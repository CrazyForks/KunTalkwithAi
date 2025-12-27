package com.android.everytalk.data.prefs

import android.content.Context
import java.util.UUID

class SyncPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("everytalk_sync_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_DEVICE_ID = "sync_device_id"
        private const val KEY_LAST_PULL_AT = "sync_last_pull_at"
        private const val KEY_LAST_PUSH_AT = "sync_last_push_at"
    }

    /**
     * 获取或生成设备 ID (UUID)
     */
    fun getDeviceId(): String {
        var deviceId = prefs.getString(KEY_DEVICE_ID, null)
        if (deviceId.isNullOrBlank()) {
            deviceId = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, deviceId).apply()
        }
        return deviceId!!
    }

    fun getLastPullAt(): Long {
        return prefs.getLong(KEY_LAST_PULL_AT, 0L)
    }

    fun setLastPullAt(timestamp: Long) {
        prefs.edit().putLong(KEY_LAST_PULL_AT, timestamp).apply()
    }

    fun getLastPushAt(): Long {
        return prefs.getLong(KEY_LAST_PUSH_AT, 0L)
    }

    fun setLastPushAt(timestamp: Long) {
        prefs.edit().putLong(KEY_LAST_PUSH_AT, timestamp).apply()
    }
    
    fun clearSyncState() {
        prefs.edit()
            .remove(KEY_LAST_PULL_AT)
            .remove(KEY_LAST_PUSH_AT)
            // deviceId should persist across logins generally, but maybe okay to clear too
            .apply()
    }
}