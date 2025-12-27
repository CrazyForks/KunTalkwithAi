package com.android.everytalk.util

object CloudIds {
    const val CONVERSATION_PREFIX = "cloud_conv_"

    fun toLocalConversationId(conversationId: String): String {
        return CONVERSATION_PREFIX + conversationId
    }

    fun toRemoteConversationId(localConversationId: String): String {
        return localConversationId.removePrefix(CONVERSATION_PREFIX)
    }
}
