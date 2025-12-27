import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatParams } from './modeTypes';
import { StorageService } from '../services/StorageService';
import { SessionManager } from '../lib/controllers/SessionManager';

interface TextModeState {
  chatParams: ChatParams;
  isWebSearchEnabled: boolean;
  isCodeExecutionEnabled: boolean;
  selectedModelId: string;
  systemPrompt: string;
  isSystemPromptEngaged: boolean;
  setIsWebSearchEnabled: (v: boolean) => void;
  setIsCodeExecutionEnabled: (v: boolean) => void;
  setSelectedModelId: (v: string) => void;
  setChatParams: (p: ChatParams) => void;
  setSystemPrompt: (v: string) => void;
  setIsSystemPromptEngaged: (v: boolean) => void;
}

const defaultState: Omit<TextModeState, 'setIsWebSearchEnabled' | 'setIsCodeExecutionEnabled' | 'setChatParams' | 'setSelectedModelId' | 'setSystemPrompt' | 'setIsSystemPromptEngaged'> = {
  chatParams: { temperature: 0.7, topP: 1.0, maxTokens: undefined },
  isWebSearchEnabled: false,
  isCodeExecutionEnabled: false,
  selectedModelId: '',
  systemPrompt: '',
  isSystemPromptEngaged: false,
};

const TextModeContext = createContext<TextModeState | null>(null);

export function TextModeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<typeof defaultState>(() => defaultState);
  const currentConversationIdRef = useRef<string | null>(null);
  const currentConversationHasMessagesRef = useRef(false);
  const pendingChatParamsRef = useRef<Record<string, ChatParams>>({});
  const latestStateRef = useRef<typeof defaultState>(defaultState);
  const loadSeqRef = useRef(0);

  const legacyStateRef = useRef<typeof defaultState | null>(null);
  const legacyConsumedRef = useRef(false);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const mgr = SessionManager.getInstance();

    const persistForConversation = async (
      conversationId: string,
      nextState: typeof defaultState,
      options?: { includeChatParams?: boolean }
    ) => {
      const includeChatParams = options?.includeChatParams ?? true;
      try {
        await StorageService.setTextConversationSettings(conversationId, {
          chatParams: includeChatParams ? nextState.chatParams : undefined,
          isWebSearchEnabled: nextState.isWebSearchEnabled,
          isCodeExecutionEnabled: nextState.isCodeExecutionEnabled,
          selectedModelId: nextState.selectedModelId,
          systemPrompt: nextState.systemPrompt,
          isSystemPromptEngaged: nextState.isSystemPromptEngaged,
        });
      } catch {
        // ignore
      }
    };

    const loadForConversation = async (conversationId: string) => {
      const seq = ++loadSeqRef.current;
      try {
        const settings = await StorageService.getConversationSettings(conversationId);
        if (seq !== loadSeqRef.current) return;

        const text = settings?.type === 'TEXT' ? settings.text : undefined;
        const pendingChatParams = pendingChatParamsRef.current[conversationId];

        if (!text && !legacyConsumedRef.current) {
          if (!legacyStateRef.current) {
            try {
              const raw = localStorage.getItem('everytalk_text_state_v1');
              if (raw) {
                const parsed = JSON.parse(raw) as Partial<typeof defaultState>;
                legacyStateRef.current = {
                  ...defaultState,
                  ...parsed,
                  chatParams: { ...defaultState.chatParams, ...(parsed.chatParams ?? {}) },
                  isWebSearchEnabled: false,
                };
              } else {
                legacyStateRef.current = null;
              }
            } catch {
              legacyStateRef.current = null;
            }
          }

          if (legacyStateRef.current) {
            const migrated = legacyStateRef.current;
            legacyConsumedRef.current = true;
            void StorageService.setTextConversationSettings(conversationId, {
              chatParams: migrated.chatParams,
              isWebSearchEnabled: migrated.isWebSearchEnabled,
              isCodeExecutionEnabled: migrated.isCodeExecutionEnabled,
              selectedModelId: migrated.selectedModelId,
              systemPrompt: migrated.systemPrompt,
              isSystemPromptEngaged: migrated.isSystemPromptEngaged,
            });

            setState(migrated);
            return;
          }
        }

        // 🎯 新会话或没有保存设置时，使用默认配置中的第一个模型
        let defaultModelId = text?.selectedModelId ?? '';
        if (!defaultModelId) {
          try {
            const configs = await StorageService.getAllApiConfigs('TEXT');
            if (seq !== loadSeqRef.current) return;
            // 优先选择默认配置，否则使用第一个配置
            const defaultConfig = configs.find(c => c.isDefault) || configs[0];
            if (defaultConfig?.models?.length) {
              defaultModelId = defaultConfig.models[0];
            }
          } catch {
            // 忽略获取配置失败的情况
          }
        }

        setState({
          chatParams: { ...defaultState.chatParams, ...(text?.chatParams ?? pendingChatParams ?? {}) },
          isWebSearchEnabled: text?.isWebSearchEnabled ?? defaultState.isWebSearchEnabled,
          isCodeExecutionEnabled: text?.isCodeExecutionEnabled ?? defaultState.isCodeExecutionEnabled,
          selectedModelId: defaultModelId,
          systemPrompt: text?.systemPrompt ?? defaultState.systemPrompt,
          isSystemPromptEngaged: text?.isSystemPromptEngaged ?? defaultState.isSystemPromptEngaged,
        });
      } catch {
        if (seq !== loadSeqRef.current) return;
        setState(defaultState);
      }
    };

    const unsub = mgr.subscribe((s) => {
      if (s.mode !== 'TEXT') return;
      if (!s.currentConversationId) return;

      const nextConversationHasMessages = s.messages.length > 0;

      // Android parity: if leaving an empty conversation that only has pending params, drop them.
      const prevId = currentConversationIdRef.current;
      if (prevId && prevId !== s.currentConversationId) {
        if (!currentConversationHasMessagesRef.current && pendingChatParamsRef.current[prevId]) {
          delete pendingChatParamsRef.current[prevId];
        }
      }

      currentConversationHasMessagesRef.current = nextConversationHasMessages;

      // Android parity: when first message appears, persist any pending params.
      if (nextConversationHasMessages && pendingChatParamsRef.current[s.currentConversationId]) {
        const pending = pendingChatParamsRef.current[s.currentConversationId];
        delete pendingChatParamsRef.current[s.currentConversationId];
        const snapshot = latestStateRef.current;
        void persistForConversation(
          s.currentConversationId,
          { ...snapshot, chatParams: pending },
          { includeChatParams: true }
        );
      }

      if (currentConversationIdRef.current !== s.currentConversationId) {
        currentConversationIdRef.current = s.currentConversationId;
        void loadForConversation(s.currentConversationId);
      }
    });

    const init = mgr.getState();
    if (init.mode === 'TEXT' && init.currentConversationId) {
      currentConversationIdRef.current = init.currentConversationId;
      currentConversationHasMessagesRef.current = init.messages.length > 0;
      void loadForConversation(init.currentConversationId);
    }

    return () => {
      unsub();
    };
  }, []);

  const persistForCurrentConversation = useCallback(async (nextState: typeof defaultState, options?: { includeChatParams?: boolean }) => {
    const conversationId = currentConversationIdRef.current;
    if (!conversationId) return;
    const includeChatParams = options?.includeChatParams ?? true;
    try {
      await StorageService.setTextConversationSettings(conversationId, {
        chatParams: includeChatParams ? nextState.chatParams : undefined,
        isWebSearchEnabled: nextState.isWebSearchEnabled,
        isCodeExecutionEnabled: nextState.isCodeExecutionEnabled,
        selectedModelId: nextState.selectedModelId,
        systemPrompt: nextState.systemPrompt,
        isSystemPromptEngaged: nextState.isSystemPromptEngaged,
      });
    } catch {
      // ignore
    }
  }, []);

  const api: TextModeState = useMemo(() => {
    const setIsWebSearchEnabled = (v: boolean) => {
      setState(prev => {
        const next = { ...prev, isWebSearchEnabled: v };
        void persistForCurrentConversation(next, { includeChatParams: currentConversationHasMessagesRef.current });
        return next;
      });
    };

    const setIsCodeExecutionEnabled = (v: boolean) => {
      setState(prev => {
        const next = { ...prev, isCodeExecutionEnabled: v };
        void persistForCurrentConversation(next, { includeChatParams: currentConversationHasMessagesRef.current });
        return next;
      });
    };

    const setChatParams = (p: ChatParams) => {
      setState(prev => {
        const next = { ...prev, chatParams: p };

        const conversationId = currentConversationIdRef.current;
        if (conversationId) {
          if (currentConversationHasMessagesRef.current) {
            delete pendingChatParamsRef.current[conversationId];
            void persistForCurrentConversation(next, { includeChatParams: true });
          } else {
            pendingChatParamsRef.current[conversationId] = p;
          }
        }

        return next;
      });
    };

    const setSelectedModelId = (v: string) => {
      setState(prev => {
        const next = { ...prev, selectedModelId: v };
        void persistForCurrentConversation(next, { includeChatParams: currentConversationHasMessagesRef.current });
        return next;
      });
    };

    const setSystemPrompt = (v: string) => {
      setState(prev => {
        const next = { ...prev, systemPrompt: v };
        void persistForCurrentConversation(next, { includeChatParams: currentConversationHasMessagesRef.current });
        return next;
      });
    };

    const setIsSystemPromptEngaged = (v: boolean) => {
      setState(prev => {
        const next = { ...prev, isSystemPromptEngaged: v };
        void persistForCurrentConversation(next, { includeChatParams: currentConversationHasMessagesRef.current });
        return next;
      });
    };

    return {
      ...state,
      setIsWebSearchEnabled,
      setIsCodeExecutionEnabled,
      setSelectedModelId,
      setChatParams,
      setSystemPrompt,
      setIsSystemPromptEngaged,
    };
  }, [state]);

  return <TextModeContext.Provider value={api}>{children}</TextModeContext.Provider>;
}

export function useTextModeState(): TextModeState {
  const ctx = useContext(TextModeContext);
  if (!ctx) throw new Error('useTextModeState must be used within TextModeProvider');
  return ctx;
}
