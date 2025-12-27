package com.android.everytalk.util

import android.content.Context
import android.util.Log
import com.android.everytalk.ui.screens.viewmodel.DataPersistenceManager
import com.android.everytalk.data.DataClass.Message
import com.google.gson.Gson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.*
import org.json.JSONObject

object SyncManager {
    private const val TAG = "SyncManager"
    private var webSocket: WebSocket? = null
    private var sessionId: String? = null
    private var relayUrl: String? = null
    private val client = OkHttpClient()
    private val gson = Gson()
    private var persistenceManager: DataPersistenceManager? = null

    // Initialize with DataPersistenceManager
    fun init(pm: DataPersistenceManager) {
        persistenceManager = pm
    }

    private var isOverwriteMode = false

    fun connect(url: String, sid: String, overwrite: Boolean = false) {
        if (webSocket != null) {
            disconnect()
        }
        
        sessionId = sid
        relayUrl = url
        isOverwriteMode = overwrite

        // Ensure proper WebSocket URL format
        val wsUrl = if (url.startsWith("http")) {
            url.replace("http", "ws")
        } else {
            url
        }
        
        val fullUrl = "$wsUrl?sid=$sid"
        Log.d(TAG, "Connecting to: $fullUrl, Overwrite: $overwrite")

        val request = Request.Builder().url(fullUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket Connected")
                // Send init sync mode
                send("sync_init", mapOf("mode" to if (isOverwriteMode) "overwrite" else "merge"))
                // Trigger initial sync
                startInitialSync()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "Received: $text")
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket Closing: $code / $reason")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket Failure", t)
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        sessionId = null
    }

    private fun startInitialSync() {
        CoroutineScope(Dispatchers.IO).launch {
            persistenceManager?.let { pm ->
                // 1. Sync Configs
                val apiConfigs = pm.loadApiConfigs()
                send("config_sync", apiConfigs)

                // 2. Sync Conversations (Text Mode)
                val textHistory = pm.loadChatHistory() // List<List<Message>>
                
                val batchPayload = mutableListOf<Any>()
                val pinnedTextIds = pm.loadPinnedTextIds()
                
                for (messages in textHistory) {
                    if (messages.isEmpty()) continue
                    val stableId = com.android.everytalk.util.ConversationNameHelper.resolveStableId(messages) ?: continue
                    val firstMsg = messages.first()
                    val lastMsg = messages.last()
                    
                    val conversationObj = mapOf(
                        "id" to stableId,
                        "type" to "TEXT",
                        "title" to (com.android.everytalk.util.ConversationNameHelper.generateConversationName(messages) ?: "New Chat"),
                        "createdAt" to firstMsg.timestamp,
                        "updatedAt" to lastMsg.timestamp,
                        "isPinned" to pinnedTextIds.contains(stableId)
                    )
                    
                    batchPayload.add(mapOf(
                        "conversation" to conversationObj,
                        "messages" to messages
                    ))
                }
                
                if (batchPayload.isNotEmpty()) {
                    send("batch_history_sync", batchPayload)
                }
                
                // 3. Sync Conversations (Image Mode)
                val imageHistory = pm.loadImageGenerationHistory()
                val imageBatchPayload = mutableListOf<Any>()
                val pinnedImageIds = pm.loadPinnedImageIds()
                
                for (messages in imageHistory) {
                    if (messages.isEmpty()) continue
                    val stableId = com.android.everytalk.util.ConversationNameHelper.resolveStableId(messages) ?: continue
                    val firstMsg = messages.first()
                    val lastMsg = messages.last()
                    
                    val conversationObj = mapOf(
                        "id" to stableId,
                        "type" to "IMAGE",
                        "title" to (com.android.everytalk.util.ConversationNameHelper.generateConversationName(messages) ?: "New Image Chat"),
                        "createdAt" to firstMsg.timestamp,
                        "updatedAt" to lastMsg.timestamp,
                        "isPinned" to pinnedImageIds.contains(stableId)
                    )
                    
                    imageBatchPayload.add(mapOf(
                        "conversation" to conversationObj,
                        "messages" to messages
                    ))
                }
                
                if (imageBatchPayload.isNotEmpty()) {
                    send("batch_history_sync", imageBatchPayload)
                }

                // 4. Sync Settings
                val params = pm.loadConversationParameters()
                if (params.isNotEmpty()) {
                    val settingsPayload = params.map { (convId, config) ->
                        mapOf(
                            "conversationId" to convId,
                            "type" to "TEXT", 
                            "text" to mapOf(
                                "chatParams" to mapOf(
                                    "temperature" to config.temperature,
                                    "topP" to config.topP,
                                    "maxTokens" to config.maxOutputTokens
                                )
                            )
                        )
                    }
                    send("settings_sync", settingsPayload)
                }
            }
        }
    }

    fun send(type: String, payload: Any) {
        if (webSocket == null) return
        
        try {
            val json = JSONObject()
            json.put("type", type)
            // Use Gson to serialize payload to ensure deep object structure is preserved
            val payloadJson = gson.toJson(payload) 
            // We need to put it as an object/array, not a string, so JSON.parse on web side works naturally?
            // Actually, JSONObject.put with a String value will quote it.
            // We want nested JSON structure.
            // Better approach: Create full object with Gson
            
            val messageMap = mapOf("type" to type, "payload" to payload)
            val finalJson = gson.toJson(messageMap)
            
            webSocket?.send(finalJson)
        } catch (e: Exception) {
            Log.e(TAG, "Error sending message", e)
        }
    }
    
    // Call this when streaming starts
    fun sendStreamChunk(conversationId: String, messageId: String, content: String, role: String = "ai") {
        send("stream_chunk", mapOf(
            "conversationId" to conversationId,
            "messageId" to messageId,
            "content" to content,
            "role" to role
        ))
    }
    
    // Call this when streaming ends
    fun sendStreamEnd(conversationId: String, messageId: String, fullMessage: Message) {
         send("stream_end", mapOf(
            "conversationId" to conversationId,
            "messageId" to messageId,
            "fullMessage" to fullMessage
        ))
    }
}