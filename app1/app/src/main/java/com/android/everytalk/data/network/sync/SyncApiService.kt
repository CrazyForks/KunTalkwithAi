package com.android.everytalk.data.network.sync

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface SyncApiService {
    @POST("auth/google")
    suspend fun authGoogle(@Body request: AuthGoogleRequest): AuthGoogleResponse

    @POST("sync/push")
    suspend fun push(@Body request: SyncPushRequest): SyncPushResponse

    @GET("sync/pull")
    suspend fun pull(@Query("since") since: Long): SyncPullResponse
}