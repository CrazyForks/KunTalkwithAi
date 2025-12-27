package com.android.everytalk.data.network.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class AuthGoogleRequest(
    val idToken: String,
    val deviceId: String
)

@Serializable
data class AuthGoogleResponse(
    val accessToken: String
)

@Serializable
data class SyncChange(
    val table: String, // 'conversations', 'messages', 'apiConfigs', 'groups', 'conversationSettings', 'tombstones'
    val op: String, // 'upsert', 'delete'
    val record: Map<String, JsonElement>
)

@Serializable
data class SyncPushRequest(
    val deviceId: String,
    val changes: List<SyncChange>
)

@Serializable
data class SyncPushResponse(
    val ok: Boolean
)

@Serializable
data class SyncPullResponse(
    val now: Long,
    val conversations: List<Map<String, JsonElement>>,
    val messages: List<Map<String, JsonElement>>,
    val apiConfigs: List<Map<String, JsonElement>>,
    val groups: List<Map<String, JsonElement>>,
    val conversationSettings: List<Map<String, JsonElement>>,
    val tombstones: List<Map<String, JsonElement>>
)