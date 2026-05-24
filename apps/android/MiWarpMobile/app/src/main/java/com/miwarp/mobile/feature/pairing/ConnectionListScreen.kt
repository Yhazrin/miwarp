package com.miwarp.mobile.feature.pairing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWStatusPill
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.design.MWEmptyState
import com.miwarp.mobile.model.MiWarpConnection
import com.miwarp.mobile.model.RunStatus

@Composable
fun ConnectionListScreen(
    connections: List<MiWarpConnection>,
    activeConnectionId: String?,
    onSelect: (MiWarpConnection) -> Unit,
    onDelete: (String) -> Unit,
    onAddNew: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Saved Connections",
                style = MWTypography.heading,
                color = colors.textPrimary,
            )
            Button(
                onClick = onAddNew,
                colors = ButtonDefaults.buttonColors(containerColor = colors.accentPrimary),
                shape = RoundedCornerShape(radius.md),
            ) {
                Text(text = "Add New", style = MWTypography.buttonLabel, color = Color.White)
            }
        }

        Spacer(modifier = Modifier.height(spacing.md))

        if (connections.isEmpty()) {
            MWEmptyState(
                title = "No Saved Connections",
                subtitle = "Add a connection to get started.",
            )
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(spacing.sm),
            ) {
                items(connections, key = { it.id }) { connection ->
                    val isActive = connection.id == activeConnectionId
                    MWGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { onSelect(connection) },
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = connection.displayLabel,
                                    style = MWTypography.subheading,
                                    color = colors.textPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "${connection.host}:${connection.port}",
                                    style = MWTypography.monoSmall,
                                    color = colors.textTertiary,
                                )
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            if (isActive) {
                                MWStatusPill(status = RunStatus.Running, label = "active")
                            }
                            IconButton(
                                onClick = { onDelete(connection.id) },
                                modifier = Modifier.size(32.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Delete,
                                    contentDescription = "Delete",
                                    tint = colors.textTertiary,
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
