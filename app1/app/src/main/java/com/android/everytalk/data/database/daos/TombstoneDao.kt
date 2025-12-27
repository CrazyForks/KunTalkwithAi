package com.android.everytalk.data.database.daos

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.android.everytalk.data.database.entities.TombstoneEntity

@Dao
interface TombstoneDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTombstone(tombstone: TombstoneEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTombstones(tombstones: List<TombstoneEntity>)

    @Query("SELECT * FROM tombstones WHERE deletedAt > :since")
    suspend fun getTombstonesSince(since: Long): List<TombstoneEntity>

    @Query("SELECT * FROM tombstones WHERE kind = :kind AND targetId = :targetId")
    suspend fun getTombstone(kind: String, targetId: String): TombstoneEntity?

    @Query("DELETE FROM tombstones WHERE kind = :kind AND targetId = :targetId")
    suspend fun deleteTombstone(kind: String, targetId: String)
}