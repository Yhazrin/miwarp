package com.miwarp.mobile.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.miwarp.mobile.model.MessageRole
import com.miwarp.mobile.model.RunStatus
import com.miwarp.mobile.model.ToolCallInfo

// ── 1. MWGlassCard ─────────────────────────────────────────────────────────

@Composable
fun MWGlassCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    val shape = RoundedCornerShape(radius.lg)
    val clickableMod = if (onClick != null) {
        Modifier.clickable(onClick = onClick)
    } else {
        Modifier
    }

    Column(
        modifier = modifier
            .then(clickableMod)
            .clip(shape)
            .background(colors.glassBg)
            .border(1.dp, colors.glassBorder, shape)
            .padding(spacing.md),
        content = content,
    )
}

// ── 2. MWStatusPill ────────────────────────────────────────────────────────

@Composable
fun MWStatusPill(
    status: RunStatus,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val statusColor = colors.colorForStatus(status)
    val displayLabel = label ?: status.name.lowercase().replace("_", " ")

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(50))
            .background(statusColor.copy(alpha = 0.15f))
            .padding(horizontal = 10.dp, vertical = spacing.xxs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .clip(RoundedCornerShape(50))
                .background(statusColor),
        )
        Spacer(modifier = Modifier.width(spacing.xxs))
        Text(
            text = displayLabel,
            style = MWTypography.label,
            color = statusColor,
        )
    }
}

// ── 3. MWSessionCard ───────────────────────────────────────────────────────

@Composable
fun MWSessionCard(
    title: String,
    status: RunStatus,
    cwd: String,
    model: String,
    messageCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    MWGlassCard(
        modifier = modifier.fillMaxWidth(),
        onClick = onClick,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title.ifBlank { "Untitled Session" },
                style = MWTypography.subheading,
                color = colors.textPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(modifier = Modifier.width(spacing.xs))
            MWStatusPill(status = status)
        }
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = cwd,
            style = MWTypography.monoSmall,
            color = colors.textTertiary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(spacing.xxs))
        Row(
            horizontalArrangement = Arrangement.spacedBy(spacing.sm),
        ) {
            if (model.isNotBlank()) {
                Text(text = model, style = MWTypography.caption, color = colors.textSecondary)
            }
            if (messageCount > 0) {
                Text(text = "$messageCount msgs", style = MWTypography.caption, color = colors.textSecondary)
            }
        }
        Spacer(modifier = Modifier.height(spacing.xxs))
        Icon(
            imageVector = Icons.Default.ChevronRight,
            contentDescription = "View session details",
            tint = colors.textTertiary,
            modifier = Modifier.align(Alignment.End).size(spacing.md),
        )
    }
}

// ── 4. MWChatBubble ────────────────────────────────────────────────────────

@Composable
fun MWChatBubble(
    role: MessageRole,
    text: String,
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    thinking: String? = null,
    content: @Composable (() -> Unit)? = null,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    val isUser = role == MessageRole.User
    val bgColor = if (isUser) colors.accentPrimary.copy(alpha = 0.15f) else colors.bgSurface
    val textColor = if (isUser) colors.textPrimary else colors.textPrimary
    val alignment = if (isUser) Alignment.End else Alignment.Start
    val shape = RoundedCornerShape(
        topStart = radius.lg,
        topEnd = radius.lg,
        bottomStart = if (isUser) radius.lg else radius.sm,
        bottomEnd = if (isUser) radius.sm else radius.lg,
    )

    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = alignment,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(if (isUser) 0.85f else 0.95f)
                .clip(shape)
                .background(bgColor)
                .padding(spacing.sm),
        ) {
            if (!thinking.isNullOrBlank()) {
                var thinkingExpanded by remember { mutableStateOf(false) }
                Text(
                    text = "Thinking...",
                    style = MWTypography.label,
                    color = colors.accentCyan,
                    modifier = Modifier.clickable { thinkingExpanded = !thinkingExpanded },
                )
                AnimatedVisibility(visible = thinkingExpanded) {
                    Text(
                        text = thinking,
                        style = MWTypography.monoSmall,
                        color = colors.textTertiary,
                        modifier = Modifier.padding(top = spacing.xxs),
                    )
                }
                Spacer(modifier = Modifier.height(spacing.xxs))
            }

            if (text.isNotBlank()) {
                Text(
                    text = text,
                    style = MWTypography.body,
                    color = textColor,
                )
            }

            content?.invoke()

            if (isStreaming) {
                Spacer(modifier = Modifier.height(spacing.xxs))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(10.dp),
                        strokeWidth = 1.5.dp,
                        color = colors.accentCyan,
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "streaming...",
                        style = MWTypography.caption,
                        color = colors.textTertiary,
                    )
                }
            }
        }
    }
}

// ── 5. MWToolCallCard ──────────────────────────────────────────────────────

@Composable
fun MWToolCallCard(
    tool: ToolCallInfo,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius
    var expanded by remember { mutableStateOf(false) }

    val borderColor = when {
        tool.isError -> colors.statusError
        tool.isRunning -> colors.statusRunning
        else -> colors.glassBorder
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radius.md))
            .background(colors.bgElevated)
            .border(1.dp, borderColor, RoundedCornerShape(radius.md))
            .clickable { expanded = !expanded }
            .padding(spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val iconRotation by animateFloatAsState(
                targetValue = if (expanded) 90f else 0f,
                animationSpec = tween(durationMillis = 120),
                label = "chevron",
            )
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = "Expand tool call",
                tint = colors.textTertiary,
                modifier = Modifier
                    .size(14.dp)
                    .rotate(iconRotation),
            )
            Spacer(modifier = Modifier.width(spacing.xs))
            Text(
                text = tool.toolName,
                style = MWTypography.mono.copy(fontSize = 12.sp),
                color = colors.accentCyan,
            )
            Spacer(modifier = Modifier.weight(1f))
            if (tool.isRunning) {
                CircularProgressIndicator(
                    modifier = Modifier.size(spacing.sm),
                    strokeWidth = 1.5.dp,
                    color = colors.statusRunning,
                )
            } else if (tool.isError) {
                Icon(
                    imageVector = Icons.Default.ErrorOutline,
                    contentDescription = "Error",
                    tint = colors.statusError,
                    modifier = Modifier.size(14.dp),
                )
            }
        }

        if (tool.progress >= 0 && tool.isRunning) {
            Spacer(modifier = Modifier.height(6.dp))
            androidx.compose.material3.LinearProgressIndicator(
                progress = { tool.progress.toFloat().coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp)),
                color = colors.statusRunning,
                trackColor = colors.bgDeep,
            )
            if (tool.progressMessage.isNotBlank()) {
                Text(
                    text = tool.progressMessage,
                    style = MWTypography.caption,
                    color = colors.textTertiary,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }

        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(animationSpec = tween(180)),
            exit = shrinkVertically(animationSpec = tween(180)),
        ) {
            Column(modifier = Modifier.padding(top = spacing.xs)) {
                if (tool.input.isNotBlank()) {
                    Text(
                        text = "Input",
                        style = MWTypography.label,
                        color = colors.textSecondary,
                    )
                    Text(
                        text = tool.input,
                        style = MWTypography.monoSmall,
                        color = colors.textTertiary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp)
                            .clip(RoundedCornerShape(radius.sm))
                            .background(colors.bgDeep)
                            .padding(spacing.xs),
                    )
                }
                if (tool.output.isNotBlank()) {
                    Spacer(modifier = Modifier.height(spacing.xs))
                    Text(
                        text = "Output",
                        style = MWTypography.label,
                        color = colors.textSecondary,
                    )
                    Text(
                        text = tool.output,
                        style = MWTypography.monoSmall,
                        color = if (tool.isError) colors.statusError else colors.textTertiary,
                        maxLines = if (expanded) Int.MAX_VALUE else 4,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp)
                            .clip(RoundedCornerShape(radius.sm))
                            .background(colors.bgDeep)
                            .padding(spacing.xs),
                    )
                }
            }
        }
    }
}

// ── 6. MWApprovalCard ──────────────────────────────────────────────────────

@Composable
fun MWApprovalCard(
    toolName: String,
    description: String,
    options: List<String>,
    onApprove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(radius.lg))
            .background(colors.statusWarning.copy(alpha = 0.1f))
            .border(1.dp, colors.statusWarning.copy(alpha = 0.3f), RoundedCornerShape(radius.lg))
            .padding(spacing.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = "Warning",
                tint = colors.statusWarning,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(spacing.xs))
            Text(
                text = "Permission Required",
                style = MWTypography.subheading,
                color = colors.statusWarning,
            )
        }
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = toolName,
            style = MWTypography.mono,
            color = colors.accentCyan,
        )
        if (description.isNotBlank()) {
            Spacer(modifier = Modifier.height(spacing.xxs))
            Text(
                text = description,
                style = MWTypography.bodySmall,
                color = colors.textSecondary,
            )
        }
        Spacer(modifier = Modifier.height(spacing.sm))
        Row(
            horizontalArrangement = Arrangement.spacedBy(spacing.xs),
        ) {
            options.forEach { option ->
                Button(
                    onClick = { onApprove(option) },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (option == "allow" || option == "approve") {
                            colors.statusSuccess
                        } else {
                            colors.statusError
                        },
                    ),
                    shape = RoundedCornerShape(radius.md),
                ) {
                    Text(
                        text = option.replaceFirstChar { it.uppercase() },
                        style = MWTypography.buttonLabel,
                        color = colors.accentOnAccent,
                    )
                }
            }
        }
    }
}

// ── 7. MWDiffFileRow ───────────────────────────────────────────────────────

@Composable
fun MWDiffFileRow(
    filePath: String,
    status: String,
    additions: Int? = null,
    deletions: Int? = null,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    val clickableMod = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier

    val statusColor = when (status.lowercase()) {
        "added" -> colors.statusSuccess
        "deleted" -> colors.statusError
        "renamed" -> colors.accentCyan
        else -> colors.statusWarning
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(clickableMod)
            .clip(RoundedCornerShape(radius.sm))
            .background(colors.bgElevated)
            .padding(horizontal = spacing.sm, vertical = spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(spacing.xs)
                .background(statusColor, RoundedCornerShape(4.dp)),
        )
        Spacer(modifier = Modifier.width(spacing.xs))
        Text(
            text = filePath.substringAfterLast('/'),
            style = MWTypography.body,
            color = colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(modifier = Modifier.width(spacing.xs))
        if (additions != null && additions > 0) {
            Text(
                text = "+$additions",
                style = MWTypography.monoSmall,
                color = colors.statusSuccess,
            )
            Spacer(modifier = Modifier.width(spacing.xxs))
        }
        if (deletions != null && deletions > 0) {
            Text(
                text = "-$deletions",
                style = MWTypography.monoSmall,
                color = colors.statusError,
            )
        }
        if (onClick != null) {
            Spacer(modifier = Modifier.width(spacing.xxs))
            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = "View diff",
                tint = colors.textTertiary,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

// ── 8. MWInputBar ──────────────────────────────────────────────────────────

@Composable
fun MWInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Type a message...",
    enabled: Boolean = true,
    isLoading: Boolean = false,
    leadingContent: @Composable (() -> Unit)? = null,
    trailingContent: @Composable (() -> Unit)? = null,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, colors.glassBorder, RoundedCornerShape(radius.lg)),
        color = colors.bgElevated,
        shape = RoundedCornerShape(radius.lg),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = spacing.sm, vertical = spacing.xs),
            verticalAlignment = Alignment.Bottom,
        ) {
            leadingContent?.invoke()

            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 36.dp, max = 120.dp)
                    .animateContentSize(),
                textStyle = LocalTextStyle.current.copy(
                    color = colors.textPrimary,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                ),
                cursorBrush = SolidColor(colors.accentPrimary),
                decorationBox = { innerTextField ->
                    Box(
                        modifier = Modifier.padding(vertical = 6.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        if (value.isEmpty()) {
                            Text(
                                text = placeholder,
                                style = MWTypography.body,
                                color = colors.textTertiary,
                            )
                        }
                        innerTextField()
                    }
                },
            )

            Spacer(modifier = Modifier.width(spacing.xs))

            trailingContent?.invoke()

            IconButton(
                onClick = onSend,
                enabled = enabled && value.isNotBlank() && !isLoading,
                modifier = Modifier.size(36.dp),
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = colors.accentPrimary,
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.ChevronRight,
                        contentDescription = "Send",
                        tint = if (value.isNotBlank() && enabled) colors.accentPrimary else colors.textTertiary,
                    )
                }
            }
        }
    }
}

// ── 9. State composables ───────────────────────────────────────────────────

@Composable
fun MWEmptyState(
    title: String,
    subtitle: String = "",
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = title,
            style = MWTypography.subheading,
            color = colors.textPrimary,
        )
        if (subtitle.isNotBlank()) {
            Spacer(modifier = Modifier.height(spacing.xs))
            Text(
                text = subtitle,
                style = MWTypography.bodySmall,
                color = colors.textSecondary,
            )
        }
        action?.let {
            Spacer(modifier = Modifier.height(spacing.md))
            it()
        }
    }
}

@Composable
fun MWErrorState(
    message: String,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Default.ErrorOutline,
            contentDescription = "Error",
            tint = colors.statusError,
            modifier = Modifier.size(spacing.xxxxl),
        )
        Spacer(modifier = Modifier.height(spacing.md))
        Text(
            text = "Something went wrong",
            style = MWTypography.subheading,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = message,
            style = MWTypography.bodySmall,
            color = colors.textSecondary,
        )
        if (onRetry != null) {
            Spacer(modifier = Modifier.height(spacing.md))
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = colors.accentPrimary),
                shape = RoundedCornerShape(MWTheme.radius.md),
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "Retry",
                    modifier = Modifier.size(spacing.md),
                )
                Spacer(modifier = Modifier.width(spacing.xs))
                Text(text = "Retry", style = MWTypography.buttonLabel, color = colors.accentOnAccent)
            }
        }
    }
}

@Composable
fun MWLoadingState(
    message: String = "Loading...",
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(spacing.xxl),
            color = colors.accentPrimary,
            strokeWidth = 3.dp,
        )
        Spacer(modifier = Modifier.height(spacing.md))
        Text(
            text = message,
            style = MWTypography.body,
            color = colors.textSecondary,
        )
    }
}

@Composable
fun MWReconnectBanner(
    isReconnecting: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = if (isReconnecting) colors.statusWarning.copy(alpha = 0.1f) else colors.statusError.copy(alpha = 0.1f),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = spacing.md, vertical = spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isReconnecting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = colors.statusWarning,
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.ErrorOutline,
                        contentDescription = "Connection error",
                        tint = colors.statusError,
                        modifier = Modifier.size(14.dp),
                    )
                }
                Spacer(modifier = Modifier.width(spacing.xs))
                Text(
                    text = if (isReconnecting) "Reconnecting..." else "Connection lost",
                    style = MWTypography.bodySmall,
                    color = if (isReconnecting) colors.statusWarning else colors.statusError,
                )
            }
            if (!isReconnecting) {
                Text(
                    text = "Retry",
                    style = MWTypography.label,
                    color = colors.accentPrimary,
                    modifier = Modifier.clickable(onClick = onRetry),
                )
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

private fun formatTokens(tokens: Long): String = when {
    tokens >= 1_000_000 -> "${"%.1f".format(tokens / 1_000_000.0)}M tokens"
    tokens >= 1_000 -> "${"%.1f".format(tokens / 1_000.0)}K tokens"
    else -> "$tokens tokens"
}
