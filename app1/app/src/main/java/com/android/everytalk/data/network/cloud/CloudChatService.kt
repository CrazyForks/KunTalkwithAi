package com.android.everytalk.data.network.cloud

import android.util.Log
import com.android.everytalk.BuildConfig
import com.android.everytalk.data.DataClass.Message
import com.android.everytalk.data.DataClass.Sender
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class CloudChatService {

    private val client = HttpClient {
        install(ContentNegotiation) {
            json(
                Json {
                    ignoreUnknownKeys = true
                    isLenient = true
                    explicitNulls = false
                }
            )
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30000
            connectTimeoutMillis = 10000
            socketTimeoutMillis = 30000
        }
    }

    private val baseUrl = BuildConfig.EVERYTALK_CLOUD_API_BASE_URL.trim().removeSuffix("/")

    @Serializable
    data class ConversationDto(
        val id: String,
        val type: String,
        val title: String? = null,
        val systemPrompt: String? = null,
        val createdAtMs: Long,
        val updatedAtMs: Long,
        val isPinned: Boolean = false,
        val pinnedOrder: Int = 0
    )

    @Serializable
    data class ListConversationsResponse(
        val conversations: List<ConversationDto> = emptyList()
    )

    @Serializable
    data class MessageDto(
        val id: String,
        val conversationId: String,
        val text: String,
        val role: String,
        val reasoning: String? = null,
        val isError: Boolean = false,
        val timestampMs: Long,
        @SerialName("imagesJson") val imagesJson: String? = null
    )

    @Serializable
    data class ListMessagesResponse(
        val messages: List<MessageDto> = emptyList(),
        val nextCursor: Long? = null
    )

    suspend fun listConversations(accessToken: String): List<ConversationDto> {
        val url = "$baseUrl/conversations"
        Log.d("CloudChatService", "GET $url")
        val response: HttpResponse = client.get(url) {
            header(HttpHeaders.Authorization, "Bearer $accessToken")
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrElse { "" }
            throw IllegalStateException("CloudChatService listConversations failed: HTTP ${response.status.value} ${response.status.description} ${text.take(300)}")
        }
        val resp: ListConversationsResponse = response.body()
        return resp.conversations
    }

    suspend fun listMessages(accessToken: String, conversationId: String, limit: Int = 100): List<MessageDto> {
        val url = "$baseUrl/conversations/$conversationId/messages?limit=$limit"
        Log.d("CloudChatService", "GET $url")
        val response: HttpResponse = client.get(url) {
            header(HttpHeaders.Authorization, "Bearer $accessToken")
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrElse { "" }
            throw IllegalStateException("CloudChatService listMessages failed: HTTP ${response.status.value} ${response.status.description} ${text.take(300)}")
        }
        val resp: ListMessagesResponse = response.body()
        return resp.messages
    }

    fun mapDtoToMessage(dto: MessageDto): Message {
        val sender = when (dto.role.lowercase()) {
            "assistant" -> Sender.AI
            "user" -> Sender.User
            "system" -> Sender.System
            "tool" -> Sender.Tool
            else -> Sender.AI
        }
        return Message(
            id = dto.id,
            text = dto.text,
            sender = sender,
            reasoning = dto.reasoning,
            contentStarted = dto.text.isNotBlank() || !(dto.reasoning ?: "").isBlank(),
            isError = dto.isError,
            timestamp = dto.timestampMs
        )
    }
}
