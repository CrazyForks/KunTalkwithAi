package com.android.everytalk.data.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class AuthGoogleResponse(
    val accessToken: String
)