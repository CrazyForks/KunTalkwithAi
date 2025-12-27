package com.android.everytalk.data.repository

import android.content.Context
import android.util.Log
import com.android.everytalk.data.auth.GoogleAuthManager
import com.android.everytalk.data.network.sync.AuthGoogleRequest
import com.android.everytalk.data.network.sync.SyncApiService
import com.android.everytalk.data.prefs.SyncPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

class AuthRepository(
    private val context: Context,
    private val syncApiService: SyncApiService,
    private val syncPrefs: SyncPrefs,
    private val googleAuthManager: GoogleAuthManager
) {
    private val _isSignedIn = MutableStateFlow(getAccessToken() != null)
    val isSignedIn = _isSignedIn.asStateFlow()

    fun getAccessToken(): String? {
        val prefs = context.getSharedPreferences("everytalk_auth", Context.MODE_PRIVATE)
        return prefs.getString("access_token", null)
    }

    private fun setAccessToken(token: String?) {
        val prefs = context.getSharedPreferences("everytalk_auth", Context.MODE_PRIVATE)
        if (token == null) {
            prefs.edit().remove("access_token").apply()
        } else {
            prefs.edit().putString("access_token", token).apply()
        }
        _isSignedIn.value = token != null
    }

    suspend fun signInWithGoogle(): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                // 1. Get Google ID Token
                val idToken = googleAuthManager.signIn()
                if (idToken == null) {
                    Log.w("AuthRepository", "Failed to get Google ID Token")
                    return@withContext false
                }

                // 2. Exchange for App Access Token
                val deviceId = syncPrefs.getDeviceId()
                val response = syncApiService.authGoogle(
                    AuthGoogleRequest(idToken = idToken, deviceId = deviceId)
                )

                // 3. Save Access Token
                setAccessToken(response.accessToken)
                Log.i("AuthRepository", "Successfully signed in and exchanged token")
                true
            } catch (e: Exception) {
                Log.e("AuthRepository", "Sign in failed", e)
                false
            }
        }
    }

    fun signOut() {
        setAccessToken(null)
        syncPrefs.clearSyncState()
        Log.i("AuthRepository", "Signed out")
    }
}