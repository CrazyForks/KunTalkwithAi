import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Globe, Image as ImageIcon, MessageSquare, FileText, X, ArrowUp, Terminal } from 'lucide-react';

import { ModelSelectionDialog } from './dialogs/ModelSelectionDialog';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { ConversationSettingsDialog } from './dialogs/ConversationSettingsDialog';
import { SystemPromptDialog } from './dialogs/SystemPromptDialog';

import { Popover } from './ui/Popover';
import { MarkdownRenderer } from './markdown/MarkdownRenderer';
import { ReasoningBlock } from './chat/ReasoningBlock';
import { SearchResultsBlock } from './chat/SearchResultsBlock';
import { CodeExecutionBlock } from './chat/CodeExecutionBlock';
import { TypingIndicator } from './chat/TypingIndicator';
import { StorageService } from '../services/StorageService';
import type { Message, ApiConfig, Attachment } from '../db';
import { fileToBase64, getFileType } from '../utils/fileUtils';
import { MessageActions } from './chat/MessageActions';
import { useTextModeState } from '../state/TextModeContext';
import { SessionManager } from '../lib/controllers/SessionManager';
import { StreamManager } from '../lib/controllers/StreamManager';
import { MessageProcessor } from '../lib/controllers/MessageProcessor';

export const MainContent: React.FC = () => {
    const {
        isWebSearchEnabled, setIsWebSearchEnabled,
        isCodeExecutionEnabled, setIsCodeExecutionEnabled,
        chatParams, setChatParams,
        selectedModelId, setSelectedModelId,
        systemPrompt, setSystemPrompt,
        isSystemPromptEngaged, setIsSystemPromptEngaged
    } = useTextModeState();
    const [inputText, setInputText] = useState('');

    // Connect to Managers
    const [sessionState, setSessionState] = useState(SessionManager.getInstance().getState());
    const [streamState, setStreamState] = useState({ isStreaming: false, currentMessageId: null });

    const messages = sessionState.messages;
    const isGenerating = streamState.isStreaming;

    // TODO: Ideally move config to SessionManager or a new ConfigManager
    const [currentApiConfig, setCurrentApiConfig] = useState<ApiConfig | null>(null);

    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const hasMessages = messages.length > 0;

    const scrollRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const moreButtonRef = useRef<HTMLButtonElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);

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
    const prevConversationIdRef = useRef<string | null>(null);

    // Dialog & Popover States
    const [showModelSelection, setShowModelSelection] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showConversationSettings, setShowConversationSettings] = useState(false);
    const [showSystemPromptDialog, setShowSystemPromptDialog] = useState(false);

    const [showMorePopover, setShowMorePopover] = useState(false);

    const [sendButtonBumpKey, setSendButtonBumpKey] = useState(0);

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

    const snowflakes = useMemo(() => {
        return Array.from({ length: 100 }, () => ({
            top: `-${Math.random() * 20}%`,
            left: `${Math.random() * 100}%`,
            width: `${Math.random() * 3 + 1}px`,
            height: `${Math.random() * 3 + 1}px`,
            opacity: Math.random() * 0.4 + 0.1,
            animationDuration: `${Math.random() * 5 + 3}s`,
            animationDelay: `-${Math.random() * 10}s`,
            filter: 'blur(0.5px)'
        }));
    }, []);

    const refreshDefaultConfig = useCallback(async () => {
        const cfg = await StorageService.getDefaultApiConfig('TEXT');
        setCurrentApiConfig(cfg ?? null);
        if (cfg && selectedModelId && !cfg.models.includes(selectedModelId)) {
            setSelectedModelId('');
        }
    }, [selectedModelId, setSelectedModelId]);

    // Initialize Managers
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
             if (isDone) {
                 setStreamState(prev => ({ ...prev, isStreaming: false }));
             } else {
                 setStreamState(prev => ({ ...prev, isStreaming: true }));
             }
        });

        // Initial Load
        sessionMgr.init('TEXT');
        refreshDefaultConfig();

        // Listen for conversation selection events (Legacy support or sidebar)
        const handleSelection: EventListener = (e) => {
            const ce = e as CustomEvent<{ id: string }>;
            if (ce?.detail?.id) {
                sessionMgr.loadConversation(ce.detail.id);
            }
        };

        window.addEventListener('everytalk-conversation-selected', handleSelection);
        return () => {
            unsubSession();
            unsubStream();
            window.removeEventListener('everytalk-conversation-selected', handleSelection);
        };
    }, [refreshDefaultConfig]);

    useEffect(() => {
        if (!showSettings && !showModelSelection) {
            refreshDefaultConfig();
        }
    }, [showSettings, showModelSelection, refreshDefaultConfig]);

    // Track conversation ID changes
    // NOTE: Model reset for new chats is handled in TextModeContext.loadForConversation()
    // which properly loads conversation-specific settings or defaults to the first model.
    // We only track the ID change here for other purposes (e.g., scroll reset).
    useEffect(() => {
        const currentId = sessionState.currentConversationId;
        if (currentId && currentId !== prevConversationIdRef.current) {
            prevConversationIdRef.current = currentId;
        }
    }, [sessionState.currentConversationId]);

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

    useEffect(() => {
        if (!pendingScrollToTopMessageId) return;

        const attemptScroll = () => {
            const container = messagesContainerRef.current;
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
        const container = messagesContainerRef.current;
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
    }, [messages.length, isGenerating, pinSpacerPx]);

    const getIsAtBottom = (container: HTMLDivElement) => {
        const threshold = 12;
        return container.scrollHeight - (container.scrollTop + container.clientHeight) <= threshold;
    };

    const updateAnchorFromScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;

        // Find first visible message element
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
    };

    const lastUserMessageId = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') return messages[i].id;
        }
        return null;
    }, [messages]);

    // Restore scroll anchor on content changes (streaming/layout changes)
    useEffect(() => {
        if (!userAnchoredRef.current) return;
        const anchor = anchorRef.current;
        const container = messagesContainerRef.current;
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

    const handleStop = () => {
        StreamManager.getInstance().cancelStream();
        setStreamState(prev => ({ ...prev, isStreaming: false }));
    };

    const handleSend = async (
        overrideText?: string,
        options?: {
            skipPersistUserMessage?: boolean;
            baseMessages?: Message[];
            baseUserMessage?: Message;
        }
    ) => {
        const textToSend = overrideText || inputText;
        const sessionMgr = SessionManager.getInstance();
        const streamMgr = StreamManager.getInstance();
        
        let targetConversationId = sessionState.currentConversationId;

        // Ensure active conversation
        if (!targetConversationId) {
            await sessionMgr.createNewChat('TEXT');
            targetConversationId = sessionMgr.getState().currentConversationId;
        }
        if (!targetConversationId) return; // Should not happen

        const hasAnyAttachments = (attachments.length > 0) || ((options?.baseUserMessage?.attachments?.length ?? 0) > 0);
        if (!textToSend.trim() && !hasAnyAttachments) return;

        if (streamState.isStreaming) {
            streamMgr.cancelStream();
        }

        const isRegeneration = !!options?.skipPersistUserMessage;
        const baseMessagesSnapshot = options?.baseMessages ?? messages;
        const effectiveAttachments = isRegeneration
            ? (options?.baseUserMessage?.attachments ? [...options.baseUserMessage.attachments] : undefined)
            : (attachments.length > 0 ? [...attachments] : undefined);

        const existingConversation = await StorageService.getConversation(targetConversationId);
        if (!existingConversation) {
            await StorageService.createConversation('TEXT', undefined, targetConversationId);
        }

        if (!isRegeneration) {
            const userMessage: Message = {
                id: createMessageId(),
                conversationId: targetConversationId,
                role: 'user',
                text: textToSend,
                timestamp: Date.now(),
                attachments: effectiveAttachments
            };

            await StorageService.addMessage(userMessage);
            sessionMgr.updateMessages(prev => [...prev, userMessage]);
            
            // Scroll handling
            isProgrammaticScrollRef.current = true;
            preventAutoScrollRef.current = true;
            setPendingScrollToTopMessageId(userMessage.id);
            anchorRef.current = { id: userMessage.id, offset: 0 };
            userAnchoredRef.current = true;

            if (!overrideText) {
                setInputText('');
                setAttachments([]);
                if (textareaRef.current) {
                    textareaRef.current.style.height = '44px';
                }
            }
        }

        if (isRegeneration && options?.baseUserMessage?.id) {
            // Match Android behavior: keep the base user message pinned to top while regenerating.
            isProgrammaticScrollRef.current = true;
            preventAutoScrollRef.current = true;
            setPendingScrollToTopMessageId(options.baseUserMessage.id);
            anchorRef.current = { id: options.baseUserMessage.id, offset: 0 };
            userAnchoredRef.current = true;
        }

        // Start Generating
        setStreamState(prev => ({ ...prev, isStreaming: true }));

        const aiMessageId = createMessageId();
        const aiMessage: Message = {
            id: aiMessageId,
            conversationId: targetConversationId,
            role: 'ai',
            text: '',
            timestamp: Date.now()
        };

        await StorageService.addMessage(aiMessage);
        sessionMgr.updateMessages(prev => [...prev, aiMessage]);

        try {
            if (!currentApiConfig) {
                throw new Error('未找到API配置');
            }

            // Build request context
            const contextMessages: { role: string; content: string | unknown[] }[] = [];
            
            // Android parity:
            // - When "system prompt engaged" is OFF, we must NOT include any system messages from history.
            // - When engaged is ON, we prefer the current system prompt settings, replacing any historical system message.
            const engagedForThisConversation = isSystemPromptEngaged;
            const systemText = engagedForThisConversation ? (systemPrompt || '').trim() : '';
            const hasExplicitSystemPrompt = !!systemText;
            if (engagedForThisConversation && systemText) {
                contextMessages.push({ role: 'system', content: systemText });
            }

            for (const m of baseMessagesSnapshot) {
                if (m.role === 'system') {
                    if (!engagedForThisConversation) {
                        continue;
                    }
                    // If user has explicitly configured a system prompt for this conversation,
                    // do not include any historical system messages (avoid stale/duplicate prompts).
                    if (hasExplicitSystemPrompt) {
                        continue;
                    }
                    if (m.text.trim()) contextMessages.push({ role: 'system', content: m.text });
                    continue;
                }
                if (m.role === 'tool') continue;
                const role = m.role === 'user' ? 'user' : 'assistant';
                
                let content: any = m.text;
                
                // Only process as array if there are actual attachments
                // This fixes API Error 400 where sending an array for simple text causes validation failure on some endpoints
                if (m.attachments && m.attachments.length > 0) {
                     content = MessageProcessor.processAttachments(m.text, m.attachments);
                }

                // Append code execution details if present (Context Persistence)
                // This ensures the model is aware of previous tool usage in multi-turn conversations
                if (m.codeExecution) {
                    let codeBlock = "";
                    if (m.codeExecution.code) {
                        codeBlock += `\n\nCode Executed:\n\`\`\`${m.codeExecution.language || ''}\n${m.codeExecution.code}\n\`\`\``;
                    }
                    if (m.codeExecution.output) {
                        codeBlock += `\n\nOutput:\n\`\`\`\n${m.codeExecution.output}\n\`\`\``;
                    }
                    
                    if (codeBlock) {
                        if (typeof content === 'string') {
                            content += codeBlock;
                        } else if (Array.isArray(content)) {
                            // If it's already an array (due to attachments), append the code block as a text part
                            content.push({ type: 'text', text: codeBlock });
                        }
                    }
                }

                contextMessages.push({ role, content });
            }

            if (!isRegeneration) {
                if (!effectiveAttachments || effectiveAttachments.length === 0) {
                    contextMessages.push({ role: 'user', content: textToSend });
                } else {
                    contextMessages.push({ role: 'user', content: MessageProcessor.processAttachments(textToSend, effectiveAttachments) as any });
                }
            }

            const requestModel = selectedModelId || currentApiConfig?.models[0];

            const requestModelLower = (requestModel || '').toLowerCase();
            const isGeminiChannel =
                (currentApiConfig?.channel?.toLowerCase().includes('gemini') || currentApiConfig?.provider?.toLowerCase().includes('gemini')) &&
                requestModelLower.includes('gemini');
            const enableCodeExecutionForRequest = isGeminiChannel ? isCodeExecutionEnabled : undefined;
            const qwenEnableSearchForRequest = requestModelLower.includes('qwen') && isWebSearchEnabled ? true : undefined;

            await streamMgr.startStream(
                currentApiConfig,
                {
                    messages: contextMessages as any,
                    model: requestModel,
                    temperature: chatParams.temperature,
                    topP: chatParams.topP,
                    maxTokens: chatParams.maxTokens,
                    useWebSearch: isWebSearchEnabled,
                    enableCodeExecution: enableCodeExecutionForRequest,
                    qwenEnableSearch: qwenEnableSearchForRequest,
                    stream: true,
                },
                aiMessageId,
                aiMessage
            );

        } catch (err: unknown) {
            console.error(err);
            // Error handling is managed inside StreamManager mostly, but we can do global alerts here if needed
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleMessageAction = async (action: 'copy' | 'regenerate' | 'delete' | 'edit', msg: Message) => {
        if (action === 'copy') {
            navigator.clipboard.writeText(msg.text);
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

            const aiIndex = messages.findIndex(m => m.id === msg.id);
            if (aiIndex === -1) return;

            const baseUserMsg = [...messages]
                .slice(0, aiIndex)
                .filter(m => m.role === 'user')
                .pop();

            if (!baseUserMsg) return;

            const baseUserIndex = messages.findIndex(m => m.id === baseUserMsg.id);
            if (baseUserIndex === -1) return;

            const idsToRemove = new Set<string>();
            for (let i = baseUserIndex + 1; i < messages.length; i++) {
                const m = messages[i];
                if (m.role === 'ai') {
                    idsToRemove.add(m.id);
                    continue;
                }
                break;
            }

            if (idsToRemove.size > 0) {
                await Promise.all(Array.from(idsToRemove).map((id) => StorageService.deleteMessage(id)));
                SessionManager.getInstance().updateMessages(prev => prev.filter(m => !idsToRemove.has(m.id)));
            }

            const trimmedMessages = messages.filter(m => !idsToRemove.has(m.id));
            // 重新发送时，确保使用当前的状态设置（isWebSearchEnabled 等）
            await handleSend(baseUserMsg.text, {
                skipPersistUserMessage: true,
                baseMessages: trimmedMessages,
                baseUserMessage: baseUserMsg,
            });
        }
    };

    const submitEdit = async (msg: Message) => {
        if (editValue.trim() !== msg.text) {
            await StorageService.updateMessage(msg.id, { text: editValue });
            SessionManager.getInstance().updateMessages(prev => prev.map(m => m.id === msg.id ? { ...m, text: editValue } : m));
        }
        setEditingMessageId(null);
    };

    const handleFileSelect = () => {
        fileInputRef.current?.click();
        setShowMorePopover(false);
    };

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files);
            const newAttachments: Attachment[] = [];

            for (const file of files) {
                try {
                    const base64 = await fileToBase64(file);
                    newAttachments.push({
                        type: getFileType(file),
                        name: file.name,
                        uri: base64,
                        mimeType: file.type
                    });
                } catch (err) {
                    console.error("File read error", err);
                }
            }
            setAttachments(prev => [...prev, ...newAttachments]);
        }
    };

    useEffect(() => {
        setSendButtonBumpKey((k) => k + 1);
    }, [isGenerating, inputText, attachments.length]);

    return (
        <div className="flex-1 h-screen min-h-0 relative bg-black overflow-hidden flex flex-col font-sans">

            {/* Snow Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#1a1a1a] via-black to-black opacity-60"></div>
                {snowflakes.map((flake, i) => (
                    <div
                        key={i}
                        className="absolute rounded-full bg-white animate-snow"
                        style={{
                            top: flake.top,
                            left: flake.left,
                            width: flake.width,
                            height: flake.height,
                            opacity: flake.opacity,
                            animationDuration: flake.animationDuration, // Faster fall 3-8s
                            animationDelay: flake.animationDelay, // Negative delay
                            filter: flake.filter
                        }}
                    />
                ))}
            </div>

            {/* Top Bar (Android Style) */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="absolute top-0 left-0 right-0 h-[60px] flex items-center justify-between px-4 z-20"
            >
                {/* Left: Config Pill + Status Dot */}
                <div className="flex items-center space-x-3">
                    <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowModelSelection(true)}
                        className="flex items-center space-x-2 bg-[#1a1a1a] px-4 py-1.5 rounded-full border border-white/10 cursor-pointer hover:bg-white/5 transition-colors"
                    >
                        <span className="text-gray-300 font-medium text-sm">{selectedModelId || currentApiConfig?.models?.[0] || '选择模型'}</span>
                    </motion.div>
                    <motion.div
                        whileHover={{ scale: 1.2 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => setShowSystemPromptDialog(true)}
                        className={`w-3 h-3 rounded-full cursor-pointer transition-colors ${
                             isSystemPromptEngaged ? 'bg-jan-500 shadow-[0_0_8px_rgba(40,130,49,0.8)]' : 'bg-jan-500/50'
                        }`}
                        animate={isSystemPromptEngaged ? {
                            scale: [1, 1.2, 1],
                            opacity: [1, 0.8, 1]
                        } : {}}
                        transition={isSystemPromptEngaged ? {
                            duration: 2,
                            repeat: Infinity,
                            ease: "easeInOut"
                        } : {}}
                    />
                </div>

                {/* Right: Settings */}
                <motion.button
                    whileHover={{ rotate: 90 }}
                    transition={{ duration: 0.3 }}
                    onClick={() => setShowSettings(true)}
                    className="p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-white/5"
                >
                    <Settings size={24} />
                </motion.button>
            </motion.div>

            {/* Main Content & Input Wrapper */}
            <motion.div
                layout
                className={`flex-1 min-h-0 flex flex-col z-10 pt-16 ${hasMessages ? 'justify-end' : 'justify-center items-center'}`}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >

                {/* Empty State (Only visible when no messages) */}
                <AnimatePresence>
                    {!hasMessages && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            transition={{ duration: 0.4, ease: "easeOut" }}
                            className="z-10 w-full max-w-3xl px-4 flex flex-col items-center mb-48"
                        >
                            <h2 className="text-3xl text-white font-semibold mb-8 flex items-center tracking-tight">
                                今天我能为您做些什么？ <span className="ml-2 text-3xl">🏮</span>
                            </h2>

                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Messages Area */}
                <AnimatePresence>
                    {hasMessages && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            ref={messagesContainerRef}
                            onWheelCapture={markUserInteracting}
                            onTouchStart={markUserInteracting}
                            onPointerDown={markUserInteracting}
                            onScroll={() => {
                                const container = messagesContainerRef.current;
                                if (!container) return;
                                if (isProgrammaticScrollRef.current) return;
                                if (preventAutoScrollRef.current && !userInteractingRef.current) return;

                                const atBottom = getIsAtBottom(container);
                                
                                if (atBottom) {
                                    // Special case: If we are generating and currently anchored to the latest user message,
                                    // we should MAINTAIN that anchor even if we hit the bottom (due to short content).
                                    // This prevents the view from switching to "stick to bottom" mode when we want "user bubble top" mode.
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
                            className="flex-1 min-h-0 w-full max-w-5xl mx-auto px-4 overflow-y-auto scrollbar-none pt-4 space-y-8 relative"
                            style={{ paddingBottom: bottomPadPx || undefined }}
                        >
                            <AnimatePresence>
                                {messages.map((msg) => {
                                    const lastMessageId = messages[messages.length - 1]?.id;
                                    const isLastMessage = msg.id === lastMessageId;
                                    const isActiveAIGenerating = isGenerating && isLastMessage && msg.role === 'ai';

                                    const hasMainText = !!(msg.text && msg.text.length > 0);
                                    const hasReasoning = !!(msg.reasoning && msg.reasoning.length > 0);
                                    const hasWebSearchStage = !!(msg.webSearchStage && msg.webSearchStage.trim());
                                    const hasWebSearchResults = !!(msg.webSearchResults && msg.webSearchResults.length > 0);
                                    const hasCodeExecution = !!(msg.codeExecution && (msg.codeExecution.code || msg.codeExecution.output || (msg.codeExecution as any).imageUrl));

                                    const showTypingIndicator = isActiveAIGenerating && !hasMainText && !hasReasoning && !hasWebSearchStage && !hasWebSearchResults && !hasCodeExecution;
                                    const shouldShowBubble = editingMessageId === msg.id || hasMainText || hasReasoning || hasWebSearchStage || hasWebSearchResults || hasCodeExecution || isActiveAIGenerating;

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
                                        <div className={`flex flex-col ${msg.role === 'user' ? 'max-w-[85%] lg:max-w-[75%] items-end' : 'w-full max-w-full items-start'}`}>

                                            {/* Role Name (Optional) */}
                                            <span className={`text-[10px] text-gray-500 mb-1 px-1 ${msg.role === 'user' ? 'hidden' : 'block'}`}>
                                                {msg.role === 'ai' ? (currentApiConfig?.name || currentApiConfig?.provider || 'EveryTalk AI') : 'User'}
                                            </span>

                                            {/* Attachments (Outside Bubble) */}
                                            {msg.attachments && msg.attachments.length > 0 && (
                                                <div className={`flex flex-wrap gap-2 mb-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                    {msg.attachments.map((att, idx) => (
                                                        <div key={idx} className="relative group w-24 h-24 rounded-xl border border-white/10 overflow-hidden shadow-sm bg-white/5">
                                                            {att.type === 'image' ? (
                                                                <img src={att.uri} className="w-full h-full object-cover" alt="preview" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-xs text-gray-300 break-all p-2 text-center">
                                                                    {att.name}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Text Bubble */}
                                            {shouldShowBubble && (
                                            <div className={`rounded-3xl max-w-full overflow-hidden shadow-sm ${
                                                msg.role === 'user'
                                                    ? (editingMessageId === msg.id ? 'w-full mb-4' : 'px-5 py-3 bg-[#A6A6A6] text-black rounded-br-sm mb-4')
                                                    : 'px-0 py-0 bg-transparent text-gray-100 rounded-bl-sm'
                                            }`}>

                                                {/* Content or Edit Input */}
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
                                                    (msg.text || (isGenerating && msg.id === messages[messages.length - 1].id) || msg.reasoning || (msg.webSearchResults && msg.webSearchResults.length > 0) || msg.webSearchStage || msg.codeExecution) && (
                                                        msg.role === 'user' ? (
                                                            <p className="whitespace-pre-wrap">{msg.text}</p>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {showTypingIndicator && (
                                                                    <TypingIndicator />
                                                                )}

                                                                {hasReasoning && (
                                                                    <ReasoningBlock
                                                                        content={msg.reasoning || ''}
                                                                        isGenerating={isActiveAIGenerating && !hasMainText}
                                                                        hasMainContent={hasMainText}
                                                                    />
                                                                )}

                                                                {msg.webSearchStage && msg.webSearchStage.trim() && !hasMainText && !hasWebSearchResults && (
                                                                    <div className="text-xs text-gray-300 bg-white/5 border border-white/10 rounded-xl px-3 py-2 animate-pulse">
                                                                        {msg.webSearchStage}
                                                                    </div>
                                                                )}

                                                                {msg.webSearchResults && msg.webSearchResults.length > 0 && (
                                                                    <SearchResultsBlock results={msg.webSearchResults} />
                                                                )}

                                                                {msg.codeExecution && (msg.codeExecution.code || msg.codeExecution.output || (msg.codeExecution as any).imageUrl) && (
                                                                    <CodeExecutionBlock codeExecution={msg.codeExecution} />
                                                                )}

                                                                {hasMainText && (
                                                                    <div className="relative">
                                                                        <MarkdownRenderer content={msg.text} />
                                                                        {isActiveAIGenerating && (
                                                                           <span className="inline-block w-2 h-4 ml-0.5 bg-jan-400 animate-cursor-blink align-middle" />
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    )
                                                )}
                                            </div>
                                            )}

                                            {/* Message Actions */}
                                            {(hoveredMessageId === msg.id && !isGenerating && editingMessageId !== msg.id) && (
                                                <div
                                                    className={`absolute ${msg.role === 'user' ? 'right-0 bottom-2' : 'left-0 -bottom-1'} flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} z-10`}
                                                >
                                                    <div className="rounded-xl bg-black/40 backdrop-blur-sm border border-white/10 px-1 py-1 shadow-sm">
                                                        <MessageActions
                                                            isUser={msg.role === 'user'}
                                                            onCopy={() => handleMessageAction('copy', msg)}
                                                            onDelete={() => handleMessageAction('delete', msg)}
                                                            onEdit={() => handleMessageAction('edit', msg)}
                                                            onRegenerate={() => handleMessageAction('regenerate', msg)}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                    );
                                })}
                                {/* Dummy div to ensure we can scroll enough to pin the last user message to top */}
                                <div ref={scrollRef} style={{ height: pinSpacerPx > 0 ? pinSpacerPx : 1 }} />
                            </AnimatePresence>

                            {isGenerating && (!messages[messages.length - 1] || (messages[messages.length - 1].role === 'user')) && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                    className="flex justify-start"
                                >
                                    <div className="bg-transparent rounded-3xl rounded-bl-sm border border-transparent">
                                        <TypingIndicator />
                                    </div>
                                </motion.div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Input Area */}
                <motion.div
                    layout
                    ref={inputAreaRef}
                    className={`absolute left-0 right-0 z-20 flex justify-center px-4 pointer-events-none ${
                        hasMessages
                            ? 'bottom-0 pb-6 pt-6 bg-gradient-to-t from-black from-30% to-transparent'
                            : 'top-1/2 -translate-y-1/2'
                    }`}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                    <motion.div
                        className="w-full max-w-5xl bg-[#1e1e1e] border border-white/20 px-2 py-2 relative group transition-all duration-300 rounded-3xl shadow-lg pointer-events-auto"
                    >
                        {/* Attachments Preview - Top */}
                        {attachments.length > 0 && (
                            <div className="flex gap-2 px-2 pb-2 mb-1 overflow-x-auto border-b border-white/5">
                                {attachments.map((att, idx) => (
                                    <div key={idx} className="relative group w-12 h-12 rounded-lg border border-white/10 overflow-hidden flex-shrink-0 bg-black/20">
                                        {att.type === 'image' ? (
                                            <img src={att.uri} className="w-full h-full object-cover" alt="preview" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400 break-all p-1">
                                                {att.name}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
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
                            <div className="flex items-center gap-1 relative flex-shrink-0">
                                 <motion.button
                                    ref={moreButtonRef}
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => setShowMorePopover(!showMorePopover)}
                                    className="p-1.5 text-gray-400 hover:text-white rounded-full transition-colors bg-white/5 hover:bg-white/10"
                                >
                                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M6 2.5V9.5M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </motion.button>

                                {/* Popover anchored to the + button, positioned slightly above */}
                                <Popover
                                    isOpen={showMorePopover}
                                    onClose={() => setShowMorePopover(false)}
                                    triggerRef={moreButtonRef}
                                    align="start"
                                    side="top"
                                    offset={36} // Added gap
                                    animation="android_panel"
                                >
                                    <div className="p-1.5 min-w-[200px] bg-[#1e1e1e] border border-white/10 rounded-xl shadow-xl backdrop-blur-xl">
                                        <button onClick={handleFileSelect} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                                            <ImageIcon size={18} className="text-emerald-400" />
                                            <span>上传图片/视频</span>
                                        </button>
                                        <button onClick={handleFileSelect} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                                            <FileText size={18} className="text-blue-400" />
                                            <span>上传文件</span>
                                        </button>
                                        <div className="h-px bg-white/10 my-1 mx-2" />
                                        <button onClick={() => { setShowMorePopover(false); setShowConversationSettings(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                                            <MessageSquare size={18} className="text-purple-400" />
                                            <span>对话参数</span>
                                        </button>
                                    </div>
                                </Popover>
                            </div>

                             {/* Input Field */}
                              <div className="flex-1 relative min-w-0">
                                 <textarea
                                     ref={textareaRef}
                                     value={inputText}
                                     onChange={(e) => {
                                         setInputText(e.target.value);
                                         // Auto-grow
                                         e.target.style.height = 'auto';
                                         const newHeight = Math.min(e.target.scrollHeight, 200);
                                         e.target.style.height = newHeight + 'px';
                                     }}
                                     onKeyDown={handleKeyDown}
                                     placeholder="询问任何问题"
                                     className="w-full bg-transparent text-gray-200 placeholder-gray-500 outline-none resize-none min-h-[24px] max-h-[200px] py-2.5 px-1 text-[16px] scrollbar-none leading-relaxed"
                                     rows={1}
                                     style={{ height: '44px', backgroundColor: 'transparent' }}
                                 />
                              </div>

                             {/* Right Actions (Toggles & Send) */}
                             <div className="flex items-center gap-1.5 pl-2 flex-shrink-0">
                                {/* Web Search Toggle - with smooth color animation */}
                                <motion.div
                                    onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                                    className="flex items-center justify-center cursor-pointer rounded-full w-10 h-10"
                                    animate={{
                                        backgroundColor: isWebSearchEnabled ? 'rgba(0, 145, 255, 0.2)' : 'rgba(255, 255, 255, 0)'
                                    }}
                                    whileHover={{ backgroundColor: isWebSearchEnabled ? 'rgba(0, 145, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)' }}
                                    whileTap={{ scale: 0.95 }}
                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                >
                                    <motion.div
                                        animate={{
                                            color: isWebSearchEnabled ? '#0091ff' : '#6b7280',
                                            scale: isWebSearchEnabled ? 1.1 : 1
                                        }}
                                        transition={{ duration: 0.2, ease: "easeOut" }}
                                    >
                                        <Globe
                                            size={20}
                                            strokeWidth={isWebSearchEnabled ? 2.5 : 2}
                                        />
                                    </motion.div>
                                </motion.div>

                                {/* Code Execution Toggle - with smooth color animation */}
                                {(() => {
                                    const requestModel = selectedModelId || currentApiConfig?.models?.[0] || '';
                                    const requestModelLower = String(requestModel).toLowerCase();
                                    const isGeminiChannel =
                                        (currentApiConfig?.channel?.toLowerCase().includes('gemini') || currentApiConfig?.provider?.toLowerCase().includes('gemini')) &&
                                        requestModelLower.includes('gemini');
                                    if (!isGeminiChannel) return null;

                                    return (
                                        <motion.div
                                            onClick={() => setIsCodeExecutionEnabled(!isCodeExecutionEnabled)}
                                            className="flex items-center justify-center cursor-pointer rounded-full w-10 h-10"
                                            animate={{
                                                backgroundColor: isCodeExecutionEnabled ? 'rgba(156, 39, 176, 0.2)' : 'rgba(255, 255, 255, 0)'
                                            }}
                                            whileHover={{ backgroundColor: isCodeExecutionEnabled ? 'rgba(156, 39, 176, 0.3)' : 'rgba(255, 255, 255, 0.1)' }}
                                            whileTap={{ scale: 0.95 }}
                                            transition={{ duration: 0.2, ease: "easeOut" }}
                                        >
                                            <motion.div
                                                animate={{
                                                    color: isCodeExecutionEnabled ? '#9C27B0' : '#6b7280',
                                                    scale: isCodeExecutionEnabled ? 1.1 : 1
                                                }}
                                                transition={{ duration: 0.2, ease: "easeOut" }}
                                            >
                                                <Terminal
                                                    size={20}
                                                    strokeWidth={isCodeExecutionEnabled ? 2.5 : 2}
                                                />
                                            </motion.div>
                                        </motion.div>
                                    );
                                })()}

                                {/* Send Button */}
                                <motion.button
                                    key={sendButtonBumpKey}
                                    onClick={() => {
                                        const hasContent = inputText.trim().length > 0 || attachments.length > 0;
                                        if (isGenerating) {
                                            handleStop();
                                            return;
                                        }
                                        if (hasContent) {
                                            handleSend();
                                        }
                                    }}
                                    initial={{ scale: 1 }}
                                    animate={{ scale: [1, 0.85, 1] }}
                                    transition={{ duration: 0.2 }}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    disabled={!isGenerating && inputText.trim().length === 0 && attachments.length === 0}
                                    className={`p-2 rounded-full transition-all duration-200 flex-shrink-0 ${
                                        (inputText.trim().length > 0 || attachments.length > 0 || isGenerating)
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

                        {/* Hidden File Input (and extra popover anchors if needed) */}
                        <input type="file" ref={fileInputRef} className="hidden" multiple onChange={onFileChange} />
                        
                    </motion.div>
                </motion.div>
            </motion.div>

            {/* Dialogs */}
            <ModelSelectionDialog
                isOpen={showModelSelection}
                onClose={() => setShowModelSelection(false)}
                onSelect={(id) => setSelectedModelId(id)}
                currentModelId={selectedModelId || currentApiConfig?.models[0]}
                modality="TEXT"
            />

            <SettingsDialog
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />

            <ConversationSettingsDialog
                isOpen={showConversationSettings}
                onClose={() => setShowConversationSettings(false)}
                initialSettings={chatParams}
                onConfirm={(settings) => setChatParams(settings)}
            />

            <SystemPromptDialog
                isOpen={showSystemPromptDialog}
                onClose={() => setShowSystemPromptDialog(false)}
                systemPrompt={systemPrompt}
                isEngaged={isSystemPromptEngaged}
                onSave={(prompt, engaged) => {
                    setSystemPrompt(prompt);
                    setIsSystemPromptEngaged(engaged);
                }}
            />
        </div>
    );
};