package com.miwarp.mobile.feature.chat

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

import com.miwarp.mobile.design.MWGlassCard
import com.miwarp.mobile.design.MWLoadingState
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.rpc.MiWarpRpcClient

@Composable
fun RawEventScreen(
    runId: String,
    rpcClient: MiWarpRpcClient,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    var events by remember { mutableStateOf<List<BusEvent>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(runId) {
        try {
            events = rpcClient.getBusEvents(runId)
        } catch (_: Exception) { } finally {
            isLoading = false
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(spacing.md),
    ) {
        Text(
            text = "Raw Events",
            style = MWTypography.heading,
            color = colors.textPrimary,
        )
        Spacer(modifier = Modifier.height(spacing.xs))
        Text(
            text = "Run: ${runId.take(12)}...",
            style = MWTypography.monoSmall,
            color = colors.textTertiary,
        )
        Spacer(modifier = Modifier.height(spacing.md))

        if (isLoading) {
            MWLoadingState(message = "Loading events...")
        } else {
            LazyColumn(
                contentPadding = PaddingValues(vertical = spacing.sm),
                verticalArrangement = Arrangement.spacedBy(spacing.xs),
            ) {
                items(events, key = { it.seq }) { event ->
                    MWGlassCard {
                        Text(
                            text = "::${event::class.simpleName}",
                            style = MWTypography.mono,
                            color = colors.accentCyan,
                        )
                        Text(
                            text = "seq=${event.seq}",
                            style = MWTypography.monoSmall,
                            color = colors.textTertiary,
                        )
                    }
                }
            }
        }
    }
}
