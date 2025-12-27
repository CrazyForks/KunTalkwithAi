import { StorageService } from '../../services/StorageService';
import type { Message } from '../../db';
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
        // no-op
    }

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
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