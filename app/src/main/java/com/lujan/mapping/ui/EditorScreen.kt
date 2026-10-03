package com.lujan.mapping.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lujan.mapping.R
import com.lujan.mapping.core.model.OutputTarget
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.ui.theme.LujanColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class Dialog { NONE, OUTPUT, MISSING, DIAGNOSTICS, NEW_PROJECT, NO_EXTERNAL }

@Composable
fun EditorScreen(vm: EditorViewModel) {
    val project by vm.project.collectAsStateWithLifecycle()
    val editor by vm.editor.collectAsStateWithLifecycle()
    val projection by vm.projection.collectAsStateWithLifecycle()
    val displays by vm.displays.collectAsStateWithLifecycle()
    val missingUris by vm.media.missingUris.collectAsStateWithLifecycle()
    val errors by vm.media.errors.collectAsStateWithLifecycle()
    val playing by vm.media.playing.collectAsStateWithLifecycle()
    val isDirty by vm.isDirty.collectAsStateWithLifecycle()
    val glInfo by vm.engine.glInfo.collectAsStateWithLifecycle()
    val stats by vm.engine.stats.collectAsStateWithLifecycle()
    val engineError by vm.engine.error.collectAsStateWithLifecycle()
    val confirmDelete by vm.confirmDeleteLayer.collectAsStateWithLifecycle()

    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var dialog by remember { mutableStateOf(Dialog.NONE) }
    var renameLayerId by remember { mutableStateOf<String?>(null) }
    var replaceTarget by remember { mutableStateOf<String?>(null) }
    var relinkTarget by remember { mutableStateOf<String?>(null) }

    // ---- Storage Access Framework launchers (no storage permission needed) ----
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { vm.importMedia(it) }
    }
    val replaceLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val target = replaceTarget
        if (uri != null && target != null) vm.replaceContent(target, uri)
        replaceTarget = null
    }
    val openLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { vm.openProject(it) }
    }
    val saveAsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        uri?.let { vm.saveAs(it) }
    }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        uri?.let { vm.exportFrame(it) }
    }
    val relinkLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val old = relinkTarget
        if (uri != null && old != null) vm.relinkFile(old, uri)
        relinkTarget = null
    }
    val folderLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        uri?.let { vm.searchMissingInFolder(it, missingUris) }
    }
    val mediaTypes = arrayOf("video/*", "image/*")
    val launchSaveAs = { saveAsLauncher.launch("${project.name}.mapping") }
    val latestSaveAs by rememberUpdatedState(launchSaveAs)

    LaunchedEffect(Unit) {
        vm.events.collect { e ->
            when (e) {
                is UiEvent.Message -> scope.launch { snackbar.showSnackbar(e.text) }
                UiEvent.RequestSaveAs -> latestSaveAs()
                UiEvent.NoExternalDisplay -> dialog = Dialog.NO_EXTERNAL
            }
        }
    }

    // Projector unplugged mid-show: tell the operator; output resumes automatically on reconnect.
    LaunchedEffect(projection.active, displays.isEmpty()) {
        if (projection.active && project.output.target == OutputTarget.EXTERNAL && displays.isEmpty()) {
            snackbar.showSnackbar("Pantalla externa desconectada. La proyección se reanudará al reconectarla.")
        }
    }
    // Back must not kill a running show by accident.
    BackHandler(enabled = projection.active && project.output.target == OutputTarget.EXTERNAL) {
        scope.launch { snackbar.showSnackbar("Pulsa «DETENER PROYECCIÓN» antes de salir") }
    }

    val internalOutput = projection.active && project.output.target != OutputTarget.EXTERNAL
    if (internalOutput) {
        InternalOutputScreen(vm, project, editor)
    } else {
        BoxWithConstraints(Modifier.fillMaxSize().background(LujanColors.Background)) {
            val wide = maxWidth >= 960.dp
            var showLayers by rememberSaveable { mutableStateOf(true) }
            var showProps by rememberSaveable { mutableStateOf(wide) }

            Column(Modifier.fillMaxSize()) {
                TopBar(
                    project = project,
                    isDirty = isDirty,
                    editor = editor,
                    projecting = projection.active,
                    externalName = displays.firstOrNull()?.summary,
                    hasMissing = missingUris.isNotEmpty(),
                    onToggleLayers = {
                        showLayers = !showLayers
                        if (!wide && showLayers) showProps = false
                    },
                    onToggleProps = {
                        showProps = !showProps
                        if (!wide && showProps) showLayers = false
                    },
                    onUndo = vm::undo,
                    onRedo = vm::redo,
                    onToggleGrid = vm::toggleGrid,
                    gridOn = project.grid.enabled,
                    onOutput = { dialog = Dialog.OUTPUT },
                    onDiagnostics = { dialog = Dialog.DIAGNOSTICS },
                    onNew = { if (isDirty) dialog = Dialog.NEW_PROJECT else vm.newProject() },
                    onOpen = { openLauncher.launch(arrayOf("*/*")) },
                    onSave = vm::save,
                    onSaveAs = launchSaveAs,
                    onExportFrame = { exportLauncher.launch("${project.name}.png") },
                    onMissing = { dialog = Dialog.MISSING },
                    onStartProjection = vm::startProjection,
                    onStopProjection = vm::stopProjection,
                )
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    if (wide && showLayers) {
                        LayersPanel(vm, project, editor, errors, missingUris,
                            onImport = { importLauncher.launch(mediaTypes) },
                            onRename = { renameLayerId = it.id },
                            modifier = Modifier.width(272.dp))
                    }
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        MappingView(
                            vm = vm, project = project, editor = editor,
                            targetId = "preview", outputMode = false, showHandles = true,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Column(Modifier.align(Alignment.TopCenter).padding(top = 6.dp)) {
                            if (missingUris.isNotEmpty()) {
                                Banner("${missingUris.size} archivo(s) no encontrado(s)", "Buscar archivos perdidos") { dialog = Dialog.MISSING }
                            }
                            engineError?.let { Banner(it, null) {} }
                        }
                        if (!wide && showLayers) {
                            LayersPanel(vm, project, editor, errors, missingUris,
                                onImport = { importLauncher.launch(mediaTypes) },
                                onRename = { renameLayerId = it.id },
                                modifier = Modifier.align(Alignment.CenterStart).width(272.dp))
                        }
                        if (!wide && showProps) {
                            PropertiesPanel(vm, project, editor,
                                onReplaceMedia = { id -> replaceTarget = id; replaceLauncher.launch(mediaTypes) },
                                modifier = Modifier.align(Alignment.CenterEnd).width(312.dp))
                        }
                    }
                    if (wide && showProps) {
                        PropertiesPanel(vm, project, editor,
                            onReplaceMedia = { id -> replaceTarget = id; replaceLauncher.launch(mediaTypes) },
                            modifier = Modifier.width(320.dp))
                    }
                }
                TransportBar(vm, project.layer(editor.selectedLayerId), playing, stats)
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 72.dp))
        }
    }

    // ---------------------------------------------------------------- dialogs
    when (dialog) {
        Dialog.OUTPUT -> OutputSettingsDialog(vm, project, displays, glInfo) { dialog = Dialog.NONE }
        Dialog.DIAGNOSTICS -> DiagnosticsDialog(glInfo, stats, displays) { dialog = Dialog.NONE }
        Dialog.MISSING -> MissingFilesDialog(
            files = vm.missingFiles(missingUris),
            onLocate = { uri -> relinkTarget = uri; relinkLauncher.launch(mediaTypes) },
            onSearchFolder = { folderLauncher.launch(null) },
            onDismiss = { dialog = Dialog.NONE },
        )
        Dialog.NEW_PROJECT -> ConfirmDialog(
            title = "¿Nuevo proyecto?",
            text = "Hay cambios sin guardar en «${project.name}». Se perderán (el autoguardado se sobrescribirá).",
            confirmLabel = "Descartar y crear",
            onConfirm = vm::newProject,
            onDismiss = { dialog = Dialog.NONE },
        )
        Dialog.NO_EXTERNAL -> NoExternalDisplayDialog(
            onUseInternal = { vm.startProjectionOn(OutputTarget.INTERNAL) },
            onDismiss = { dialog = Dialog.NONE },
        )
        Dialog.NONE -> Unit
    }
    confirmDelete?.let { id ->
        val layer = project.layer(id)
        if (layer == null) {
            vm.confirmDeleteLayer.value = null
        } else {
            ConfirmDialog(
                title = "¿Eliminar capa?",
                text = "Se eliminará «${layer.name}» con su mapping y máscaras. Puedes deshacerlo con Deshacer.",
                confirmLabel = "Eliminar",
                onConfirm = { vm.deleteLayer(id) },
                onDismiss = { vm.confirmDeleteLayer.value = null },
            )
        }
    }
    renameLayerId?.let { id ->
        project.layer(id)?.let { layer ->
            RenameDialog(layer.name, onConfirm = { vm.renameLayer(id, it) }, onDismiss = { renameLayerId = null })
        }
    }
}

@Composable
private fun Banner(text: String, action: String?, onAction: () -> Unit) {
    Row(
        Modifier
            .padding(4.dp)
            .background(Color(0xE6301018), RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Warning, null, tint = LujanColors.Danger, modifier = Modifier.size(18.dp))
        Text("  $text", style = MaterialTheme.typography.bodySmall)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
private fun TopBar(
    project: Project,
    isDirty: Boolean,
    editor: EditorState,
    projecting: Boolean,
    externalName: String?,
    hasMissing: Boolean,
    gridOn: Boolean,
    onToggleLayers: () -> Unit,
    onToggleProps: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onToggleGrid: () -> Unit,
    onOutput: () -> Unit,
    onDiagnostics: () -> Unit,
    onNew: () -> Unit,
    onOpen: () -> Unit,
    onSave: () -> Unit,
    onSaveAs: () -> Unit,
    onExportFrame: () -> Unit,
    onMissing: () -> Unit,
    onStartProjection: () -> Unit,
    onStopProjection: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(LujanColors.Panel)
            .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onToggleLayers) { Icon(Icons.Filled.Layers, "Capas") }
        Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            Text(androidx.compose.ui.res.stringResource(R.string.app_name), style = MaterialTheme.typography.labelSmall,
                color = LujanColors.Accent, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(project.name + if (isDirty) " •" else "", style = MaterialTheme.typography.bodyMedium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onUndo, enabled = editor.canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, "Deshacer") }
        IconButton(onClick = onRedo, enabled = editor.canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, "Rehacer") }
        IconButton(onClick = onToggleGrid) {
            Icon(Icons.Filled.GridOn, "Cuadrícula", tint = if (gridOn) LujanColors.Accent else MaterialTheme.colorScheme.onSurface)
        }
        var fileMenu by remember { mutableStateOf(false) }
        Box {
            IconButton(onClick = { fileMenu = true }) { Icon(Icons.Filled.FolderOpen, "Archivo") }
            DropdownMenu(expanded = fileMenu, onDismissRequest = { fileMenu = false }) {
                DropdownMenuItem(text = { Text("Nuevo proyecto") }, onClick = { fileMenu = false; onNew() })
                DropdownMenuItem(text = { Text("Abrir proyecto…") }, onClick = { fileMenu = false; onOpen() })
                DropdownMenuItem(text = { Text("Guardar") }, onClick = { fileMenu = false; onSave() })
                DropdownMenuItem(text = { Text("Guardar como…") }, onClick = { fileMenu = false; onSaveAs() })
                HorizontalDivider()
                DropdownMenuItem(text = { Text("Exportar fotograma (PNG)…") }, onClick = { fileMenu = false; onExportFrame() })
                DropdownMenuItem(
                    text = { Text("Buscar archivos perdidos", color = if (hasMissing) LujanColors.Danger else Color.Unspecified) },
                    onClick = { fileMenu = false; onMissing() },
                )
            }
        }
        IconButton(onClick = onOutput) {
            Icon(if (externalName != null) Icons.Filled.Tv else Icons.Filled.Cast,
                contentDescription = externalName ?: "Salida",
                tint = if (externalName != null) LujanColors.Accent else MaterialTheme.colorScheme.onSurface)
        }
        IconButton(onClick = onDiagnostics) { Icon(Icons.Filled.Info, "Compatibilidad") }
        IconButton(onClick = onToggleProps) { Icon(Icons.Filled.Tune, "Propiedades") }
        if (projecting) {
            Button(
                onClick = onStopProjection,
                colors = ButtonDefaults.buttonColors(containerColor = LujanColors.Danger),
                modifier = Modifier.height(44.dp),
            ) {
                Icon(Icons.Filled.Stop, null, Modifier.size(18.dp))
                Text(" DETENER PROYECCIÓN", fontWeight = FontWeight.Bold)
            }
        } else {
            Button(
                onClick = onStartProjection,
                colors = ButtonDefaults.buttonColors(containerColor = LujanColors.Projection, contentColor = Color.Black),
                modifier = Modifier.height(44.dp),
            ) {
                Icon(Icons.Filled.PlayArrow, null, Modifier.size(18.dp))
                Text(" INICIAR PROYECCIÓN", fontWeight = FontWeight.Bold)
            }
        }
    }
}

/**
 * Fullscreen output on the phone (INTERNAL / BOTH): used with Chromecast or wired
 * mirroring. Shows nothing but the content; a tap reveals a small auto-hiding toolbar.
 */
@Composable
private fun InternalOutputScreen(vm: EditorViewModel, project: Project, editor: EditorState) {
    var editHandles by remember { mutableStateOf(false) }
    var controls by remember { mutableStateOf(true) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(controls, tick) {
        if (controls) {
            delay(3500)
            controls = false
        }
    }
    BackHandler { vm.stopProjection() }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        MappingView(
            vm = vm, project = project, editor = editor,
            targetId = "internal", outputMode = true, showHandles = editHandles,
            modifier = Modifier.fillMaxSize(),
        )
        if (!editHandles) {
            // Invisible tap catcher: the output stays clean until the operator touches it.
            Box(Modifier.fillMaxSize().clickable(
                interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                indication = null,
            ) { controls = true; tick++ })
        }
        AnimatedVisibility(
            visible = controls || editHandles,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
        ) {
            Row(
                Modifier.background(Color(0xCC16181D), RoundedCornerShape(12.dp)).padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = { editHandles = !editHandles; tick++ }) {
                    Icon(Icons.Filled.Edit, null, Modifier.size(18.dp))
                    Text(if (editHandles) " Ocultar esquinas" else " Ajustar esquinas")
                }
                TextButton(onClick = { vm.stopProjection() }) {
                    Icon(Icons.Filled.Close, null, Modifier.size(18.dp), tint = LujanColors.Danger)
                    Text(" DETENER PROYECCIÓN", color = LujanColors.Danger)
                }
            }
        }
    }
}
