package com.android.everytalk.data.DataClass

import kotlinx.serialization.Serializable

@Serializable
data class UserInfo(
    val displayName: String? = null,
    val email: String? = null,
    val photoUrl: String? = null,
    val id: String? = null
)