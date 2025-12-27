package com.android.everytalk.data.network.sync

import android.content.Context
import okhttp3.Interceptor
import okhttp3.Response

class SyncAuthInterceptor(private val context: Context) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val prefs = context.getSharedPreferences("everytalk_auth", Context.MODE_PRIVATE)
        val token = prefs.getString("access_token", null)

        val request = chain.request()
        
        // Only add header if token exists and request is to our sync API
        // This check is a bit naive, ideally we check host. 
        // But since we use a specific Retrofit client for sync, it should be fine.
        return if (token != null) {
            val newRequest = request.newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
            chain.proceed(newRequest)
        } else {
            chain.proceed(request)
        }
    }
}