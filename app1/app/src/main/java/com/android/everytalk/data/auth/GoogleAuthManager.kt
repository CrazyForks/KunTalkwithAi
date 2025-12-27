package com.android.everytalk.data.auth

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialException
import com.android.everytalk.BuildConfig
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GoogleAuthManager(private val context: Context) {
    private val credentialManager = CredentialManager.create(context)

    suspend fun signIn(): String? {
        return withContext(Dispatchers.IO) {
            try {
                // Use Web Client ID from BuildConfig (injected via Gradle)
                val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
                if (webClientId.isBlank()) {
                    Log.e("GoogleAuthManager", "GOOGLE_WEB_CLIENT_ID is missing in BuildConfig")
                    return@withContext null
                }

                val googleIdOption = GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setServerClientId(webClientId)
                    .setAutoSelectEnabled(true)
                    .build()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()

                val result = credentialManager.getCredential(
                    request = request,
                    context = context,
                )

                handleSignIn(result)
            } catch (e: GetCredentialException) {
                Log.e("GoogleAuthManager", "GetCredentialException", e)
                null
            } catch (e: Exception) {
                Log.e("GoogleAuthManager", "Unexpected exception", e)
                null
            }
        }
    }

    private fun handleSignIn(result: GetCredentialResponse): String? {
        val credential = result.credential
        if (credential is GoogleIdTokenCredential) {
            val idToken = credential.idToken
            Log.d("GoogleAuthManager", "Got ID Token (len=${idToken.length})")
            return idToken
        } else {
            Log.e("GoogleAuthManager", "Unexpected credential type: ${credential.javaClass.name}")
            return null
        }
    }
}