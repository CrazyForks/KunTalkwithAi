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
  watermark?: boolean;
  seedreamQuality?: '2K' | '4K';
  geminiImageSize?: '2K' | '4K';
  modalSize?: '2K' | 'HD';
}
