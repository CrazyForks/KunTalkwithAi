import Dexie, { type Table } from 'dexie';

// --- Interfaces matching Android Entities ---

export interface Conversation {
    id: string;
    type: 'TEXT' | 'IMAGE';
    title?: string;
    systemPrompt?: string;
    createdAt: number;
    updatedAt: number;
    isPinned: boolean;
    pinnedOrder: number;
    // Helper to store group membership if needed directly, or join table
    groupId?: string;
}

export interface Message {
    id: string;
    conversationId: string;
    text: string;
    role: 'user' | 'ai' | 'system' | 'tool';
    
    // Additional Metadata
    reasoning?: string; // Chain of thought content
    isError?: boolean;
    timestamp: number;
    
    // Multimodal & Advanced Features
    images?: string[]; // URLs or Base64
    attachments?: Attachment[];
    
    // Web Search
    webSearchStage?: string;
    webSearchResults?: WebSearchResult[];
    
    // Grounding / Citations
    groundingMetadata?: any;
    
    // Code Execution
    codeExecution?: {
        code: string;
        language: string;
        output?: string;
        outcome?: 'success' | 'error';
    };
}

export interface Attachment {
    type: 'file' | 'image' | 'audio' | 'video';
    name: string;
    uri: string; // Base64 or Blob URL
    mimeType: string;
}

export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface ApiConfig {
    id: string;
    provider: string; // 'OpenAI', 'Gemini', 'Custom', etc.
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[]; // List of available models for this config
    channel?: 'OpenAI兼容' | 'Gemini';
    updatedAt?: number;
    
    // Custom Tools (JSON String)
    toolsJson?: string;

    // Default Parameters
    isDefault?: boolean;
    modality: 'TEXT' | 'IMAGE';
}

export interface ConversationGroup {
    id: string;
    name: string;
    conversationIds: string[];
    createdAt: number;
    updatedAt?: number;
}

export interface Tombstone {
    kind: 'conversation' | 'message' | 'apiConfig' | 'group' | 'conversationSetting';
    targetId: string;
    deletedAt: number;
}

export interface TextConversationSettings {
    chatParams?: {
        temperature: number;
        topP: number;
        maxTokens?: number;
    };
    isWebSearchEnabled: boolean;
    isCodeExecutionEnabled: boolean;
    selectedModelId: string;
    systemPrompt: string;
    isSystemPromptEngaged: boolean;
}

export interface ImageConversationSettings {
    imageParams: {
        aspectRatio: string;
        steps: number;
        guidance: number;
        watermark?: boolean;
        seedreamQuality?: '2K' | '4K';
        geminiImageSize?: '2K' | '4K';
        modalSize?: '2K' | 'HD';
    };
    selectedModelId: string;
}

export interface ConversationSettings {
    conversationId: string;
    type: 'TEXT' | 'IMAGE';
    text?: TextConversationSettings;
    image?: ImageConversationSettings;
    updatedAt: number;
}

// --- Database Class ---

export class EveryTalkDatabase extends Dexie {
    conversations!: Table<Conversation>;
    messages!: Table<Message>;
    apiConfigs!: Table<ApiConfig>;
    groups!: Table<ConversationGroup>;
    conversationSettings!: Table<ConversationSettings>;
    tombstones!: Table<Tombstone>;

    constructor() {
        super('EveryTalkDB');
        
        // Define Schema
        this.version(1).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality',
            groups: 'id, name'
        });

        this.version(2).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality',
            groups: 'id, name',
            conversationSettings: 'conversationId, type, updatedAt'
        });

        // Version 3: Attempted cleanup (might have failed if connection was open)
        this.version(3).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality',
            groups: 'id, name',
            conversationSettings: 'conversationId, type, updatedAt'
        });

        // Upgrade to version 4: Force cleanup of ALL image configs and re-insert ONLY the default one
        this.version(4).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality',
            groups: 'id, name',
            conversationSettings: 'conversationId, type, updatedAt'
        });

        // Version 5: Force re-cleanup of all IMAGE configs - ensures single default config
        this.version(5).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality',
            groups: 'id, name',
            conversationSettings: 'conversationId, type, updatedAt'
        }).upgrade(async trans => {
            // Delete ALL existing image configs
            await trans.table('apiConfigs')
                .filter((c: ApiConfig) => c.modality === 'IMAGE')
                .delete();
            
            // Re-add the single default config
            const siliconFlowUrl = import.meta.env.VITE_SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/images/generations';
            let sfBase = siliconFlowUrl;
            if (sfBase.includes('/images/generations')) {
                sfBase = sfBase.replace('/images/generations', '');
            }
            if (sfBase.endsWith('/v1')) {
                sfBase = sfBase.replace('/v1', '');
            }
            if (sfBase.endsWith('/')) sfBase = sfBase.slice(0, -1);

            const siliconModel = import.meta.env.VITE_SILICONFLOW_DEFAULT_MODEL || 'Kwai-Kolors/Kolors';
            
            await trans.table('apiConfigs').add({
                id: 'default_image_config',
                provider: 'SystemDefault',
                name: '默认配置',
                baseUrl: sfBase,
                apiKey: import.meta.env.VITE_SILICONFLOW_API_KEY || '',
                models: [
                    'Z-image-turbo-modal',
                    'qwen-image-edit-modal',
                    siliconModel
                ],
                channel: 'OpenAI兼容',
                modality: 'IMAGE',
                isDefault: true
            });
        });

        this.version(6).stores({
            conversations: 'id, type, createdAt, updatedAt, isPinned',
            messages: 'id, conversationId, role, timestamp',
            apiConfigs: 'id, provider, modality, updatedAt',
            groups: 'id, name, updatedAt',
            conversationSettings: 'conversationId, type, updatedAt',
            tombstones: '[kind+targetId], deletedAt'
        });

        this.on('populate', this.populate.bind(this));
    }

    async populate() {
        // --- System Default Image Config (One Card, Multiple Providers) ---
        // This runs on fresh install.
        
        const siliconFlowUrl = import.meta.env.VITE_SILICONFLOW_API_URL || 'https://api.siliconflow.cn/v1/images/generations';
        let sfBase = siliconFlowUrl;
        if (sfBase.includes('/images/generations')) {
            sfBase = sfBase.replace('/images/generations', '');
        }
        if (sfBase.endsWith('/v1')) {
            sfBase = sfBase.replace('/v1', '');
        }
        if (sfBase.endsWith('/')) sfBase = sfBase.slice(0, -1);

        const siliconModel = import.meta.env.VITE_SILICONFLOW_DEFAULT_MODEL || 'Kwai-Kolors/Kolors';
        
        const models = [
            'Z-image-turbo-modal',
            'qwen-image-edit-modal',
            siliconModel
        ];

        await this.apiConfigs.add({
            id: 'default_image_config',
            provider: 'SystemDefault',
            name: '默认配置',
            baseUrl: sfBase,
            apiKey: import.meta.env.VITE_SILICONFLOW_API_KEY || '',
            models: models,
            channel: 'OpenAI兼容',
            modality: 'IMAGE',
            isDefault: true
        });
    }
}

export const db = new EveryTalkDatabase();