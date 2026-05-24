package com.miwarp.mobile.feature.artifacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWEmptyState
import com.miwarp.mobile.design.MWErrorState
import com.miwarp.mobile.design.MWLoadingState
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.RunArtifacts
import com.miwarp.mobile.rpc.MiWarpRpcClient

@Composable
fun ArtifactsScreen(
    runId: String,
    rpcClient: MiWarpRpcClient,
    onFileClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    var artifacts by remember { mutableStateOf<RunArtifacts?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(runId) {
        try {
            artifacts = rpcClient.getRunArtifacts(runId)
        } catch (e: Exception) {
            error = e.message ?: "Failed to load artifacts"
        } finally {
            isLoading = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.md),
    ) {
        Text(
            text = "Artifacts",
            style = MWTypography.heading,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = "Files generated or modified in this session.",
            style = MWTypography.body,
            color = colors.textSecondary,
        )
        Spacer(modifier = Modifier.height(spacing.md))

        when {
            isLoading -> MWLoadingState(message = "Loading artifacts...")
            error != null -> MWErrorState(
                message = error!!,
                onRetry = {
                    error = null
                    isLoading = true
                },
            )
            else -> {
                val files = artifacts?.filesChanged
                val diffSummary = artifacts?.diffSummary
                val commands = artifacts?.commands
                val cost = artifacts?.costEstimate

                if (files.isNullOrEmpty() && diffSummary.isNullOrEmpty() && commands.isNullOrEmpty()) {
                    MWEmptyState(
                        title = "No Artifacts",
                        subtitle = "No files were generated in this session.",
                    )
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(vertical = spacing.sm),
                        verticalArrangement = Arrangement.spacedBy(spacing.xs),
                    ) {
                        if (!files.isNullOrEmpty()) {
                            items(files, key = { it }) { filePath ->
                                ListItem(
                                    headlineContent = {
                                        Text(
                                            text = filePath,
                                            style = MWTypography.monoCaption,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    },
                                    leadingContent = {
                                        Icon(
                                            imageVector = Icons.Outlined.Description,
                                            contentDescription = null,
                                            tint = colors.accentCyan,
                                        )
                                    },
                                    modifier = Modifier.clickable { onFileClick(filePath) },
                                )
                            }
                        }
                        if (!diffSummary.isNullOrEmpty()) {
                            item {
                                Text(
                                    text = "Diff Summary",
                                    style = MWTypography.subheading,
                                    color = colors.textPrimary,
                                    modifier = Modifier.padding(top = spacing.md),
                                )
                                Text(
                                    text = diffSummary,
                                    style = MWTypography.monoSmall,
                                    color = colors.textSecondary,
                                )
                            }
                        }
                        if (!commands.isNullOrEmpty()) {
                            item {
                                Text(
                                    text = "Commands",
                                    style = MWTypography.subheading,
                                    color = colors.textPrimary,
                                    modifier = Modifier.padding(top = spacing.md),
                                )
                                commands.forEach { cmd ->
                                    Text(
                                        text = cmd,
                                        style = MWTypography.monoSmall,
                                        color = colors.textTertiary,
                                    )
                                }
                            }
                        }
                        if (cost != null && cost > 0) {
                            item {
                                Text(
                                    text = "Estimated cost: $${String.format("%.4f", cost)}",
                                    style = MWTypography.caption,
                                    color = colors.textTertiary,
                                    modifier = Modifier.padding(top = spacing.md),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
