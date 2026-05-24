package com.miwarp.mobile.feature.sessions

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.miwarp.mobile.design.MWSessionCard
import com.miwarp.mobile.model.MiWarpRun

@Composable
fun SessionCard(
    run: MiWarpRun,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    MWSessionCard(
        title = run.displayTitle,
        status = run.status,
        cwd = run.shortCwd,
        model = run.model,
        messageCount = run.messageCount,
        onClick = onClick,
        modifier = modifier,
    )
}
