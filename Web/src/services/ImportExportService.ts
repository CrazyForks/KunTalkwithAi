import { db, type ApiConfig, type Conversation, type Message, type ConversationGroup, type ConversationSettings, type TextConversationSettings } from '../db';

type AndroidModalityType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'MULTIMODAL';

type AndroidSender = 'User' | 'AI' | 'System' | 'Tool';

interface AndroidApiConfig {
    address: string;
    key: string;
    model: string;
    provider: string;
    id: string;
    name: string;
    channel?: string;
    isValid?: boolean;
    modalityType?: AndroidModalityType;
    temperature?: number;
    topP?: number | null;
    maxTokens?: number | null;
    defaultUseWebSearch?: boolean | null;
    imageSize?: string | null;
    numInferenceSteps?: number | null;
    guidanceScale?: number | null;
    toolsJson?: string | null;
    enableCodeExecution?: boolean | null;
}

interface AndroidThinkingConfig {
    include_thoughts?: boolean | null;
    thinking_budget?: number | null;
}

interface AndroidGenerationConfig {
    temperature?: number | null;
    top_p?: number | null;
    max_output_tokens?: number | null;
    thinking_config?: AndroidThinkingConfig | null;
}

interface AndroidExportedMessage {
    id: string;
    text: string;
    sender: string;
    reasoning?: string | null;
    timestamp: number;
    isError?: boolean;
    imageUrls?: string[] | null;
}

interface AndroidExportedConversation {
    id: string;
    messages: AndroidExportedMessage[];
    createdAt: number;
    lastModifiedAt: number;
}

interface AndroidExportedSettings {
    version?: number;
    exportTimestamp?: number;
    apiConfigs: AndroidApiConfig[];
    customProviders?: string[];
    conversationParameters?: Record<string, AndroidGenerationConfig>;
    voiceBackendConfigs?: unknown[];
    chatHistory?: AndroidExportedConversation[];
    imageGenerationHistory?: AndroidExportedConversation[];
    pinnedTextIds?: string[];
    pinnedImageIds?: string[];
    conversationGroups?: Record<string, string[]>;
}

const EXPORT_VERSION = 3;
const OBFUSCATION_PREFIX = 'EZT_OBF_V1:';
const XOR_KEY = 0x5a;
const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;

function xorBytes(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        out[i] = bytes[i] ^ XOR_KEY;
    }
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function obfuscateKey(key: string): string {
    if (!key?.trim()) return key;
    try {
        const encoded = new TextEncoder().encode(key);
        const xored = xorBytes(encoded);
        return OBFUSCATION_PREFIX + bytesToBase64(xored);
    } catch {
        return key;
    }
}

function deobfuscateKey(key: string): string {
    if (!key?.trim()) return key;
    if (!key.startsWith(OBFUSCATION_PREFIX)) return key;
    try {
        const base64 = key.slice(OBFUSCATION_PREFIX.length);
        const bytes = base64ToBytes(base64);
        const original = xorBytes(bytes);
        return new TextDecoder().decode(original);
    } catch {
        return key;
    }
}

function mapWebRoleToAndroidSender(role: Message['role']): AndroidSender {
    switch (role) {
        case 'user':
            return 'User';
        case 'ai':
            return 'AI';
        case 'system':
            return 'System';
        case 'tool':
            return 'Tool';
        default:
            return 'User';
    }
}

function mapAndroidSenderToWebRole(sender: string): Message['role'] {
    switch (sender) {
        case 'User':
            return 'user';
        case 'AI':
            return 'ai';
        case 'System':
            return 'system';
        case 'Tool':
            return 'tool';
        default:
            return 'user';
    }
}

function downloadTextFile(fileName: string, content: string, mime = 'application/json') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function normalizeBaseUrl(url: string): string {
    let v = (url ?? '').trim();
    if (v.endsWith('/')) v = v.slice(0, -1);
    return v;
}

function safeJsonParse(text: string): unknown {
    return JSON.parse(text);
}

function buildSettingsFromWeb(includeHistory: boolean, data: {
    apiConfigs: ApiConfig[];
    conversations: Conversation[];
    groups: ConversationGroup[];
    messagesByConversationId: Map<string, Message[]>;
    conversationSettingsByConversationId: Map<string, ConversationSettings | undefined>;
}): AndroidExportedSettings {
    const androidApiConfigs: AndroidApiConfig[] = [];
    for (const cfg of data.apiConfigs) {
        const models = Array.isArray(cfg.models) ? cfg.models : [];
        if (models.length === 0) continue;
        for (const model of models) {
            androidApiConfigs.push({
                address: normalizeBaseUrl(cfg.baseUrl),
                key: obfuscateKey(cfg.apiKey ?? ''),
                model,
                provider: cfg.provider,
                id: `${cfg.id}::${model}`,
                name: cfg.name || cfg.provider,
                channel: cfg.channel ?? 'OpenAI兼容',
                isValid: true,
                modalityType: cfg.modality,
                toolsJson: cfg.toolsJson ?? null,
            });
        }
    }

    const conversationParameters: Record<string, AndroidGenerationConfig> = {};
    for (const c of data.conversations) {
        if (c.type !== 'TEXT') continue;
        const settings = data.conversationSettingsByConversationId.get(c.id);
        const text = settings?.type === 'TEXT' ? settings.text : undefined;
        const chatParams = text?.chatParams;
        if (!chatParams) continue;
        conversationParameters[c.id] = {
            temperature: chatParams.temperature,
            top_p: chatParams.topP,
            max_output_tokens: chatParams.maxTokens ?? null,
            thinking_config: null,
        };
    }

    const pinnedTextIds = data.conversations.filter(c => c.type === 'TEXT' && c.isPinned).map(c => c.id);
    const pinnedImageIds = data.conversations.filter(c => c.type === 'IMAGE' && c.isPinned).map(c => c.id);

    const conversationGroups: Record<string, string[]> = {};
    for (const g of data.groups) {
        conversationGroups[g.name] = Array.isArray(g.conversationIds) ? g.conversationIds : [];
    }

    const chatHistory: AndroidExportedConversation[] = [];
    const imageGenerationHistory: AndroidExportedConversation[] = [];

    if (includeHistory) {
        for (const c of data.conversations) {
            const messages = data.messagesByConversationId.get(c.id) ?? [];
            const exported: AndroidExportedConversation = {
                id: c.id,
                createdAt: c.createdAt,
                lastModifiedAt: c.updatedAt,
                messages: messages.map(m => {
                    const images = (m.images ?? []).filter(u => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://')));
                    return {
                        id: m.id,
                        text: m.text,
                        sender: mapWebRoleToAndroidSender(m.role),
                        reasoning: m.reasoning ?? null,
                        timestamp: m.timestamp,
                        isError: !!m.isError,
                        imageUrls: images.length > 0 ? images : null,
                    };
                }),
            };

            if (c.type === 'TEXT') chatHistory.push(exported);
            if (c.type === 'IMAGE') imageGenerationHistory.push(exported);
        }
    }

    return {
        version: EXPORT_VERSION,
        exportTimestamp: Date.now(),
        apiConfigs: androidApiConfigs,
        customProviders: [],
        conversationParameters,
        voiceBackendConfigs: [],
        chatHistory,
        imageGenerationHistory,
        pinnedTextIds,
        pinnedImageIds,
        conversationGroups,
    };
}

function normalizeAndroidModality(v: unknown): AndroidModalityType {
    if (v === 'IMAGE' || v === 'TEXT' || v === 'AUDIO' || v === 'VIDEO' || v === 'MULTIMODAL') return v;
    return 'TEXT';
}

function groupAndroidApiConfigsToWeb(androidConfigs: AndroidApiConfig[]): { text: ApiConfig[]; image: ApiConfig[] } {
    const byKey = new Map<string, { base: Omit<ApiConfig, 'id' | 'models' | 'isDefault'>; name: string; models: Set<string>; existingIds: Set<string> }>();

    const imageModels = new Set<string>();
    let imageSeed: { baseUrl: string; apiKey: string; channel?: ApiConfig['channel']; toolsJson?: string } | null = null;

    for (const c of androidConfigs) {
        const modality = normalizeAndroidModality(c.modalityType);
        const webModality: ApiConfig['modality'] = modality === 'IMAGE' ? 'IMAGE' : 'TEXT';

        const provider = (c.provider ?? '').trim();
        const baseUrl = normalizeBaseUrl(c.address ?? '');
        const apiKey = deobfuscateKey(c.key ?? '');
        const channel = (c.channel ?? 'OpenAI兼容') as ApiConfig['channel'];
        const toolsJson = (c.toolsJson ?? undefined) as string | undefined;

        if (webModality === 'IMAGE') {
            if (c.model?.trim()) imageModels.add(c.model.trim());
            if (!imageSeed) {
                imageSeed = {
                    baseUrl,
                    apiKey,
                    channel,
                    toolsJson,
                };
            }
            continue;
        }

        const k = [webModality, provider, baseUrl, apiKey, channel, toolsJson ?? ''].join('|');
        if (!byKey.has(k)) {
            byKey.set(k, {
                base: {
                    provider,
                    name: (c.name ?? provider).trim() || provider,
                    baseUrl,
                    apiKey,
                    channel,
                    modality: webModality,
                    toolsJson,
                },
                name: (c.name ?? provider).trim() || provider,
                models: new Set<string>(),
                existingIds: new Set<string>(),
            });
        }
        const entry = byKey.get(k)!;
        if (c.model?.trim()) entry.models.add(c.model.trim());
        if (c.id?.trim()) entry.existingIds.add(c.id.trim());
        if (c.name?.trim()) entry.name = c.name.trim();
    }

    const text: ApiConfig[] = [];
    const image: ApiConfig[] = [];

    for (const v of byKey.values()) {
        const idPrefix = v.base.modality === 'IMAGE' ? 'image' : 'text';
        const id = `${idPrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const cfg: ApiConfig = {
            id,
            provider: v.base.provider,
            name: v.name,
            baseUrl: v.base.baseUrl,
            apiKey: v.base.apiKey,
            models: Array.from(v.models),
            channel: v.base.channel,
            modality: v.base.modality,
            toolsJson: v.base.toolsJson,
            isDefault: false,
        };

        text.push(cfg);
    }

    if (imageModels.size > 0) {
        const seed = imageSeed;
        image.push({
            id: 'default_image_config',
            provider: 'SystemDefault',
            name: '默认配置',
            baseUrl: seed?.baseUrl ?? '',
            apiKey: seed?.apiKey ?? '',
            models: Array.from(imageModels),
            channel: seed?.channel ?? 'OpenAI兼容',
            modality: 'IMAGE',
            toolsJson: seed?.toolsJson,
            isDefault: true,
        });
    }

    return { text, image };
}

async function mergeConfigs(imported: ApiConfig[]) {
    const existing = await db.apiConfigs.toArray();

    const keyOf = (c: ApiConfig) => [c.modality, c.provider, normalizeBaseUrl(c.baseUrl), c.apiKey, c.channel ?? '', c.toolsJson ?? ''].join('|');

    const existingByKey = new Map<string, ApiConfig>();
    for (const c of existing) {
        existingByKey.set(keyOf(c), c);
    }

    for (const c of imported) {
        if (c.modality === 'IMAGE') {
            const existingDefault = await db.apiConfigs.get('default_image_config');
            const mergedModels = Array.from(new Set([...(existingDefault?.models ?? []), ...(c.models ?? [])])).filter(Boolean);
            await db.apiConfigs.put({
                id: 'default_image_config',
                provider: existingDefault?.provider ?? c.provider,
                name: existingDefault?.name ?? c.name,
                baseUrl: existingDefault?.baseUrl ? existingDefault.baseUrl : c.baseUrl,
                apiKey: existingDefault?.apiKey ? existingDefault.apiKey : c.apiKey,
                models: mergedModels,
                channel: (existingDefault?.channel ?? c.channel) as ApiConfig['channel'],
                modality: 'IMAGE',
                toolsJson: existingDefault?.toolsJson ?? c.toolsJson,
                isDefault: true,
            });
            continue;
        }

        const k = keyOf(c);
        const hit = existingByKey.get(k);
        if (hit) {
            const mergedModels = Array.from(new Set([...(hit.models ?? []), ...(c.models ?? [])])).filter(Boolean);
            await db.apiConfigs.put({
                ...hit,
                name: c.name || hit.name,
                baseUrl: c.baseUrl || hit.baseUrl,
                apiKey: c.apiKey ?? hit.apiKey,
                channel: c.channel ?? hit.channel,
                toolsJson: c.toolsJson ?? hit.toolsJson,
                models: mergedModels,
            });
        } else {
            await db.apiConfigs.put(c);
            existingByKey.set(k, c);
        }
    }
}

async function mergeGroups(groups: Record<string, string[]>) {
    const existing = await db.groups.toArray();
    const byName = new Map<string, ConversationGroup>();
    for (const g of existing) {
        byName.set(g.name, g);
    }

    for (const [name, ids] of Object.entries(groups)) {
        const safeIds = (ids ?? []).filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
        const hit = byName.get(name);
        if (hit) {
            const merged = Array.from(new Set([...(hit.conversationIds ?? []), ...safeIds]));
            await db.groups.put({ ...hit, conversationIds: merged });
        } else {
            const id = `group_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            await db.groups.put({
                id,
                name,
                conversationIds: safeIds,
                createdAt: Date.now(),
            });
        }
    }
}

async function applyPinnedIds(textIds: string[], imageIds: string[]) {
    const all = await db.conversations.toArray();
    const textSet = new Set((textIds ?? []).filter(Boolean));
    const imageSet = new Set((imageIds ?? []).filter(Boolean));

    for (const c of all) {
        const shouldPin = (c.type === 'TEXT' && textSet.has(c.id)) || (c.type === 'IMAGE' && imageSet.has(c.id));
        if (shouldPin && !c.isPinned) {
            await db.conversations.put({ ...c, isPinned: true });
        }
    }
}

async function importConversationParameters(params: Record<string, AndroidGenerationConfig>) {
    for (const [conversationId, cfg] of Object.entries(params ?? {})) {
        const conversation = await db.conversations.get(conversationId);
        if (!conversation || conversation.type !== 'TEXT') continue;

        const settings = await db.conversationSettings.get(conversationId);
        const text: TextConversationSettings = (settings?.type === 'TEXT' ? settings.text : undefined) ?? {
            chatParams: { temperature: 0.7, topP: 1.0 },
            isWebSearchEnabled: false,
            isCodeExecutionEnabled: false,
            selectedModelId: '',
            systemPrompt: '',
            isSystemPromptEngaged: false,
        };

        const prev = text.chatParams ?? { temperature: 0.7, topP: 1.0 };
        const nextChatParams = {
            temperature: (cfg?.temperature ?? prev.temperature) as number,
            topP: (cfg?.top_p ?? prev.topP) as number,
            maxTokens: (cfg?.max_output_tokens ?? prev.maxTokens) ?? undefined,
        };

        await db.conversationSettings.put({
            conversationId,
            type: 'TEXT',
            text: {
                ...text,
                chatParams: nextChatParams,
            },
            updatedAt: Date.now(),
        });
    }
}

async function importHistory(list: AndroidExportedConversation[], type: Conversation['type']): Promise<{ imported: number; skipped: number }>{
    let imported = 0;
    let skipped = 0;

    for (const conv of list ?? []) {
        const existingConversation = await db.conversations.get(conv.id);
        if (existingConversation) {
            skipped++;
            continue;
        }

        const messageIds = (conv.messages ?? []).map(m => m.id).filter(Boolean);
        const existingCount = messageIds.length > 0 ? await db.messages.where('id').anyOf(messageIds).count() : 0;
        if (existingCount > 0) {
            skipped++;
            continue;
        }

        await db.conversations.put({
            id: conv.id,
            type,
            title: 'New Chat',
            createdAt: conv.createdAt ?? Date.now(),
            updatedAt: conv.lastModifiedAt ?? Date.now(),
            isPinned: false,
            pinnedOrder: 0,
        });

        for (const m of conv.messages ?? []) {
            const images = (m.imageUrls ?? []).filter(u => typeof u === 'string');
            await db.messages.put({
                id: m.id,
                conversationId: conv.id,
                text: m.text ?? '',
                role: mapAndroidSenderToWebRole(m.sender),
                reasoning: m.reasoning ?? undefined,
                isError: !!m.isError,
                timestamp: m.timestamp ?? Date.now(),
                images: images.length ? images : undefined,
            });
        }

        imported++;
    }

    return { imported, skipped };
}

function parseAndroidExportedSettings(jsonText: string): { settings: AndroidExportedSettings; warnings: string[] } {
    if (jsonText.length > MAX_IMPORT_FILE_SIZE) {
        throw new Error('导入文件过大（最大支持50MB）');
    }

    const warnings: string[] = [];
    const parsed = safeJsonParse(jsonText);

    if (Array.isArray(parsed)) {
        warnings.push('检测到旧版本格式(v1)，已自动转换');
        return {
            warnings,
            settings: {
                version: 1,
                exportTimestamp: Date.now(),
                apiConfigs: parsed as AndroidApiConfig[],
                customProviders: [],
                conversationParameters: {},
                voiceBackendConfigs: [],
                chatHistory: [],
                imageGenerationHistory: [],
                pinnedTextIds: [],
                pinnedImageIds: [],
                conversationGroups: {},
            },
        };
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('无法解析导入文件：JSON根节点不是对象');
    }

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.apiConfigs)) {
        throw new Error('无法解析导入文件：缺少 apiConfigs');
    }

    const version = typeof obj.version === 'number' ? obj.version : 2;
    if (version < 2) warnings.push('检测到v1格式，已自动兼容');
    if (version === 2) warnings.push('检测到v2格式（无密钥混淆），已自动兼容');
    if (version > EXPORT_VERSION) warnings.push(`检测到较新版本格式 (v${version})，部分新功能可能不支持`);

    return {
        warnings,
        settings: {
            version,
            exportTimestamp: typeof obj.exportTimestamp === 'number' ? obj.exportTimestamp : Date.now(),
            apiConfigs: obj.apiConfigs as AndroidApiConfig[],
            customProviders: (obj.customProviders as string[]) ?? [],
            conversationParameters: (obj.conversationParameters as Record<string, AndroidGenerationConfig>) ?? {},
            voiceBackendConfigs: (obj.voiceBackendConfigs as unknown[]) ?? [],
            chatHistory: (obj.chatHistory as AndroidExportedConversation[]) ?? [],
            imageGenerationHistory: (obj.imageGenerationHistory as AndroidExportedConversation[]) ?? [],
            pinnedTextIds: (obj.pinnedTextIds as string[]) ?? [],
            pinnedImageIds: (obj.pinnedImageIds as string[]) ?? [],
            conversationGroups: (obj.conversationGroups as Record<string, string[]>) ?? {},
        },
    };
}

export const ImportExportService = {
    async exportToFile(includeHistory: boolean) {
        const [apiConfigs, conversations, groups] = await Promise.all([
            db.apiConfigs.toArray(),
            db.conversations.toArray(),
            db.groups.toArray(),
        ]);

        const messagesByConversationId = new Map<string, Message[]>();
        const conversationSettingsByConversationId = new Map<string, ConversationSettings | undefined>();

        if (includeHistory) {
            for (const c of conversations) {
                const messages = await db.messages.where('conversationId').equals(c.id).sortBy('timestamp');
                messagesByConversationId.set(c.id, messages);
            }
        }

        for (const c of conversations) {
            const s = await db.conversationSettings.get(c.id);
            conversationSettingsByConversationId.set(c.id, s);
        }

        const settings = buildSettingsFromWeb(includeHistory, {
            apiConfigs,
            conversations,
            groups,
            messagesByConversationId,
            conversationSettingsByConversationId,
        });

        const json = JSON.stringify(settings, null, 2);
        const fileNameBase = includeHistory ? 'eztalk_full_backup' : 'eztalk_settings';
        downloadTextFile(`${fileNameBase}.json`, json);
    },

    async importFromJson(jsonText: string): Promise<{ message: string; warnings: string[] }>{
        const { settings, warnings } = parseAndroidExportedSettings(jsonText);
        const importedWeb = groupAndroidApiConfigsToWeb(settings.apiConfigs ?? []);

        const result: { configsImported: number; chatHistoryImported: number; imageHistoryImported: number; warnings: string[]; errors: string[] } = {
            configsImported: 0,
            chatHistoryImported: 0,
            imageHistoryImported: 0,
            warnings: [...warnings],
            errors: [],
        };

        await db.transaction('rw', [db.apiConfigs, db.conversations, db.messages, db.groups, db.conversationSettings], async () => {
            await mergeConfigs([...importedWeb.text, ...importedWeb.image]);
            result.configsImported = settings.apiConfigs?.length ?? 0;

            if (settings.chatHistory?.length) {
                const r = await importHistory(settings.chatHistory, 'TEXT');
                result.chatHistoryImported = r.imported;
                if (r.skipped > 0) result.warnings.push(`跳过了 ${r.skipped} 个重复的会话`);
            }

            if (settings.imageGenerationHistory?.length) {
                const r = await importHistory(settings.imageGenerationHistory, 'IMAGE');
                result.imageHistoryImported = r.imported;
                if (r.skipped > 0) result.warnings.push(`跳过了 ${r.skipped} 个重复的图像会话`);
            }

            if (settings.conversationGroups && Object.keys(settings.conversationGroups).length > 0) {
                await mergeGroups(settings.conversationGroups);
            }

            if (settings.pinnedTextIds?.length || settings.pinnedImageIds?.length) {
                await applyPinnedIds(settings.pinnedTextIds ?? [], settings.pinnedImageIds ?? []);
            }

            if (settings.conversationParameters && Object.keys(settings.conversationParameters).length > 0) {
                await importConversationParameters(settings.conversationParameters);
            }
        });

        const successItems: string[] = [];
        if (result.configsImported > 0) successItems.push(`${result.configsImported}个API配置`);
        if (result.chatHistoryImported > 0) successItems.push(`${result.chatHistoryImported}个聊天会话`);
        if (result.imageHistoryImported > 0) successItems.push(`${result.imageHistoryImported}个图像会话`);

        let message = successItems.length ? `成功导入: ${successItems.join(', ')}` : '导入完成，未发现有效数据';
        if (result.warnings.length) {
            message += `\n⚠️ ${result.warnings.length}个警告`;
            const details = result.warnings.slice(0, 3);
            for (const w of details) message += `\n  - ${w}`;
            if (result.warnings.length > 3) message += `\n  - ...还有${result.warnings.length - 3}个警告`;
        }

        return { message, warnings: result.warnings };
    },
};
