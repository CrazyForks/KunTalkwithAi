import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { Settings, ArrowUp, Image as ImageIcon, X, SlidersHorizontal, ChevronsRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { TypingIndicator } from './chat/TypingIndicator';
import { MessageActions } from './chat/MessageActions';
import { ImageSettingsDialog } from './dialogs/ImageSettingsDialog';
import { ModelSelectionDialog } from './dialogs/ModelSelectionDialog';
import { ImageViewer } from './ImageViewer';

import { Popover } from './ui/Popover';
import { StorageService } from '../services/StorageService';
import type { ApiConfig, Message } from '../db';
import { useImageModeState } from '../state/ImageModeContext';
import type { ModelConfig } from '../state/modeTypes';
import { generateImage } from '../lib/api';
import { fileToBase64 } from '../utils/fileUtils';
import { SessionManager } from '../lib/controllers/SessionManager';
import { StreamManager } from '../lib/controllers/StreamManager';

export const ImageGenerationScreen: React.FC = () => {
    const { imageParams, setImageParams, selectedModelId, setSelectedModelId } = useImageModeState();
    
    // Connect to SessionManager
    const [sessionState, setSessionState] = useState(SessionManager.getInstance().getState());
    const [streamState, setStreamState] = useState({ isStreaming: false, currentMessageId: null });
    
    const messages = sessionState.messages;
    const isGenerating = streamState.isStreaming;
    const hasContent = messages.length > 0;
    
    const [currentApiConfig, setCurrentApiConfig] = useState<ApiConfig | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [selectedImages, setSelectedImages] = useState<File[]>([]);
    const [showParamsPanel, setShowParamsPanel] = useState(false);
    
    const abortRef = useRef<AbortController | null>(null);
    const prevConversationIdRef = useRef<string | null>(null);

    const [viewerUrl, setViewerUrl] = useState<string | null>(null);

    const [showMorePopover, setShowMorePopover] = useState(false);
    const [sendButtonBumpKey, setSendButtonBumpKey] = useState(0);
    const [layoutBump, setLayoutBump] = useState(0);
    const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const moreButtonRef = useRef<HTMLDivElement>(null);
    const paramsButtonRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);

    // Dialog States
    const [showSettingsDialog, setShowSettingsDialog] = useState(false);
    const [showModelDialog, setShowModelDialog] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);

    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [pendingScrollToTopMessageId, setPendingScrollToTopMessageId] = useState<string | null>(null);
    const [pinSpacerPx, setPinSpacerPx] = useState(0);
    const [bottomPadPx, setBottomPadPx] = useState(0);

    const isProgrammaticScrollRef = useRef(false);
    const preventAutoScrollRef = useRef(false);
    const userInteractingRef = useRef(false);
    const userInteractingTimerRef = useRef<number | null>(null);
    const userAnchoredRef = useRef(false);
    const anchorRef = useRef<{ id: string; offset: number } | null>(null);
    const lastRestoreAtRef = useRef(0);

    const createMessageId = () => {
        try {
            if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
                return (crypto as any).randomUUID() as string;
            }
        } catch {
            // ignore
        }
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    };

    const markUserInteracting = useCallback(() => {
        userInteractingRef.current = true;
        preventAutoScrollRef.current = false;
        if (userInteractingTimerRef.current) {
            window.clearTimeout(userInteractingTimerRef.current);
        }
        userInteractingTimerRef.current = window.setTimeout(() => {
            userInteractingRef.current = false;
            userInteractingTimerRef.current = null;
        }, 300);
    }, []);

    useEffect(() => {
        return () => {
            if (userInteractingTimerRef.current) {
                window.clearTimeout(userInteractingTimerRef.current);
            }
        };
    }, []);

    const getIsAtBottom = (container: HTMLDivElement) => {
        const threshold = 12;
        return container.scrollHeight - (container.scrollTop + container.clientHeight) <= threshold;
    };

    const updateAnchorFromScroll = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        const targetLine = container.scrollTop + 8;
        let anchorId: string | null = null;

        for (const msg of messages) {
            const el = messageRefs.current[msg.id];
            if (!el) continue;
            const bottom = el.offsetTop + el.offsetHeight;
            if (bottom >= targetLine) {
                anchorId = msg.id;
                break;
            }
        }

        if (!anchorId) return;
        const el = messageRefs.current[anchorId];
        if (!el) return;
        anchorRef.current = { id: anchorId, offset: container.scrollTop - el.offsetTop };
    }, [messages]);

    const lastUserMessageId = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') return messages[i].id;
        }
        return null;
    }, [messages]);

    useEffect(() => {
        if (!userAnchoredRef.current) return;
        const anchor = anchorRef.current;
        const container = scrollRef.current;
        if (!anchor || !container) return;
        if (isProgrammaticScrollRef.current) return;

        const now = Date.now();
        if (now - lastRestoreAtRef.current < 50) return;
        lastRestoreAtRef.current = now;

        const el = messageRefs.current[anchor.id];
        if (!el) return;

        isProgrammaticScrollRef.current = true;
        container.scrollTop = Math.max(0, el.offsetTop + anchor.offset);
        window.requestAnimationFrame(() => {
            isProgrammaticScrollRef.current = false;
        });
    }, [messages]);

    useEffect(() => {
        if (!pendingScrollToTopMessageId) return;

        const attemptScroll = () => {
            const container = scrollRef.current;
            const targetId = pendingScrollToTopMessageId;
            const el = messageRefs.current[targetId];

            if (!container || !el) return false;

            isProgrammaticScrollRef.current = true;
            preventAutoScrollRef.current = true;

            const targetTop = Math.max(0, el.offsetTop - 24);
            const maxTopRaw = container.scrollHeight - container.clientHeight;
            const maxTop = Math.max(0, maxTopRaw);
            const minScrollDistance = 160;
            const desiredMaxTop = targetTop + minScrollDistance;
            const requiredExtra = Math.max(0, Math.ceil(desiredMaxTop - maxTopRaw));

            const needed = requiredExtra > 0 ? requiredExtra + 24 : 0;
            if (needed > 0 && needed > pinSpacerPx + 2) {
                setPinSpacerPx(needed);
                return false;
            }

            const startTop = maxTop;
            container.scrollTop = startTop;

            const durationMs = 350;
            const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
            let startAt = 0;

            const step = (now: number) => {
                if (!startAt) startAt = now;
                const t = Math.min(1, (now - startAt) / durationMs);
                const eased = easeInOutQuad(t);
                container.scrollTop = startTop + (targetTop - startTop) * eased;
                if (t < 1) {
                    window.requestAnimationFrame(step);
                }
            };

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(step);
            });

            anchorRef.current = { id: targetId, offset: -24 };
            userAnchoredRef.current = true;

            setPendingScrollToTopMessageId(null);

            setTimeout(() => {
                const currentEl = messageRefs.current[targetId];
                if (currentEl) {
                    const reCheckTop = Math.max(0, currentEl.offsetTop - 24);
                    if (Math.abs(container.scrollTop - reCheckTop) > 10) {
                        container.scrollTo({ top: reCheckTop, behavior: 'auto' });
                    }
                }
                isProgrammaticScrollRef.current = false;
            }, durationMs + 80);

            return true;
        };

        if (!attemptScroll()) {
            const timers: ReturnType<typeof setTimeout>[] = [];
            [50, 100, 300].forEach(delay => {
                timers.push(setTimeout(() => {
                    if (pendingScrollToTopMessageId) attemptScroll();
                }, delay));
            });

            timers.push(setTimeout(() => {
                if (!messageRefs.current[pendingScrollToTopMessageId || '']) {
                    isProgrammaticScrollRef.current = false;
                }
            }, 400));

            return () => timers.forEach(clearTimeout);
        }
    }, [messages.length, pendingScrollToTopMessageId, pinSpacerPx]);

    useEffect(() => {
        const container = scrollRef.current;
        const anchor = anchorRef.current;
        if (!container || !anchor) return;
        if (!userAnchoredRef.current) return;
        const el = messageRefs.current[anchor.id];
        if (!el) return;
        if (!preventAutoScrollRef.current) return;

        const targetTop = Math.max(0, el.offsetTop - 24);
        const maxTopRaw = container.scrollHeight - container.clientHeight;
        const minScrollDistance = 160;
        const desiredMaxTop = targetTop + minScrollDistance;
        const requiredExtra = Math.max(0, Math.ceil(desiredMaxTop - maxTopRaw));

        const needed = requiredExtra > 0 ? requiredExtra + 24 : 0;
        if (needed > 0 && needed > pinSpacerPx + 2) {
            setPinSpacerPx(needed);
        }
    }, [messages.length, isGenerating, pinSpacerPx, layoutBump]);

    useEffect(() => {
        setSendButtonBumpKey((k) => k + 1);
    }, [isGenerating, inputValue, selectedImages.length]);

    useEffect(() => {
        const el = inputAreaRef.current;
        if (!el) return;

        const update = () => {
            const h = el.getBoundingClientRect().height;
            setBottomPadPx(Math.max(0, Math.round(h + 16)));
        };

        update();

        let ro: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => update());
            ro.observe(el);
        }

        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('resize', update);
            ro?.disconnect();
        };
    }, []);

    const refreshDefaultConfig = async () => {
        const cfg = await StorageService.getDefaultApiConfig('IMAGE');
        setCurrentApiConfig(cfg ?? null);
        if (cfg && selectedModelId && !cfg.models.includes(selectedModelId)) {
            setSelectedModelId('');
        }
    };

    // Initialize Session
    useEffect(() => {
        const sessionMgr = SessionManager.getInstance();
        const streamMgr = StreamManager.getInstance();
        
        const unsubSession = sessionMgr.subscribe(setSessionState);
        const unsubStream = streamMgr.subscribe((msgId, partial, isDone) => {
             // Optimistically update message in session
             sessionMgr.updateMessages(prev => prev.map(m => {
                 if (m.id === msgId) {
                     return { ...m, ...partial };
                 }
                 return m;
             }));
             
             // Update generating state
             setStreamState(prev => ({ ...prev, isStreaming: !isDone }));
        });
        
        sessionMgr.init('IMAGE');
        refreshDefaultConfig();

        const handleSelection: EventListener = (e) => {
            const ce = e as CustomEvent<{ id: string }>;
            if (ce?.detail?.id) sessionMgr.loadConversation(ce.detail.id);
        };

        window.addEventListener('everytalk-conversation-selected', handleSelection);
        return () => {
            unsubSession();
            unsubStream();
            window.removeEventListener('everytalk-conversation-selected', handleSelection);
        };
    }, []);

    useEffect(() => {
        if (!showSettingsDialog) {
            refreshDefaultConfig();
        }
    }, [showSettingsDialog]);

    useEffect(() => {
        if (!showModelDialog) {
            refreshDefaultConfig();
        }
    }, [showModelDialog]);

    // Track conversation ID changes
    // NOTE: Model reset for new chats is handled in ImageModeContext.loadForConversation()
    // which properly loads conversation-specific settings or defaults to the first model.
    // We only track the ID change here for other purposes (e.g., scroll reset).
    useEffect(() => {
        const currentId = sessionState.currentConversationId;
        if (currentId && currentId !== prevConversationIdRef.current) {
            prevConversationIdRef.current = currentId;
        }
    }, [sessionState.currentConversationId]);

    const selectedModel = selectedModelId || currentApiConfig?.models?.[0] || '';
    const aspectRatio = imageParams.aspectRatio;
    const steps = imageParams.steps;
    const guidance = imageParams.guidance;

    const modelLower = selectedModel.toLowerCase();
    const providerLower = (currentApiConfig?.provider ?? '').toLowerCase();
    const addressLower = (currentApiConfig?.baseUrl ?? '').toLowerCase();

    const isModal = modelLower.includes('z-image-turbo') || modelLower.includes('z_image_turbo') || addressLower.includes('z-image-turbo');
    const isQwenEdit = modelLower.includes('qwen-image-edit') || modelLower.includes('qwen-edit') || modelLower.includes('qwen_edit');
    const isKolors = modelLower.includes('kolors') || modelLower.includes('kwai-kolors');
    const isSeedream = providerLower.includes('seedream') || modelLower.includes('doubao') || modelLower.includes('seedream');
    const isGemini = (providerLower.includes('gemini') || modelLower.includes('gemini') || modelLower.includes('imagen')) && currentApiConfig?.channel !== 'OpenAI兼容';
    const isGemini3Pro = modelLower.includes('gemini-3-pro-image') || modelLower.includes('gemini-3-pro-image-preview');
    const isGemini25Flash = modelLower.includes('gemini-2.5-flash-image') || modelLower.includes('gemini-2-5-flash-image');

    const maxInputImages = isModal ? 0 : (isQwenEdit ? 1 : (isGemini3Pro ? 14 : (isGemini25Flash ? 3 : 1)));

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setSelectedImages(prev => {
            if (maxInputImages <= 0) return [];
            if (prev.length <= maxInputImages) return prev;
            return prev.slice(0, maxInputImages);
        });
    }, [maxInputImages]);

    const handleStop = () => {
        // Stop currently managed stream if integrated or just fallback to abortRef for simple image gen
        // Since image gen isn't fully in StreamManager yet, we keep local abort
        // But for consistency we should move generateImage to StreamManager or similar
        // For now, let's keep local control but update state
        abortRef.current?.abort();
        abortRef.current = null;
        setStreamState(prev => ({ ...prev, isStreaming: false }));
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (maxInputImages <= 0) return;
        if (e.target.files && e.target.files.length > 0) {
            const incoming = Array.from(e.target.files);
            setSelectedImages(prev => {
                const merged = [...prev, ...incoming];
                if (merged.length <= maxInputImages) return merged;
                return merged.slice(0, maxInputImages);
            });
        }
    };

    const handleImageLoad = useCallback(() => {
        // Trigger a re-calculation of scroll positions/anchors when an image loads
        // This is crucial because image loading changes the layout height asynchronously
        setLayoutBump(prev => prev + 1);
        
        // Immediate restoration attempt
        if (userAnchoredRef.current && anchorRef.current && scrollRef.current) {
             const anchor = anchorRef.current;
             const container = scrollRef.current;
             const el = messageRefs.current[anchor.id];
             if (el) {
                 isProgrammaticScrollRef.current = true;
                 container.scrollTop = Math.max(0, el.offsetTop + anchor.offset);
                 requestAnimationFrame(() => {
                     isProgrammaticScrollRef.current = false;
                 });
             }
        }
    }, []);

    const removeImage = (index: number) => {
        setSelectedImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const pickClosestRatio = (w: number, h: number, candidates: string[]): string => {
        if (w <= 0 || h <= 0) return candidates[0] ?? '1:1';
        const r = w / h;

        let best = candidates[0] ?? '1:1';
        let bestDiff = Number.POSITIVE_INFINITY;

        for (const c of candidates) {
            const parts = c.split(':');
            if (parts.length !== 2) continue;
            const cw = Number(parts[0]);
            const ch = Number(parts[1]);
            if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) continue;
            const cr = cw / ch;
            const diff = Math.abs(cr - r);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = c;
            }
        }

        return best;
    };

    const detectAspectRatioFromFile = async (file: File): Promise<{ width: number; height: number } | null> => {
        try {
            if (typeof createImageBitmap === 'function') {
                const bmp = await createImageBitmap(file);
                const width = bmp.width as number;
                const height = bmp.height as number;
                if (typeof bmp.close === 'function') bmp.close();
                return { width, height };
            }
        } catch {
            // ignore
        }

        try {
            const url = URL.createObjectURL(file);
            const img = new Image();
            const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
                img.onerror = () => reject(new Error('load image failed'));
                img.src = url;
            });
            URL.revokeObjectURL(url);
            return size;
        } catch {
            return null;
        }
    };

    const handleSend = async (overridePrompt?: string) => {
        const prompt = overridePrompt !== undefined ? overridePrompt : inputValue.trim();
        const sessionMgr = SessionManager.getInstance();
        
        if ((!prompt && selectedImages.length === 0) || isGenerating) return;

        let targetConversationId = sessionState.currentConversationId;
        if (!targetConversationId) {
            await sessionMgr.createNewChat('IMAGE');
            targetConversationId = sessionMgr.getState().currentConversationId;
        }
        if (!targetConversationId) return;

        if (!currentApiConfig || !selectedModel) {
            console.error("Missing config or model", currentApiConfig, selectedModel);
            return;
        }

        if (!currentApiConfig.baseUrl) {
            console.error("Missing Base URL");
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const now = Date.now();
        
        const effectiveImageParams = { ...imageParams };
        if (!isModal && effectiveImageParams.aspectRatio === 'AUTO' && selectedImages.length > 0) {
            const sz = await detectAspectRatioFromFile(selectedImages[0]);
            if (sz) {
                const ratioCandidates = ['1:1', '2:3', '3:2', '3:4', '4:3', '1:2', '4:5', '5:4', '9:16', '16:9', '21:9'];
                effectiveImageParams.aspectRatio = pickClosestRatio(sz.width, sz.height, ratioCandidates);
            } else {
                effectiveImageParams.aspectRatio = '1:1';
            }
        }

        // Convert images to base64 for persistence
        const referenceImages = await Promise.all(selectedImages.map(file => fileToBase64(file)));

        const userMessageId = createMessageId();
        const aiId = createMessageId();

        const userMessage: Message = {
            id: userMessageId,
            conversationId: targetConversationId,
            role: 'user',
            text: prompt,
            images: referenceImages,
            timestamp: now
        };
        await StorageService.addMessage(userMessage);

        const aiMessage: Message = {
            id: aiId,
            conversationId: targetConversationId,
            role: 'ai',
            text: '',
            images: [],
            timestamp: now + 1
        };
        await StorageService.addMessage(aiMessage);

        isProgrammaticScrollRef.current = true;
        preventAutoScrollRef.current = true;
        setPendingScrollToTopMessageId(userMessageId);
        anchorRef.current = { id: userMessageId, offset: 0 };
        userAnchoredRef.current = true;

        // Update Session Manager
        sessionMgr.updateMessages(prev => [...prev, userMessage, aiMessage]);

        if (overridePrompt === undefined) {
            setInputValue('');
            setSelectedImages([]);
        }
        setStreamState(prev => ({ ...prev, isStreaming: true }));

        try {
            const mapped: ModelConfig = {
                id: currentApiConfig.id,
                provider: currentApiConfig.provider,
                address: currentApiConfig.baseUrl,
                key: currentApiConfig.apiKey,
                channel: currentApiConfig.channel === 'Gemini' ? 'Gemini' : 'OpenAI兼容',
                model: selectedModel,
            };
            const urls = await generateImage({
                config: mapped,
                prompt: prompt || ' ',
                imageParams: effectiveImageParams,
                signal: controller.signal,
                referenceImages
            });

            await StorageService.updateMessage(aiId, { images: urls });
            sessionMgr.updateMessages(prev => prev.map(m => {
                if (m.id !== aiId) return m;
                return { ...m, images: urls };
            }));
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'AbortError') {
                // ignored
            } else {
                const errText = e instanceof Error ? e.message : '请求失败';
                await StorageService.updateMessage(aiId, { text: errText });
                sessionMgr.updateMessages(prev => prev.map(m => {
                    if (m.id !== aiId) return m;
                    return { ...m, text: errText };
                }));
            }
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
            setStreamState(prev => ({ ...prev, isStreaming: false }));
        }
    };

    const handleMessageAction = async (action: 'copy' | 'regenerate' | 'delete' | 'edit', msg: Message) => {
        if (action === 'copy') {
             if (msg.images && msg.images.length > 0) {
                 // Copy image URLs or first image
                 navigator.clipboard.writeText(msg.images.join('\n'));
             } else {
                 navigator.clipboard.writeText(msg.text);
             }
             return;
        }

        if (action === 'delete') {
            await StorageService.deleteMessage(msg.id);
            SessionManager.getInstance().updateMessages(prev => prev.filter(m => m.id !== msg.id));
            return;
        }

        if (action === 'edit') {
            setEditingMessageId(msg.id);
            setEditValue(msg.text);
            return;
        }

        if (action === 'regenerate') {
            if (msg.role !== 'ai') return;
            
            // Find preceding user message
            const aiIndex = messages.findIndex(m => m.id === msg.id);
            if (aiIndex === -1) return;
            
            const baseUserMsg = [...messages]
                .slice(0, aiIndex)
                .filter(m => m.role === 'user')
                .pop();
            
            if (!baseUserMsg) return;

            // Delete this AI message and any subsequent messages
             const idsToRemove = new Set<string>();
             // Keep the base user message, delete everything after it
             // Actually logic: delete THIS AI message and everything after it?
             // Or delete everything after baseUserMsg?
             // Usually regenerate means: delete ai response, and re-run using baseUserMsg prompt.
             // Let's find baseUserMsg index in full list
             const baseUserIndex = messages.findIndex(m => m.id === baseUserMsg.id);
             
             for (let i = baseUserIndex + 1; i < messages.length; i++) {
                 idsToRemove.add(messages[i].id);
             }

             if (idsToRemove.size > 0) {
                await Promise.all(Array.from(idsToRemove).map((id) => StorageService.deleteMessage(id)));
                SessionManager.getInstance().updateMessages(prev => prev.filter(m => !idsToRemove.has(m.id)));
            }

            // Trigger send with previous prompt
            // Note: we might lose the original "selectedImages" if they were not persisted or re-hydrated.
            // But handleSend uses "selectedImages" state or args.
            // For simple regen, we just use text prompt. Re-using images is trickier if we don't restore state.
            // For now, assume text prompt regen.
            // Restoration of images for regen would require decoding base64 from message history if stored there.
            // Our DB stores images as array of strings (urls or base64).
            
            // If the user message had images, we should technically restore them to "selectedImages" if we want them included in new generation call
            // But handleSend reads from "selectedImages" state.
            // Let's try to restore them if they are base64 in the message.
            if (baseUserMsg.images && baseUserMsg.images.length > 0) {
                 // Best effort: if they are data URLs, convert back to file?
                 // Or modify handleSend to accept explicit images.
                 // For now, let's just re-run prompt and rely on the fact that 'generateImage' API might need refImages.
                 // Actually, handleSend builds user message from scratch.
                 // We need a version of handleSend that doesn't create user message, OR
                 // we just re-run the "API call part" logic.
                 
                 // Simpler approach: Just trigger generation logic directly?
                 // But we want to reuse the common flow.
                 
                 // Let's modify handleSend to support "skip user message creation" or just re-fill state?
                 // Re-filling state is safer.
                 setInputValue(baseUserMsg.text);
                 // Images?
                 // If we can't easily restore File objects, we might skip images for regen or warn user.
                 // However, we can modify handleSend to take optional "referenceImages" string array directly?
                 // Yes, generateImage takes referenceImages (string[]).
                 // So we can extract them from baseUserMsg.
                 
                 // But handleSend creates a NEW user message. We don't want that for regen?
                 // Typically regen deletes old AI response and generates new one for SAME user message.
                 // So we shouldn't call handleSend which creates a new user message.
                 // We should factor out the "generation" part.
                 
                 // For this fix, let's just do a quick "delete and re-send as new message" (effectively)
                 // OR better: keep user message, delete AI message, call generation.
                 
                 // Let's just do: delete AI message(s), then call handleSend logic but skip creating user message.
                 // We need to refactor handleSend a bit? Or just duplicate the generation call here.
                 // Duplication is safer to avoid breaking existing flow.
            }
            
            // Quick implementation: just update input and let user press send? No, that's not "Regenerate".
            // Let's do:
            // 1. Delete AI message
            // 2. Call generateImage
            // 3. Create new AI message
            
            // Re-using handleSend logic by calling it with override?
            // But handleSend creates user message.
            
            // Let's just create a new AI message and call generate.
            
            const prompt = baseUserMsg.text;
            const refs = baseUserMsg.images || [];

            const aiId = createMessageId();
            const now = Date.now();
            
            const aiMessage: Message = {
                id: aiId,
                conversationId: sessionState.currentConversationId!,
                role: 'ai',
                text: '',
                images: [],
                timestamp: now
            };
            await StorageService.addMessage(aiMessage);
            SessionManager.getInstance().updateMessages(prev => [...prev, aiMessage]);
            
            setStreamState(prev => ({ ...prev, isStreaming: true }));
            
            // ... copy-paste generation logic ...
            // Ideally refactor this into a "performGeneration(prompt, images, aiMessageId)" function.
            // But for this diff, let's inline or use a helper if possible.
             if (!currentApiConfig) return;
             
             const controller = new AbortController();
             abortRef.current = controller;
             
             try {
                const effectiveImageParams = { ...imageParams };
                // Aspect ratio logic... assume already set or default
                
                const mapped: ModelConfig = {
                    id: currentApiConfig.id,
                    provider: currentApiConfig.provider,
                    address: currentApiConfig.baseUrl,
                    key: currentApiConfig.apiKey,
                    channel: currentApiConfig.channel === 'Gemini' ? 'Gemini' : 'OpenAI兼容',
                    model: selectedModel,
                };
                
                const urls = await generateImage({
                    config: mapped,
                    prompt: prompt || ' ',
                    imageParams: effectiveImageParams,
                    signal: controller.signal,
                    referenceImages: refs
                });

                await StorageService.updateMessage(aiId, { images: urls });
                SessionManager.getInstance().updateMessages(prev => prev.map(m => {
                    if (m.id !== aiId) return m;
                    return { ...m, images: urls };
                }));
             } catch (e: unknown) {
                 if (e instanceof DOMException && e.name === 'AbortError') {
                 } else {
                    const errText = e instanceof Error ? e.message : '请求失败';
                    await StorageService.updateMessage(aiId, { text: errText });
                    SessionManager.getInstance().updateMessages(prev => prev.map(m => {
                        if (m.id !== aiId) return m;
                        return { ...m, text: errText };
                    }));
                 }
             } finally {
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
                setStreamState(prev => ({ ...prev, isStreaming: false }));
            }
        }
    };

    const submitEdit = async (msg: Message) => {
        if (editValue.trim() !== msg.text) {
            await StorageService.updateMessage(msg.id, { text: editValue });
            SessionManager.getInstance().updateMessages(prev => prev.map(m => m.id === msg.id ? { ...m, text: editValue } : m));
        }
        setEditingMessageId(null);
    };

    return (
        <div className="flex-1 w-full flex flex-col h-full bg-black text-white relative overflow-hidden">
            {/* Snow Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-black to-black opacity-60"></div>
                {[...Array(100)].map((_, i) => (
                    <div
                        key={i}
                        className="absolute rounded-full bg-white animate-snow"
                        style={{
                            top: `-${Math.random() * 20}%`,
                            left: `${Math.random() * 100}%`,
                            width: `${Math.random() * 3 + 1}px`,
                            height: `${Math.random() * 3 + 1}px`,
                            opacity: Math.random() * 0.4 + 0.1,
                            animationDuration: `${Math.random() * 5 + 3}s`, // Faster fall 3-8s
                            animationDelay: `-${Math.random() * 10}s`, // Negative delay
                            filter: 'blur(0.5px)'
                        }}
                    />
                ))}
            </div>

            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-transparent backdrop-blur-md z-20">
                <div
                    onClick={() => setShowModelDialog(true)}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded-lg transition-colors"
                >
                    <span className="font-semibold text-sm">{selectedModel}</span>
                    <ChevronsRight size={14} className="text-gray-500" />
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setShowSettingsDialog(true)}
                        className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <Settings size={20} strokeWidth={1.5} />
                    </button>
                </div>
            </div>

            {/* Main Content & Input Wrapper */}
            <motion.div
                layout
                className={`flex-1 min-h-0 flex flex-col z-10 pt-16 ${hasContent ? 'justify-end' : 'justify-center items-center'}`}
            >
                {/* Empty State */}
                <AnimatePresence>
                    {!hasContent && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            className="z-10 w-full max-w-3xl px-4 flex flex-col items-center mb-48"
                        >
                            <h2 className="text-3xl text-white font-semibold mb-8 flex items-center tracking-tight">
                                激发你的创意灵感 <span className="ml-2 text-3xl">🧧</span>
                            </h2>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Generated Content Area */}
                {hasContent && (
                    <motion.div
                        ref={scrollRef}
                        onWheelCapture={markUserInteracting}
                        onTouchStart={markUserInteracting}
                        onPointerDown={markUserInteracting}
                        onScroll={() => {
                            const container = scrollRef.current;
                            if (!container) return;
                            if (isProgrammaticScrollRef.current) return;
                            if (preventAutoScrollRef.current && !userInteractingRef.current) return;

                            const atBottom = getIsAtBottom(container);

                            if (atBottom) {
                                const isAnchoredToLatestUser =
                                    isGenerating &&
                                    anchorRef.current &&
                                    lastUserMessageId &&
                                    anchorRef.current.id === lastUserMessageId;

                                if (isAnchoredToLatestUser) {
                                    userAnchoredRef.current = true;
                                    updateAnchorFromScroll();
                                } else {
                                    if (!preventAutoScrollRef.current) {
                                        userAnchoredRef.current = false;
                                        anchorRef.current = null;
                                        setPinSpacerPx(0);
                                    } else {
                                        userAnchoredRef.current = true;
                                        updateAnchorFromScroll();
                                    }
                                }
                            } else {
                                if (userInteractingRef.current) {
                                    userAnchoredRef.current = true;
                                    updateAnchorFromScroll();
                                }
                            }
                        }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex-1 min-h-0 w-full max-w-5xl mx-auto px-4 overflow-y-auto scrollbar-none pt-4 space-y-6 relative"
                        style={{ paddingBottom: bottomPadPx || '40vh' }}
                    >
                        <AnimatePresence>
                            {messages.map((msg, idx) => {
                                const isLastMessage = idx === messages.length - 1;
                                const isActiveAIGenerating = isGenerating && isLastMessage && msg.role === 'ai';
                                const showTypingIndicator = isActiveAIGenerating && (!msg.images || msg.images.length === 0) && !msg.text;

                                return (
                                    <motion.div
                                        key={msg.id}
                                        ref={(el) => {
                                            messageRefs.current[msg.id] = el;
                                        }}
                                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ duration: 0.3 }}
                                        className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group relative pb-8 scroll-mt-6`}
                                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                                        onMouseLeave={() => setHoveredMessageId(null)}
                                    >
                                        <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                            {/* Images */}
                                            {msg.images && msg.images.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mb-2 justify-end">
                                                    {msg.images.map((img, i) => (
                                                        <motion.img
                                                            layout
                                                            onLoad={handleImageLoad}
                                                            whileHover={{ scale: 1.02 }}
                                                            whileTap={{ scale: 0.98 }}
                                                            onClick={() => setViewerUrl(img)}
                                                            key={i}
                                                            src={img}
                                                            alt="attachment"
                                                            className="rounded-lg max-w-[300px] max-h-[300px] object-cover border border-white/10 cursor-pointer shadow-lg hover:shadow-xl hover:border-white/20 transition-all"
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                            {/* Text Bubble or Loading */}
                                            {(msg.text || showTypingIndicator || editingMessageId === msg.id) && (
                                                <div className={`rounded-3xl max-w-full overflow-hidden shadow-sm ${
                                                    msg.role === 'user'
                                                        ? (editingMessageId === msg.id ? 'w-full mb-4' : 'px-5 py-3 bg-[#A6A6A6] text-black rounded-br-sm mb-4')
                                                        : 'px-4 py-2 bg-[#2a2a2a] text-white rounded-bl-none border border-white/10'
                                                }`}>
                                                    {editingMessageId === msg.id ? (
                                                        <div className="flex flex-col gap-3 min-w-[300px] w-full bg-[#333] p-3 rounded-2xl">
                                                            <textarea
                                                                className="w-full bg-transparent outline-none resize-none text-base leading-relaxed text-white"
                                                                value={editValue}
                                                                onChange={(e) => {
                                                                    setEditValue(e.target.value);
                                                                    e.target.style.height = 'auto';
                                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                                }}
                                                                autoFocus
                                                                rows={1}
                                                                ref={(ref) => {
                                                                    if (ref) {
                                                                        ref.style.height = 'auto';
                                                                        ref.style.height = ref.scrollHeight + 'px';
                                                                    }
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                                        e.preventDefault();
                                                                        submitEdit(msg);
                                                                    }
                                                                    if (e.key === 'Escape') {
                                                                        setEditingMessageId(null);
                                                                    }
                                                                }}
                                                            />
                                                            <div className="flex justify-end gap-2 pt-1">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingMessageId(null);
                                                                    }}
                                                                    className="px-4 py-1.5 rounded-full bg-[#444] text-white hover:bg-[#555] transition-colors text-sm font-medium"
                                                                >
                                                                    取消
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        submitEdit(msg);
                                                                    }}
                                                                    className="px-4 py-1.5 rounded-full bg-white text-black hover:bg-gray-200 transition-colors text-sm font-medium"
                                                                >
                                                                    发送
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {msg.text && <p className="whitespace-pre-wrap">{msg.text}</p>}
                                                            {showTypingIndicator && <TypingIndicator />}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            
                                            {/* Message Actions */}
                                            {(hoveredMessageId === msg.id && !isGenerating && editingMessageId !== msg.id) && (
                                                <div
                                                    className={`absolute ${msg.role === 'user' ? 'right-0 bottom-2' : 'left-0 -bottom-0'} flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} z-10`}
                                                >
                                                    <div className="rounded-xl bg-black/40 backdrop-blur-sm border border-white/10 px-1 py-1 shadow-lg">
                                                        <MessageActions
                                                            isUser={msg.role === 'user'}
                                                            onCopy={msg.role === 'user' ? () => handleMessageAction('copy', msg) : undefined}
                                                            onDelete={() => handleMessageAction('delete', msg)}
                                                            onEdit={msg.role === 'user' ? () => handleMessageAction('edit', msg) : undefined}
                                                            onRegenerate={() => handleMessageAction('regenerate', msg)}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                        <div style={{ height: pinSpacerPx > 0 ? pinSpacerPx : 1 }} />
                    </motion.div>
                )}

                {/* Input Area */}
                <motion.div
                    layout
                    ref={inputAreaRef}
                    className={`absolute left-0 right-0 z-20 flex justify-center px-4 pointer-events-none ${
                        hasContent
                            ? 'bottom-0 pb-6 pt-6 bg-gradient-to-t from-black from-30% to-transparent'
                            : 'top-1/2 -translate-y-1/2'
                    }`}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                    <motion.div
                        className="w-full max-w-5xl bg-[#1e1e1e] border border-white/20 px-2 py-2 relative group transition-all duration-300 rounded-3xl shadow-lg pointer-events-auto"
                    >
                        {/* Attachments Preview - Top */}
                        {selectedImages.length > 0 && (
                            <div className="flex gap-2 px-2 pb-2 mb-1 overflow-x-auto border-b border-white/5">
                                {selectedImages.map((file, index) => (
                                    <div key={index} className="relative group w-12 h-12 rounded-lg border border-white/10 overflow-hidden flex-shrink-0 bg-black/20">
                                        <img
                                            src={URL.createObjectURL(file)}
                                            alt="preview"
                                            className="w-full h-full object-cover"
                                            onLoad={handleImageLoad}
                                        />
                                        <button
                                            onClick={() => removeImage(index)}
                                            className="absolute top-0 right-0 bg-black/60 text-white rounded-bl-lg p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex items-center gap-2 pl-1 pr-1">
                            {/* Left Actions (+ Button) */}
                            <div className="flex items-center gap-1 relative" ref={moreButtonRef}>
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => setShowMorePopover(!showMorePopover)}
                                    className="p-1.5 text-gray-400 hover:text-white rounded-full transition-colors bg-white/5 hover:bg-white/10"
                                >
                                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M6 2.5V9.5M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </motion.button>

                                <Popover
                                    isOpen={showMorePopover}
                                    onClose={() => setShowMorePopover(false)}
                                    triggerRef={moreButtonRef}
                                    align="start"
                                    side="top"
                                    offset={36}
                                    animation="android_panel"
                                >
                                    <div className="p-1.5 min-w-[200px] bg-[#1e1e1e] border border-white/10 rounded-xl shadow-xl backdrop-blur-xl">
                                        <button
                                            onClick={() => {
                                                if (maxInputImages <= 0) return;
                                                fileInputRef.current?.click();
                                                setShowMorePopover(false);
                                            }}
                                            disabled={maxInputImages <= 0}
                                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors ${maxInputImages <= 0 ? 'text-gray-600 cursor-not-allowed' : 'text-gray-200 hover:text-white hover:bg-white/10'}`}
                                        >
                                            <ImageIcon size={18} className="text-emerald-400" />
                                            <span>上传参考图</span>
                                        </button>
                                    </div>
                                </Popover>
                            </div>

                            {/* Input Field */}
                            <div className="flex-1 relative">
                                <textarea
                                    ref={textareaRef}
                                    value={inputValue}
                                    onChange={(e) => {
                                        setInputValue(e.target.value);
                                        e.target.style.height = 'auto';
                                        const newHeight = Math.min(e.target.scrollHeight, 200);
                                        e.target.style.height = newHeight + 'px';
                                    }}
                                    onKeyDown={handleKeyDown}
                                    placeholder="描述你想要生成的图像画面..."
                                    className="w-full bg-transparent text-gray-200 placeholder-gray-500 outline-none resize-none min-h-[24px] max-h-[200px] py-2.5 px-1 text-[16px] scrollbar-none leading-relaxed"
                                    rows={1}
                                    style={{ height: '44px', backgroundColor: 'transparent' }}
                                />
                            </div>

                            {/* Right Actions (Params & Send) */}
                            <div className="flex items-center gap-1.5">
                                {/* Params Toggle */}
                                <div ref={paramsButtonRef}>
                                    <motion.div
                                        onClick={() => setShowParamsPanel(!showParamsPanel)}
                                        className={`flex items-center justify-center cursor-pointer rounded-full h-10 px-2.5 transition-colors ${
                                            showParamsPanel
                                                ? ''
                                                : 'hover:bg-white/10'
                                        }`}
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        <motion.div className="flex items-center justify-center">
                                            <SlidersHorizontal
                                                size={20}
                                                className={showParamsPanel ? 'text-[#9C27B0]' : 'text-gray-500'}
                                                strokeWidth={showParamsPanel ? 2.5 : 2}
                                            />
                                        </motion.div>
                                    </motion.div>
                                </div>

                                <Popover
                                    isOpen={showParamsPanel}
                                    onClose={() => setShowParamsPanel(false)}
                                    triggerRef={paramsButtonRef}
                                    align="end"
                                    alignOffset={100}
                                    side="top"
                                    offset={24}
                                    animation="android_panel"
                                    usePortal={true} // Re-enable portal so it isn't clipped or hidden
                                >
                                    <div className="w-80 p-4 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/20">
                                         <div className="flex items-center justify-between mb-4">
                                            <h4 className="text-sm font-semibold text-white">生成参数</h4>
                                        </div>

                                        <div className="space-y-4">
                                            {isModal && (
                                                <div className="mb-4">
                                                    <label className="text-xs text-gray-400 mb-2 block">Modal 档位</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['2K', 'HD'] as const).map(tier => (
                                                            <button
                                                                key={tier}
                                                                onClick={() => setImageParams({ ...imageParams, modalSize: tier })}
                                                                className={`py-1.5 text-xs rounded-lg border ${imageParams.modalSize === tier ? 'bg-white text-black border-white' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
                                                            >
                                                                {tier}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {!isQwenEdit && (
                                                <div>
                                                    <label className="text-xs text-gray-400 mb-2 block">图片比例</label>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        {(
                                                            isModal
                                                                ? (imageParams.modalSize === 'HD' ? ['1:1', '16:9', '9:16'] : ['1:1', '16:9', '9:16', '3:4', '4:3'])
                                                                : (isKolors
                                                                    ? ['1:1', '3:4', '3:4 (Plus)', '4:3', '9:16', '16:9', '1:2']
                                                                    : ['AUTO', '1:1', '2:3', '3:2', '3:4', '4:3', '1:2', '4:5', '5:4', '9:16', '16:9', '21:9']
                                                                  )
                                                        ).map(ratio => (
                                                            <button
                                                                key={ratio}
                                                                onClick={() => setImageParams({ ...imageParams, aspectRatio: ratio })}
                                                                className={`py-1.5 text-xs rounded-lg border ${aspectRatio === ratio ? 'bg-white text-black border-white' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
                                                            >
                                                                {ratio}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {isSeedream && (
                                                <div>
                                                    <label className="text-xs text-gray-400 mb-2 block">Seedream 清晰度</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['2K', '4K'] as const).map(q => (
                                                            <button
                                                                key={q}
                                                                onClick={() => setImageParams({ ...imageParams, seedreamQuality: q })}
                                                                className={`py-1.5 text-xs rounded-lg border ${imageParams.seedreamQuality === q ? 'bg-white text-black border-white' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
                                                            >
                                                                {q}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}


                                            {isGemini && isGemini3Pro && (
                                                <div>
                                                    <label className="text-xs text-gray-400 mb-2 block">Gemini 尺寸档位</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {(['2K', '4K'] as const).map(s => (
                                                            <button
                                                                key={s}
                                                                onClick={() => setImageParams({ ...imageParams, geminiImageSize: s })}
                                                                className={`py-1.5 text-xs rounded-lg border ${imageParams.geminiImageSize === s ? 'bg-white text-black border-white' : 'bg-transparent text-gray-400 border-white/10 hover:border-white/30'}`}
                                                            >
                                                                {s}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {(isModal || isQwenEdit) && (
                                                <div>
                                                    <div className="flex justify-between mb-2">
                                                        <label className="text-xs text-gray-400">迭代步数 (Steps)</label>
                                                        <span className="text-xs text-gray-300">{steps}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max={isModal ? "20" : "50"}
                                                        step="1"
                                                        value={steps}
                                                        onChange={(e) => setImageParams({ ...imageParams, steps: Number(e.target.value) })}
                                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                                                    />
                                                    <div className="flex justify-between mt-1">
                                                        <span className="text-[10px] text-gray-500">1</span>
                                                        <span className="text-[10px] text-gray-500">{isModal ? "推荐: 4" : "推荐: 30"}</span>
                                                        <span className="text-[10px] text-gray-500">{isModal ? "20" : "50"}</span>
                                                    </div>
                                                </div>
                                            )}

                                            {isQwenEdit && (
                                                <div>
                                                    <div className="flex justify-between mb-2">
                                                        <label className="text-xs text-gray-400">引导系数 (CFG Scale)</label>
                                                        <span className="text-xs text-gray-300">{guidance}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max="10"
                                                        step="0.1"
                                                        value={guidance}
                                                        onChange={(e) => setImageParams({ ...imageParams, guidance: Number(e.target.value) })}
                                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                                                    />
                                                    <div className="flex justify-between mt-1">
                                                        <span className="text-[10px] text-gray-500">1</span>
                                                        <span className="text-[10px] text-gray-500">推荐: 7.5</span>
                                                        <span className="text-[10px] text-gray-500">10</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </Popover>

                                {/* Send/Stop Button */}
                                <motion.button
                                    key={sendButtonBumpKey}
                                    onClick={() => {
                                        if (isGenerating) {
                                            handleStop();
                                            return;
                                        }
                                        if (inputValue.trim().length > 0 || selectedImages.length > 0) {
                                            handleSend();
                                        }
                                    }}
                                    initial={{ scale: 1 }}
                                    animate={{ scale: [1, 0.85, 1] }}
                                    transition={{ duration: 0.2 }}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    disabled={!isGenerating && inputValue.trim().length === 0 && selectedImages.length === 0}
                                    className={`p-2 rounded-full transition-all duration-200 ml-1 ${
                                        (inputValue.trim().length > 0 || selectedImages.length > 0 || isGenerating)
                                            ? 'bg-white text-black hover:bg-gray-200 shadow-[0_0_10px_rgba(255,255,255,0.2)]'
                                            : 'bg-[#444] text-[#222] cursor-not-allowed'
                                    }`}
                                >
                                    {isGenerating ? (
                                        <div className="w-5 h-5 flex items-center justify-center">
                                            <div className="w-2.5 h-2.5 bg-black rounded-[2px]" />
                                        </div>
                                    ) : (
                                        <ArrowUp size={20} strokeWidth={3} />
                                    )}
                                </motion.button>
                            </div>
                        </div>
                        
                        <input
                            type="file"
                            multiple={maxInputImages > 1}
                            accept="image/*"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleImageSelect}
                        />

                    </motion.div>
                </motion.div>
            </motion.div>


            {/* Dialogs */}
            <ImageSettingsDialog
                isOpen={showSettingsDialog}
                onClose={() => setShowSettingsDialog(false)}
            />

            <ModelSelectionDialog
                isOpen={showModelDialog}
                onClose={() => setShowModelDialog(false)}
                onSelect={async (id) => {
                    setSelectedModelId(id);
                    await refreshDefaultConfig();
                }}
                currentModelId={selectedModel}
                modality="IMAGE"
            />
            
            <ImageViewer
                isOpen={!!viewerUrl}
                imageUrl={viewerUrl}
                onClose={() => setViewerUrl(null)}
                onUseAsReference={async (url) => {
                     try {
                        const response = await fetch(url);
                        const blob = await response.blob();
                        const file = new File([blob], `ref-${Date.now()}.png`, { type: blob.type });
                        setSelectedImages(prev => {
                            if (maxInputImages <= 0) return prev;
                            const merged = [...prev, file];
                            if (merged.length <= maxInputImages) return merged;
                            return merged.slice(merged.length - maxInputImages);
                        });
                     } catch (err) {
                        console.error('Failed to use image as reference', err);
                     }
                }}
            />
        </div>
    );
};