package com.android.everytalk.statecontroller.controller.auth

import android.util.Log
import com.android.everytalk.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * AuthService 负责与后端 API 进行身份验证交互
 * (交换 Google ID Token 为 Access Token)
 */
class AuthService {

    private val client = HttpClient {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                prettyPrint = true
                isLenient = true
            })
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30000
            connectTimeoutMillis = 10000
            socketTimeoutMillis = 30000
        }
    }

    // 后端基础 URL，从 BuildConfig 获取
    private val baseUrl = BuildConfig.EVERYTALK_CLOUD_API_BASE_URL.trim().removeSuffix("/")

    @Serializable
    data class GoogleAuthRequest(
        val idToken: String,
        val deviceId: String
    )

    @Serializable
    data class AuthResponse(
        val accessToken: String? = null,
        val error: String? = null
    )

    /**
     * 将 Google ID Token 交换为应用的 Access Token
     */
    suspend fun exchangeGoogleIdToken(idToken: String, deviceId: String): String {
        val url = "$baseUrl/auth/google"
        try {
            val response: AuthResponse = client.post(url) {
                contentType(ContentType.Application.Json)
                setBody(GoogleAuthRequest(idToken, deviceId))
            }.body()

            if (response.accessToken != null) {
                return response.accessToken
            } else {
                throw Exception("Auth failed: ${response.error ?: "Unknown error"}")
            }
        } catch (e: Exception) {
            Log.e("AuthService", "Failed to exchange token", e)
            throw e
        }
    }
}