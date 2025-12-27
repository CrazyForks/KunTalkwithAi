import { EventEmitter } from 'eventemitter3';

type MessageType = 'sys' | 'text' | 'image' | 'stream_start' | 'stream_chunk' | 'stream_end' | 'history_sync';

interface SyncMessage {
    type: MessageType;
    payload?: unknown;
    msg?: string;
    event?: string;
    clients?: number;
    // ... potentially other fields
}

export class SyncService extends EventEmitter {
    private ws: WebSocket | null = null;
    private sessionId: string | null = null;
    private relayUrl: string = 'ws://localhost:8080'; // Default, should be configurable
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        super();
        // Try to recover session from local storage
        const savedSession = localStorage.getItem('everytalk_session_id');
        if (savedSession) {
            this.sessionId = savedSession;
        }
    }

    public generateSessionId(): string {
        // Simple random ID generator
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    public connect(sessionId?: string) {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            if (sessionId && this.sessionId !== sessionId) {
                 this.disconnect(); // Switch session
            } else {
                return; // Already connected
            }
        }

        if (sessionId) {
            this.sessionId = sessionId;
            localStorage.setItem('everytalk_session_id', sessionId);
        } else if (!this.sessionId) {
            this.sessionId = this.generateSessionId();
            localStorage.setItem('everytalk_session_id', this.sessionId);
        }

        const url = `${this.relayUrl}?sid=${this.sessionId}`;
        console.log(`Connecting to Relay: ${url}`);

        try {
            this.ws = new WebSocket(url);
            this.setupListeners();
        } catch (e) {
            console.error("WebSocket connection failed:", e);
            this.emit('error', e);
            this.scheduleReconnect();
        }
    }

    public disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.emit('disconnected');
    }

    public send(type: MessageType, payload: unknown) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket not connected, cannot send message");
            return;
        }
        const message = JSON.stringify({ type, payload });
        this.ws.send(message);
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }

    public getLinkUrl(): string {
        // Generate a deep link or URL for the mobile app to scan
        // Format: everytalk://sync?sid=XYZ&relay=ws://...
        // For now, just return the session ID or a JSON object string
        if (!this.sessionId) return '';
        return JSON.stringify({
            sid: this.sessionId,
            relay: this.relayUrl
        });
    }

    private setupListeners() {
        if (!this.ws) return;

        this.ws.onopen = () => {
            console.log("WebSocket Connected");
            this.emit('connected');
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data) as SyncMessage;
                this.handleMessage(data);
            } catch (e) {
                console.error("Failed to parse WebSocket message:", event.data, e);
                // Handle raw text if necessary, or binary
                if (typeof event.data === 'string') {
                     // potentially treat as raw text stream?
                }
            }
        };

        this.ws.onclose = (event) => {
            console.log(`WebSocket Closed: ${event.code} ${event.reason}`);
            this.emit('disconnected');
            // Only reconnect if not intentionally closed (code 1000)
            if (event.code !== 1000) {
                 this.scheduleReconnect();
            }
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket Error:", error);
            this.emit('error', error);
        };
    }

    private handleMessage(data: SyncMessage) {
        // console.log("Received:", data);
        
        // Handle System Messages from Relay
        if (data.type === 'sys') {
            if (data.event === 'peer_disconnected') {
                this.emit('peer_disconnected');
            }
            if (data.clients !== undefined) {
                 this.emit('client_count', data.clients);
            }
            return;
        }

        // Handle Application Messages
        this.emit('message', data);
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) return;
        
        console.log("Scheduling reconnect in 3s...");
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect(this.sessionId!); // Reconnect with same session
        }, 3000);
    }
}

export const syncService = new SyncService();