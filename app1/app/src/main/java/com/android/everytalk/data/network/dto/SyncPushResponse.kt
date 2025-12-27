package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class SyncPushResponse(
    val ok: Boolean,
    val error: String? = null
)