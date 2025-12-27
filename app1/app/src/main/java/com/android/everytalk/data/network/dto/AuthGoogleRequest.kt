package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class AuthGoogleRequest(
    val idToken: String,
    val deviceId: String
)