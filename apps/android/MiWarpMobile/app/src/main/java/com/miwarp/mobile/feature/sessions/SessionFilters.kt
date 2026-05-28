package com.miwarp.mobile.feature.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.miwarp.mobile.design.MWTheme
import com.miwarp.mobile.design.MWTypography

enum class SessionFilter(val label: String) {
    All("All"),
    Active("Active"),
    Completed("Done"),
    Failed("Failed"),
}

@Composable
fun SessionFilters(
    activeFilter: SessionFilter,
    onFilterChange: (SessionFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = MWTheme.colors
    val spacing = MWTheme.spacing
    val radius = MWTheme.radius

    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(spacing.xs),
    ) {
        SessionFilter.entries.forEach { filter ->
            val isActive = filter == activeFilter
            Text(
                text = filter.label,
                style = MWTypography.label,
                color = if (isActive) colors.textPrimary else colors.textTertiary,
                modifier = Modifier
                    .clip(RoundedCornerShape(radius.sm))
                    .background(if (isActive) colors.accentPrimary.copy(alpha = 0.15f) else colors.bgSurface)
                    .clickable { onFilterChange(filter) }
                    .padding(horizontal = spacing.sm, vertical = 6.dp),
            )
        }
    }
}
