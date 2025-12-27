import { type ApiConfig, type WebSearchResult } from '../db';
import { WebSearchService } from './WebSearchService';
import { SystemPromptInjector } from '../lib/controllers/SystemPromptInjector';

type ChatContentPart =
    | { type: 'text'; text?: string }
    | { type: 'image_url'; image_url?: { url?: string } }
    | { type: 'input_audio'; input_audio?: unknown };

export type StreamEvent =
    | { type: 'reasoning'; data: string }
    | { type: 'web_search_status'; data: string }
    | { type: 'web_search_results'; data: WebSearchResult[] }
    | { type: 'grounding_metadata'; data: any }
    | { type: 'code_executable'; data: { code: string; language: string } }
    | { type: 'code_execution_result'; data: { output?: string; outcome?: 'success' | 'error'; imageUrl?: string } }
    | { type: 'error'; data: { message: string; upstreamStatus?: number } };

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
    return typeof v === 'object' && v !== null;
}

function getString(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function getBoolean(v: unknown): boolean | undefined {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true') return true;
        if (s === 'false') return false;
    }
    if (typeof v === 'number') {
        if (v === 1) return true;
        if (v === 0) return false;
    }
    return undefined;
}

function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
    if (!m) return null;
    return { mimeType: m[1] || 'application/octet-stream', base64: m[2] || '' };
}

function mergeGeminiContents(contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }>) {
    const merged: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
    for (const c of contents) {
        if (!c.parts || c.parts.length === 0) continue;
        const last = merged[merged.length - 1];
        if (last && last.role === c.role) {
            last.parts.push(...c.parts);
        } else {
            merged.push({ role: c.role, parts: [...c.parts] });
        }
    }

    while (merged.length > 0 && merged[0].role === 'model') {
        merged.shift();
    }

    const finalMerged: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
    for (const c of merged) {
        const last = finalMerged[finalMerged.length - 1];
        if (last && last.role === c.role) {
            last.parts.push(...c.parts);
        } else {
            finalMerged.push({ role: c.role, parts: [...c.parts] });
        }
    }

    return finalMerged;
}

function normalizeOpenAIMessagesForGemini(
    messages: Array<{ role: string; content: string | ChatContentPart[] }>
): Array<{ role: string; content: string | ChatContentPart[] }> {
    // Keep system messages, but ensure the first non-system message is from user.
    // Some Gemini proxies reject conversations that start with assistant/model.
    const out: Array<{ role: string; content: string | ChatContentPart[] }> = [];

    let seenFirstUser = false;
    for (const m of messages) {
        if (m.role === 'system') {
            out.push(m);
            continue;
        }

        const roleLower = (m.role || '').toLowerCase();
        if (!seenFirstUser && (roleLower === 'assistant' || roleLower === 'ai' || roleLower === 'model')) {
            continue;
        }

        if (roleLower === 'user') {
            seenFirstUser = true;
        }

        out.push(m);
    }

    // Merge consecutive same-role messages by concatenating content.
    const merged: Array<{ role: string; content: string | ChatContentPart[] }> = [];
    for (const m of out) {
        const last = merged[merged.length - 1];
        if (!last || last.role !== m.role || m.role === 'system') {
            merged.push(m);
            continue;
        }

        const toParts = (c: string | ChatContentPart[]): ChatContentPart[] => {
            if (Array.isArray(c)) return c;
            const t = String(c ?? '');
            return t ? [{ type: 'text', text: t }] : [];
        };

        const mergedParts = [...toParts(last.content), ...toParts(m.content)].filter((p) => {
            if (p.type !== 'text') return true;
            return !!(p.text && p.text.trim());
        });

        // If it's pure text parts, simplify back to string to maximize proxy compatibility.
        const allText = mergedParts.every((p) => p.type === 'text');
        if (allText) {
            const text = mergedParts.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('\n\n').trim();
            merged[merged.length - 1] = { ...last, content: text };
        } else {
            merged[merged.length - 1] = { ...last, content: mergedParts };
        }
    }

    return merged;
}

export interface ChatRequest {
    messages: { role: string; content: string | ChatContentPart[] }[];
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    stream?: boolean;
    useWebSearch?: boolean;
    enableCodeExecution?: boolean;
    qwenEnableSearch?: boolean;
    tools?: unknown[];
}

export const ApiService = {
    async fetchModels(config: Pick<ApiConfig, 'provider' | 'baseUrl' | 'apiKey' | 'channel'>): Promise<string[]> {
        const { baseUrl, apiKey, channel } = config;
        let url = baseUrl.replace(/\/+$/, '').replace(/\\:/g, ':');

        if (channel === 'Gemini' || url.includes('generativelanguage.googleapis.com')) {
            // Gemini Protocol
            // https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY
            if (url.includes('generativelanguage.googleapis.com')) {
                url = `${url}/v1beta/models?key=${apiKey}`;
            } else {
                // Assuming proxy that forwards /v1beta/models or just /models depending on implementation
                // But if it's a proxy for Gemini, it likely follows Google structure or OpenAI structure.
                // If the user selected Gemini Channel, let's try the Google structure first or standard "models" endpoint
                // Adjusting to common proxy patterns: many proxies just map /v1/models (OpenAI style) to Gemini models list.
                // BUT if we want native behavior:
                url = `${url}/v1beta/models?key=${apiKey}`;
            }

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (data && Array.isArray(data.models)) {
                    return data.models
                        .map((m: any) => m.name?.replace(/^models\//, '') || m.displayName)
                        .filter(Boolean);
                }
            } catch (e) {
                console.warn('Failed to fetch Gemini models natively, trying OpenAI compatible fallback...', e);
                // Fallback to OpenAI style below
            }
        }

        // OpenAI Compatible Protocol
        if (!url.endsWith('/v1')) url += '/v1';
        url += '/models';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        // Only add Authorization if not Gemini channel (though we might be here as fallback)
        // If we are strictly Gemini channel but fell back, maybe we shouldn't add Bearer?
        // But OpenAI compatible endpoint usually requires Bearer.
        // Let's assume if we are here, we need Bearer unless it's strictly Gemini URL which we handled above.
        headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Fetch Models Failed: ${res.status} ${res.statusText}`);
        
        const data = await res.json();
        if (Array.isArray(data.data)) {
            return data.data.map((m: any) => m.id).filter(Boolean);
        }
        
        return [];
    },

    async *streamChat(
        config: ApiConfig,
        request: ChatRequest,
        signal?: AbortSignal
    ): AsyncGenerator<string | StreamEvent, void, unknown> {

        // --- Client-Side Web Search Logic (OpenAI Compatible Only) ---
        // Mirroring Android OpenAIDirectClient.kt logic
        let messages = request.messages;
        
        // Inject System Prompt for Render Safety (Android Parity)
        // We do this for BOTH protocols to ensure consistent rendering
        const isGeminiProtocol = config.channel === 'Gemini' || config.baseUrl.includes('generativelanguage.googleapis.com');
        
        // Auto-detect language from user messages
        const userText = SystemPromptInjector.extractUserTexts(messages);
        const lang = SystemPromptInjector.detectUserLanguage(userText);
        messages = SystemPromptInjector.injectSystemPrompt(messages, lang);

        let useWebSearchInBody = request.useWebSearch;

        // Only perform client-side search if:
        // 1. Web Search is enabled
        // 2. Not using Qwen Search (which is server-side)
        // 3. Not Gemini Channel (which uses Google Search tool server-side usually, but Android allows client-side for "OpenAI Compatible" channel even if model is Gemini?
        //    Android: if (request.useWebSearch == true && request.qwenEnableSearch != true).
        //    It seems Android does it for ALL models in OpenAIDirectClient.
        //    But if channel is 'Gemini', we use 'GeminiDirectClient' usually? No, 'Gemini' channel uses 'OpenAI Compatible' protocol in this file?
        //    In Web, we have a separate block for 'Gemini' channel.
        //    So this logic applies to the "OpenAI Compatible" block.
        //    But wait, if config.channel === 'Gemini', we skip the OpenAI block.
        //    So we should only apply this if we are NOT in the Gemini Protocol block.
        
        if (!isGeminiProtocol && request.useWebSearch && !request.qwenEnableSearch) {
             const lastUserMsg = messages[messages.length - 1];
             if (lastUserMsg && lastUserMsg.role === 'user') {
                 const query = Array.isArray(lastUserMsg.content)
                    ? lastUserMsg.content.map(c => c.type === 'text' ? c.text : '').join(' ')
                    : String(lastUserMsg.content);
                 
                 if (query && query.trim()) {
                     // Check if keys are available
                     const apiKey = import.meta.env.VITE_GOOGLE_SEARCH_API_KEY;
                     const cseId = import.meta.env.VITE_GOOGLE_CSE_ID;
                     const hasKeys = apiKey && cseId;
                     
                     if ((import.meta as any).env?.DEV) {
                         console.info('[ApiService] Client-side search check:', { hasKeys, query: query.trim(), apiKeyPrefix: apiKey?.slice(0, 4), cseIdPrefix: cseId?.slice(0, 4) });
                     }

                     if (hasKeys) {
                         yield { type: 'web_search_status', data: 'Searching Google...' };
                         const results = await WebSearchService.search(query.trim());
                         
                         if ((import.meta as any).env?.DEV) {
                             console.info('[ApiService] Client-side search results:', results.length);
                         }

                         if (results.length > 0) {
                             yield { type: 'web_search_results', data: results.map((r) => ({ title: r.title, url: r.href, snippet: r.snippet })) };
                             yield { type: 'web_search_status', data: '整理搜索结果中...' };
                             
                             const injectedContent = WebSearchService.formatResultsForPrompt(results, query.trim());
                             
                             // Clone and inject
                             const newMessages = [...messages];
                             const newLastMsg = { ...lastUserMsg };
                             
                             if (Array.isArray(newLastMsg.content)) {
                                 const newParts = [...newLastMsg.content];
                                 const firstTextIdx = newParts.findIndex(p => p.type === 'text');
                                 if (firstTextIdx >= 0) {
                                     const original = newParts[firstTextIdx];
                                     if (original.type === 'text') {
                                         newParts[firstTextIdx] = { ...original, text: injectedContent + "\n\n" + (original.text || '') };
                                     }
                                 } else {
                                     newParts.unshift({ type: 'text', text: injectedContent });
                                 }
                                 newLastMsg.content = newParts;
                             } else {
                                 newLastMsg.content = injectedContent + "\n\n" + newLastMsg.content;
                             }
                             newMessages[newMessages.length - 1] = newLastMsg;
                             messages = newMessages;
                             
                             // Disable server-side search since we handled it
                             useWebSearchInBody = false;
                         } else {
                             yield { type: 'web_search_status', data: 'No results, answering directly...' };
                         }
                     } else {
                         if ((import.meta as any).env?.DEV) {
                             console.warn('[ApiService] Web search skipped: Missing VITE_GOOGLE_SEARCH_API_KEY or VITE_GOOGLE_CSE_ID');
                         }
                         // No keys, rely on server-side if supported
                         // yield { type: 'web_search_status', data: 'Web search skipped (no client keys)...' };
                     }
                 }
             }
        }

        let url = config.baseUrl.replace(/\/+$/, '').replace(/\\:/g, ':');
        const modelLower = request.model.toLowerCase();
        const isGeminiModel = config.provider === 'Gemini' || config.channel === 'Gemini' || modelLower.includes('gemini');
        const geminiThinkingBudget = modelLower.includes('flash')
            ? 1024
            : (modelLower.includes('pro') ? 8192 : 24576);

        // Normalize URL based on provider conventions (simplified)
        if (config.provider === 'OpenAI' || config.provider === 'SiliconFlow' || config.provider === 'DeepSeek' || config.channel === 'OpenAI兼容') {
            // Align with Android URL construction logic
            if (url.endsWith('/chat/completions')) {
                // Use as is
            } else if (url.endsWith('/v1')) {
                url += '/chat/completions';
            } else {
                url += '/v1/chat/completions';
            }
        } else if (config.provider === 'Gemini' || config.channel === 'Gemini') {

            // Gemini API format: https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=API_KEY
            // If this is direct Gemini API, use the specific endpoint logic
            // However, for this implementation step, we assume the user might be using an OpenAI-compatible proxy for Gemini
            // OR we need to implement the specific Gemini protocol.

            // If the base URL is the official Google API, OR the user explicitly selected Gemini channel, use the Gemini protocol
            if (config.channel === 'Gemini' || url.includes('generativelanguage.googleapis.com')) {
                url += `/v1beta/models/${request.model}:streamGenerateContent?key=${config.apiKey}&alt=sse`;
            } else {
                // Assume OpenAI compatible proxy
                if (url.endsWith('/chat/completions')) {
                    // Use as is
                } else if (url.endsWith('/v1')) {
                    url += '/chat/completions';
                } else {
                    url += '/v1/chat/completions';
                }
            }
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'X-Accel-Buffering': 'no',
        };

        // Only add Authorization header for OpenAI compatible APIs
        // Gemini API passes key in URL query param
        if (config.channel !== 'Gemini' && !url.includes('generativelanguage.googleapis.com')) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        let body: string;

        if (config.channel === 'Gemini' || url.includes('generativelanguage.googleapis.com')) {
            // Apply System Prompt Injection for Gemini Protocol
            // Note: We've already injected it into 'messages' in the caller?
            // Actually, we should handle injection here or in the caller.
            // In Android it's done in buildGeminiPayload.
            // Let's rely on the caller passing the right messages, OR inject here if we want to be safe.
            // For now, let's assume messages are processed by SystemPromptInjector in MainContent.tsx before calling this?
            // Wait, MainContent.tsx just pushes user/system messages. It doesn't use SystemPromptInjector yet.
            // We should use SystemPromptInjector here to be consistent with Android's GeminiDirectClient.

            // Wait, we need to import it. But ApiService is in services/. SystemPromptInjector is in lib/controllers/.
            // It's fine.
            
            // Actually, let's keep it simple. We'll inject it here if not present?
            // Android injects it *inside* buildGeminiPayload.
            
            const systemText = messages
                .filter(m => m.role === 'system')
                .map(m => (Array.isArray(m.content)
                    ? m.content.map(p => (p.type === 'text' ? (p.text ?? '') : '')).join('')
                    : String(m.content)))
                .map(s => s.trim())
                .filter(Boolean)
                .join('\n\n');

            let effectiveSystemText = systemText;

            if (request.enableCodeExecution) {
                const enforcementPrompt = "\n\nIMPORTANT: You have access to a code execution tool. When asked to calculate, plot, or solve problems, you MUST use the code execution tool to run the code and show the results/plots, instead of just writing the code.";
                effectiveSystemText = effectiveSystemText ? (effectiveSystemText + enforcementPrompt) : enforcementPrompt.trim();
            }

            const tools: Array<Record<string, unknown>> = [];
            
            // 🔥 Gemini Grounding with Google Search 配置
            // 参考官方文档: https://ai.google.dev/gemini-api/docs/grounding
            // - Gemini 2.0+, 2.5, 3: 使用简单的 { google_search: {} }
            // - Gemini 1.5 (Legacy): 使用 { google_search_retrieval: { dynamic_retrieval_config: {...} } }
            const isLegacyGemini15 = modelLower.includes('gemini-1.5');
            
            if (request.useWebSearch) {
                if (isLegacyGemini15) {
                    // Gemini 1.5 Legacy: 使用 google_search_retrieval 工具
                    tools.push({
                        google_search_retrieval: {
                            dynamic_retrieval_config: {
                                mode: "MODE_DYNAMIC",
                                dynamic_threshold: 0.3  // 较低阈值，更积极地触发搜索
                            }
                        }
                    });
                } else {
                    // Gemini 2.0+, 2.5, 3: 使用简单的 google_search 工具
                    tools.push({ google_search: {} });
                }
            }
            if (request.enableCodeExecution) {
                tools.push({ code_execution: {} });
            }

            const contents = mergeGeminiContents(
                messages
                    .filter(m => m.role !== 'system')
                    .map((m) => {
                        const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
                        const parts: Array<Record<string, unknown>> = Array.isArray(m.content)
                            ? m.content.map((c) => {
                                if (c.type === 'text') {
                                    const t = (c.text ?? '').trim();
                                    return t ? { text: t } : null;
                                }
                                if (c.type === 'image_url') {
                                    const u = c.image_url?.url ?? '';
                                    const parsed = parseDataUrl(u);
                                    if (parsed) {
                                        return { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } };
                                    }
                                    const base64 = u.includes(',') ? (u.split(',')[1] ?? '') : '';
                                    return base64 ? { inlineData: { mimeType: 'image/jpeg', data: base64 } } : null;
                                }
                                return null;
                            }).filter(Boolean) as Array<Record<string, unknown>>
                            : (() => {
                                const t = String(m.content ?? '').trim();
                                return t ? [{ text: t }] : [];
                            })();

                        return { role, parts };
                    })
            );

            // 🔥 修复：当启用 google_search 或 code_execution 时，禁用 thinkingConfig
            // Gemini 的 thinking 模式和工具调用可能存在冲突，导致模型只思考不调用工具
            const shouldDisableThinking = request.enableCodeExecution || request.useWebSearch;
            
            body = JSON.stringify({
                systemInstruction: effectiveSystemText
                    ? { parts: [{ text: effectiveSystemText }] }
                    : undefined,
                contents,
                tools: tools.length > 0 ? tools : undefined,
                generationConfig: {
                    temperature: request.temperature,
                    topP: request.topP,
                    maxOutputTokens: request.maxTokens,
                    ...(shouldDisableThinking
                        ? {}
                        : {
                            thinkingConfig: {
                                includeThoughts: true,
                                thinkingBudget: geminiThinkingBudget,
                            }
                        })
                }
            });
        } else {
            // OpenAI Protocol Body
            const effectiveMessages = isGeminiModel
                ? normalizeOpenAIMessagesForGemini(messages)
                : messages;

            let requestTools = request.tools;

            // Inject custom tools from config if present
            if ((config as any).toolsJson) {
                try {
                    const customTools = JSON.parse((config as any).toolsJson);
                    if (Array.isArray(customTools)) {
                        requestTools = [...(requestTools || []), ...customTools];
                    }
                } catch (e) {
                    console.error("Failed to parse custom tools JSON", e);
                }
            }

            const extraBody: Record<string, unknown> = {};

            // Android parity: Gemini models on OpenAI-compatible gateways (OneAPI/NewAPI etc.)
            // require tools/thinking_config under extra_body.google.
            if (isGeminiModel) {
                const google: Record<string, unknown> = {};
                const googleTools: Array<Record<string, unknown>> = [];
                if (useWebSearchInBody === true) {
                    googleTools.push({ google_search: {} });
                }
                if (request.enableCodeExecution === true) {
                    googleTools.push({ code_execution: {} });
                }
                if (googleTools.length > 0) {
                    google.tools = googleTools;
                }

                if (request.enableCodeExecution !== true) {
                    google.thinking_config = {
                        include_thoughts: true,
                        thinking_budget: geminiThinkingBudget,
                    };
                }

                if (Object.keys(google).length > 0) {
                    extraBody.google = google;
                }
            }

            // Android parity: Qwen search
            if (request.qwenEnableSearch === true) {
                extraBody.enable_search = true;
                extraBody.search_options = {
                    forced_search: true,
                    search_strategy: 'max',
                };
            }

            const extraBodyFinal = Object.keys(extraBody).length > 0 ? extraBody : undefined;

            body = JSON.stringify({
                model: request.model,
                messages: effectiveMessages,
                stream: true,
                temperature: request.temperature,
                top_p: request.topP,
                max_tokens: request.maxTokens,
                use_web_search: typeof useWebSearchInBody === 'boolean' ? useWebSearchInBody : undefined,
                enableCodeExecution: typeof request.enableCodeExecution === 'boolean' ? request.enableCodeExecution : undefined,
                qwenEnableSearch: typeof request.qwenEnableSearch === 'boolean' ? request.qwenEnableSearch : undefined,
                // Extra body for provider-specific extensions (Android-compatible)
                extra_body: extraBodyFinal,
                // For Qwen some gateways accept these at top-level as well
                enable_search: request.qwenEnableSearch === true ? true : undefined,
                search_options: request.qwenEnableSearch === true ? { forced_search: true, search_strategy: 'max' } : undefined,
                tools: requestTools && requestTools.length > 0 ? requestTools : undefined,
                ...(request.enableCodeExecution
                    ? {}
                    : (isGeminiModel
                        ? {
                            thinking_config: {
                                include_thoughts: true,
                                thinking_budget: geminiThinkingBudget,
                            }
                        }
                        : {})),
            });
        }

        if ((import.meta as any).env?.DEV) {
            const safeUrl = url.replace(String(config.apiKey || ''), '***');
            let safeBody = body;
            if (config.apiKey) {
                safeBody = safeBody.replaceAll(String(config.apiKey), '***');
            }
            console.info('[ApiService.streamChat] url=', safeUrl);
            console.info('[ApiService.streamChat] flags=', {
                useWebSearch: request.useWebSearch,
                enableCodeExecution: request.enableCodeExecution,
                qwenEnableSearch: request.qwenEnableSearch,
            });
            try {
                const parsed = JSON.parse(safeBody) as any;
                console.info('[ApiService.streamChat] body(keys)=', Object.keys(parsed));
                console.info('[ApiService.streamChat] body.tools=', JSON.stringify(parsed.tools));
                console.info('[ApiService.streamChat] body.generationConfig=', JSON.stringify(parsed.generationConfig));
                console.info('[ApiService.streamChat] body.use_web_search=', parsed.use_web_search);
                console.info('[ApiService.streamChat] body.enableCodeExecution=', parsed.enableCodeExecution);
                console.info('[ApiService.streamChat] body.qwenEnableSearch=', parsed.qwenEnableSearch);
                console.info('[ApiService.streamChat] body.extra_body=', parsed.extra_body);
            } catch {
                console.info('[ApiService.streamChat] body(raw)=', safeBody.slice(0, 800));
            }
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body,
                signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error ${response.status}: ${errorText}`);
            }

            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let sseDataLines: string[] = [];
            let shouldStop = false;
            const devLog = (...args: unknown[]) => {
                if ((import.meta as any).env?.DEV) console.info(...args);
            };

            async function* parseSsePayload(payload: string): AsyncGenerator<string | StreamEvent, void, unknown> {
                const data = payload.trim();
                if (!data || data === '[DONE]') return;

                // Gemini official SSE: JSON objects in data
                if (config.channel === 'Gemini' || url.includes('generativelanguage.googleapis.com')) {
                    let json: unknown;
                    try {
                        json = JSON.parse(data);
                    } catch {
                        return;
                    }
                    if (!isRecord(json)) return;

                    const candidates = asArray(json.candidates);
                    const first = candidates[0];
                    if (!isRecord(first)) return;

                    const finishReasonRaw = getString((first as UnknownRecord).finishReason);
                    const finishReason = finishReasonRaw.trim();
                    if (finishReason) {
                        const frUpper = finishReason.toUpperCase();
                        if (frUpper !== 'FINISH_REASON_UNSPECIFIED') {
                            shouldStop = true;
                        }
                        devLog('[Gemini SSE] finishReason:', finishReason);
                    }

                    const content = first.content;
                    if (isRecord(content)) {
                        const parts = asArray(content.parts);
                        for (const p of parts) {
                            if (!isRecord(p)) continue;

                            const thought = getBoolean((p as UnknownRecord).thought);
                            const text = getString((p as UnknownRecord).text);
                            if (text) {
                                if (thought) {
                                    devLog('[Gemini SSE] thought chunk:', text.slice(0, 120));
                                    yield { type: 'reasoning', data: text };
                                } else {
                                    yield text;
                                }
                            }

                            const executable = (p as UnknownRecord).executableCode;
                            if (isRecord(executable)) {
                                const code = getString(executable.code);
                                const language = getString(executable.language) || 'python';
                                if (code) yield { type: 'code_executable', data: { code, language } };
                            }

                            const execResult = (p as UnknownRecord).codeExecutionResult;
                            if (isRecord(execResult)) {
                                const output = getString(execResult.output);
                                const outcomeRaw = getString(execResult.outcome).toLowerCase();
                                const outcome = outcomeRaw.includes('ok') || outcomeRaw.includes('success') ? 'success' : outcomeRaw ? 'error' : undefined;
                                yield { type: 'code_execution_result', data: { output: output || undefined, outcome } };
                            }

                            const inlineData = (p as UnknownRecord).inlineData;
                            if (isRecord(inlineData)) {
                                const mimeType = getString(inlineData.mimeType);
                                const b64 = getString(inlineData.data);
                                if (mimeType.startsWith('image/') && b64) {
                                    yield { type: 'code_execution_result', data: { outcome: 'success', imageUrl: `data:${mimeType};base64,${b64}` } };
                                }
                            }
                        }
                    }

                    const groundingMetadata = first.groundingMetadata;
                    if (isRecord(groundingMetadata)) {
                        yield { type: 'grounding_metadata', data: groundingMetadata };

                        const chunks = asArray(groundingMetadata.groundingChunks);
                        const results: WebSearchResult[] = [];
                        for (const c of chunks) {
                            if (!isRecord(c)) continue;
                            const web = (c as UnknownRecord).web;
                            if (!isRecord(web)) continue;
                            const title = getString(web.title);
                            const uri = getString(web.uri);
                            if (title || uri) {
                                results.push({ title: title || uri, url: uri, snippet: '' });
                            }
                        }
                        if (results.length > 0) {
                            yield { type: 'web_search_results', data: results };
                        }
                    }

                    return;
                }

                // OpenAI-compatible SSE: JSON objects in data
                let json: unknown;
                try {
                    json = JSON.parse(data);
                } catch {
                    return;
                }

                if (isRecord(json) && isGeminiModel) {
                    const keys = Object.keys(json).slice(0, 12);
                    devLog('[Gemini Proxy] payload keys:', keys);
                }

                // Backend-style events (Android-compatible)
                if (isRecord(json) && typeof json.type === 'string') {
                    const t = json.type;
                    if (t === 'content' || t === 'text' || t === 'content_final') {
                        const text = getString(json.text);
                        if (text) yield text;
                        if (t === 'content_final') shouldStop = true;
                        return;
                    }
                    if (t === 'reasoning') {
                        const text = getString(json.text);
                        if (text) yield { type: 'reasoning', data: text };
                        return;
                    }
                    if (t === 'web_search_status') {
                        const stage = getString(json.stage);
                        if (stage) yield { type: 'web_search_status', data: stage };
                        return;
                    }
                    if (t === 'web_search_results') {
                        const rawResults = asArray(json.results);
                        const results: WebSearchResult[] = rawResults.map((r) => {
                            if (!isRecord(r)) return { title: '', url: '', snippet: '' };
                            return {
                                title: getString(r.title),
                                url: getString((r as UnknownRecord).url) || getString((r as UnknownRecord).href),
                                snippet: getString(r.snippet),
                            };
                        }).filter(r => r.title || r.url || r.snippet);
                        if (results.length > 0) yield { type: 'web_search_results', data: results };
                        return;
                    }
                    if (t === 'code_executable') {
                        const code = getString((json as UnknownRecord).executableCode) || getString((json as UnknownRecord).code);
                        const language = getString((json as UnknownRecord).codeLanguage) || 'python';
                        if (code) yield { type: 'code_executable', data: { code, language } };
                        return;
                    }
                    if (t === 'code_execution_result') {
                        const output = getString((json as UnknownRecord).codeExecutionOutput);
                        const outcomeRaw = getString((json as UnknownRecord).codeExecutionOutcome).toLowerCase();
                        const outcome = outcomeRaw === 'success' || outcomeRaw === 'ok' ? 'success' : outcomeRaw ? 'error' : undefined;
                        yield { type: 'code_execution_result', data: { output: output || undefined, outcome } };
                        return;
                    }
                    if (t === 'error') {
                        const msg = getString(json.message);
                        const upstreamStatus = typeof json.upstreamStatus === 'number' ? json.upstreamStatus : undefined;
                        if (msg) yield { type: 'error', data: { message: msg, upstreamStatus } };
                        return;
                    }
                }

                // OpenAI non-stream + delta fallback (align with Android)
                if (isRecord(json)) {
                    const choices = asArray(json.choices);
                    const first = choices[0];
                    if (isRecord(first)) {
                        const finishReason = getString((first as UnknownRecord).finish_reason) || getString((first as UnknownRecord).finishReason);
                        if (finishReason) {
                            shouldStop = true;
                            if (isGeminiModel) devLog('[Gemini Proxy] finishReason:', finishReason);
                        }

                        const message = (first as UnknownRecord).message;
                        if (isRecord(message)) {
                            const content = (message as UnknownRecord).content;
                            if (typeof content === 'string' && content) {
                                yield content;
                            }

                            const reasoningVal =
                                (message as UnknownRecord).reasoning_content ??
                                (message as UnknownRecord).reasoning ??
                                (message as UnknownRecord).thinking ??
                                (message as UnknownRecord).thoughts;
                            const reasoning = typeof reasoningVal === 'string'
                                ? reasoningVal
                                : (isRecord(reasoningVal)
                                    ? (getString((reasoningVal as UnknownRecord).text) || getString((reasoningVal as UnknownRecord).content))
                                    : '');
                            if (reasoning) yield { type: 'reasoning', data: reasoning };
                        }

                        const delta = (first as UnknownRecord).delta;
                        if (isRecord(delta)) {
                            const content = (delta as UnknownRecord).content;
                            if (typeof content === 'string' && content) {
                                yield content;
                            }

                            const reasoningVal =
                                (delta as UnknownRecord).reasoning_content ??
                                (delta as UnknownRecord).reasoning ??
                                (delta as UnknownRecord).thinking ??
                                (delta as UnknownRecord).thoughts;
                            const reasoning = typeof reasoningVal === 'string'
                                ? reasoningVal
                                : (isRecord(reasoningVal)
                                    ? (getString((reasoningVal as UnknownRecord).text) || getString((reasoningVal as UnknownRecord).content))
                                    : '');
                            
                            // Align with Android: Send reasoning event if not empty
                            if (reasoning) {
                                yield { type: 'reasoning', data: reasoning };
                            }
                        }
                    }
                }
            }

            while (true) {
                if (signal?.aborted) {
                    try {
                        await reader.cancel();
                    } catch {
                        // ignore
                    }
                    throw new DOMException('Aborted', 'AbortError');
                }
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        if (sseDataLines.length > 0) {
                            const payload = sseDataLines.join('\n');
                            sseDataLines = [];
                            yield* parseSsePayload(payload);
                            if (shouldStop) {
                                try {
                                    await reader.cancel();
                                } catch {
                                    // ignore
                                }
                                break;
                            }
                        }
                        continue;
                    }

                    if (trimmed.startsWith(':')) {
                        continue;
                    }
                    if (trimmed.startsWith('data:')) {
                        sseDataLines.push(trimmed.slice(5).trim());
                        continue;
                    }

                    // Non-SSE fallback (rare proxies)
                    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                        yield* parseSsePayload(trimmed);
                        if (shouldStop) {
                            try {
                                await reader.cancel();
                            } catch {
                                // ignore
                            }
                            break;
                        }
                    }
                }

                if (shouldStop) break;
            }

            if (sseDataLines.length > 0) {
                yield* parseSsePayload(sseDataLines.join('\n'));
            }

            const tail = buffer.trim();
            if (tail) {
                // Some proxies return the full JSON body without newlines; parse it at the end.
                if (tail.startsWith('data:')) {
                    const payload = tail.replace(/^data:\s*/i, '').trim();
                    yield* parseSsePayload(payload);
                } else {
                    yield* parseSsePayload(tail);
                }
            }
        } catch (error) {
            console.error('Stream Chat Error:', error);
            throw error;
        }
    }
};