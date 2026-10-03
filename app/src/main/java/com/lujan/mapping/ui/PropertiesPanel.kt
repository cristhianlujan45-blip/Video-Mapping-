package com.lujan.mapping.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.geometry.LayerTransform
import com.lujan.mapping.core.model.BlendMode
import com.lujan.mapping.core.model.ColorAdjust
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.CropRect
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.MaskShape
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.ui.theme.LujanColors
import java.util.Locale
import kotlin.math.roundToInt

private val Tabs = listOf("Superficie", "Máscaras", "Color", "Medio")

@Composable
fun PropertiesPanel(
    vm: EditorViewModel,
    project: Project,
    editor: EditorState,
    onReplaceMedia: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val layer = project.layer(editor.selectedLayerId)
    Column(modifier.fillMaxHeight().background(LujanColors.Panel)) {
        if (layer == null) {
            Text(
                "Selecciona una superficie\n\n• Toca una superficie para seleccionarla\n• Arrastra las esquinas para ajustar la perspectiva\n" +
                    "• Un dedo mueve · dos dedos escalan y rotan\n• Mantén pulsado para el menú contextual\n• Doble toque alterna superficies superpuestas",
                modifier = Modifier.padding(16.dp),
                color = LujanColors.TextDim,
                style = MaterialTheme.typography.bodySmall,
            )
            return@Column
        }
        var chosenTab by rememberSaveable { mutableIntStateOf(0) }
        // While editing / drawing a mask the mask tab is forced.
        val tab = if (editor.mode != EditMode.SURFACE) 1 else chosenTab
        ScrollableTabRow(selectedTabIndex = tab, edgePadding = 0.dp, containerColor = LujanColors.Panel) {
            Tabs.forEachIndexed { i, t ->
                Tab(selected = tab == i, onClick = {
                    chosenTab = i
                    if (i != 1 && editor.mode != EditMode.SURFACE) vm.setMode(EditMode.SURFACE)
                }, text = { Text(t, maxLines = 1) })
            }
        }
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 4.dp)
        ) {
            Text(layer.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (layer.locked) Text("Capa bloqueada", color = LujanColors.Projection, style = MaterialTheme.typography.labelSmall)
            when (tab) {
                0 -> SurfaceTab(vm, project, layer, editor)
                1 -> MasksTab(vm, layer, editor)
                2 -> ColorTab(vm, layer)
                else -> MediaTab(vm, layer, onReplaceMedia)
            }
            VSpace(24)
        }
    }
}

@Composable
private fun SurfaceTab(vm: EditorViewModel, project: Project, layer: Layer, editor: EditorState) {
    val id = layer.id
    val enabled = !layer.locked
    fun live(f: (Layer) -> Layer) {
        vm.beginEdit(); vm.updateLayerLive(id, f)
    }
    val done = { vm.commitEdit() }

    SectionTitle("Composición")
    PropSlider("Opacidad", layer.opacity, 0f..1f, { v -> live { it.copy(opacity = v) } }, done,
        format = { "${(it * 100).roundToInt()} %" }, enabled = enabled)
    Text("Modo de mezcla", style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
    BlendModePicker(layer.blendMode, enabled) { m -> vm.updateLayer(id) { it.copy(blendMode = m) } }

    SectionTitle("Transformación")
    val t = layer.transform
    PropSlider("Posición X", t.offsetX, -1f..1f, { v -> live { it.copy(transform = it.transform.copy(offsetX = v)) } }, done, enabled = enabled)
    PropSlider("Posición Y", t.offsetY, -1f..1f, { v -> live { it.copy(transform = it.transform.copy(offsetY = v)) } }, done, enabled = enabled)
    PropSlider("Escala", t.scale, 0.1f..4f, { v -> live { it.copy(transform = it.transform.copy(scale = v)) } }, done,
        format = { "${(it * 100).roundToInt()} %" }, enabled = enabled)
    PropSlider("Rotación", t.rotationDeg, -180f..180f, { v -> live { it.copy(transform = it.transform.copy(rotationDeg = v)) } }, done,
        format = { "${it.roundToInt()}°" }, enabled = enabled)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { vm.updateLayer(id) { it.copy(transform = LayerTransform()) } }, enabled = enabled) { Text("Restablecer") }
        OutlinedButton(onClick = { vm.updateLayer(id) { ProjectOps.bakeTransform(it, project.output.aspect) } }, enabled = enabled && !t.isIdentity) { Text("Aplicar a esquinas") }
    }

    SectionTitle("Esquinas (perspectiva)")
    val q = layer.finalQuad(project.output.aspect)
    val names = listOf("Sup. izq.", "Sup. der.", "Inf. der.", "Inf. izq.")
    names.forEachIndexed { i, n ->
        val c = q.corner(i)
        val px = "${(c.x * project.output.width).roundToInt()}, ${(c.y * project.output.height).roundToInt()} px"
        Row(
            Modifier
                .fillMaxWidth()
                .height(36.dp)
                .background(if (editor.selectedCorner == i) LujanColors.PanelHigh else LujanColors.Panel, RoundedCornerShape(6.dp))
                .clickable { vm.selectCorner(if (editor.selectedCorner == i) null else i) }
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(n, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            Text(px, style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
        }
    }
    Text("Selecciona una esquina y usa las flechas del teclado para ajustar píxel a píxel (Mayús = 10 px).",
        style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
    SwitchRow("Modo precisión (arrastre ×0.2)", editor.fineMode, { vm.setFineMode(it) })
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { vm.updateLayer(id) { ProjectOps.resetCorners(it, project.output.aspect) } }, enabled = enabled) { Text("Restablecer") }
        OutlinedButton(onClick = { vm.updateLayer(id) { ProjectOps.fillOutput(it) } }, enabled = enabled) { Text("Pantalla completa") }
    }

    SectionTitle("Espejo y borde")
    SwitchRow("Espejo horizontal", layer.flipH, { v -> vm.updateLayer(id) { it.copy(flipH = v) } }, enabled)
    SwitchRow("Espejo vertical", layer.flipV, { v -> vm.updateLayer(id) { it.copy(flipV = v) } }, enabled)
    PropSlider("Borde suave", layer.edgeFeather, 0f..0.25f, { v -> live { it.copy(edgeFeather = v) } }, done,
        format = { "${(it * 100).roundToInt()} %" }, enabled = enabled)

    SectionTitle("Recorte del contenido")
    val c = layer.crop
    PropSlider("Izquierda", c.left, 0f..0.95f, { v -> live { it.copy(crop = it.crop.copy(left = v.coerceAtMost(it.crop.right - 0.05f))) } }, done, enabled = enabled)
    PropSlider("Derecha", c.right, 0.05f..1f, { v -> live { it.copy(crop = it.crop.copy(right = v.coerceAtLeast(it.crop.left + 0.05f))) } }, done, enabled = enabled)
    PropSlider("Arriba", c.top, 0f..0.95f, { v -> live { it.copy(crop = it.crop.copy(top = v.coerceAtMost(it.crop.bottom - 0.05f))) } }, done, enabled = enabled)
    PropSlider("Abajo", c.bottom, 0.05f..1f, { v -> live { it.copy(crop = it.crop.copy(bottom = v.coerceAtLeast(it.crop.top + 0.05f))) } }, done, enabled = enabled)
    if (!c.isFull) OutlinedButton(onClick = { vm.updateLayer(id) { it.copy(crop = CropRect()) } }, enabled = enabled) { Text("Quitar recorte") }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BlendModePicker(current: BlendMode, enabled: Boolean, onPick: (BlendMode) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
            Text(current.label)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            BlendMode.entries.forEach { m ->
                DropdownMenuItem(text = { Text(m.label) }, onClick = { open = false; onPick(m) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MasksTab(vm: EditorViewModel, layer: Layer, editor: EditorState) {
    val id = layer.id
    val enabled = !layer.locked
    SectionTitle("Nueva máscara")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        MaskShape.entries.forEach { shape ->
            OutlinedButton(onClick = { vm.addMask(id, shape) }, enabled = enabled) { Text(shape.label) }
        }
    }
    if (editor.mode == EditMode.FREEHAND_DRAW) {
        Text("Dibuja el contorno con el dedo sobre la vista previa. Se cerrará automáticamente.",
            color = LujanColors.MaskOutline, style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = { vm.setMode(EditMode.SURFACE) }) { Text("Cancelar dibujo") }
    }
    Text("La máscara muestra solo lo que queda dentro de la forma. «Invertir» oculta el interior. " +
        "Las máscaras siguen a la superficie cuando mueves sus esquinas.",
        style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)

    if (layer.masks.isNotEmpty()) SectionTitle("Máscaras de la capa")
    layer.masks.forEach { m ->
        val selected = m.id == editor.selectedMaskId
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(if (selected) LujanColors.PanelHigh else LujanColors.Panel, RoundedCornerShape(6.dp))
                .clickable { vm.selectMask(if (selected) null else m.id) }
                .padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(m.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (selected) LujanColors.MaskOutline else MaterialTheme.colorScheme.onSurface)
            IconButton(onClick = { vm.updateMask(id, m.id) { it.copy(enabled = !it.enabled) } }) {
                Icon(if (m.enabled) Icons.Filled.Visibility else Icons.Filled.VisibilityOff, "Activar")
            }
            IconButton(onClick = { vm.deleteMask(id, m.id) }, enabled = enabled) {
                Icon(Icons.Filled.Delete, "Eliminar máscara", tint = LujanColors.Danger)
            }
        }
        if (selected) {
            Column(Modifier.padding(start = 8.dp)) {
                SwitchRow("Invertir", m.inverted, { v -> vm.updateMask(id, m.id) { it.copy(inverted = v) } }, enabled)
                PropSlider("Opacidad de la máscara", m.opacity, 0f..1f,
                    { v -> vm.beginEdit(); vm.updateMaskLive(id, m.id) { it.copy(opacity = v) } }, { vm.commitEdit() },
                    format = { "${(it * 100).roundToInt()} %" }, enabled = enabled)
                PropSlider("Suavizado del borde", m.feather, 0f..0.1f,
                    { v -> vm.beginEdit(); vm.updateMaskLive(id, m.id) { it.copy(feather = v) } }, { vm.commitEdit() },
                    format = { String.format(Locale.US, "%.3f", it) }, enabled = enabled)
                if (m.shape == MaskShape.POLYGON) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { vm.updateMask(id, m.id) { ProjectOps.insertPolygonPoint(it) } }, enabled = enabled) { Text("+ Punto") }
                        OutlinedButton(onClick = { vm.updateMask(id, m.id) { ProjectOps.removePolygonPoint(it, it.points.lastIndex) } },
                            enabled = enabled && m.points.size > 3) { Text("− Punto") }
                    }
                }
                Text("Arrastra los puntos amarillos en la vista previa; arrastra dentro de la superficie para mover la máscara.",
                    style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
            }
        }
    }
}

@Composable
private fun ColorTab(vm: EditorViewModel, layer: Layer) {
    val id = layer.id
    val enabled = !layer.locked
    val a = layer.color
    fun live(f: (ColorAdjust) -> ColorAdjust) {
        vm.beginEdit(); vm.updateLayerLive(id) { it.copy(color = f(it.color)) }
    }
    val done = { vm.commitEdit() }
    SectionTitle("Ajustes de color (GPU)")
    PropSlider("Brillo", a.brightness, -1f..1f, { v -> live { it.copy(brightness = v) } }, done, enabled = enabled)
    PropSlider("Contraste", a.contrast, 0f..2f, { v -> live { it.copy(contrast = v) } }, done, enabled = enabled)
    PropSlider("Saturación", a.saturation, 0f..2f, { v -> live { it.copy(saturation = v) } }, done, enabled = enabled)
    PropSlider("Tono", a.hue, -180f..180f, { v -> live { it.copy(hue = v) } }, done, format = { "${it.roundToInt()}°" }, enabled = enabled)
    SwitchRow("Negativo", a.invert, { v -> vm.updateLayer(id) { it.copy(color = it.color.copy(invert = v)) } }, enabled)
    if (!a.isIdentity) OutlinedButton(onClick = { vm.updateLayer(id) { it.copy(color = ColorAdjust()) } }, enabled = enabled) { Text("Restablecer color") }
}

@Composable
private fun MediaTab(vm: EditorViewModel, layer: Layer, onReplaceMedia: (String) -> Unit) {
    val id = layer.id
    val enabled = !layer.locked
    SectionTitle("Contenido")
    val media = layer.content.media
    when (layer.content.kind) {
        ContentKind.VIDEO, ContentKind.IMAGE -> if (media != null) {
            Text(media.displayName, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val details = buildList {
                if (media.width > 0) add("${media.width}x${media.height}")
                if (media.durationMs > 0) add(formatTime(media.durationMs))
                media.mimeType?.let { add(it) }
            }.joinToString(" · ")
            Text(details, style = MaterialTheme.typography.labelSmall, color = LujanColors.TextDim)
        }
        ContentKind.TEST_PATTERN -> Text("Patrón de calibración (esquinas: rojo, verde, azul, amarillo)", style = MaterialTheme.typography.bodySmall)
        ContentKind.SOLID_COLOR -> Text("Color sólido", style = MaterialTheme.typography.bodySmall)
    }
    VSpace(8)
    OutlinedButton(onClick = { onReplaceMedia(id) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("Reemplazar por video / imagen…") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { vm.setLayerContentKind(id, ContentKind.TEST_PATTERN) }, enabled = enabled) { Text("Patrón") }
        OutlinedButton(onClick = { vm.setLayerContentKind(id, ContentKind.SOLID_COLOR) }, enabled = enabled) { Text("Color") }
    }
    if (layer.content.kind == ContentKind.SOLID_COLOR || layer.content.kind == ContentKind.TEST_PATTERN) {
        SectionTitle(if (layer.content.kind == ContentKind.SOLID_COLOR) "Color" else "Tinte del patrón")
        ColorSwatches(layer.content.colorArgb) { c -> vm.updateLayer(id) { it.copy(content = it.content.copy(colorArgb = c)) } }
    }
    if (layer.content.kind == ContentKind.VIDEO) {
        SectionTitle("Reproducción")
        val pb = layer.playback
        SwitchRow("Bucle", pb.loop, { v -> vm.updateLayer(id) { it.copy(playback = it.playback.copy(loop = v)) } })
        SwitchRow("Silenciar", pb.muted, { v -> vm.updateLayer(id) { it.copy(playback = it.playback.copy(muted = v)) } })
        PropSlider("Volumen", pb.volume, 0f..1f,
            { v -> vm.beginEdit(); vm.updateLayerLive(id) { it.copy(playback = it.playback.copy(volume = v)) } }, { vm.commitEdit() },
            format = { "${(it * 100).roundToInt()} %" })
        Text("Velocidad", style = MaterialTheme.typography.bodySmall, color = LujanColors.TextDim)
        ChoiceChips(listOf(0.25f, 0.5f, 1f, 1.5f, 2f), pb.speed, { "${it}x" }, { s ->
            vm.updateLayer(id) { it.copy(playback = it.playback.copy(speed = s)) }
        })
    }
}
