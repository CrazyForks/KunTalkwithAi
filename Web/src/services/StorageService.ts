import { db, type Conversation, type Message, type ApiConfig, type ConversationGroup, type ConversationSettings, type TextConversationSettings, type ImageConversationSettings } from '../db';

export const StorageService = {
    // --- Conversations ---
    async createConversation(type: 'TEXT' | 'IMAGE', title?: string, id?: string): Promise<string> {
        const finalId = id || Date.now().toString();
        const now = Date.now();

        const existing = await db.conversations.get(finalId);
        if (existing) {
            await db.conversations.update(finalId, {
                type,
                title: title ?? existing.title,
                updatedAt: now,
            });
            return finalId;
        }

        const conversation: Conversation = {
            id: finalId,
            type,
            title: title || 'New Chat',
            createdAt: now,
            updatedAt: now,
            isPinned: false,
            pinnedOrder: 0
        };
        await db.conversations.add(conversation);
        return finalId;
    },

    async getConversation(id: string): Promise<Conversation | undefined> {
        return db.conversations.get(id);
    },

    async getAllConversations(type?: 'TEXT' | 'IMAGE'): Promise<Conversation[]> {
        let collection = db.conversations.orderBy('updatedAt').reverse();
        if (type) {
            collection = collection.filter(c => c.type === type);
        }
        return collection.toArray();
    },

    async updateConversation(id: string, updates: Partial<Conversation>) {
        await db.conversations.update(id, { ...updates, updatedAt: Date.now() });
    },

    async deleteConversation(id: string) {
        await db.transaction('rw', db.conversations, db.messages, db.conversationSettings, db.groups, async () => {
            await db.messages.where('conversationId').equals(id).delete();
            await db.conversationSettings.delete(id);
            await db.conversations.delete(id);

            const groups = await db.groups.toArray();
            for (const g of groups) {
                if (!Array.isArray(g.conversationIds)) continue;
                if (!g.conversationIds.includes(id)) continue;
                const updated: ConversationGroup = {
                    ...g,
                    conversationIds: g.conversationIds.filter(cid => cid !== id)
                };
                await db.groups.put(updated);
            }
        });
    },

    async deleteAllConversations(type: 'TEXT' | 'IMAGE') {
        await db.transaction('rw', db.conversations, db.messages, db.conversationSettings, db.groups, async () => {
            // Get all conversation IDs of the specified type
            const conversations = await db.conversations.where('type').equals(type).toArray();
            const ids = conversations.map(c => c.id);

            if (ids.length === 0) return;

            // Delete messages for these conversations
            await db.messages.where('conversationId').anyOf(ids).delete();

            // Delete conversation settings
            await db.conversationSettings.where('conversationId').anyOf(ids).delete();

            // Delete conversations
            await db.conversations.where('id').anyOf(ids).delete();

            // Remove these conversations from groups
            const groups = await db.groups.toArray();
            for (const g of groups) {
                if (!Array.isArray(g.conversationIds)) continue;
                
                // Check if this group contains any of the deleted IDs
                const newIds = g.conversationIds.filter(cid => !ids.includes(cid));
                
                // Only update if changes were made
                if (newIds.length !== g.conversationIds.length) {
                    const updated: ConversationGroup = {
                        ...g,
                        conversationIds: newIds
                    };
                    await db.groups.put(updated);
                }
            }
        });
    },

    // --- Groups ---
    async getAllGroups(): Promise<ConversationGroup[]> {
        const groups = await db.groups.toArray();
        return groups.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },

    async createGroup(name: string): Promise<string> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Group name is required');

        const existingByName = await db.groups.where('name').equals(trimmed).first();
        if (existingByName) return existingByName.id;

        const id = `group_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const now = Date.now();
        const group: ConversationGroup = {
            id,
            name: trimmed,
            conversationIds: [],
            createdAt: now
        };
        await db.groups.add(group);
        return id;
    },

    async renameGroup(groupId: string, name: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Group name is required');

        const existingByName = await db.groups.where('name').equals(trimmed).first();
        if (existingByName && existingByName.id !== groupId) return;

        await db.groups.update(groupId, { name: trimmed });
    },

    async deleteGroup(groupId: string): Promise<void> {
        await db.groups.delete(groupId);
    },

    async addConversationToGroup(groupId: string, conversationId: string, opts?: { exclusive?: boolean }): Promise<void> {
        const exclusive = opts?.exclusive ?? true;
        await db.transaction('rw', db.groups, async () => {
            const groups = await db.groups.toArray();
            for (const g of groups) {
                const ids = Array.isArray(g.conversationIds) ? g.conversationIds : [];
                const inThis = g.id === groupId;
                const has = ids.includes(conversationId);

                if (inThis) {
                    if (!has) {
                        await db.groups.put({
                            ...g,
                            conversationIds: [...ids, conversationId]
                        } as ConversationGroup);
                    }
                    continue;
                }

                if (exclusive && has) {
                    await db.groups.put({
                        ...g,
                        conversationIds: ids.filter(cid => cid !== conversationId)
                    } as ConversationGroup);
                }
            }
        });
    },

    async removeConversationFromGroup(groupId: string, conversationId: string): Promise<void> {
        await db.transaction('rw', db.groups, async () => {
            const g = await db.groups.get(groupId);
            if (!g) return;
            const ids = Array.isArray(g.conversationIds) ? g.conversationIds : [];
            if (!ids.includes(conversationId)) return;
            await db.groups.put({
                ...g,
                conversationIds: ids.filter(cid => cid !== conversationId)
            } as ConversationGroup);
        });
    },

    async removeConversationFromAllGroups(conversationId: string): Promise<void> {
        await db.transaction('rw', db.groups, async () => {
            const groups = await db.groups.toArray();
            for (const g of groups) {
                const ids = Array.isArray(g.conversationIds) ? g.conversationIds : [];
                if (!ids.includes(conversationId)) continue;
                await db.groups.put({
                    ...g,
                    conversationIds: ids.filter(cid => cid !== conversationId)
                } as ConversationGroup);
            }
        });
    },

    // --- Conversation Settings ---
    async getConversationSettings(conversationId: string): Promise<ConversationSettings | undefined> {
        return db.conversationSettings.get(conversationId);
    },

    async setTextConversationSettings(conversationId: string, settings: TextConversationSettings): Promise<void> {
        const now = Date.now();
        await db.conversationSettings.put({
            conversationId,
            type: 'TEXT',
            text: settings,
            updatedAt: now,
        });
    },

    async setImageConversationSettings(conversationId: string, settings: ImageConversationSettings): Promise<void> {
        const now = Date.now();
        await db.conversationSettings.put({
            conversationId,
            type: 'IMAGE',
            image: settings,
            updatedAt: now,
        });
    },

    // --- Messages ---
    async addMessage(message: Message) {
        await db.transaction('rw', db.messages, db.conversations, async () => {
            await db.messages.add(message);
            await db.conversations.update(message.conversationId, { updatedAt: Date.now() });
        });
    },

    async getMessages(conversationId: string): Promise<Message[]> {
        return db.messages.where('conversationId').equals(conversationId).sortBy('timestamp');
    },

    async updateMessage(id: string, updates: Partial<Message>) {
        await db.messages.update(id, updates);
    },

    async deleteMessage(id: string) {
        await db.messages.delete(id);
    },

    async getLatestMessageByModeHint(modality: 'TEXT' | 'IMAGE'): Promise<Message | undefined> {
        const ordered = db.messages.orderBy('timestamp').reverse();
        if (modality === 'IMAGE') {
            return ordered.filter(m => (m.images?.length ?? 0) > 0).first();
        }
        return ordered.filter(m => (m.images?.length ?? 0) === 0).first();
    },

    // --- API Configs ---
    async getAllApiConfigs(modality: 'TEXT' | 'IMAGE' = 'TEXT'): Promise<ApiConfig[]> {
        return db.apiConfigs.filter(c => c.modality === modality).toArray();
    },

    async saveApiConfig(config: ApiConfig) {
        await db.apiConfigs.put(config);
    },

    async deleteApiConfig(id: string) {
        await db.apiConfigs.delete(id);
    },

    async setDefaultApiConfig(id: string, modality: 'TEXT' | 'IMAGE') {
        await db.transaction('rw', db.apiConfigs, async () => {
            // Unset current default
            await db.apiConfigs
                .filter(c => c.modality === modality && c.isDefault === true)
                .modify({ isDefault: false });

            // Set new default
            await db.apiConfigs.update(id, { isDefault: true });
        });
    },

    async getDefaultApiConfig(modality: 'TEXT' | 'IMAGE'): Promise<ApiConfig | undefined> {
        return db.apiConfigs.filter(c => c.modality === modality && c.isDefault === true).first();
    }
};