package com.android.everytalk.data.network.sync

import android.content.Context
import okhttp3.Interceptor
import okhttp3.Response

class SyncAuthInterceptor(private val context: Context) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val prefs = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
        val token = prefs.getString("access_token", null)

        val requestBuilder = chain.request().newBuilder()
        
        if (!token.isNullOrBlank()) {
            requestBuilder.addHeader("Authorization", "Bearer $token")
        }

        return chain.proceed(requestBuilder.build())
    }
}