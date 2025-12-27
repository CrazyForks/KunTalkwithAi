package com.android.everytalk.data.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.android.everytalk.data.database.entity.TombstoneEntity

@Dao
interface TombstoneDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insert(tombstone: TombstoneEntity)

    @Query("SELECT * FROM tombstones WHERE userId = :userId AND deletedAtMs > :since")
    fun getTombstonesSince(userId: String, since: Long): List<TombstoneEntity>
}
