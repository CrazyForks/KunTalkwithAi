package com.android.everytalk.statecontroller.controller.auth

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.android.everytalk.BuildConfig

import java.security.MessageDigest
import java.util.UUID

/**
 * AuthManager 负责处理客户端凭据获取（Google Sign-In）
 */
class AuthManager(private val context: Context) {

    private val credentialManager = CredentialManager.create(context)

    /**
     * 发起 Google 登录流程，获取 ID Token
     * @return 成功时返回 Google ID Token，失败时抛出异常
     */
    suspend fun signInWithGoogle(): String = withContext(Dispatchers.IO) {
        throw IllegalStateException("AuthManager needs an Activity context to launch sign-in UI. Use signInWithGoogle(activity) instead.")
    }

    /**
     * 使用 Activity Context 发起登录
     */
    suspend fun signInWithGoogle(activity: android.app.Activity): String {
        suspend fun requestIdToken(autoSelect: Boolean): String {
            val serverClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID.trim()
            if (serverClientId.isBlank()) {
                throw IllegalStateException("GOOGLE_WEB_CLIENT_ID is empty. Please set VITE_GOOGLE_WEB_CLIENT_ID in local.properties/CI env and rebuild.")
            }

            val rawNonce = UUID.randomUUID().toString()
            val digest = MessageDigest.getInstance("SHA-256").digest(rawNonce.toByteArray())
            val nonce = digest.joinToString(separator = "") { b -> "%02x".format(b) }

            Log.i(
                "AuthManager",
                "Starting Google Sign-In (autoSelect=$autoSelect, clientIdSuffix=${serverClientId.takeLast(12)})"
            )

            val googleIdOption = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(serverClientId)
                .setNonce(nonce)
                .setAutoSelectEnabled(autoSelect)
                .build()

            val request = GetCredentialRequest.Builder()
                .setPreferImmediatelyAvailableCredentials(false)
                .addCredentialOption(googleIdOption)
                .build()

            val result = credentialManager.getCredential(
                request = request,
                context = activity
            )
            return handleSignIn(result)
        }

        return try {
            // 先尝试 autoSelect=true（若已授权/仅一个候选账号，可能无需弹窗）
            requestIdToken(autoSelect = true)
        } catch (e: NoCredentialException) {
            // 常见原因：设备没有可用 Google 账号、或没有已授权的凭据。
            // 回退到 autoSelect=false，强制弹出账号选择/登录 UI。
            Log.w("AuthManager", "NoCredentialException, retry with autoSelect=false", e)
            requestIdToken(autoSelect = false)
        } catch (e: GetCredentialException) {
            Log.e("AuthManager", "GetCredentialException: ${e.message}", e)
            throw e
        } catch (e: Exception) {
            Log.e("AuthManager", "Unexpected exception during sign in", e)
            throw e
        }
    }

    private fun handleSignIn(result: GetCredentialResponse): String {
        val credential = result.credential
        return when (credential) {
            is GoogleIdTokenCredential -> {
                credential.idToken
            }

            is androidx.credentials.CustomCredential -> {
                if (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    try {
                        GoogleIdTokenCredential.createFrom(credential.data).idToken
                    } catch (e: Exception) {
                        Log.e("AuthManager", "Failed to parse GoogleIdTokenCredential", e)
                        throw e
                    }
                } else {
                    Log.e("AuthManager", "Unexpected custom credential type: ${credential.type}")
                    throw IllegalStateException("Unexpected credential type: ${credential.type}")
                }
            }

            else -> {
                Log.e("AuthManager", "Unexpected credential type: ${credential.type}")
                throw IllegalStateException("Unexpected credential type: ${credential.type}")
            }
        }
    }
}