package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SyncPullResponse(
    val now: Long,
    val conversations: List<Map<String, JsonElement>>? = null,
    val messages: List<Map<String, JsonElement>>? = null,
    val apiConfigs: List<Map<String, JsonElement>>? = null,
    val groups: List<Map<String, JsonElement>>? = null,
    val conversationSettings: List<Map<String, JsonElement>>? = null,
    val tombstones: List<Map<String, JsonElement>>? = null
)