import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageParams } from './modeTypes';
import { StorageService } from '../services/StorageService';
import { SessionManager } from '../lib/controllers/SessionManager';

interface ImageModeState {
  imageParams: ImageParams;
  selectedModelId: string;
  setSelectedModelId: (v: string) => void;
  setImageParams: (p: ImageParams) => void;
}

const defaultState: Omit<ImageModeState, 'setSelectedModelId' | 'setImageParams'> = {
  imageParams: {
    aspectRatio: '1:1',
    steps: 30,
    guidance: 7.5,
    watermark: false,
    seedreamQuality: '2K',
    modalSize: '2K',
  },
  selectedModelId: '',
};

const ImageModeContext = createContext<ImageModeState | null>(null);

export function ImageModeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<typeof defaultState>(() => defaultState);
  const currentConversationIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const legacyStateRef = useRef<typeof defaultState | null>(null);
  const legacyConsumedRef = useRef(false);

  useEffect(() => {
    const mgr = SessionManager.getInstance();

    const loadForConversation = async (conversationId: string) => {
      const seq = ++loadSeqRef.current;
      try {
        const settings = await StorageService.getConversationSettings(conversationId);
        if (seq !== loadSeqRef.current) return;

        const image = settings?.type === 'IMAGE' ? settings.image : undefined;

        if (!image && !legacyConsumedRef.current) {
          if (!legacyStateRef.current) {
            try {
              const raw = localStorage.getItem('everytalk_image_state_v1');
              if (raw) {
                const parsed = JSON.parse(raw) as Partial<typeof defaultState>;
                legacyStateRef.current = {
                  ...defaultState,
                  ...parsed,
                  imageParams: { ...defaultState.imageParams, ...(parsed.imageParams ?? {}) },
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
            void StorageService.setImageConversationSettings(conversationId, {
              imageParams: migrated.imageParams,
              selectedModelId: migrated.selectedModelId,
            });

            setState(migrated);
            return;
          }
        }

        // 🎯 新会话或没有保存设置时，使用默认配置中的第一个模型
        let defaultModelId = image?.selectedModelId ?? '';
        if (!defaultModelId) {
          try {
            const configs = await StorageService.getAllApiConfigs('IMAGE');
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
          imageParams: { ...defaultState.imageParams, ...(image?.imageParams ?? {}) },
          selectedModelId: defaultModelId,
        });
      } catch {
        if (seq !== loadSeqRef.current) return;
        setState(defaultState);
      }
    };

    const unsub = mgr.subscribe((s) => {
      if (s.mode !== 'IMAGE') return;
      if (!s.currentConversationId) return;

      if (currentConversationIdRef.current !== s.currentConversationId) {
        currentConversationIdRef.current = s.currentConversationId;
        void loadForConversation(s.currentConversationId);
      }
    });

    const init = mgr.getState();
    if (init.mode === 'IMAGE' && init.currentConversationId) {
      currentConversationIdRef.current = init.currentConversationId;
      void loadForConversation(init.currentConversationId);
    }

    return () => {
      unsub();
    };
  }, []);

  const persistForCurrentConversation = useCallback(async (nextState: typeof defaultState) => {
    const conversationId = currentConversationIdRef.current;
    if (!conversationId) return;
    try {
      await StorageService.setImageConversationSettings(conversationId, {
        imageParams: nextState.imageParams,
        selectedModelId: nextState.selectedModelId,
      });
    } catch {
      // ignore
    }
  }, []);

  const api: ImageModeState = useMemo(() => {
    const setSelectedModelId = (v: string) => {
      setState(prev => {
        const next = { ...prev, selectedModelId: v };
        void persistForCurrentConversation(next);
        return next;
      });
    };

    const setImageParams = (p: ImageParams) => {
      setState(prev => {
        const next = { ...prev, imageParams: p };
        void persistForCurrentConversation(next);
        return next;
      });
    };

    return {
      ...state,
      setSelectedModelId,
      setImageParams,
    };
  }, [state]);

  return <ImageModeContext.Provider value={api}>{children}</ImageModeContext.Provider>;
}

export function useImageModeState(): ImageModeState {
  const ctx = useContext(ImageModeContext);
  if (!ctx) throw new Error('useImageModeState must be used within ImageModeProvider');
  return ctx;
}
