package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class SyncChange(
    val table: String,
    val op: String,
    val record: Map<String, JsonElement>
)