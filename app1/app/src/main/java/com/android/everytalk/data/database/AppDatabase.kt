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
import com.android.everytalk.data.database.daos.TombstoneDao
import com.android.everytalk.data.database.entities.ApiConfigEntity
import com.android.everytalk.data.database.entities.ChatSessionEntity
import com.android.everytalk.data.database.entities.ConversationGroupEntity
import com.android.everytalk.data.database.entities.ConversationParamsEntity
import com.android.everytalk.data.database.entities.ExpandedGroupEntity
import com.android.everytalk.data.database.entities.MessageEntity
import com.android.everytalk.data.database.entities.PinnedItemEntity
import com.android.everytalk.data.database.entities.SystemSettingEntity
import com.android.everytalk.data.database.entities.TombstoneEntity
import com.android.everytalk.data.database.entities.VoiceBackendConfigEntity

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
        TombstoneEntity::class
    ],
    version = 4,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun apiConfigDao(): ApiConfigDao
    abstract fun voiceConfigDao(): VoiceConfigDao
    abstract fun chatDao(): ChatDao
    abstract fun settingsDao(): SettingsDao
    abstract fun tombstoneDao(): TombstoneDao

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
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .build()
                INSTANCE = instance
                instance
            }
        }
        
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // 添加版本 1 到 2 的迁移逻辑
                // 如果没有具体变更，可以是空实现
            }
        }
        
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // Add useRealtimeStreaming column to voice_backend_configs table
                // SQLite doesn't support BOOLEAN type directly, uses INTEGER (0/1)
                database.execSQL("ALTER TABLE voice_backend_configs ADD COLUMN useRealtimeStreaming INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                // 1. Create tombstones table
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS `tombstones` (
                        `kind` TEXT NOT NULL,
                        `targetId` TEXT NOT NULL,
                        `deletedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`kind`, `targetId`)
                    )
                """.trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS `index_tombstones_deletedAt` ON `tombstones` (`deletedAt`)")

                // 2. Add updatedAt to api_configs
                // Set default updatedAt to current time for existing records
                val now = System.currentTimeMillis()
                database.execSQL("ALTER TABLE api_configs ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")

                // 3. Add updatedAt to messages
                // We default updatedAt to timestamp (creation time) for existing messages
                // Since we can't easily reference another column in DEFAULT, we might need to recreate table or update later?
                // SQLite ALTER TABLE ADD COLUMN allows constant default.
                // We'll set it to 0 first, then update it from timestamp.
                database.execSQL("ALTER TABLE messages ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0")
                database.execSQL("UPDATE messages SET updatedAt = timestamp")
                
                // 4. Add createdAt and updatedAt to conversation_groups
                database.execSQL("ALTER TABLE conversation_groups ADD COLUMN createdAt INTEGER NOT NULL DEFAULT $now")
                database.execSQL("ALTER TABLE conversation_groups ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")

                // 5. Add updatedAt to conversation_params
                database.execSQL("ALTER TABLE conversation_params ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT $now")
            }
        }
    }
}