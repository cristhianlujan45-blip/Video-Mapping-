package com.lujan.mapping.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object LujanColors {
    val Background = Color(0xFF0E0F12)
    val Panel = Color(0xFF16181D)
    val PanelHigh = Color(0xFF1F2229)
    val Border = Color(0xFF2A2E37)
    val Accent = Color(0xFF00E5FF)
    val Projection = Color(0xFFFF6D00)
    val Danger = Color(0xFFFF4D5E)
    val TextDim = Color(0xFF9AA0AC)
    val Handle = Color(0xFFFF6D00)
    val Outline = Color(0xFF00E5FF)
    val MaskOutline = Color(0xFFFFD54F)
}

private val scheme = darkColorScheme(
    primary = LujanColors.Accent,
    onPrimary = Color.Black,
    secondary = LujanColors.Projection,
    onSecondary = Color.Black,
    background = LujanColors.Background,
    onBackground = Color(0xFFE8EAED),
    surface = LujanColors.Panel,
    onSurface = Color(0xFFE8EAED),
    surfaceVariant = LujanColors.PanelHigh,
    onSurfaceVariant = LujanColors.TextDim,
    surfaceContainer = LujanColors.Panel,
    surfaceContainerHigh = LujanColors.PanelHigh,
    surfaceContainerHighest = LujanColors.PanelHigh,
    outline = LujanColors.Border,
    error = LujanColors.Danger,
)

@Composable
fun LujanTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = Typography(), content = content)
}
