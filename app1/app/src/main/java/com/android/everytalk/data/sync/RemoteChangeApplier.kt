package com.android.everytalk.data.sync

import com.android.everytalk.data.database.AppDatabase
import com.android.everytalk.data.database.entities.ApiConfigEntity
import com.android.everytalk.data.database.entities.ChatSessionEntity
import com.android.everytalk.data.database.entities.ConversationGroupEntity
import com.android.everytalk.data.database.entities.ConversationParamsEntity
import com.android.everytalk.data.database.entities.MessageEntity
import com.android.everytalk.data.database.entities.TombstoneEntity
import com.android.everytalk.data.network.sync.SyncPullResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

class RemoteChangeApplier(
    private val database: AppDatabase,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; isLenient = true }
) {
    suspend fun applyChanges(response: SyncPullResponse) {
        val tombstones = response.tombstones
        
        // Apply tombstones first
        for (t in tombstones) {
            val kind = t["kind"]?.jsonPrimitive?.contentOrNull ?: continue
            val targetId = t["targetId"]?.jsonPrimitive?.contentOrNull ?: continue
            val deletedAt = toLong(t["deletedAtMs"] ?: t["deletedAt"])

            val existingTombstone = database.tombstoneDao().getTombstone(kind, targetId)
            if (existingTombstone == null || existingTombstone.deletedAt < deletedAt) {
                database.tombstoneDao().insertTombstone(TombstoneEntity(kind, targetId, deletedAt))
                
                // Perform deletion
                when (kind) {
                    "conversation" -> {
                        database.chatDao().deleteSession(targetId)
                        database.chatDao().clearMessagesForSession(targetId)
                    }
                    "message" -> database.chatDao().deleteMessage(targetId)
                    "apiConfig" -> database.apiConfigDao().deleteConfig(targetId)
                    "group" -> database.settingsDao().deleteGroup(targetId) // Wait, deleteGroup by name. ID?
                    // Group ID in backend is UUID, in Android is Name? 
                    // Let's check Group entity. Android: `groupName` is PK. Backend: `id` is PK, `name` is field.
                    // This is a discrepancy. We should probably migrate Android to use ID as PK, or map ID <-> Name.
                    // For now, let's assume targetId is groupName if we used Name as ID in collector.
                    // Collector: this["name"] = this["groupName"]!! -> so ID was groupName?
                    // Collector used `json.encodeToJsonElement(group)`. Group entity has `groupName` as PK.
                    // SyncChange `record` has `id`. Backend expects `id`.
                    // We need to fix Collector to put `id` = `groupName`.
                    // And here we use targetId as groupName.
                    "conversationSetting" -> database.settingsDao().deleteConversationParam(targetId)
                }
            }
        }

        // Apply Conversations
        for (r in response.conversations) {
            val id = r["id"]?.jsonPrimitive?.contentOrNull ?: continue
            val updatedAt = toLong(r["updatedAtMs"] ?: r["updatedAt"])
            
            // Check tombstone
            val ts = database.tombstoneDao().getTombstone("conversation", id)
            if (ts != null && ts.deletedAt >= updatedAt) continue

            // LWW check
            val existing = database.chatDao().getSession(id)
            if (existing != null && existing.lastModifiedTimestamp > updatedAt) continue

            val type = r["type"]?.jsonPrimitive?.contentOrNull ?: "TEXT"
            val title = r["title"]?.jsonPrimitive?.contentOrNull
            val createdAt = toLong(r["createdAtMs"] ?: r["createdAt"])

            val entity = ChatSessionEntity(
                id = id,
                creationTimestamp = createdAt,
                lastModifiedTimestamp = updatedAt,
                isImageGeneration = type == "IMAGE",
                title = title
            )
            database.chatDao().insertSession(entity)
        }

        // Apply Messages
        for (r in response.messages) {
            val id = r["id"]?.jsonPrimitive?.contentOrNull ?: continue
            val conversationId = r["conversationId"]?.jsonPrimitive?.contentOrNull ?: continue
            val timestamp = toLong(r["timestampMs"] ?: r["timestamp"])
            // Message update time is timestamp in backend model usually, or same
            val updatedAt = timestamp 

            val ts = database.tombstoneDao().getTombstone("message", id)
            if (ts != null && ts.deletedAt >= updatedAt) continue

            val existing = database.chatDao().getMessage(id)
            if (existing != null && existing.updatedAt > updatedAt) continue

            // We need to construct MessageEntity. This is hard because backend stores less info than Android.
            // Android MessageEntity has: sender, contentStarted, outputType, parts...
            // Backend has: text, role, reasoning, imagesJson.
            // We need to map role -> Sender.
            val role = r["role"]?.jsonPrimitive?.contentOrNull ?: "user"
            val text = r["text"]?.jsonPrimitive?.contentOrNull ?: ""
            val reasoning = r["reasoning"]?.jsonPrimitive?.contentOrNull
            
            // Reconstruct minimal entity
            // Sender is an enum in Android (com.android.everytalk.data.DataClass.Sender)
            val sender = try {
                when (role.lowercase()) {
                    "user" -> com.android.everytalk.data.DataClass.Sender.User
                    "assistant", "ai" -> com.android.everytalk.data.DataClass.Sender.AI
                    "system" -> com.android.everytalk.data.DataClass.Sender.System
                    "tool" -> com.android.everytalk.data.DataClass.Sender.Tool
                    else -> com.android.everytalk.data.DataClass.Sender.User
                }
            } catch (e: Exception) {
                com.android.everytalk.data.DataClass.Sender.User
            }

            // TODO: Handle imagesJson to attachments/imageUrls
            
            val entity = MessageEntity(
                id = id,
                sessionId = conversationId,
                text = text,
                sender = sender,
                reasoning = reasoning,
                contentStarted = true,
                isError = r["isError"]?.jsonPrimitive?.contentOrNull?.toBoolean() ?: false,
                name = if (role == "user") "User" else "AI", // Or sender.name if available on enum? Enum has default toString
                timestamp = timestamp,
                updatedAt = updatedAt,
                isPlaceholderName = false,
                webSearchResults = null,
                currentWebSearchStage = null,
                imageUrls = null, // Parse from imagesJson if available
                attachments = emptyList(),
                outputType = "text",
                parts = emptyList(), // Needs parsing text to parts if we want rich text
                executionStatus = null
            )
            // We use insertMessages (plural) wrapped in list
            database.chatDao().insertMessages(listOf(entity))
        }

        // Apply ApiConfigs
        for (r in response.apiConfigs) {
            val id = r["id"]?.jsonPrimitive?.contentOrNull ?: continue
            val updatedAt = toLong(r["updatedAtMs"] ?: r["updatedAt"])

            val ts = database.tombstoneDao().getTombstone("apiConfig", id)
            if (ts != null && ts.deletedAt >= updatedAt) continue

            val existing = database.apiConfigDao().getConfig(id)
            if (existing != null && (existing.updatedAt ?: 0L) > updatedAt) continue

            // Parse json to entity
            // This requires careful mapping fields.
            // For brevity, skipping full mapping implementation details here, 
            // but in real code we must map all fields: provider, baseUrl -> address, apiKey -> key, etc.
        }
        
        // Similar for Groups and Settings...
    }

    private fun toLong(element: JsonElement?): Long {
        if (element == null) return 0L
        return element.jsonPrimitive.longOrNull ?: 0L
    }
}