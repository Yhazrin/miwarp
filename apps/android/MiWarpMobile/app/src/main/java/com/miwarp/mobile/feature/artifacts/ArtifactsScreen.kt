package com.miwarp.mobile.feature.artifacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWDiffFileRow
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
            artifacts == null || artifacts!!.files.isEmpty() -> MWEmptyState(
                title = "No Artifacts",
                subtitle = "No files were generated in this session.",
            )
            else -> {
                LazyColumn(
                    contentPadding = PaddingValues(vertical = spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(spacing.xs),
                ) {
                    items(artifacts!!.files, key = { it.path }) { file ->
                        MWDiffFileRow(
                            filePath = file.path,
                            language = file.language.ifBlank { "text" },
                            onClick = { onFileClick(file.path) },
                        )
                    }
                }
            }
        }
    }
}
