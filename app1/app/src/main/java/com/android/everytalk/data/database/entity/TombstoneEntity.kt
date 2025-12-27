package com.android.everytalk.data.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 墓碑实体类 - 用于记录已删除数据的元数据，实现软删除同步
 */
@Entity(
    tableName = "tombstones",
    indices = [
        Index(value = ["userId", "deletedAtMs"]),
        Index(value = ["userId", "kind", "targetId"], unique = true)
    ]
)
data class TombstoneEntity(
    @PrimaryKey
    val id: String,

    val userId: String,

    /**
     * 删除对象的类型 (conversation, message, group, apiConfig, conversationSetting)
     */
    val kind: String,

    /**
     * 被删除对象的 ID
     */
    val targetId: String,

    /**
     * 删除发生的时间戳 (毫秒)
     */
    val deletedAtMs: Long,

    /**
     * 执行删除操作的设备 ID (用于调试或避免回环)
     */
    val deviceId: String
)
