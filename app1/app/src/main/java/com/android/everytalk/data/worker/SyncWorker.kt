package com.android.everytalk.data.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker.Result
import androidx.work.WorkerParameters
import com.android.everytalk.data.database.AppDatabase
import com.android.everytalk.data.network.sync.SyncAuthInterceptor
import com.android.everytalk.data.network.sync.SyncApiService
import com.android.everytalk.data.auth.GoogleAuthManager
import com.android.everytalk.data.prefs.SyncPrefs
import com.android.everytalk.data.repository.AuthRepository
import com.android.everytalk.data.repository.SyncRepository
import com.android.everytalk.BuildConfig
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType

class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            // Manual DI since Hilt is not fully set up or we want to avoid complexity here
            val context = applicationContext
            val database = AppDatabase.getDatabase(context)
            val syncPrefs = SyncPrefs(context)
            
            val client = OkHttpClient.Builder()
                .addInterceptor(SyncAuthInterceptor(context))
                .build()
                
            val json = Json { ignoreUnknownKeys = true }
            val retrofit = Retrofit.Builder()
                .baseUrl(BuildConfig.EVERYTALK_CLOUD_API_BASE_URL)
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                
            val apiService = retrofit.create(SyncApiService::class.java)
            val authManager = GoogleAuthManager(context)
            val authRepository = AuthRepository(context, apiService, syncPrefs, authManager)
            val repository = SyncRepository(apiService, syncPrefs, database, authRepository)

            repository.sync()
            Result.success()
        } catch (e: Exception) {
            e.printStackTrace()
            Result.retry()
        }
    }
}