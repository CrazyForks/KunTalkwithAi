package com.android.everytalk.data.worker

import android.content.Context

object SyncScheduler {
    private const val WORK_NAME_PERIODIC = "EveryTalkSyncWorkerPeriodic"
    private const val WORK_NAME_ONETIME = "EveryTalkSyncWorkerOneTime"

    fun scheduleOneTimeSync(context: Context) {
        return
    }
}