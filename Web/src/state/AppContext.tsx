import React, { createContext, useContext, useMemo, useState } from 'react';

export type ChannelType = 'OpenAI兼容' | 'Gemini';

export interface ModelConfig {
  id: string;
  provider: string;
  address: string;
  key: string;
  channel: ChannelType;
  model: string;
}

export interface ChatParams {
  temperature: number;
  topP: number;
  maxTokens?: number;
}

export interface ImageParams {
  aspectRatio: string;
  steps: number;
  guidance: number;
}

interface AppState {
  textConfig: ModelConfig;
  imageConfig: ModelConfig;
  chatParams: ChatParams;
  imageParams: ImageParams;
  isWebSearchEnabled: boolean;
  setIsWebSearchEnabled: (v: boolean) => void;
  setTextConfig: (cfg: ModelConfig) => void;
  setImageConfig: (cfg: ModelConfig) => void;
  setChatParams: (p: ChatParams) => void;
  setImageParams: (p: ImageParams) => void;
}

const STORAGE_KEY = 'everytalk_web_state_v1';

const defaultState: Omit<AppState, 'setIsWebSearchEnabled' | 'setTextConfig' | 'setImageConfig' | 'setChatParams' | 'setImageParams'> = {
  textConfig: {
    id: 'default-text',
    provider: 'OpenAI',
    address: 'https://api.openai.com/v1',
    key: '',
    channel: 'OpenAI兼容',
    model: 'gpt-4o',
  },
  imageConfig: {
    id: 'default-image',
    provider: 'OpenAI',
    address: 'https://api.openai.com/v1',
    key: '',
    channel: 'OpenAI兼容',
    model: 'gpt-image-1',
  },
  chatParams: { temperature: 0.7, topP: 1.0, maxTokens: undefined },
  imageParams: { aspectRatio: '1:1', steps: 30, guidance: 7.5 },
  isWebSearchEnabled: false,
};

function loadInitial(): typeof defaultState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<typeof defaultState>;
    return {
      ...defaultState,
      ...parsed,
      textConfig: { ...defaultState.textConfig, ...(parsed.textConfig ?? {}) },
      imageConfig: { ...defaultState.imageConfig, ...(parsed.imageConfig ?? {}) },
      chatParams: { ...defaultState.chatParams, ...(parsed.chatParams ?? {}) },
      imageParams: { ...defaultState.imageParams, ...(parsed.imageParams ?? {}) },
    };
  } catch {
    return defaultState;
  }
}

function persist(state: typeof defaultState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<typeof defaultState>(() => loadInitial());

  const api: AppState = useMemo(() => {
    const setIsWebSearchEnabled = (v: boolean) => {
      setState(prev => {
        const next = { ...prev, isWebSearchEnabled: v };
        persist(next);
        return next;
      });
    };

    const setTextConfig = (cfg: ModelConfig) => {
      setState(prev => {
        const next = { ...prev, textConfig: cfg };
        persist(next);
        return next;
      });
    };

    const setImageConfig = (cfg: ModelConfig) => {
      setState(prev => {
        const next = { ...prev, imageConfig: cfg };
        persist(next);
        return next;
      });
    };

    const setChatParams = (p: ChatParams) => {
      setState(prev => {
        const next = { ...prev, chatParams: p };
        persist(next);
        return next;
      });
    };

    const setImageParams = (p: ImageParams) => {
      setState(prev => {
        const next = { ...prev, imageParams: p };
        persist(next);
        return next;
      });
    };

    return {
      ...state,
      setIsWebSearchEnabled,
      setTextConfig,
      setImageConfig,
      setChatParams,
      setImageParams,
    };
  }, [state]);

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}
