package com.android.everytalk.data.database.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.android.everytalk.data.database.entity.DeviceClockEntity

@Dao
interface DeviceClockDao {
    @Query("SELECT * FROM device_clocks WHERE userId = :userId AND deviceId = :deviceId")
    fun getDeviceClock(userId: String, deviceId: String): DeviceClockEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun insertOrUpdate(deviceClock: DeviceClockEntity)
}
