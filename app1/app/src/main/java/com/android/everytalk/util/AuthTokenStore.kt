package com.android.everytalk.util

import android.content.Context

class AuthTokenStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getAccessToken(): String? {
        return prefs.getString(KEY_ACCESS_TOKEN, null)
    }

    fun setAccessToken(token: String?) {
        prefs.edit().apply {
            if (token.isNullOrBlank()) {
                remove(KEY_ACCESS_TOKEN)
            } else {
                putString(KEY_ACCESS_TOKEN, token)
            }
        }.apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_ACCESS_TOKEN).apply()
    }

    private companion object {
        private const val PREFS_NAME = "auth_prefs"
        private const val KEY_ACCESS_TOKEN = "access_token"
    }
}
