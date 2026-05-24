package com.miwarp.mobile.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWStatusPill
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.ConnectionState
import com.miwarp.mobile.model.MiWarpConnection
import com.miwarp.mobile.model.RunStatus

@Composable
fun SettingsScreen(
    activeConnection: MiWarpConnection?,
    connectionState: ConnectionState,
    isDarkMode: Boolean,
    onToggleTheme: () -> Unit,
    onDisconnect: () -> Unit,
    onChangeConnection: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(spacing.md),
    ) {
        Text(
            text = "Settings",
            style = MWTypography.heading,
            color = colors.textPrimary,
        )

        Spacer(modifier = Modifier.height(spacing.lg))

        // Connection section
        MWGlassCard {
            Text(
                text = "Connection",
                style = MWTypography.subheading,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(spacing.md))

            if (activeConnection != null) {
                Text(
                    text = activeConnection.displayLabel,
                    style = MWTypography.body,
                    color = colors.textPrimary,
                )
                Spacer(modifier = Modifier.height(spacing.xxs))
                Text(
                    text = "${activeConnection.host}:${activeConnection.port}",
                    style = MWTypography.monoSmall,
                    color = colors.textTertiary,
                )
                Spacer(modifier = Modifier.height(spacing.sm))
                val connStatusLabel = when (connectionState) {
                    ConnectionState.Connected -> "Connected"
                    ConnectionState.Connecting -> "Connecting..."
                    ConnectionState.Reconnecting -> "Reconnecting..."
                    ConnectionState.Error -> "Error"
                    ConnectionState.Disconnected -> "Disconnected"
                }
                val connStatusRun = when (connectionState) {
                    ConnectionState.Connected -> RunStatus.Completed
                    ConnectionState.Connecting, ConnectionState.Reconnecting -> RunStatus.WaitingInput
                    ConnectionState.Error -> RunStatus.Failed
                    ConnectionState.Disconnected -> RunStatus.Idle
                }
                MWStatusPill(status = connStatusRun, label = connStatusLabel)
            } else {
                Text(
                    text = "Not connected",
                    style = MWTypography.body,
                    color = colors.textTertiary,
                )
            }

            Spacer(modifier = Modifier.height(spacing.md))

            Row(
                horizontalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                Button(
                    onClick = onChangeConnection,
                    colors = ButtonDefaults.buttonColors(containerColor = colors.accentPrimary),
                    shape = RoundedCornerShape(radius.md),
                    modifier = Modifier.weight(1f),
                ) {
                    Text(text = "Change Connection", style = MWTypography.buttonLabel, color = Color.White)
                }

                if (activeConnection != null) {
                    Button(
                        onClick = onDisconnect,
                        colors = ButtonDefaults.buttonColors(containerColor = colors.statusError),
                        shape = RoundedCornerShape(radius.md),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Logout,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(spacing.lg))

        // Appearance section
        MWGlassCard {
            Text(
                text = "Appearance",
                style = MWTypography.subheading,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(spacing.md))

            SettingsRow(
                icon = if (isDarkMode) Icons.Default.DarkMode else Icons.Default.LightMode,
                label = "Theme",
                value = if (isDarkMode) "Dark" else "Light",
                onClick = onToggleTheme,
            )
        }

        Spacer(modifier = Modifier.height(spacing.lg))

        // App info
        MWGlassCard {
            Text(
                text = "About",
                style = MWTypography.subheading,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(spacing.sm))
            Text(
                text = "MiWarp Mobile",
                style = MWTypography.body,
                color = colors.textPrimary,
            )
            Text(
                text = "Version 1.0.0",
                style = MWTypography.caption,
                color = colors.textTertiary,
            )
            Spacer(modifier = Modifier.height(spacing.xs))
            Text(
                text = "A mobile companion for MiWarp Desktop. Connect to your AI coding sessions from anywhere.",
                style = MWTypography.bodySmall,
                color = colors.textSecondary,
            )
        }
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.sm),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = colors.textSecondary,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = label,
                style = MWTypography.body,
                color = colors.textPrimary,
            )
        }
        Text(
            text = value,
            style = MWTypography.body,
            color = colors.accentPrimary,
            modifier = Modifier.padding(start = spacing.sm),
        )
    }
}
