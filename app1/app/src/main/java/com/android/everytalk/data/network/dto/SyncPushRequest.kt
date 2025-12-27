package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class SyncPushRequest(
    val deviceId: String,
    val changes: List<SyncChange>
)