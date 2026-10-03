package com.lujan.mapping.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.render.RenderEngine
import com.lujan.mapping.ui.theme.LujanColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.util.Locale

/**
 * Bottom transport: global Play/Pause/Stop/Sync for all videos, plus the timeline,
 * loop, mute and volume of the selected video layer.
 */
@Composable
fun TransportBar(
    vm: EditorViewModel,
    selected: Layer?,
    playing: Boolean,
    stats: RenderEngine.Stats,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(64.dp)
            .background(LujanColors.Panel)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilledIconButton(
            onClick = { vm.media.togglePlay() },
            modifier = Modifier.size(52.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = LujanColors.Accent),
        ) {
            Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (playing) "Pausa" else "Reproducir", tint = androidx.compose.ui.graphics.Color.Black)
        }
        IconButton(onClick = { vm.media.stop() }) { Icon(Icons.Filled.Stop, "Detener") }
        IconButton(onClick = { vm.media.restartAll() }) { Icon(Icons.Filled.Replay, "Reiniciar todos sincronizados") }

        val video = selected?.takeIf { it.content.kind == ContentKind.VIDEO }
        if (video != null) {
            VideoTimeline(vm, video, Modifier.weight(1f))
        } else {
            Text(
                "Play/Pausa controla todos los videos · selecciona una capa de video para ver su línea de tiempo",
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                style = MaterialTheme.typography.labelSmall,
                color = LujanColors.TextDim,
                maxLines = 2,
            )
        }
        Text(
            String.format(Locale.US, "%dx%d · %.0f fps", stats.outputWidth, stats.outputHeight, stats.fps),
            style = MaterialTheme.typography.labelSmall,
            color = LujanColors.TextDim,
            modifier = Modifier.padding(start = 8.dp),
        )
    }
}

@Composable
private fun VideoTimeline(vm: EditorViewModel, layer: Layer, modifier: Modifier) {
    var position by remember(layer.id) { mutableLongStateOf(0L) }
    var duration by remember(layer.id) { mutableLongStateOf(0L) }
    var dragging by remember(layer.id) { mutableStateOf(false) }
    var dragValue by remember(layer.id) { mutableFloatStateOf(0f) }

    LaunchedEffect(layer.id) {
        while (isActive) {
            if (!dragging) {
                position = vm.media.positionMs(layer.id)
                duration = vm.media.durationMs(layer.id)
            }
            delay(200)
        }
    }

    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        val shown = if (dragging) dragValue.toLong() else position
        Text(formatTime(shown), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 4.dp))
        Slider(
            value = if (duration > 0) (if (dragging) dragValue else position.toFloat()).coerceIn(0f, duration.toFloat()) else 0f,
            onValueChange = { dragging = true; dragValue = it },
            onValueChangeFinished = {
                vm.media.seek(layer.id, dragValue.toLong())
                position = dragValue.toLong()
                dragging = false
            },
            valueRange = 0f..(if (duration > 0) duration.toFloat() else 1f),
            enabled = duration > 0,
            modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
            colors = SliderDefaults.colors(thumbColor = LujanColors.Accent, activeTrackColor = LujanColors.Accent,
                inactiveTrackColor = LujanColors.Border),
        )
        Text(formatTime(duration), style = MaterialTheme.typography.labelSmall)
        val pb = layer.playback
        IconButton(onClick = { vm.updateLayer(layer.id) { it.copy(playback = it.playback.copy(loop = !it.playback.loop)) } }) {
            Icon(Icons.Filled.Repeat, "Bucle", tint = if (pb.loop) LujanColors.Accent else LujanColors.TextDim)
        }
        IconButton(onClick = { vm.updateLayer(layer.id) { it.copy(playback = it.playback.copy(muted = !it.playback.muted)) } }) {
            Icon(if (pb.muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp, "Silenciar",
                tint = if (pb.muted) LujanColors.Danger else MaterialTheme.colorScheme.onSurface)
        }
        Text(String.format(Locale.US, "%.2gx", pb.speed), style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
    }
}
