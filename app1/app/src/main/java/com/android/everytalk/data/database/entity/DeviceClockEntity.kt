package com.android.everytalk.data.database.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * 设备时钟实体类 - 用于记录每个设备的同步状态
 */
@Entity(
    tableName = "device_clocks",
    primaryKeys = ["userId", "deviceId"]
)
data class DeviceClockEntity(
    val userId: String,
    val deviceId: String,
    
    /**
     * 上次成功拉取数据的时间戳 (服务器时间)
     */
    val lastPullAt: Long = 0,
    
    /**
     * 本地记录的更新时间
     */
    val updatedAt: Long = System.currentTimeMillis()
)
