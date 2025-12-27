package com.android.everytalk.data.network.api

import com.android.everytalk.data.network.dto.AuthGoogleRequest
import com.android.everytalk.data.network.dto.AuthGoogleResponse
import com.android.everytalk.data.network.dto.SyncPullResponse
import com.android.everytalk.data.network.dto.SyncPushRequest
import com.android.everytalk.data.network.dto.SyncPushResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface EveryTalkSyncApi {
    
    @POST("/auth/google")
    suspend fun authGoogle(@Body request: AuthGoogleRequest): AuthGoogleResponse
    
    @GET("/sync/pull")
    suspend fun syncPull(@Query("since") since: Long): SyncPullResponse
    
    @POST("/sync/push")
    suspend fun syncPush(@Body request: SyncPushRequest): SyncPushResponse
}
