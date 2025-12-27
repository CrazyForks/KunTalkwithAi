package com.android.everytalk.data.repository

import android.util.Log
import com.android.everytalk.data.database.AppDatabase
import com.android.everytalk.data.network.sync.SyncApiService
import com.android.everytalk.data.network.sync.SyncPushRequest
import com.android.everytalk.data.prefs.SyncPrefs
import com.android.everytalk.data.sync.LocalChangeCollector
import com.android.everytalk.data.sync.RemoteChangeApplier
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SyncRepository(
    private val syncApiService: SyncApiService,
    private val syncPrefs: SyncPrefs,
    private val database: AppDatabase,
    private val authRepository: AuthRepository
) {
    private val collector = LocalChangeCollector(database)
    private val applier = RemoteChangeApplier(database)

    suspend fun sync() {
        withContext(Dispatchers.IO) {
            if (!authRepository.isSignedIn.value) {
                Log.w("SyncRepository", "Skipping sync: not signed in")
                return@withContext
            }

            try {
                Log.i("SyncRepository", "Starting sync...")
                
                // 1. Push
                val lastPushAt = syncPrefs.getLastPushAt()
                val changes = collector.collectChanges(lastPushAt)
                
                if (changes.isNotEmpty()) {
                    Log.i("SyncRepository", "Pushing ${changes.size} changes")
                    val deviceId = syncPrefs.getDeviceId()
                    // Push in batches if needed, but for now simple one-shot
                    val response = syncApiService.push(
                        SyncPushRequest(deviceId = deviceId, changes = changes)
                    )
                    
                    if (response.ok) {
                        syncPrefs.setLastPushAt(System.currentTimeMillis())
                        Log.i("SyncRepository", "Push successful")
                    } else {
                        Log.e("SyncRepository", "Push failed: server returned not ok")
                        // Stop sync if push fails to avoid overwriting local with partial state?
                        // Or continue to pull? Usually better to stop.
                        return@withContext
                    }
                } else {
                    Log.i("SyncRepository", "No local changes to push")
                }

                // 2. Pull
                val lastPullAt = syncPrefs.getLastPullAt()
                val pullResponse = syncApiService.pull(lastPullAt)
                
                Log.i("SyncRepository", "Pull successful, applying changes (server time: ${pullResponse.now})")
                applier.applyChanges(pullResponse)
                
                syncPrefs.setLastPullAt(pullResponse.now)
                Log.i("SyncRepository", "Sync completed")

            } catch (e: Exception) {
                Log.e("SyncRepository", "Sync failed", e)
            }
        }
    }
}