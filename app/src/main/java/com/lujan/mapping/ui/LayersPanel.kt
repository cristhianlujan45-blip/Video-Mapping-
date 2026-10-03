package com.lujan.mapping.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lujan.mapping.core.model.BlendMode
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.ui.theme.LujanColors

@Composable
fun LayersPanel(
    vm: EditorViewModel,
    project: Project,
    editor: EditorState,
    errors: Map<String, String>,
    missingUris: Set<String>,
    onImport: () -> Unit,
    onRename: (Layer) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxHeight().background(LujanColors.Panel)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Capas", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            var addMenu by remember { mutableStateOf(false) }
            Box {
                FilledTonalButton(onClick = { addMenu = true }, modifier = Modifier.height(40.dp)) {
                    Icon(Icons.Filled.Add, null, Modifier.size(18.dp))
                    Text(" Añadir")
                }
                DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                    DropdownMenuItem(text = { Text("Video / imagen del dispositivo…") }, leadingIcon = { Icon(Icons.Filled.Movie, null) },
                        onClick = { addMenu = false; onImport() })
                    DropdownMenuItem(text = { Text("Superficie de calibración") }, leadingIcon = { Icon(Icons.Filled.GridOn, null) },
                        onClick = { addMenu = false; vm.addTestPatternSurface() })
                    DropdownMenuItem(text = { Text("Color sólido") }, leadingIcon = { Icon(Icons.Filled.Palette, null) },
                        onClick = { addMenu = false; vm.addSolidSurface() })
                }
            }
        }
        if (project.layers.isEmpty()) {
            Text(
                "Sin capas.\nPulsa «Añadir» para importar un video o crear una superficie.",
                modifier = Modifier.padding(16.dp),
                color = LujanColors.TextDim,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        // Top-most layer first, like compositing apps.
        LazyColumn(Modifier.weight(1f)) {
            items(project.layers.reversed(), key = { it.id }) { layer ->
                LayerRow(
                    vm = vm,
                    layer = layer,
                    selected = layer.id == editor.selectedLayerId,
                    error = errors[layer.id],
                    missing = layer.content.media?.uri in missingUris,
                    onRename = { onRename(layer) },
                )
            }
        }
    }
}

@Composable
private fun LayerRow(
    vm: EditorViewModel,
    layer: Layer,
    selected: Boolean,
    error: String?,
    missing: Boolean,
    onRename: () -> Unit,
) {
    val bg = if (selected) LujanColors.PanelHigh else LujanColors.Panel
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .background(bg, RoundedCornerShape(8.dp))
            .clickable { vm.selectLayer(layer.id) }
    ) {
        Row(Modifier.fillMaxWidth().height(52.dp).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            val icon: ImageVector = when (layer.content.kind) {
                ContentKind.VIDEO -> Icons.Filled.Movie
                ContentKind.IMAGE -> Icons.Filled.Image
                ContentKind.TEST_PATTERN -> Icons.Filled.GridOn
                ContentKind.SOLID_COLOR -> Icons.Filled.Palette
            }
            Icon(icon, null, tint = if (selected) LujanColors.Accent else LujanColors.TextDim, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(layer.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium,
                    color = if (layer.visible) MaterialTheme.colorScheme.onSurface else LujanColors.TextDim)
                Row {
                    when {
                        missing -> Pill("Archivo perdido", LujanColors.Danger)
                        error != null -> Pill("Error", LujanColors.Danger)
                        layer.blendMode != BlendMode.NORMAL -> Pill(layer.blendMode.label, LujanColors.Accent)
                        layer.masks.isNotEmpty() -> Pill("${layer.masks.size} máscara(s)", LujanColors.MaskOutline)
                        else -> {}
                    }
                }
            }
            IconButton(onClick = { vm.updateLayer(layer.id) { it.copy(visible = !it.visible) } }) {
                Icon(if (layer.visible) Icons.Filled.Visibility else Icons.Filled.VisibilityOff,
                    contentDescription = if (layer.visible) "Ocultar" else "Mostrar",
                    tint = if (layer.visible) MaterialTheme.colorScheme.onSurface else LujanColors.TextDim)
            }
            IconButton(onClick = { vm.updateLayer(layer.id) { it.copy(locked = !it.locked) } }) {
                Icon(if (layer.locked) Icons.Filled.Lock else Icons.Filled.LockOpen,
                    contentDescription = if (layer.locked) "Desbloquear" else "Bloquear",
                    tint = if (layer.locked) LujanColors.Projection else LujanColors.TextDim)
            }
        }
        if (selected) {
            if (error != null) {
                Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Warning, null, tint = LujanColors.Danger, modifier = Modifier.size(16.dp))
                    Text(" $error", color = LujanColors.Danger, style = MaterialTheme.typography.labelSmall)
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.moveLayer(layer.id, 1) }) { Icon(Icons.Filled.ArrowUpward, "Subir") }
                IconButton(onClick = { vm.moveLayer(layer.id, -1) }) { Icon(Icons.Filled.ArrowDownward, "Bajar") }
                IconButton(onClick = { vm.duplicateLayer(layer.id) }) { Icon(Icons.Filled.ContentCopy, "Duplicar") }
                IconButton(onClick = onRename) { Icon(Icons.Filled.Edit, "Renombrar") }
                IconButton(onClick = { vm.confirmDeleteLayer.value = layer.id }) {
                    Icon(Icons.Filled.Delete, "Eliminar", tint = LujanColors.Danger)
                }
            }
        }
    }
}
