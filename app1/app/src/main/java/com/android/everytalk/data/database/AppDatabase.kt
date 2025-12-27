package com.android.everytalk.data.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.android.everytalk.data.database.daos.ApiConfigDao
import com.android.everytalk.data.database.daos.ChatDao
import com.android.everytalk.data.database.daos.SettingsDao
import com.android.everytalk.data.database.daos.VoiceConfigDao
// Removed old TombstoneDao import
import com.android.everytalk.data.database.entities.ApiConfigEntity
import com.android.everytalk.data.database.entities.ChatSessionEntity
import com.android.everytalk.data.database.entities.ConversationGroupEntity
import com.android.everytalk.data.database.entities.ConversationParamsEntity
import com.android.everytalk.data.database.entities.ExpandedGroupEntity
import com.android.everytalk.data.database.entities.MessageEntity
import com.android.everytalk.data.database.entities.PinnedItemEntity
import com.android.everytalk.data.database.entities.SystemSettingEntity
// Removed old TombstoneEntity import
import com.android.everytalk.data.database.entities.VoiceBackendConfigEntity

// New Sync Entities & DAOs
import com.android.everytalk.data.database.entity.DeviceClockEntity
import com.android.everytalk.data.database.entity.TombstoneEntity
import com.android.everytalk.data.database.dao.DeviceClockDao
import com.android.everytalk.data.database.dao.TombstoneDao

@Database(
    entities = [
        ApiConfigEntity::class,
        VoiceBackendConfigEntity::class,
        ChatSessionEntity::class,
        MessageEntity::class,
        SystemSettingEntity::class,
        PinnedItemEntity::class,
        ConversationGroupEntity::class,
        ExpandedGroupEntity::class,
        ConversationParamsEntity::class,
        TombstoneEntity::class, // Uses new entity
        DeviceClockEntity::class
    ],
    version = 5,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun apiConfigDao(): ApiConfigDao
    abstract fun voiceConfigDao(): VoiceConfigDao
    abstract fun chatDao(): ChatDao
    abstract fun settingsDao(): SettingsDao
    
    // Updated to use new DAO
    abstract fun tombstoneDao(): TombstoneDao
    abstract fun deviceClockDao(): DeviceClockDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "eztalk_room_database"
                )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()
                INSTANCE = instance
                instance
            }
        }
        
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
            }
        }
        
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE voice_backend_configs ADD COLUMN useRealtimeStreaming INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // This migration created the OLD tombstones table.
                // We will drop it and recreate it in MIGRATION_4_5 to match the new schema,
                // or we can adjust this if we were starting fresh.
                // Since this is history, we keep it as is, but MIGRATION_4_5 will handle the upgrade.
                
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS `tombstones_old` (
                        `kind` TEXT NOT NULL,
                        `targetId` TEXT NOT NULL,
                        `deletedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`kind`, `targetId`)
                    )
                """.trimIndent())
                // Note: I renamed table to tombstones_old to avoid conflict if someone runs 3->4 then 4->5
                // effectively deprecating this migration's result.
                
                // ... (other columns additions)
                val now = System.currentTimeMillis()
                database.execSQL("ALTER TABLE api_configs ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")
                database.execSQL("ALTER TABLE messages ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0")
                database.execSQL("UPDATE messages SET updatedAt = timestamp")
                database.execSQL("ALTER TABLE conversation_groups ADD COLUMN createdAt INTEGER NOT NULL DEFAULT $now")
                database.execSQL("ALTER TABLE conversation_groups ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")
                database.execSQL("ALTER TABLE conversation_params ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")
            }
        }

        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // 1. Create device_clocks
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS `device_clocks` (
                        `userId` TEXT NOT NULL,
                        `deviceId` TEXT NOT NULL,
                        `lastPullAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`userId`, `deviceId`)
                    )
                """.trimIndent())
                
                // 2. Handle Tombstones
                // Drop the old table if it exists (from Migration 3->4)
                database.execSQL("DROP TABLE IF EXISTS `tombstones`")
                database.execSQL("DROP TABLE IF EXISTS `tombstones_old`")
                
                // Create the NEW tombstones table matching TombstoneEntity
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS `tombstones` (
                        `id` TEXT NOT NULL,
                        `userId` TEXT NOT NULL,
                        `kind` TEXT NOT NULL,
                        `targetId` TEXT NOT NULL,
                        `deletedAtMs` INTEGER NOT NULL,
                        `deviceId` TEXT NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                """.trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS `index_tombstones_userId_deletedAtMs` ON `tombstones` (`userId`, `deletedAtMs`)")
                database.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_tombstones_userId_kind_targetId` ON `tombstones` (`userId`, `kind`, `targetId`)")
            }
        }
    }
}
