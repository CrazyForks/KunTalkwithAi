package com.android.everytalk.data.sync

import com.android.everytalk.data.database.AppDatabase
import com.android.everytalk.data.database.entities.toApiConfig
import com.android.everytalk.data.database.entities.toMessage
import com.android.everytalk.data.network.sync.SyncChange
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

class LocalChangeCollector(
    private val database: AppDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
) {
    suspend fun collectChanges(since: Long): List<SyncChange> {
        val changes = mutableListOf<SyncChange>()

        // 1. Conversations
        val sessions = database.chatDao().getSessionsSince(since)
        for (session in sessions) {
            changes.add(SyncChange(
                table = "conversations",
                op = "upsert",
                record = json.encodeToJsonElement(session).jsonObject.toMutableMap().apply {
                    // Adapt fields to match backend schema if needed
                    // Backend expects: type (TEXT/IMAGE), title, systemPrompt, createdAtMs, updatedAtMs, isPinned, pinnedOrder
                    // Local ChatSessionEntity: id, creationTimestamp, lastModifiedTimestamp, isImageGeneration, title
                    this["type"] = json.encodeToJsonElement(if (session.isImageGeneration) "IMAGE" else "TEXT")
                    this["createdAtMs"] = json.encodeToJsonElement(session.creationTimestamp)
                    this["updatedAtMs"] = json.encodeToJsonElement(session.lastModifiedTimestamp)
                    // TODO: isPinned, pinnedOrder are in separate table 'pinned_items'
                    // For now we might need to join or fetch separately.
                    // Or we just ignore isPinned in conversation sync for now and rely on pinned items sync?
                    // Backend has isPinned on Conversation model.
                    // Local 'pinned_items' is separate.
                    // We can check if id is in pinned items.
                }
            ))
        }

        // 2. Messages
        val messages = database.chatDao().getMessagesSince(since)
        for (message in messages) {
            changes.add(SyncChange(
                table = "messages",
                op = "upsert",
                record = json.encodeToJsonElement(message).jsonObject.toMutableMap().apply {
                    // Backend: id, conversationId, text, role, reasoning, isError, timestampMs, imagesJson
                    // Local: id, sessionId, text, sender, reasoning, isError, timestamp...
                    this["conversationId"] = this["sessionId"]!!
                    this["role"] = json.encodeToJsonElement(message.sender.name.lowercase()) // User -> user, AI -> ai
                    this["timestampMs"] = json.encodeToJsonElement(message.timestamp)
                    // imagesJson handling...
                }
            ))
        }

        // 3. ApiConfigs
        val configs = database.apiConfigDao().getConfigsSince(since)
        for (config in configs) {
            changes.add(SyncChange(
                table = "apiConfigs",
                op = "upsert",
                record = json.encodeToJsonElement(config).jsonObject.toMutableMap().apply {
                    this["updatedAtMs"] = json.encodeToJsonElement(config.updatedAt ?: 0L)
                    this["modelsJson"] = json.encodeToJsonElement("[]") // TODO: parse config.model? config.model is string
                    // Backend expects modelsJson as array of strings
                    this["modelsJson"] = json.encodeToJsonElement("[\"${config.model}\"]")
                }
            ))
        }

        // 4. Groups
        val groups = database.settingsDao().getGroupsSince(since)
        for (group in groups) {
            changes.add(SyncChange(
                table = "groups",
                op = "upsert",
                record = json.encodeToJsonElement(group).jsonObject.toMutableMap().apply {
                    this["name"] = this["groupName"]!!
                    this["conversationIdsJson"] = json.encodeToJsonElement(group.conversationIds) // List<String> to JSON array string? No, backend expects string field containing JSON
                    // wait, prisma model: conversationIdsJson String.
                    // Room: conversationIds List<String>.
                    // serialization will make it a JSON Array.
                    // backend expects a string that *contains* json.
                    // So we might need to double encode or ensure it matches.
                    // Actually SyncChange record is Map<String, JsonElement>.
                    // When sent to backend, it becomes JSON object.
                    // Backend `SyncChange` schema says record: z.record(z.any()).
                    // Inside `sync/push`: r.conversationIdsJson ?? (Array.isArray(r.conversationIds) ? JSON.stringify(r.conversationIds) : '[]')
                    // So if we send `conversationIds` as array, backend handles it.
                }
            ))
        }

        // 5. Conversation Settings
        val settings = database.settingsDao().getConversationParamsSince(since)
        for (setting in settings) {
            changes.add(SyncChange(
                table = "conversationSettings",
                op = "upsert",
                record = json.encodeToJsonElement(setting).jsonObject.toMutableMap().apply {
                    this["updatedAtMs"] = json.encodeToJsonElement(setting.updatedAt)
                    // config is GenerationConfig. Backend expects textJson/imageJson.
                    // We can serialize `config` to one of them based on type.
                    // Assuming we can infer type from conversation... or config itself.
                    this["textJson"] = json.encodeToJsonElement(setting.config)
                }
            ))
        }

        // 6. Tombstones
        val tombstones = database.tombstoneDao().getTombstonesSince(since)
        for (tombstone in tombstones) {
            changes.add(SyncChange(
                table = "tombstones",
                op = "upsert", // Tombstones are always upserted to propagate deletion
                record = json.encodeToJsonElement(tombstone).jsonObject.toMutableMap().apply {
                    this["deletedAtMs"] = json.encodeToJsonElement(tombstone.deletedAt)
                }
            ))
        }

        return changes
    }
}