import { ApiService, type ChatRequest, type StreamEvent } from '../../services/ApiService';
import { StorageService } from '../../services/StorageService';
import type { ApiConfig, Message, WebSearchResult } from '../../db';

// Internal structure for buffering state updates
interface StreamBuffer {
    text: string;
    reasoning: string;
    webSearchStage?: string;
    webSearchResults?: WebSearchResult[];
    groundingMetadata?: any;
    codeExecution?: {
        code?: string;
        language?: string;
        output?: string;
        outcome?: 'success' | 'error';
        imageUrl?: string;
    };
    isError: boolean;
    errorMsg?: string;
}

// UI State decoupled from DB Message
export interface StreamState {
    isStreaming: boolean;
    currentMessageId: string | null;
    abortController: AbortController | null;
}

type StreamListener = (messageId: string, partialMessage: Partial<Message>, isDone: boolean) => void;

export class StreamManager {
    private static instance: StreamManager;
    private state: StreamState = {
        isStreaming: false,
        currentMessageId: null,
        abortController: null
    };

    private thinkCarry = '';
    private thinkMode = false;

    // Buffering system
    private buffer: StreamBuffer | null = null;
    private bufferFlushTimer: number | null = null;
    private FLUSH_INTERVAL_MS = 50; // Debounce update to 50ms (20fps)

    private listeners: Set<StreamListener> = new Set();

    private constructor() {}

    static getInstance(): StreamManager {
        if (!StreamManager.instance) {
            StreamManager.instance = new StreamManager();
        }
        return StreamManager.instance;
    }

    subscribe(listener: StreamListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private clearFlushTimer() {
        if (this.bufferFlushTimer) {
            window.clearTimeout(this.bufferFlushTimer);
            this.bufferFlushTimer = null;
        }
    }

    private notify(messageId: string, partial: Partial<Message>, isDone: boolean) {
        this.listeners.forEach(l => l(messageId, partial, isDone));
    }

    // Initialize a new stream
    async startStream(
        config: ApiConfig,
        request: ChatRequest,
        aiMessageId: string,
        initialMessage: Message
    ) {
        // Cancel existing stream if any
        if (this.state.isStreaming) {
            this.cancelStream();
        }

        const abortController = new AbortController();
        this.state = {
            isStreaming: true,
            currentMessageId: aiMessageId,
            abortController
        };

        // Initialize buffer
        this.buffer = {
            text: '',
            reasoning: '',
            isError: false
        };

        this.thinkCarry = '';
        this.thinkMode = false;

        try {
            for await (const event of ApiService.streamChat(config, request, abortController.signal)) {
                this.processEvent(event);
                this.scheduleFlush(aiMessageId);
            }

            if (this.buffer && this.thinkCarry) {
                if (this.thinkMode) {
                    this.buffer.reasoning += this.thinkCarry;
                } else {
                    this.buffer.text += this.thinkCarry;
                }
                this.thinkCarry = '';
            }

            // Apply citations if available
            if (this.buffer && this.buffer.groundingMetadata && this.buffer.text) {
                this.buffer.text = this.addCitations(this.buffer.text, this.buffer.groundingMetadata);
            }

            // Final flush
            this.clearFlushTimer();
            this.flushBuffer(aiMessageId, true);

            // Persist final state to DB
            if (this.buffer) {
                const finalMsg: Message = {
                    ...initialMessage,
                    text: this.buffer.text,
                    reasoning: this.buffer.reasoning || undefined,
                    webSearchStage: this.buffer.webSearchStage,
                    webSearchResults: this.buffer.webSearchResults,
                    codeExecution: this.buffer.codeExecution as any,
                    isError: this.buffer.isError,
                    timestamp: Date.now()
                };
                await StorageService.updateMessage(aiMessageId, finalMsg);
            }

        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                console.log('Stream aborted by user');
                this.clearFlushTimer();
                this.flushBuffer(aiMessageId, true);
            } else {
                console.error('Stream failed:', err);
                const errMsg = err instanceof Error ? err.message : 'Unknown Error';
                this.buffer = { ...this.buffer!, isError: true, errorMsg: errMsg, text: (this.buffer?.text || '') + `\n\nError: ${errMsg}` };
                this.clearFlushTimer();
                this.flushBuffer(aiMessageId, true);

                await StorageService.updateMessage(aiMessageId, {
                    text: this.buffer.text,
                    isError: true
                });
            }
        } finally {
            this.clearFlushTimer();
            this.state.isStreaming = false;
            this.state.currentMessageId = null;
            this.state.abortController = null;
            this.buffer = null;
        }
    }

    cancelStream() {
        if (this.state.abortController) {
            this.state.abortController.abort();
        }
        this.clearFlushTimer();
        this.state.isStreaming = false;
    }

    private splitPossibleTagSuffix(s: string, tag: string) {
        const lower = s.toLowerCase();
        const lowerTag = tag.toLowerCase();
        const lastLt = lower.lastIndexOf('<');
        if (lastLt === -1) return { emit: s, carry: '' };
        const suffix = lower.slice(lastLt);
        if (lowerTag.startsWith(suffix) && suffix.length < lowerTag.length) {
            return { emit: s.slice(0, lastLt), carry: s.slice(lastLt) };
        }
        return { emit: s, carry: '' };
    }

    private processThinkChunk(chunk: string) {
        let combined = this.thinkCarry + chunk;
        this.thinkCarry = '';
        let visibleDelta = '';
        let reasoningDelta = '';

        while (combined) {
            const lower = combined.toLowerCase();
            if (!this.thinkMode) {
                const openIdx = lower.indexOf('<think>');
                if (openIdx === -1) {
                    const { emit, carry } = this.splitPossibleTagSuffix(combined, '<think>');
                    visibleDelta += emit;
                    this.thinkCarry = carry;
                    break;
                }
                visibleDelta += combined.slice(0, openIdx);
                combined = combined.slice(openIdx + '<think>'.length);
                this.thinkMode = true;
                continue;
            }

            const closeIdx = lower.indexOf('</think>');
            if (closeIdx === -1) {
                const { emit, carry } = this.splitPossibleTagSuffix(combined, '</think>');
                reasoningDelta += emit;
                this.thinkCarry = carry;
                break;
            }
            reasoningDelta += combined.slice(0, closeIdx);
            combined = combined.slice(closeIdx + '</think>'.length);
            this.thinkMode = false;
        }

        return { visibleDelta, reasoningDelta };
    }

    private processEvent(event: string | any) {
        if (!this.buffer) return;

        if (typeof event === 'string') {
            const { visibleDelta, reasoningDelta } = this.processThinkChunk(event);
            if (visibleDelta) this.buffer.text += visibleDelta;
            if (reasoningDelta) this.buffer.reasoning += reasoningDelta;
            return;
        }

        if (event.type === 'reasoning') {
            this.buffer.reasoning += event.data;
        } else if (event.type === 'web_search_status') {
            this.buffer.webSearchStage = event.data;
        } else if (event.type === 'web_search_results') {
            this.buffer.webSearchResults = event.data;
        } else if (event.type === 'grounding_metadata') {
            this.buffer.groundingMetadata = event.data;
        } else if (event.type === 'code_executable') {
            this.buffer.codeExecution = {
                ...this.buffer.codeExecution,
                code: event.data.code,
                language: event.data.language
            };
        } else if (event.type === 'code_execution_result') {
            this.buffer.codeExecution = {
                ...this.buffer.codeExecution,
                output: event.data.output,
                outcome: event.data.outcome,
                imageUrl: event.data.imageUrl
            };
        } else if (event.type === 'error') {
            this.buffer.isError = true;
            this.buffer.errorMsg = event.data.message;
            this.buffer.text += `\nError: ${event.data.message}`;
        }
    }

    private scheduleFlush(messageId: string) {
        if (this.bufferFlushTimer) return;
        
        this.bufferFlushTimer = window.setTimeout(() => {
            this.flushBuffer(messageId, false);
            this.bufferFlushTimer = null;
        }, this.FLUSH_INTERVAL_MS);
    }

    private flushBuffer(messageId: string, isDone: boolean) {
        if (!this.buffer) return;

        const partial: Partial<Message> = {
            text: this.buffer.text,
            reasoning: this.buffer.reasoning,
            webSearchStage: this.buffer.webSearchStage,
            webSearchResults: this.buffer.webSearchResults,
            codeExecution: this.buffer.codeExecution as any,
            isError: this.buffer.isError
        };

        this.notify(messageId, partial, isDone);
    }

    private addCitations(text: string, metadata: any): string {
        if (!metadata || !metadata.groundingSupports || !metadata.groundingChunks) return text;
        
        const supports = metadata.groundingSupports;
        const chunks = metadata.groundingChunks;
        
        if (!Array.isArray(supports) || !Array.isArray(chunks)) return text;
        
        // Sort supports by endIndex descending
        const sortedSupports = supports
            .map((support: any) => {
                const segment = support.segment;
                if (!segment) return null;
                const endIndex = segment.endIndex;
                const chunkIndices = support.groundingChunkIndices;
                if (typeof endIndex !== 'number' || !Array.isArray(chunkIndices)) return null;
                return { endIndex, chunkIndices };
            })
            .filter((item): item is { endIndex: number; chunkIndices: number[] } => item !== null)
            .sort((a, b) => b.endIndex - a.endIndex);

        let newText = text;
        
        for (const support of sortedSupports) {
            // Protect against out of bounds if text was truncated or mismatched
            if (support.endIndex > newText.length) continue;
            
            const citationLinks = support.chunkIndices.map((idx: number) => {
                if (idx >= 0 && idx < chunks.length) {
                    const chunk = chunks[idx];
                    const uri = chunk.web?.uri;
                    if (uri) {
                        return `[${idx + 1}](${uri})`;
                    }
                }
                return null;
            }).filter(Boolean);
            
            if (citationLinks.length > 0) {
                const citationString = " " + citationLinks.join(" ");
                // Insert at endIndex
                newText = newText.slice(0, support.endIndex) + citationString + newText.slice(support.endIndex);
            }
        }
        
        return newText;
    }
}