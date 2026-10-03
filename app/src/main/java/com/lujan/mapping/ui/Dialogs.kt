package com.lujan.mapping.ui

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.lujan.mapping.core.model.GridPattern
import com.lujan.mapping.core.model.OutputTarget
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.core.model.ScaleMode
import com.lujan.mapping.display.ExternalDisplayMonitor
import com.lujan.mapping.render.RenderEngine
import com.lujan.mapping.ui.theme.LujanColors
import kotlin.math.roundToInt

@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = true,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = { onConfirm(); onDismiss() }) {
                Text(confirmLabel, color = if (destructive) LujanColors.Danger else LujanColors.Accent)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
fun RenameDialog(initial: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Renombrar capa") },
        text = { OutlinedTextField(value = text, onValueChange = { text = it.take(60) }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(text); onDismiss() }, enabled = text.isNotBlank()) { Text("Aceptar") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

private data class Resolution(val w: Int, val h: Int, val label: String)

@Composable
fun OutputSettingsDialog(
    vm: EditorViewModel,
    project: Project,
    displays: List<ExternalDisplayMonitor.ExternalDisplay>,
    glInfo: RenderEngine.GlInfo?,
    onDismiss: () -> Unit,
) {
    val out = project.output
    val grid = project.grid
    val maxTex = glInfo?.maxTextureSize ?: 4096
    val presets = buildList {
        add(Resolution(1280, 720, "720p"))
        add(Resolution(1920, 1080, "1080p"))
        add(Resolution(2560, 1440, "1440p"))
        add(Resolution(3840, 2160, "4K"))
        add(Resolution(1024, 768, "XGA 4:3"))
        add(Resolution(1280, 800, "WXGA 16:10"))
        displays.firstOrNull()?.let { add(Resolution(it.width, it.height, "Nativa ${it.width}x${it.height}")) }
    }.distinctBy { it.w to it.h }
    val current = presets.firstOrNull { it.w == out.width && it.h == out.height }
        ?: Resolution(out.width, out.height, "${out.width}x${out.height}")

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } },
        title = { Text("Salida y calibración") },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                SectionTitle("Pantalla externa")
                if (displays.isEmpty()) {
                    Text("No se detecta ninguna pantalla externa compatible (HDMI / USB-C / Miracast).\n" +
                        "Para Chromecast usa la duplicación de pantalla de Android y el destino «Pantalla interna».",
                        style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
                } else displays.forEach {
                    Text("✓ ${it.summary}", style = MaterialTheme.typography.bodySmall, color = LujanColors.Accent)
                }

                SectionTitle("Destino de la proyección")
                ChoiceChips(OutputTarget.entries, out.target, { it.label }, { t -> vm.setOutput(out.copy(target = t)) })

                SectionTitle("Resolución de salida")
                ChoiceChips(presets + (if (current in presets) emptyList() else listOf(current)), current, { it.label },
                    { r -> vm.setOutput(out.copy(width = r.w, height = r.h)) },
                    enabled = { it.w <= maxTex && it.h <= maxTex })
                Text("Independiente de la interfaz. Usa la resolución nativa del proyector para máxima nitidez. " +
                    "4K multiplica el trabajo de la GPU ×4 respecto a 1080p.",
                    style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)

                SectionTitle("Fotogramas por segundo")
                ChoiceChips(listOf(30, 60), out.fpsLimit, { "$it fps" }, { f -> vm.setOutput(out.copy(fpsLimit = f)) })

                SectionTitle("Escalado en la pantalla externa")
                ChoiceChips(ScaleMode.entries, out.scaleMode, { it.label }, { m -> vm.setOutput(out.copy(scaleMode = m)) })

                SectionTitle("Cuadrícula de calibración")
                SwitchRow("Mostrar cuadrícula", grid.enabled, { vm.setGrid(grid.copy(enabled = it)) })
                ChoiceChips(GridPattern.entries, grid.pattern, { it.label }, { p -> vm.setGrid(grid.copy(pattern = p)) })
                PropSlider("Divisiones", grid.divisions.toFloat(), 2f..64f, { vm.setGrid(grid.copy(divisions = it.roundToInt())) }, {},
                    format = { it.roundToInt().toString() })
                PropSlider("Grosor de línea", grid.thickness, 1f..12f, { vm.setGrid(grid.copy(thickness = it)) }, {},
                    format = { "${it.roundToInt()} px" })
                PropSlider("Opacidad", grid.opacity, 0.1f..1f, { vm.setGrid(grid.copy(opacity = it)) }, {},
                    format = { "${(it * 100).roundToInt()} %" })
                ColorSwatches(grid.colorArgb) { c -> vm.setGrid(grid.copy(colorArgb = c)) }
                SwitchRow("Mostrar contenido bajo la cuadrícula", grid.showContent, { vm.setGrid(grid.copy(showContent = it)) })
            }
        },
    )
}

@Composable
fun MissingFilesDialog(
    files: List<Pair<String, String>>,
    onLocate: (String) -> Unit,
    onSearchFolder: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Buscar archivos perdidos") },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text("Estos archivos se movieron, se borraron o perdieron el permiso de acceso. " +
                    "Las superficies se conservan (se muestran con un patrón rojo).",
                    style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
                VSpace(8)
                OutlinedButton(onClick = onSearchFolder, modifier = Modifier.fillMaxWidth()) {
                    Text("Buscar todos en una carpeta…")
                }
                files.forEach { (uri, name) ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { onLocate(uri) }) { Text("Localizar…") }
                    }
                }
                if (files.isEmpty()) Text("No hay archivos perdidos ✓", color = LujanColors.Accent)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } },
    )
}

@Composable
fun NoExternalDisplayDialog(onUseInternal: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("No hay pantalla externa") },
        text = {
            Text("No se detectó un proyector conectado como pantalla independiente.\n\n" +
                "• HDMI / USB-C: comprueba el adaptador y que tu teléfono admita salida de video (DisplayPort Alt Mode).\n" +
                "• Chromecast / duplicación: la proyección se mostrará a pantalla completa en el teléfono y Android la duplicará.\n\n" +
                "¿Proyectar en la pantalla interna?")
        },
        confirmButton = { TextButton(onClick = { onUseInternal(); onDismiss() }) { Text("Usar pantalla interna") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

/** Hardware report: what this device can really do for mapping. */
@Composable
fun DiagnosticsDialog(
    glInfo: RenderEngine.GlInfo?,
    stats: RenderEngine.Stats,
    displays: List<ExternalDisplayMonitor.ExternalDisplay>,
    onDismiss: () -> Unit,
) {
    val decoders = remember { decoderReport() }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } },
        title = { Text("Compatibilidad del dispositivo") },
        text = {
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
                SectionTitle("Dispositivo")
                Text("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                    style = MaterialTheme.typography.bodySmall)

                SectionTitle("GPU")
                if (glInfo == null) Text("OpenGL ES no inicializado", color = LujanColors.Danger)
                else {
                    Text("${glInfo.renderer} (${glInfo.vendor})", style = MaterialTheme.typography.bodySmall)
                    Text("${glInfo.version} · contexto ES ${glInfo.contextVersion}", style = MaterialTheme.typography.bodySmall)
                    Text("Textura máx.: ${glInfo.maxTextureSize}px " +
                        if (glInfo.maxTextureSize >= 4096) "(4K posible)" else "(4K no disponible)", style = MaterialTheme.typography.bodySmall)
                    Text(if (glInfo.externalOes) "✓ Video directo a GPU (OES_EGL_image_external)" else "✗ Sin textura externa: video no soportado",
                        style = MaterialTheme.typography.bodySmall, color = if (glInfo.externalOes) LujanColors.Accent else LujanColors.Danger)
                }
                Text("Render: ${stats.fps.roundToInt()} fps · ${"%.1f".format(stats.frameMs)} ms/fotograma (CPU+GPU envío)",
                    style = MaterialTheme.typography.bodySmall)

                SectionTitle("Pantallas externas")
                if (displays.isEmpty()) Text("Ninguna detectada ahora mismo. Conecta el adaptador HDMI/USB-C y vuelve a abrir.",
                    style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
                displays.forEach { d ->
                    Text("✓ ${d.summary}${if (d.secure) " · segura" else ""}", style = MaterialTheme.typography.bodySmall, color = LujanColors.Accent)
                    Text("Modos: ${d.supportedModes.joinToString()}", style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
                }

                SectionTitle("Decodificadores de video por hardware")
                decoders.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text("Es el límite real de videos simultáneos (cada superficie con video usa un decodificador).",
                    style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)

                SectionTitle("Notas")
                Text("• Chromecast no se expone como pantalla independiente a las apps: usa duplicación + destino «Pantalla interna».\n" +
                    "• ARCore no se usa en esta versión: la calibración es manual (esquinas + cuadrícula), que funciona en todos los dispositivos.",
                    style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
            }
        },
    )
}

private fun decoderReport(): List<String> {
    val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
    val mimes = listOf(
        MediaFormat.MIMETYPE_VIDEO_AVC to "H.264",
        MediaFormat.MIMETYPE_VIDEO_HEVC to "H.265/HEVC",
        MediaFormat.MIMETYPE_VIDEO_VP9 to "VP9 (WebM)",
        MediaFormat.MIMETYPE_VIDEO_AV1 to "AV1",
    )
    return mimes.map { (mime, label) ->
        val infos = list.codecInfos.filter { !it.isEncoder && it.supportedTypes.any { t -> t.equals(mime, ignoreCase = true) } }
        val hw = infos.filter { isHardware(it) }
        val best = (hw.ifEmpty { infos }).firstOrNull()
        if (best == null) "$label: no disponible"
        else {
            val caps = best.getCapabilitiesForType(mime)
            val v = caps.videoCapabilities
            val maxW = v?.supportedWidths?.upper ?: 0
            val maxH = v?.supportedHeights?.upper ?: 0
            "$label: ${if (hw.isNotEmpty()) "hardware" else "software"} · hasta ${maxW}x$maxH · ~${caps.maxSupportedInstances} instancias"
        }
    }
}

private fun isHardware(info: MediaCodecInfo): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.isHardwareAccelerated
    else !info.name.startsWith("OMX.google.") && !info.name.startsWith("c2.android.")
