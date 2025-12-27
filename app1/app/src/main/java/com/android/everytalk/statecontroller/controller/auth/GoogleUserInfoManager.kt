package com.android.everytalk.statecontroller.controller.auth

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.preferencesDataStore
import com.android.everytalk.data.DataClass.UserInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString

private val Context.dataStore by preferencesDataStore(name = "user_info_prefs")

class GoogleUserInfoManager(private val context: Context) {

    private val USER_INFO_KEY = stringPreferencesKey("user_info")

    val userInfo: Flow<UserInfo?> = context.dataStore.data
        .catch { exception ->
            if (exception is java.io.IOException) {
                Log.e("GoogleUserInfoManager", "Error reading preferences", exception)
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { preferences ->
            val userInfoJson = preferences[USER_INFO_KEY]
            Log.d("GoogleUserInfoManager", "Reading userInfoJson: $userInfoJson")
            if (userInfoJson != null) {
                try {
                    val info = Json.decodeFromString<UserInfo>(userInfoJson)
                    Log.d("GoogleUserInfoManager", "Decoded UserInfo: $info")
                    info
                } catch (e: Exception) {
                    Log.e("GoogleUserInfoManager", "Failed to decode UserInfo", e)
                    null
                }
            } else {
                Log.d("GoogleUserInfoManager", "UserInfo is null in DataStore")
                null
            }
        }

    suspend fun saveUserInfo(userInfo: UserInfo) {
        Log.d("GoogleUserInfoManager", "Saving UserInfo: $userInfo")
        try {
            context.dataStore.edit { preferences ->
                val json = Json.encodeToString(userInfo)
                preferences[USER_INFO_KEY] = json
                Log.d("GoogleUserInfoManager", "Saved UserInfo JSON: $json")
            }
        } catch (e: Exception) {
            Log.e("GoogleUserInfoManager", "Failed to save user info to DataStore", e)
        }
    }

    suspend fun clearUserInfo() {
        context.dataStore.edit { preferences ->
            preferences.remove(USER_INFO_KEY)
        }
    }
}