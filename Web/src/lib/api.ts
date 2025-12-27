import type { ChannelType, ModelConfig, ChatParams, ImageParams } from '../state/modeTypes';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamChatOptions {
  config: ModelConfig;
  messages: ChatMessage[];
  params: ChatParams;
  useWebSearch: boolean;
  signal: AbortSignal;
  onDelta: (deltaText: string) => void;
}

export interface GenerateImageOptions {
  config: ModelConfig;
  prompt: string;
  imageParams: ImageParams;
  signal: AbortSignal;
  referenceImages?: string[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function getString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function joinUrl(base: string, path: string): string {
  const b = base.trim().replace(/\/+$/, '');
  const p = path.trim().replace(/^\/+/, '');
  return `${b}/${p}`;
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onData: (data: string) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let dataLines: string[] = [];

  while (true) {
    if (signal.aborted) {
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
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line) {
        if (dataLines.length > 0) {
          const payload = dataLines.join('\n');
          dataLines = [];
          onData(payload);
        }
        continue;
      }

      if (line.startsWith(':')) {
        continue;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
  }

  if (dataLines.length > 0) {
    onData(dataLines.join('\n'));
  }
}

function normalizeChannel(channel: ChannelType): ChannelType {
  return channel;
}

function toOpenAiMessages(messages: ChatMessage[]): Array<{ role: ChatRole; content: string }> {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter(m => m.content.trim().length > 0)
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    }));
}

export async function streamChatCompletion(opts: StreamChatOptions): Promise<void> {
  const channel = normalizeChannel(opts.config.channel);

  if (!opts.config.address.trim()) {
    throw new Error('缺少 API 地址');
  }
  if (!opts.config.key.trim()) {
    throw new Error('缺少 API Key');
  }
  if (!opts.config.model.trim()) {
    throw new Error('缺少模型名称');
  }

  if (channel === 'Gemini') {
    const base = opts.config.address.trim().replace(/\/+$/, '');
    const apiUrl = joinUrl(base, `v1beta/models/${encodeURIComponent(opts.config.model)}:streamGenerateContent?key=${encodeURIComponent(opts.config.key)}`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: toGeminiContents(opts.messages),
        generationConfig: {
          temperature: opts.params.temperature,
          topP: opts.params.topP,
          maxOutputTokens: opts.params.maxTokens,
        },
      }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      throw new Error(`请求失败: ${res.status} ${txt}`);
    }

    await readSseStream(res.body, opts.signal, data => {
      if (!data || data === '[DONE]') return;
      const parsed = JSON.parse(data) as unknown;
      if (!isRecord(parsed)) return;
      const candidates = asArray(parsed.candidates);
      const first = candidates[0];
      if (!isRecord(first)) return;
      const content = first.content;
      if (!isRecord(content)) return;
      const parts = asArray(content.parts);
      const deltaText = parts
        .map(p => (isRecord(p) ? getString(p.text) : ''))
        .join('');
      if (deltaText) opts.onDelta(deltaText);
    });

    return;
  }

  let base = opts.config.address.trim().replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';
  const url = joinUrl(base, 'chat/completions');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.config.key}`,
    },
    body: JSON.stringify({
      model: opts.config.model,
      messages: toOpenAiMessages(opts.messages),
      stream: true,
      temperature: opts.params.temperature,
      top_p: opts.params.topP,
      max_tokens: opts.params.maxTokens,
      web_search: opts.useWebSearch ? true : undefined,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`请求失败: ${res.status} ${txt}`);
  }

  await readSseStream(res.body, opts.signal, data => {
    if (!data || data === '[DONE]') return;
    const parsed = JSON.parse(data) as unknown;
    if (!isRecord(parsed)) return;
    const choices = asArray(parsed.choices);
    const first = choices[0];
    if (!isRecord(first)) return;
    const delta = first.delta;
    if (!isRecord(delta)) return;
    const deltaText = getString(delta.content);
    if (deltaText) opts.onDelta(deltaText);
  });
}

// --- Image Generation Implementations ---

/**
 * Detect model family for routing to correct API implementation.
 * Mirrors Android ImageGenCapabilities.detectFamily logic.
 */
function detectModelFamily(modelName: string, provider: string, address: string): 'MODAL_Z_IMAGE' | 'QWEN' | 'KOLORS' | 'GEMINI' | 'SEEDREAM' | 'UNKNOWN' {
  const parts = [modelName, provider, address].map(s => (s || '').toLowerCase());
  
  const containsAny = (...keys: string[]) => parts.some(p => keys.some(k => p.includes(k)));
  
  if (containsAny('z-image-turbo', 'z_image_turbo')) return 'MODAL_Z_IMAGE';
  if (containsAny('qwen-image-edit', 'qwen-edit', 'qwen_edit')) return 'QWEN';
  if (containsAny('gemini', 'google', 'imagen')) return 'GEMINI';
  if (containsAny('doubao', 'seedream', 'volces')) return 'SEEDREAM';
  if (containsAny('kolors', 'kwai', 'siliconflow')) return 'KOLORS';
  return 'UNKNOWN';
}

export async function generateImage(opts: GenerateImageOptions): Promise<string[]> {
  const { config, referenceImages } = opts;

  // Detect model family
  const family = detectModelFamily(config.model, config.provider, config.address);

  // Modal Z-Image-Turbo (GET based) - uses VITE_MODAL_API_URLS, no API key needed
  if (family === 'MODAL_Z_IMAGE') {
    return generateImageModal(opts);
  }

  // Qwen Image Edit - uses VITE_QWEN_EDIT_API_URLS and VITE_QWEN_EDIT_API_SECRET
  if (family === 'QWEN') {
    return generateImageQwenEdit(opts);
  }

  // Gemini Native (only if channel is NOT OpenAI兼容)
  if (family === 'GEMINI' && config.channel !== 'OpenAI兼容') {
    if (referenceImages && referenceImages.length > 0) {
      return generateImageGeminiWithReference(opts);
    }
    return generateImageGemini(opts);
  }

  // Seedream (Doubao) specific check
  if (family === 'SEEDREAM') {
    if (referenceImages && referenceImages.length > 0) {
      return generateImageSeedreamWithReference(opts);
    }
    return generateImageOpenAI(opts, true);
  }

  // KOLORS family (SiliconFlow) - use OpenAI compatible with SiliconFlow env vars
  if (family === 'KOLORS') {
    return generateImageOpenAI(opts, false);
  }

  // Default to OpenAI Compatible for UNKNOWN family
  return generateImageOpenAI(opts, false);
}

function isGemini3ProImage(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return lower.includes('gemini-3-pro-image') || lower.includes('gemini-3-pro-image-preview');
}

function parseModalRatioAndTier(
  aspectRatioRaw: string | undefined,
  modalTier: '2K' | 'HD' | undefined
): { ratio: string; tier: '2K' | 'HD' } {
  const raw = (aspectRatioRaw ?? '').trim();
  const upper = raw.toUpperCase();

  let tier: '2K' | 'HD' = modalTier ?? '2K';
  let ratio = raw || '1:1';

  if (upper.startsWith('2K')) {
    tier = '2K';
    ratio = raw.slice(2).trim() || '1:1';
  } else if (upper.startsWith('HD')) {
    tier = 'HD';
    ratio = raw.slice(2).trim() || '1:1';
  }

  return { ratio, tier };
}

async function generateImageQwenEdit(opts: GenerateImageOptions): Promise<string[]> {
  const { config, prompt, imageParams, signal, referenceImages } = opts;

  // Use Env Var for Qwen URL/Key if available (for System Default Config)
  // Note: .env files may have escaped colons (\:), need to remove them
  const envUrlsRaw = import.meta.env.VITE_QWEN_EDIT_API_URLS;
  const envUrls = envUrlsRaw
      ? envUrlsRaw.split(',')
          .map((s: string) => s.trim().replace(/\\:/g, ':'))
          .filter(Boolean)
      : [];
  
  const envKey = import.meta.env.VITE_QWEN_EDIT_API_SECRET;
  
  // If env vars are present (System Default), use them as list; otherwise use single config address
  const urls = envUrls.length > 0
      ? envUrls
      : [config.address.replace(/\\:/g, ':')];
      
  const finalKey = envKey || config.key;

  if (!referenceImages || referenceImages.length === 0) {
    throw new Error('Qwen 图像编辑需要提供一张参考图片');
  }

  const rawBase64 = referenceImages[0].split(',')[1];
  if (!rawBase64) throw new Error('无效的图片数据');

  const payload = {
    image_base64: rawBase64,
    prompt: prompt || 'Edit this image',
    steps: imageParams.steps || 30,
    guidance_scale: imageParams.guidance || 7.5
  };

  let lastErr: Error | null = null;

  for (const url of urls) {
      try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': finalKey
            },
            body: JSON.stringify(payload),
            signal
          });

          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            // If 402/429/500/etc, we continue to next URL
            throw new Error(`Qwen Edit API Error ${res.status}: ${txt}`);
          }

          const json = await res.json() as UnknownRecord;
          if (json.status !== 'success') {
            throw new Error(`API Error: ${getString(json.detail) || 'Unknown error'}`);
          }

          const resultB64 = getString(json.image_base64);
          if (!resultB64) throw new Error('Empty image_base64 in response');

          return [`data:image/png;base64,${resultB64}`];
      } catch (e) {
          console.warn(`Qwen Edit failed on ${url}:`, e);
          lastErr = e instanceof Error ? e : new Error('Qwen Edit Request Failed');
          // If aborted, stop immediately
          if (signal.aborted) throw e;
      }
  }

  throw lastErr ?? new Error('Qwen Edit 均请求失败');
}

async function generateImageGeminiWithReference(opts: GenerateImageOptions): Promise<string[]> {
  const { config, prompt, imageParams, signal, referenceImages } = opts;

  const base = config.address.trim().replace(/\/+$/, '');
  const cleanBase = base.replace(/\/v1\/images\/generations.*$/, '').replace(/\/v1beta\/models.*$/, '').replace(/\/v1\/.*$/, '');
  const url = `${cleanBase}/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.key)}`;

  const parts: unknown[] = [{ text: prompt }];

  if (referenceImages && referenceImages.length > 0) {
    for (const dataUri of referenceImages) {
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }
  }

  const supportedRatios = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
  const hasValidAspectRatio = supportedRatios.has(imageParams.aspectRatio);
  const hasGeminiImageSize = isGemini3ProImage(config.model) && !!imageParams.geminiImageSize;

  const imageConfig: Record<string, unknown> = {};
  if (hasValidAspectRatio) imageConfig.aspectRatio = imageParams.aspectRatio;
  if (hasGeminiImageSize) imageConfig.imageSize = imageParams.geminiImageSize;

  const payload = {
    contents: [{
      role: 'user',
      parts: parts
    }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini API Error ${res.status}: ${txt}`);
  }

  return parseGeminiResponse(await res.json());
}

async function generateImageSeedreamWithReference(opts: GenerateImageOptions): Promise<string[]> {
  const { config, prompt, imageParams, signal, referenceImages } = opts;

  // Use Env Var for Seedream URL if available (System Default Config support)
  let base = config.address;
  if (import.meta.env.VITE_SEEDREAM_API_URL && (config.provider === 'SystemDefault' || config.address.includes('siliconflow'))) {
      base = import.meta.env.VITE_SEEDREAM_API_URL;
  }

  base = base.trim().replace(/\/+$/, '');
  if (!base.endsWith('/images/generations')) {
    if (!base.endsWith('/v1') && !base.endsWith('/v3')) {
         // Standard check
         if (!base.includes('volces.com')) {
             // Fallback logic
         }
    }
    if (!base.includes('/images/generations')) {
         if (!base.endsWith('/v1') && !base.includes('/v3')) base += '/v1';
         base = joinUrl(base, 'images/generations');
    }
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    prompt: prompt,
    response_format: 'url',
    watermark: imageParams.watermark === true,
    size: mapSeedreamSize(imageParams.seedreamQuality, imageParams.aspectRatio),
    image: referenceImages // Seedream expects array of image URLs or Data URIs
  };

  const res = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.key}`
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Seedream API Error ${res.status}: ${txt}`);
  }

  const json = await res.json() as UnknownRecord;
  return parseOpenAIResponse(json);
}

function parseGeminiResponse(json: unknown): string[] {
    const candidates = asArray((json as UnknownRecord).candidates);
    const first = candidates[0] as UnknownRecord | undefined;
    const content = first?.content as UnknownRecord | undefined;
    const parts = asArray(content?.parts);

    const images: string[] = [];
    
    for (const part of parts) {
        if (!isRecord(part)) continue;
        const inlineData = part.inlineData as UnknownRecord | undefined;
        if (inlineData) {
            const mime = getString(inlineData.mimeType) || 'image/png';
            const data = getString(inlineData.data);
            if (data) {
                images.push(`data:${mime};base64,${data}`);
            }
        }
    }
    
    if (images.length === 0) {
        throw new Error('未获取到图片数据');
    }

    return images;
}

function parseOpenAIResponse(json: UnknownRecord): string[] {
    const data = asArray(json.data);
    const urls: string[] = [];

    for (const item of data) {
        if (!isRecord(item)) continue;
        const u = getString(item.url);
        if (u) {
            urls.push(u);
            continue;
        }
        const b64 = getString(item.b64_json);
        if (b64) {
            urls.push(`data:image/png;base64,${b64}`);
        }
    }
    return urls;
}

async function generateImageModal(opts: GenerateImageOptions): Promise<string[]> {
    const { config, prompt, imageParams, signal } = opts;
    
    // Use Env Var for Modal URLs if available
    // Note: .env files may have escaped colons (\:), need to remove them
    const rawAddressStr = import.meta.env.VITE_MODAL_API_URLS || config.address;
    const addressStr = (rawAddressStr || '').replace(/\\:/g, ':');

    // Determine Width/Height based on params
    let width = 1024;
    let height = 1024;
    
    const { ratio: aspectRatio, tier } = parseModalRatioAndTier(imageParams.aspectRatio, imageParams.modalSize);

    const map2k: Record<string, [number, number]> = {
        '1:1': [2048, 2048],
        '16:9': [2048, 1152],
        '9:16': [1152, 2048],
        '4:3': [2048, 1536],
    };
    const mapHd: Record<string, [number, number]> = {
        '1:1': [1024, 1024],
        '16:9': [1024, 576],
        '9:16': [576, 1024],
    };

    const mapping = tier === 'HD' ? mapHd : map2k;
    const mapped = mapping[aspectRatio];
    if (mapped) {
        width = mapped[0];
        height = mapped[1];
    }

    const steps = imageParams.steps || 4;
    
    const urls = addressStr
        .split(',')
        .map((s: string) => s.trim().replace(/\\:/g, ':'))
        .filter(Boolean);
    if (urls.length === 0) throw new Error('缺少 Modal API 地址');

    let lastErr: Error | null = null;
    for (const baseUrl of urls) {
        try {
            const urlObj = new URL(baseUrl);
            urlObj.searchParams.set('prompt', prompt);
            urlObj.searchParams.set('width', width.toString());
            urlObj.searchParams.set('height', height.toString());
            urlObj.searchParams.set('steps', steps.toString());

            const res = await fetch(urlObj.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'image/jpeg',
                },
                signal,
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`Modal API Error ${res.status}: ${txt}`);
            }

            const blob = await res.blob();
            const base64 = await blobToBase64(blob);
            return [base64];
        } catch (e) {
            lastErr = e instanceof Error ? e : new Error('Modal 请求失败');
        }
    }

    throw lastErr ?? new Error('Modal 请求失败');
}

async function generateImageGemini(opts: GenerateImageOptions): Promise<string[]> {
    const { config, prompt, imageParams, signal } = opts;
    
    const base = config.address.trim().replace(/\/+$/, '');
    const cleanBase = base.replace(/\/v1\/images\/generations.*$/, '').replace(/\/v1beta\/models.*$/, '').replace(/\/v1\/.*$/, '');
    const url = `${cleanBase}/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.key)}`;

    const supportedRatios = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
    const hasValidAspectRatio = supportedRatios.has(imageParams.aspectRatio);
    const hasGeminiImageSize = isGemini3ProImage(config.model) && !!imageParams.geminiImageSize;

    const imageConfig: Record<string, unknown> = {};
    if (hasValidAspectRatio) imageConfig.aspectRatio = imageParams.aspectRatio;
    if (hasGeminiImageSize) imageConfig.imageSize = imageParams.geminiImageSize;

    const payload = {
        contents: [{
            role: 'user',
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Gemini API Error ${res.status}: ${txt}`);
    }

    return parseGeminiResponse(await res.json());
}

async function generateImageOpenAI(opts: GenerateImageOptions, isSeedream: boolean): Promise<string[]> {
    const { config, prompt, imageParams, signal, referenceImages } = opts;

    // Determine base URL based on provider
    let base = config.address;
    
    // For SystemDefault provider, use environment variables
    if (config.provider === 'SystemDefault') {
        if (isSeedream) {
            // Seedream uses its own API URL
            base = import.meta.env.VITE_SEEDREAM_API_URL || base;
        } else {
            // SiliconFlow (Kolors) uses VITE_SILICONFLOW_API_URL
            const sfUrl = import.meta.env.VITE_SILICONFLOW_API_URL;
            if (sfUrl) {
                base = sfUrl.replace(/\\:/g, ':');
            }
        }
    } else if (isSeedream && import.meta.env.VITE_SEEDREAM_API_URL && config.address.includes('siliconflow')) {
        base = import.meta.env.VITE_SEEDREAM_API_URL.replace(/\\:/g, ':');
    }

    base = base.trim().replace(/\/+$/, '').replace(/\\:/g, ':');
    if (!base.endsWith('/images/generations')) {
         if (!base.endsWith('/v3') && !base.includes('volces.com')) {
             if (!base.endsWith('/v1')) base += '/v1';
             base = joinUrl(base, 'images/generations');
         } else if (base.includes('volces.com') && !base.endsWith('/images/generations')) {
             // Seedream full path usually ends with generations
         }
    }
    const url = base;

    // For SystemDefault provider, always use env var for API key (SiliconFlow)
    let apiKey = config.key;
    if (config.provider === 'SystemDefault' || !apiKey) {
        apiKey = import.meta.env.VITE_SILICONFLOW_API_KEY || config.key || '';
    }

    const payload: Record<string, unknown> = {
        model: config.model,
        prompt: prompt,
        n: 1
    };

    if (isSeedream) {
        // Seedream specific
        payload.response_format = 'url';
        payload.watermark = imageParams.watermark === true;
        payload.size = mapSeedreamSize(imageParams.seedreamQuality, imageParams.aspectRatio);
        if (referenceImages && referenceImages.length > 0) {
            payload.image = referenceImages; // Seedream expects array of image URLs or Data URIs
        }
    } else {
        // Standard OpenAI
        payload.size = mapOpenAISize(imageParams.aspectRatio);
        payload.steps = imageParams.steps;
        payload.guidance = imageParams.guidance;
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal
    });

    if (res.status === 401) {
       // Try without Bearer prefix if it failed, although standard OpenAI requires it.
       // Some custom endpoints might just want the key or key in a different header.
       // But for SiliconFlow it is Bearer.
       // The error might be because the key is empty or invalid.
       // Check if key is present.
       if (!config.key) throw new Error('API Key is missing');
    }

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`请求失败: ${res.status} ${txt}`);
    }

    return parseOpenAIResponse(await res.json() as UnknownRecord);
}

function mapOpenAISize(ratio?: string): string {
    switch (ratio) {
        case '16:9': return '1792x1024';
        case '9:16': return '1024x1792';
        case '4:3': return '1024x768';
        case '3:4': return '768x1024'; // Standard SDXL
        case '3:4 (Plus)': return '864x1184'; // Android-specific Kolors resolution
        case '1:2': return '720x1440'; // Kolors recommended
        default: return '1024x1024';
    }
}

function mapSeedreamSize(quality: ImageParams['seedreamQuality'] | undefined, aspectRatio?: string): string {
    const q = quality === '4K' ? '4K' : '2K';
    if (q === '4K') {
        switch (aspectRatio) {
            case "1:1": return "4096x4096";
            case "4:3": return "4608x3456";
            case "3:4": return "3456x4608";
            case "16:9": return "5120x2880";
            case "9:16": return "2880x5120";
            case "3:2": return "4992x3328";
            case "2:3": return "3328x4992";
            case "21:9": return "6048x2592";
            default: return "4096x4096";
        }
    }

    switch (aspectRatio) {
        case "1:1": return "2048x2048";
        case "4:3": return "2304x1728";
        case "3:4": return "1728x2304";
        case "16:9": return "2560x1440";
        case "9:16": return "1440x2560";
        case "3:2": return "2496x1664";
        case "2:3": return "1664x2496";
        case "21:9": return "3024x1296";
        default: return "2048x2048";
    }
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
