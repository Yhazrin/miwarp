package com.miwarp.mobile.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.model.ChatMessage

@Composable
fun MessageList(
    messages: List<ChatMessage>,
    modifier: Modifier = Modifier,
) {
    val spacing = MWTheme.spacing
    val listState = rememberLazyListState()

    // Auto-scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        state = listState,
        contentPadding = PaddingValues(
            horizontal = spacing.md,
            vertical = spacing.sm,
        ),
        verticalArrangement = Arrangement.spacedBy(spacing.sm),
    ) {
        items(messages, key = { it.id }) { message ->
            MessageBubble(
                message = message,
            )
        }
    }
}
