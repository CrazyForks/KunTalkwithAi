package com.android.everytalk.data.worker

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private const val WORK_NAME_PERIODIC = "EveryTalkSyncWorkerPeriodic"
    private const val WORK_NAME_ONETIME = "EveryTalkSyncWorkerOneTime"

    fun scheduleOneTimeSync(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            WORK_NAME_ONETIME,
            ExistingWorkPolicy.KEEP, // Don't replace if already running/enqueued
            syncRequest
        )
    }
}