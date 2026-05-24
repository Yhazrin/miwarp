package com.miwarp.mobile.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.miwarp.mobile.design.MWApprovalCard

@Composable
fun ApprovalCard(
    toolName: String,
    description: String,
    options: List<String>,
    onApprove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    MWApprovalCard(
        toolName = toolName,
        description = description,
        options = options,
        onApprove = onApprove,
        modifier = modifier,
    )
}
