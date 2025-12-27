package com.android.everytalk.data.repository

import android.util.Log
import androidx.room.withTransaction
import com.android.everytalk.data.DataClass.Sender
import com.android.everytalk.data.database.AppDatabase
import com.android.everytalk.data.database.entities.ChatSessionEntity
import com.android.everytalk.data.database.entity.DeviceClockEntity
import com.android.everytalk.data.database.entities.MessageEntity
import com.android.everytalk.data.database.entity.TombstoneEntity
import com.android.everytalk.data.network.api.EveryTalkSyncApi
import com.android.everytalk.data.network.dto.SyncChange
import com.android.everytalk.data.network.dto.SyncPushRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.util.UUID

class SyncRepository(
    private val db: AppDatabase,
    private val api: EveryTalkSyncApi,
    private val authRepository: AuthRepository
) {
    private val TAG = "SyncRepository"

    suspend fun syncOnce() = withContext(Dispatchers.IO) {
        val userId = authRepository.getUserId() ?: return@withContext
        authRepository.getAccessToken() ?: return@withContext
        
        // Ensure device ID is available
        val deviceId = authRepository.getDeviceId()
        
        // 1. Get last pull time
        val clock = db.deviceClockDao().getDeviceClock(userId, deviceId)
        val lastPullAt = clock?.lastPullAt ?: 0L
        
        try {
            // 2. Pull from server
            val response = api.syncPull(lastPullAt)
            val now = response.now
            
            // 3. Apply changes (Merge)
            db.withTransaction {
                 // Apply Tombstones
                 response.tombstones?.forEach { map ->
                    val kind = (map["kind"] as? JsonPrimitive)?.contentOrNull ?: return@forEach
                    val targetId = (map["targetId"] as? JsonPrimitive)?.contentOrNull ?: return@forEach
                    val deletedAtMs = (map["deletedAtMs"] as? JsonPrimitive)?.longOrNull ?: 0L
                    
                    db.tombstoneDao().insert(
                        TombstoneEntity(
                            id = UUID.randomUUID().toString(),
                            userId = userId,
                            kind = kind,
                            targetId = targetId,
                            deletedAtMs = deletedAtMs,
                            deviceId = deviceId
                        )
                    )
                    
                    when (kind) {
                        "conversation" -> db.chatDao().deleteConversationById(targetId)
                        "message" -> db.chatDao().deleteMessageById(targetId)
                    }
                }

                // Apply Conversations (ChatSessionEntity)
                response.conversations?.forEach { map ->
                    val id = (map["id"] as? JsonPrimitive)?.contentOrNull ?: return@forEach
                    val updatedAt = (map["updatedAtMs"] as? JsonPrimitive)?.longOrNull ?: 0L
                    
                    val existing = db.chatDao().getConversationById(id)
                    if (existing == null || updatedAt > existing.lastModifiedTimestamp) {
                        val typeStr = (map["type"] as? JsonPrimitive)?.contentOrNull ?: "TEXT"
                        val isImageGen = typeStr == "IMAGE"
                        
                        val entity = ChatSessionEntity(
                            id = id,
                            creationTimestamp = (map["createdAtMs"] as? JsonPrimitive)?.longOrNull ?: updatedAt,
                            lastModifiedTimestamp = updatedAt,
                            isImageGeneration = isImageGen,
                            title = (map["title"] as? JsonPrimitive)?.contentOrNull,
                            userId = userId
                        )
                        db.chatDao().insertOrUpdate(entity)
                    }
                }
                
                // Apply Messages (MessageEntity)
                response.messages?.forEach { map ->
                    val id = (map["id"] as? JsonPrimitive)?.contentOrNull ?: return@forEach
                    val timestamp = (map["timestampMs"] as? JsonPrimitive)?.longOrNull ?: 0L
                    
                    val existing = db.chatDao().getMessageById(id)
                    if (existing == null || timestamp > existing.timestamp) {
                        val senderStr = (map["role"] as? JsonPrimitive)?.contentOrNull ?: "user"
                        val sender = if (senderStr.equals("user", ignoreCase = true)) Sender.User else Sender.AI

                         val entity = MessageEntity(
                            id = id,
                            sessionId = (map["conversationId"] as? JsonPrimitive)?.contentOrNull ?: "",
                            text = (map["text"] as? JsonPrimitive)?.contentOrNull ?: "",
                            sender = sender,
                            reasoning = null,
                            contentStarted = false,
                            isError = false,
                            name = null,
                            timestamp = timestamp,
                            isPlaceholderName = false,
                            webSearchResults = null,
                            currentWebSearchStage = null,
                            imageUrls = null,
                            attachments = emptyList(),
                            outputType = "text",
                            parts = emptyList(),
                            executionStatus = null,
                            updatedAt = timestamp,
                            userId = userId
                        )
                        db.chatDao().insertOrUpdate(entity)
                    }
                }
                
                // Update Clock
                db.deviceClockDao().insertOrUpdate(
                    DeviceClockEntity(userId, deviceId, lastPullAt = now)
                )
            }
            
            // 4. Push local changes
            val changes = collectLocalChanges(userId, lastPullAt)
            if (changes.isNotEmpty()) {
                val pushResponse = api.syncPush(SyncPushRequest(deviceId, changes))
                if (pushResponse.ok) {
                    // Success - ideally update lastPullAt again or mark changes as synced if we had a local 'dirty' flag
                    // But for this simple implementation, we rely on the next pull to update the clock if we want strictly consistent LWW
                }
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Sync failed", e)
        }
    }
    
    private suspend fun collectLocalChanges(userId: String, since: Long): List<SyncChange> {
        val changes = mutableListOf<SyncChange>()
        
        // Collect Conversations
        val conversationsByUser = db.chatDao().getConversationsSince(userId, since)
        val conversations = if (conversationsByUser.isNotEmpty()) {
            conversationsByUser
        } else {
            // Fallback for legacy/local data where entities may not have userId populated yet.
            db.chatDao().getSessionsSince(since)
        }
        conversations.forEach { c ->
            changes.add(SyncChange(
                table = "conversations",
                op = "upsert",
                record = mapOf(
                    "id" to JsonPrimitive(c.id),
                    "type" to JsonPrimitive(if (c.isImageGeneration) "IMAGE" else "TEXT"),
                    "title" to JsonPrimitive(c.title),
                    "updatedAtMs" to JsonPrimitive(c.lastModifiedTimestamp),
                    "createdAtMs" to JsonPrimitive(c.creationTimestamp)
                )
            ))
        }
        
        // Collect Messages
        val messagesByUser = db.chatDao().getMessagesSince(userId, since)
        val messages = if (messagesByUser.isNotEmpty()) {
            messagesByUser
        } else {
            // Fallback for legacy/local data where entities may not have userId populated yet.
            db.chatDao().getMessagesSince(since)
        }
        messages.forEach { m ->
            changes.add(SyncChange(
                table = "messages",
                op = "upsert",
                record = mapOf(
                    "id" to JsonPrimitive(m.id),
                    "conversationId" to JsonPrimitive(m.sessionId),
                    "text" to JsonPrimitive(m.text),
                    "timestampMs" to JsonPrimitive(m.timestamp),
                    "role" to JsonPrimitive(if (m.sender == Sender.User) "user" else "assistant")
                )
            ))
        }
        
        return changes
    }
}
