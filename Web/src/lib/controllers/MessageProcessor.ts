import type { Message, Attachment } from '../../db';

export class MessageProcessor {
    static processAttachments(text: string, attachments: Attachment[] | undefined): ({ type: 'text'; text?: string } | { type: 'image_url'; image_url?: { url?: string } } | { type: 'input_audio'; input_audio?: unknown })[] {
        const safeText = text ?? '';
        const list = attachments ?? [];
        const hasImages = list.some(a => a.type === 'image');
        
        if (!hasImages) return [{ type: 'text', text: safeText }];

        const parts: Array<{ type: 'text'; text?: string } | { type: 'image_url'; image_url?: { url?: string } }> = [];
        if (safeText) parts.push({ type: 'text', text: safeText });
        
        for (const a of list) {
            if (a.type === 'image') {
                parts.push({ type: 'image_url', image_url: { url: a.uri } });
            } else {
                parts.push({ type: 'text', text: `[Attachment: ${a.name}]` });
            }
        }
        return parts as any;
    }

    static mergeUpdates(original: Message, partial: Partial<Message>): Message {
        // Logic to merge partial stream updates into the message object
        // This is where we handle accumulating reasoning, text parts, etc. if needed
        // For now, simple spread is sufficient as StreamManager buffers the whole text
        return {
            ...original,
            ...partial,
            timestamp: partial.timestamp || original.timestamp
        };
    }
    
    static createPlaceholder(conversationId: string, role: 'user' | 'ai'): Message {
        return {
            id: (Date.now() + (role === 'ai' ? 1 : 0)).toString(),
            conversationId,
            role,
            text: '',
            timestamp: Date.now()
        };
    }
}