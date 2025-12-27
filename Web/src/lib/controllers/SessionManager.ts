import { StorageService } from '../../services/StorageService';
import { syncService } from '../../services/SyncService';
import type { Message, Conversation, ApiConfig, ConversationSettings } from '../../db';
import { ConversationNameHelper } from './ConversationNameHelper';

export interface SessionState {
    currentConversationId: string | null;
    mode: 'TEXT' | 'IMAGE';
    messages: Message[];
    isDirty: boolean; // Tracks if the current "new" session has unsaved changes
}

type Listener = (state: SessionState) => void;

export class SessionManager {
    private static instance: SessionManager;
    private state: SessionState = {
        currentConversationId: null,
        mode: 'TEXT',
        messages: [],
        isDirty: false
    };
    private persistInFlight: Promise<void> | null = null;
    private listeners: Set<Listener> = new Set();
    
    // Flag to prevent race conditions during mode switching
    // When switchMode() is called, this is set to the target mode
    // to prevent init() from a stale component from overwriting the state
    private modeSwitchTarget: 'TEXT' | 'IMAGE' | null = null;

    private constructor() {
        // Setup Sync Listeners
        syncService.on('message', this.handleSyncMessage.bind(this));
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    private handleSyncMessage(data: any) {
        console.log("SessionManager received sync:", data.type);

        if (data.type === 'sync_init') {
            const payload = data.payload as { mode: 'merge' | 'overwrite' };
            if (payload.mode === 'overwrite') {
                console.log("Received 'overwrite' sync mode. Clearing local database...");
                (async () => {
                    // Clear all data
                    await StorageService.deleteAllConversations('TEXT');
                    await StorageService.deleteAllConversations('IMAGE');
                    
                    // Also clear configs? Maybe. The sync will re-populate them.
                    // For now, let's trust that subsequent sync messages will re-fill everything.
                    // But StorageService currently doesn't have a "clear everything" for settings/configs.
                    // However, upsert logic in subsequent syncs will handle it.
                    // To be safe and truly "overwrite", we should probably clear apiConfigs too.
                    
                    // Reload current view to empty state
                    this.state = {
                        currentConversationId: null,
                        mode: this.state.mode, // Keep current mode
                        messages: [],
                        isDirty: false
                    };
                    await this.createNewChat(this.state.mode);
                })();
            }
        }
        else if (data.type === 'batch_history_sync') {
             // Handle multiple conversations sync
             const payload = data.payload as Array<{ conversation: Conversation, messages: Message[] }>;
             if (!Array.isArray(payload)) return;

             (async () => {
                 for (const item of payload) {
                     if (!item.conversation) continue;
                     
                     // 1. Upsert Conversation
                     const existingConv = await StorageService.getConversation(item.conversation.id);
                     if (!existingConv) {
                         await StorageService.createConversation(
                             item.conversation.type,
                             item.conversation.title,
                             item.conversation.id
                         );
                         await StorageService.updateConversation(item.conversation.id, {
                             createdAt: item.conversation.createdAt,
                             updatedAt: item.conversation.updatedAt,
                             isPinned: item.conversation.isPinned,
                             pinnedOrder: item.conversation.pinnedOrder
                         });
                     } else {
                         await StorageService.updateConversation(item.conversation.id, {
                             title: item.conversation.title,
                             updatedAt: item.conversation.updatedAt,
                             isPinned: item.conversation.isPinned,
                             pinnedOrder: item.conversation.pinnedOrder
                         });
                     }

                     // 2. Sync Messages
                     if (item.messages && Array.isArray(item.messages)) {
                        for (const msg of item.messages) {
                            // Basic upsert, in reality might want bulkAdd for performance
                            const existingMsg = (await StorageService.getMessages(item.conversation.id)).find(m => m.id === msg.id);
                            if (existingMsg) {
                                await StorageService.updateMessage(msg.id, msg);
                            } else {
                                await StorageService.addMessage(msg);
                            }
                        }
                     }
                     
                     // Reload if current
                     if (this.state.currentConversationId === item.conversation.id) {
                         await this.loadConversation(item.conversation.id);
                     }
                 }
             })().catch(err => console.error("Error handling batch_history_sync:", err));

        }
        else if (data.type === 'config_sync') {
            // Handle ApiConfigs
            const payload = data.payload as ApiConfig[];
            if (!Array.isArray(payload)) return;
            
            (async () => {
                 for (const config of payload) {
                     // Try to match by ID
                     await StorageService.saveApiConfig(config);
                     // If it's marked as default in payload, set it locally?
                     // Usually sync implies "copy exactly".
                     // But we have different local vs remote ID strategies?
                     // Assuming IDs are UUIDs generated by Android, we just use them.
                 }
                 console.log("Synced ApiConfigs:", payload.length);
            })().catch(err => console.error("Error handling config_sync:", err));

        }
        else if (data.type === 'settings_sync') {
            // Handle ConversationSettings
            const payload = data.payload as ConversationSettings[];
             if (!Array.isArray(payload)) return;

            (async () => {
                for (const setting of payload) {
                    if (setting.type === 'TEXT' && setting.text) {
                        await StorageService.setTextConversationSettings(setting.conversationId, setting.text);
                    } else if (setting.type === 'IMAGE' && setting.image) {
                        await StorageService.setImageConversationSettings(setting.conversationId, setting.image);
                    }
                }
                console.log("Synced ConversationSettings:", payload.length);
            })().catch(err => console.error("Error handling settings_sync:", err));

        }
        else if (data.type === 'history_sync') {
            const payload = data.payload as { conversation: Conversation, messages: Message[] };
            if (!payload || !payload.conversation) return;
            
            (async () => {
                // Determine if we should update current UI
                const isCurrent = this.state.currentConversationId === payload.conversation.id;

                // Update DB
                const existingConv = await StorageService.getConversation(payload.conversation.id);
                if (!existingConv) {
                    await StorageService.createConversation(
                        payload.conversation.type,
                        payload.conversation.title,
                        payload.conversation.id
                    );
                    await StorageService.updateConversation(payload.conversation.id, {
                        createdAt: payload.conversation.createdAt,
                        updatedAt: payload.conversation.updatedAt,
                        isPinned: payload.conversation.isPinned,
                        pinnedOrder: payload.conversation.pinnedOrder
                    });
                } else {
                     await StorageService.updateConversation(payload.conversation.id, {
                        title: payload.conversation.title,
                        updatedAt: payload.conversation.updatedAt,
                        isPinned: payload.conversation.isPinned,
                        pinnedOrder: payload.conversation.pinnedOrder
                    });
                }

                if (payload.messages && Array.isArray(payload.messages)) {
                    for (const msg of payload.messages) {
                        const existingMsg = (await StorageService.getMessages(payload.conversation.id)).find(m => m.id === msg.id);
                        if (existingMsg) {
                            await StorageService.updateMessage(msg.id, msg);
                        } else {
                            await StorageService.addMessage(msg);
                        }
                    }
                }
                
                if (isCurrent) {
                    await this.loadConversation(payload.conversation.id);
                }

            })().catch(err => console.error("Error handling history_sync:", err));
        }
        else if (data.type === 'stream_chunk') {
            // Real-time streaming
            // NOTE: For image generation, "content" might be progress text or empty if waiting for URL.
            // Android side typically sends final 'stream_end' with the full message including image URLs.
            const payload = data.payload as { conversationId: string, messageId: string, content: string, role?: string };
            if (this.state.currentConversationId === payload.conversationId) {
                this.updateMessages(prev => {
                    const existingIdx = prev.findIndex(m => m.id === payload.messageId);
                    if (existingIdx !== -1) {
                        const newMsgs = [...prev];
                        // Only append text if it's text. If it's an image generation process,
                        // we might receive status updates in text field until final image arrives.
                        newMsgs[existingIdx] = {
                            ...newMsgs[existingIdx],
                            text: newMsgs[existingIdx].text + payload.content
                        };
                        return newMsgs;
                    } else {
                        // New message starting
                         return [...prev, {
                            id: payload.messageId,
                            conversationId: payload.conversationId,
                            text: payload.content,
                            role: (payload.role as any) || 'ai',
                            timestamp: Date.now(),
                            // Initialize with empty images array to support image mode structure
                            images: []
                        }];
                    }
                });
            }
        }
        else if (data.type === 'stream_end') {
            const payload = data.payload as { conversationId: string, messageId: string, fullMessage?: Message };
             if (this.state.currentConversationId === payload.conversationId) {
                // Ensure finalized state
                if (payload.fullMessage) {
                     this.updateMessages(prev => {
                        const existingIdx = prev.findIndex(m => m.id === payload.messageId);
                        if (existingIdx !== -1) {
                            const newMsgs = [...prev];
                            newMsgs[existingIdx] = payload.fullMessage!;
                            return newMsgs;
                        }
                        return [...prev, payload.fullMessage!];
                    });
                }
             }
        }
    }

    public subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        this.listeners.forEach(l => l({ ...this.state }));
    }

    public getState(): SessionState {
        return { ...this.state };
    }

    public async init(initialMode: 'TEXT' | 'IMAGE') {
        // CRITICAL FIX: If a mode switch is in progress and the init request is for a DIFFERENT mode
        // than the switch target, ignore it. This prevents stale components (that are being unmounted)
        // from overwriting the state that was just set by switchMode().
        if (this.modeSwitchTarget !== null && initialMode !== this.modeSwitchTarget) {
            return;
        }
        
        // Prevent overwriting existing session if already initialized for the same mode
        // This is crucial when MainContent remounts due to key change (e.g. New Chat)
        if (this.state.currentConversationId && this.state.mode === initialMode) {
            return;
        }

        this.state.mode = initialMode;
        
        // Always create a new chat for initial load (Text or Image)
        // Only load historical data if explicitly requested (Sidebar click)
        await this.createNewChat(initialMode);
    }

    public async switchMode(newMode: 'TEXT' | 'IMAGE') {
        if (this.state.mode === newMode) return;
        
        // Set the switch target to prevent race conditions with stale component init() calls
        this.modeSwitchTarget = newMode;
        
        // Save current session if needed?
        // Logic: Android saves on switch if dirty.
        // For now, let's just switch context.
        this.state.mode = newMode;
        
        // Always start fresh when switching modes
        await this.createNewChat(newMode);
        
        // Clear the switch target after a short delay to allow stale components to finish their lifecycle
        // Using setTimeout to ensure this runs after React's component lifecycle completes
        setTimeout(() => {
            if (this.modeSwitchTarget === newMode) {
                this.modeSwitchTarget = null;
            }
        }, 500);
    }

    public async createNewChat(mode: 'TEXT' | 'IMAGE') {
        // "Lazy Persistence": DO NOT create DB entry yet.
        // Generate a temporary ID.
        const tempId = `new_chat_${Date.now()}`;
        this.state = {
            currentConversationId: tempId,
            mode: mode,
            messages: [],
            isDirty: false // Not dirty until first message
        };
        this.notify();
    }

    public async loadConversation(id: string) {
        // If loading the same ID, do nothing (unless forced refresh needed?)
        if (this.state.currentConversationId === id) return;

        const conversation = await StorageService.getConversation(id);
        if (!conversation) {
            console.error(`Conversation ${id} not found`);
            return;
        }

        const messages = await StorageService.getMessages(id);
        
        this.state = {
            currentConversationId: id,
            mode: conversation.type,
            messages: messages,
            isDirty: false
        };
        this.notify();
    }

    public updateMessages(updateFn: (prev: Message[]) => Message[]) {
        const newMessages = updateFn(this.state.messages);
        this.state.messages = newMessages;
        
        // Determine if we need to persist "Lazily"
        this.ensurePersisted();
        
        this.notify();
    }
    
    // Explicit setter for messages (alternative to updateMessages)
    public setMessages(messages: Message[]) {
        this.state.messages = messages;

        // Notify immediately for UI responsiveness
        this.notify();

        // Ensure the conversation exists in DB so refresh can restore it.
        this.ensurePersisted();
    }

    private ensurePersisted() {
        if (this.state.isDirty) return;
        if (!this.state.currentConversationId?.startsWith('new_chat_')) return;
        if (this.state.messages.length === 0) return;
        if (this.persistInFlight) return;

        this.persistInFlight = this.persistCurrentSession().finally(() => {
            this.persistInFlight = null;
        });
    }

    private async persistCurrentSession() {
        if (!this.state.currentConversationId) return;
        
        // Determine title
        let title: string | undefined = undefined;
        if (this.state.messages.length > 0) {
            // Use the first user message content for title
            const firstMsg = this.state.messages.find(m => m.role === 'user');
            if (firstMsg && firstMsg.text.trim()) {
                title = ConversationNameHelper.cleanAndTruncateText(firstMsg.text);
            }
        }
        
        // If still no title, use default
        if (!title) {
            // Count existing convs to determine index?
            // For simplicity, just use generic name or let StorageService default (New Chat)
            // But android uses "Conversation X". Let's stick to StorageService default for now if empty.
        }

        const id = this.state.currentConversationId;

        const existing = await StorageService.getConversation(id);
        if (!existing) {
            await StorageService.createConversation(this.state.mode, title, id);
        } else if (title && title !== existing.title) {
            await StorageService.updateConversation(id, { title });
        }

        this.state.isDirty = true;
    }

    public async deleteConversation(id: string) {
        await StorageService.deleteConversation(id);
        
        // If deleted current, switch to another
        if (this.state.currentConversationId === id) {
            const conversations = await StorageService.getAllConversations(this.state.mode);
            if (conversations.length > 0) {
                await this.loadConversation(conversations[0].id);
            } else {
                await this.createNewChat(this.state.mode);
            }
        }
    }

    public async clearAllConversations(type: 'TEXT' | 'IMAGE') {
        await StorageService.deleteAllConversations(type);
        
        // If current conversation is of the type being cleared, create a new one
        if (this.state.mode === type) {
            await this.createNewChat(this.state.mode);
        }
    }
}