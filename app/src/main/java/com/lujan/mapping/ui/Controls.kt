package com.lujan.mapping.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lujan.mapping.ui.theme.LujanColors
import java.util.Locale

/** Labeled slider whose drag is one undo step: begin on first change, commit on release. */
@Composable
fun PropSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    onChange: (Float) -> Unit,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
    format: (Float) -> String = { String.format(Locale.US, "%.2f", it) },
    enabled: Boolean = true,
) {
    Column(modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim, modifier = Modifier.weight(1f))
            Text(format(value), style = MaterialTheme.typography.bodySmall)
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            onValueChangeFinished = onFinished,
            valueRange = range,
            enabled = enabled,
            modifier = Modifier.height(32.dp),
            colors = SliderDefaults.colors(
                thumbColor = LujanColors.Accent,
                activeTrackColor = LujanColors.Accent,
                inactiveTrackColor = LujanColors.Border,
            ),
        )
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier.padding(top = 12.dp, bottom = 4.dp),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.sp,
        color = LujanColors.Accent,
    )
}

@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().height(44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> ChoiceChips(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit, enabled: (T) -> Boolean = { true }) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        options.forEach { opt ->
            FilterChip(
                selected = opt == selected,
                onClick = { onSelect(opt) },
                label = { Text(label(opt), maxLines = 1) },
                enabled = enabled(opt),
            )
        }
    }
}

val ColorPresets: List<Long> = listOf(
    0xFFFFFFFF, 0xFFFF2D2D, 0xFF2DFF5A, 0xFF2D6BFF, 0xFFFFE52D, 0xFF2DF5FF, 0xFFFF2DF0, 0xFFFF8A00, 0xFF000000,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ColorSwatches(selected: Long, onSelect: (Long) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ColorPresets.forEach { c ->
            val isSel = (c and 0xFFFFFFFF) == (selected and 0xFFFFFFFF)
            Spacer(
                Modifier
                    .size(34.dp)
                    .background(Color(c.toInt()), CircleShape)
                    .border(if (isSel) 3.dp else 1.dp, if (isSel) LujanColors.Accent else LujanColors.Border, CircleShape)
                    .clickable { onSelect(c) }
            )
        }
    }
}

@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier
            .background(color.copy(alpha = 0.18f), RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 2.dp),
        color = color,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 1,
    )
}

@Composable
fun HSpace(w: Int) = Spacer(Modifier.width(w.dp))

@Composable
fun VSpace(h: Int) = Spacer(Modifier.height(h.dp))

fun formatTime(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return String.format(Locale.US, "%d:%02d", s / 60, s % 60)
}
