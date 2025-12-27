package com.android.everytalk.data.repository

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import com.android.everytalk.data.network.api.EveryTalkSyncApi
import com.android.everytalk.data.network.dto.AuthGoogleRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.UUID

class AuthRepository(
    private val context: Context,
    private val syncApi: EveryTalkSyncApi
) {
    private val prefs = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
    private val credentialManager = CredentialManager.create(context)

    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    val authState = _authState.asStateFlow()

    val isSignedIn = authState.map { it is AuthState.Authenticated }

    init {
        val token = prefs.getString("access_token", null)
        var userId = prefs.getString("user_id", null)
        if (token != null) {
            if (userId.isNullOrBlank()) {
                userId = decodeUidFromAccessToken(token)
                if (!userId.isNullOrBlank()) {
                    prefs.edit().putString("user_id", userId).apply()
                }
            }
            if (!userId.isNullOrBlank()) {
                _authState.value = AuthState.Authenticated(userId, token)
            } else {
                _authState.value = AuthState.Unauthenticated
            }
        } else {
            _authState.value = AuthState.Unauthenticated
        }
    }

    suspend fun signInWithGoogle(): Result<Unit> {
        try {
            val googleIdOption = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(com.android.everytalk.BuildConfig.GOOGLE_WEB_CLIENT_ID)
                .setAutoSelectEnabled(true)
                .build()

            val request = GetCredentialRequest.Builder()
                .addCredentialOption(googleIdOption)
                .build()

            val result = credentialManager.getCredential(
                request = request,
                context = context
            )

            return handleSignIn(result)
        } catch (e: Exception) {
            return Result.failure(e)
        }
    }

    private suspend fun handleSignIn(result: GetCredentialResponse): Result<Unit> {
        val credential = result.credential
        if (credential is GoogleIdTokenCredential) {
            val idToken = credential.idToken
            val deviceId = getDeviceId()
            
            return try {
                val response = syncApi.authGoogle(AuthGoogleRequest(idToken, deviceId))
                val accessToken = response.accessToken

                val userId = decodeUidFromAccessToken(accessToken)
                    ?: return Result.failure(IllegalStateException("accessToken missing uid"))
                
                saveAuth(userId, accessToken)
                Result.success(Unit)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
        return Result.failure(Exception("Invalid credential type"))
    }

    private fun saveAuth(userId: String, token: String) {
        prefs.edit()
            .putString("access_token", token)
            .putString("user_id", userId)
            .apply()
        _authState.value = AuthState.Authenticated(userId, token)
    }

    fun signOut() {
        prefs.edit().clear().apply()
        _authState.value = AuthState.Unauthenticated
    }

    fun getAccessToken(): String? {
        return (authState.value as? AuthState.Authenticated)?.accessToken
    }

    fun getUserId(): String? {
        return (authState.value as? AuthState.Authenticated)?.userId
    }

    fun getDeviceId(): String {
        var id = prefs.getString("device_id", null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    private fun decodeUidFromAccessToken(token: String): String? {
        return runCatching {
            val parts = token.split('.')
            if (parts.size < 2) return@runCatching null
            val payloadB64 = parts[1]

            val decoder = Base64.getUrlDecoder()
            val payloadBytes = decoder.decode(payloadB64)
            val payloadJson = String(payloadBytes, StandardCharsets.UTF_8)
            val obj = JSONObject(payloadJson)

            // backend signs { uid: user.id, sub: user.googleSub }
            obj.optString("uid", null)
        }.getOrNull()
    }
}

sealed class AuthState {
    object Loading : AuthState()
    object Unauthenticated : AuthState()
    data class Authenticated(val userId: String, val accessToken: String) : AuthState()
}
