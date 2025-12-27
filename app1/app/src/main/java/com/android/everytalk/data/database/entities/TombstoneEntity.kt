package com.android.everytalk.data.database.entities

import androidx.room.Entity
import androidx.room.Index

/**
 * 墓碑实体类 - 用于记录被删除的数据，以便同步给服务端
 */
@Entity(
    tableName = "tombstones",
    primaryKeys = ["kind", "targetId"],
    indices = [Index(value = ["deletedAt"])]
)
data class TombstoneEntity(
    /**
     * 数据类型：conversation, message, apiConfig, group, conversationSetting
     */
    val kind: String,
    
    /**
     * 被删除数据的 ID
     */
    val targetId: String,
    
    /**
     * 删除时间戳 (毫秒)
     */
    val deletedAt: Long
)