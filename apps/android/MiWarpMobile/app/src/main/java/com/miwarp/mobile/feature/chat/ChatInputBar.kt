package com.miwarp.mobile.feature.chat

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWInputBar
import com.miwarp.mobile.design.MWTheme

@Composable
fun ChatInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    enabled: Boolean = true,
    onStop: (() -> Unit)? = null,
) {
    val colors = MWTheme.colors

    MWInputBar(
        value = value,
        onValueChange = onValueChange,
        onSend = onSend,
        modifier = modifier,
        placeholder = "Send a message...",
        enabled = enabled,
        isLoading = isLoading,
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onStop != null) {
                    IconButton(
                        onClick = onStop,
                        modifier = Modifier.width(32.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Stop,
                            contentDescription = "Stop",
                            tint = colors.statusError,
                        )
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                }
            }
        },
    )
}
