package com.miwarp.mobile.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.miwarp.mobile.design.MWToolCallCard
import com.miwarp.mobile.model.ToolCallInfo

@Composable
fun ToolCallCard(
    tool: ToolCallInfo,
    modifier: Modifier = Modifier,
) {
    MWToolCallCard(tool = tool, modifier = modifier)
}
