package com.miwarp.mobile.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.miwarp.mobile.design.MWChatBubble
import com.miwarp.mobile.design.MWToolCallCard
import com.miwarp.mobile.model.ChatMessage
import com.miwarp.mobile.model.MessageRole

@Composable
fun MessageBubble(
    message: ChatMessage,
    modifier: Modifier = Modifier,
) {
    if (message.role == MessageRole.User) {
        MWChatBubble(
            role = MessageRole.User,
            text = message.text,
            modifier = modifier,
        )
    } else {
        MWChatBubble(
            role = MessageRole.Assistant,
            text = message.text,
            isStreaming = message.isStreaming,
            thinking = message.thinking.ifBlank { null },
            modifier = modifier,
        ) {
            if (message.toolCalls.isNotEmpty()) {
                message.toolCalls.forEach { tool ->
                    MWToolCallCard(tool = tool)
                }
            }
        }
    }
}
