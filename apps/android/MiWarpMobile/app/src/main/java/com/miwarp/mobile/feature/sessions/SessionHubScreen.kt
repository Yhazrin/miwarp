package com.miwarp.mobile.feature.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWEmptyState
import com.miwarp.mobile.design.MWErrorState
import com.miwarp.mobile.design.MWLoadingState
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography
import com.miwarp.mobile.model.MiWarpRun
import com.miwarp.mobile.model.RunStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionHubScreen(
    runs: List<MiWarpRun>,
    isLoading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onSessionClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing

    var activeFilter by remember { mutableStateOf(SessionFilter.All) }

    val filteredRuns = remember(runs, activeFilter) {
        when (activeFilter) {
            SessionFilter.All -> runs
            SessionFilter.Active -> runs.filter {
                it.status == RunStatus.Running || it.status == RunStatus.Idle || it.status == RunStatus.Pending || it.status == RunStatus.WaitingApproval
            }
            SessionFilter.Completed -> runs.filter { it.status == RunStatus.Completed }
            SessionFilter.Failed -> runs.filter { it.status == RunStatus.Failed || it.status == RunStatus.Stopped }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(top = spacing.md),
    ) {
        Column(modifier = Modifier.padding(horizontal = spacing.md)) {
            Text(
                text = "Sessions",
                style = MWTypography.heading,
                color = colors.textPrimary,
            )
            Spacer(modifier = Modifier.height(spacing.sm))
            SessionFilters(
                activeFilter = activeFilter,
                onFilterChange = { activeFilter = it },
            )
        }

        Spacer(modifier = Modifier.height(spacing.md))

        when {
            isLoading && runs.isEmpty() -> {
                MWLoadingState(message = "Loading sessions...")
            }
            error != null && runs.isEmpty() -> {
                MWErrorState(message = error, onRetry = onRefresh)
            }
            else -> {
                PullToRefreshBox(
                    isRefreshing = isLoading,
                    onRefresh = onRefresh,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (filteredRuns.isEmpty()) {
                        MWEmptyState(
                            title = when (activeFilter) {
                                SessionFilter.All -> "No Sessions"
                                SessionFilter.Active -> "No Active Sessions"
                                SessionFilter.Completed -> "No Completed Sessions"
                                SessionFilter.Failed -> "No Failed Sessions"
                            },
                            subtitle = "Sessions will appear here when you start using MiWarp.",
                        )
                    } else {
                        LazyColumn(
                            contentPadding = PaddingValues(horizontal = spacing.md, vertical = spacing.sm),
                            verticalArrangement = Arrangement.spacedBy(spacing.sm),
                        ) {
                            items(filteredRuns, key = { it.id }) { run ->
                                SessionCard(
                                    run = run,
                                    onClick = { onSessionClick(run.id) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
