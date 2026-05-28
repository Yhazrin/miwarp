package com.miwarp.mobile.feature.artifacts

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow

import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWLoadingState
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.GitDiff
import com.miwarp.mobile.rpc.MiWarpRpcClient

@Composable
fun DiffPreviewScreen(
    runId: String,
    filePath: String,
    cwd: String,
    rpcClient: MiWarpRpcClient,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    var diff by remember { mutableStateOf<GitDiff?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(runId, filePath, cwd) {
        if (cwd.isBlank()) {
            error = "Working directory not available"
            isLoading = false
            return@LaunchedEffect
        }
        try {
            diff = rpcClient.getGitDiff(cwd, file = filePath)
        } catch (e: Exception) {
            error = e.message ?: "Failed to load diff"
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
            text = filePath.substringAfterLast('/'),
            style = MWTypography.heading,
            color = colors.textPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = filePath,
            style = MWTypography.monoSmall,
            color = colors.textTertiary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(modifier = Modifier.height(spacing.md))

        when {
            isLoading -> MWLoadingState(message = "Loading diff...")
            error != null -> {
                Text(text = error!!, style = MWTypography.body, color = colors.statusError)
            }
            diff == null || diff!!.diff.isBlank() -> {
                Text(text = "No diff available for this file.", style = MWTypography.body, color = colors.textSecondary)
            }
            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    MWGlassCard {
                        Text(
                            text = "Diff",
                            style = MWTypography.label,
                            color = colors.accentCyan,
                        )
                        Spacer(modifier = Modifier.height(spacing.xs))
                        Text(
                            text = diff!!.diff,
                            style = MWTypography.monoSmall,
                            color = colors.textPrimary,
                            modifier = Modifier
                                .fillMaxSize()
                                .horizontalScroll(rememberScrollState()),
                        )
                    }
                }
            }
        }
    }
}
