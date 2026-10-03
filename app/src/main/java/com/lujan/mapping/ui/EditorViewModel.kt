package com.lujan.mapping.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.lujan.mapping.LujanApp
import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.geometry.Corner
import com.lujan.mapping.core.geometry.Vec2
import com.lujan.mapping.core.history.History
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.GridSettings
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.LayerContent
import com.lujan.mapping.core.model.Mask
import com.lujan.mapping.core.model.MaskShape
import com.lujan.mapping.core.model.OutputSettings
import com.lujan.mapping.core.model.OutputTarget
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.media.MediaProbe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class EditMode { SURFACE, MASK, FREEHAND_DRAW }

data class EditorState(
    val selectedLayerId: String? = null,
    val selectedCorner: Int? = null,
    val mode: EditMode = EditMode.SURFACE,
    val selectedMaskId: String? = null,
    /** Precision mode: drags move 1/5 of the finger distance. */
    val fineMode: Boolean = false,
    val canUndo: Boolean = false,
    val canRedo: Boolean = false,
)

data class ProjectionState(val active: Boolean = false)

sealed interface UiEvent {
    data class Message(val text: String) : UiEvent
    data object RequestSaveAs : UiEvent
    data object NoExternalDisplay : UiEvent
}

/**
 * Single source of truth of the editor. All project mutations go through [beginEdit] /
 * [updateLive] / [commitEdit] (continuous gestures, sliders) or [applyEdit] (discrete
 * actions), which gives undo/redo for every kind of edit.
 */
@OptIn(FlowPreview::class)
class EditorViewModel(app: Application) : AndroidViewModel(app) {

    private val graph = (app as LujanApp).graph
    val engine = graph.renderEngine
    val media = graph.mediaManager
    private val repo = graph.projectRepository
    val displays = graph.displayMonitor.displays

    private val _project = MutableStateFlow(ProjectOps.newProject())
    val project: StateFlow<Project> = _project

    private val _editor = MutableStateFlow(EditorState())
    val editor: StateFlow<EditorState> = _editor

    private val _projection = MutableStateFlow(ProjectionState())
    val projection: StateFlow<ProjectionState> = _projection

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<UiEvent> = _events

    /** Layer waiting for delete confirmation (keyboard Delete, context menu, panel). */
    val confirmDeleteLayer = MutableStateFlow<String?>(null)

    private val _documentUri = MutableStateFlow<Uri?>(null)
    val documentUri: StateFlow<Uri?> = _documentUri

    /** Last saved snapshot; null = unsaved changes restored from autosave. */
    private val savedProject = MutableStateFlow<Project?>(_project.value)
    val isDirty: StateFlow<Boolean> = combine(_project, savedProject) { p, s -> s == null || p != s }
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val history = History<Project>()
    private var editStart: Project? = null
    private val prefs = app.getSharedPreferences("lujan_mapping", 0)

    init {
        setProjectInternal(_project.value)
        viewModelScope.launch {
            val restored = repo.loadAutosave()
            if (restored != null) {
                setProjectInternal(restored)
                savedProject.value = if (prefs.getBoolean(KEY_AUTOSAVE_DIRTY, false)) null else restored
                _documentUri.value = repo.currentDocumentUri
                media.verifyMedia(restored)
            }
            // Autosave: debounced so a drag does not hammer the storage.
            _project.drop(1).debounce(1500).collect { p ->
                repo.writeAutosave(p)
                prefs.edit().putBoolean(KEY_AUTOSAVE_DIRTY, isDirty.value).apply()
            }
        }
    }

    // ------------------------------------------------------------ core plumbing

    private fun setProjectInternal(p: Project) {
        _project.value = p
        engine.setProject(p)
        media.sync(p)
    }

    /** Opens an edit transaction (no-op if one is already open). */
    fun beginEdit() {
        if (editStart == null) editStart = _project.value
    }

    fun updateLive(f: (Project) -> Project) {
        val next = f(_project.value)
        if (next != _project.value) setProjectInternal(next)
    }

    /** Closes the transaction and records one undo step if something changed. */
    fun commitEdit() {
        val start = editStart ?: return
        editStart = null
        if (start != _project.value) {
            history.record(start)
            refreshHistoryFlags()
        }
    }

    fun applyEdit(f: (Project) -> Project) {
        val inTransaction = editStart != null
        beginEdit()
        updateLive(f)
        if (!inTransaction) commitEdit()
    }

    /** Changes that should not create undo steps (grid toggles, view settings). */
    private fun applyNoHistory(f: (Project) -> Project) = updateLive(f)

    private fun refreshHistoryFlags() {
        _editor.value = _editor.value.copy(canUndo = history.canUndo, canRedo = history.canRedo)
    }

    fun undo() {
        if (editStart != null) commitEdit()
        val prev = history.undo(_project.value) ?: return
        setProjectInternal(prev)
        validateSelection()
        refreshHistoryFlags()
    }

    fun redo() {
        if (editStart != null) commitEdit()
        val next = history.redo(_project.value) ?: return
        setProjectInternal(next)
        validateSelection()
        refreshHistoryFlags()
    }

    private fun validateSelection() {
        val e = _editor.value
        val layer = _project.value.layer(e.selectedLayerId)
        if (layer == null) {
            _editor.value = e.copy(selectedLayerId = null, selectedCorner = null, selectedMaskId = null, mode = EditMode.SURFACE)
        } else if (e.selectedMaskId != null && layer.masks.none { it.id == e.selectedMaskId }) {
            _editor.value = e.copy(selectedMaskId = null, mode = EditMode.SURFACE)
        }
    }

    private fun message(text: String) {
        _events.tryEmit(UiEvent.Message(text))
    }

    val aspect: Float get() = _project.value.output.aspect

    fun selectedLayer(): Layer? = _project.value.layer(_editor.value.selectedLayerId)

    // ------------------------------------------------------------- selection

    fun selectLayer(id: String?) {
        val e = _editor.value
        if (e.selectedLayerId == id) return
        _editor.value = e.copy(selectedLayerId = id, selectedCorner = null, selectedMaskId = null, mode = EditMode.SURFACE)
    }

    fun selectCorner(corner: Int?) {
        _editor.value = _editor.value.copy(selectedCorner = corner)
    }

    fun cycleCorner() {
        val c = _editor.value.selectedCorner
        selectCorner(if (c == null) Corner.TOP_LEFT else (c + 1) % 4)
    }

    fun setFineMode(on: Boolean) {
        _editor.value = _editor.value.copy(fineMode = on)
    }

    fun setMode(mode: EditMode, maskId: String? = _editor.value.selectedMaskId) {
        _editor.value = _editor.value.copy(mode = mode, selectedMaskId = if (mode == EditMode.SURFACE) null else maskId)
    }

    fun selectMask(maskId: String?) {
        _editor.value = _editor.value.copy(
            selectedMaskId = maskId,
            mode = if (maskId == null) EditMode.SURFACE else EditMode.MASK
        )
    }

    // ---------------------------------------------------------------- layers

    fun addTestPatternSurface() {
        val p = _project.value
        val layer = ProjectOps.createLayer(p, LayerContent(ContentKind.TEST_PATTERN), "Superficie", p.output.aspect)
        applyEdit { ProjectOps.addLayer(it, layer) }
        selectLayer(layer.id)
    }

    fun addSolidSurface(argb: Long = 0xFFFFFFFF) {
        val p = _project.value
        val layer = ProjectOps.createLayer(p, LayerContent(ContentKind.SOLID_COLOR, colorArgb = argb), "Color", 1f)
        applyEdit { ProjectOps.addLayer(it, layer) }
        selectLayer(layer.id)
    }

    /** Imports a video/image as a new layer sized to the media's aspect ratio. */
    fun importMedia(uri: Uri) {
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            MediaProbe.persistReadPermission(ctx, uri)
            val probed = withContext(Dispatchers.IO) { MediaProbe.probe(ctx, uri) }
            if (probed == null) {
                message("Formato no soportado")
                return@launch
            }
            val ref = probed.ref
            val contentAspect = if (ref.width > 0 && ref.height > 0) ref.width.toFloat() / ref.height else 16f / 9f
            val p = _project.value
            val layer = ProjectOps.createLayer(p, LayerContent(probed.kind, ref), ProjectOps.mediaLayerName(ref), contentAspect)
            applyEdit { ProjectOps.addLayer(it, layer) }
            selectLayer(layer.id)
        }
    }

    /** Replaces the content of an existing layer, keeping its mapping. */
    fun replaceContent(layerId: String, uri: Uri) {
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            MediaProbe.persistReadPermission(ctx, uri)
            val probed = withContext(Dispatchers.IO) { MediaProbe.probe(ctx, uri) }
            if (probed == null) {
                message("Formato no soportado")
                return@launch
            }
            applyEdit { p -> ProjectOps.updateLayer(p, layerId) { it.copy(content = LayerContent(probed.kind, probed.ref)) } }
        }
    }

    fun setLayerContentKind(layerId: String, kind: ContentKind) {
        applyEdit { p -> ProjectOps.updateLayer(p, layerId) { it.copy(content = it.content.copy(kind = kind, media = if (kind == ContentKind.VIDEO || kind == ContentKind.IMAGE) it.content.media else null)) } }
    }

    fun requestDeleteSelected() {
        val l = selectedLayer() ?: return
        confirmDeleteLayer.value = l.id
    }

    fun selectAdjacentLayer(delta: Int) {
        val layers = _project.value.layers
        if (layers.isEmpty()) return
        val idx = layers.indexOfFirst { it.id == _editor.value.selectedLayerId }
        val next = if (idx < 0) layers.lastIndex else (idx + delta).coerceIn(0, layers.lastIndex)
        selectLayer(layers[next].id)
    }

    fun deleteLayer(id: String) {
        applyEdit { ProjectOps.removeLayer(it, id) }
        validateSelection()
    }

    fun duplicateLayer(id: String) {
        var newId: String? = null
        applyEdit { p -> ProjectOps.duplicateLayer(p, id).also { newId = it.second }.first }
        newId?.let { selectLayer(it) }
    }

    fun moveLayer(id: String, delta: Int) = applyEdit { ProjectOps.moveLayer(it, id, delta) }

    fun moveLayerToEdge(id: String, top: Boolean) = applyEdit { ProjectOps.moveLayerToEdge(it, id, top) }

    fun renameLayer(id: String, name: String) {
        val clean = name.trim().take(60)
        if (clean.isEmpty()) return
        applyEdit { p -> ProjectOps.updateLayer(p, id) { it.copy(name = clean) } }
    }

    /** Atomic layer edit (one undo step). */
    fun updateLayer(id: String, f: (Layer) -> Layer) = applyEdit { p -> ProjectOps.updateLayer(p, id, f) }

    /** Live layer edit inside an open transaction (sliders, gestures). */
    fun updateLayerLive(id: String, f: (Layer) -> Layer) = updateLive { p -> ProjectOps.updateLayer(p, id, f) }

    // -------------------------------------------------------------- gestures

    fun dragCornerTo(layerId: String, corner: Int, model: Vec2) {
        updateLayerLive(layerId) { ProjectOps.setCorner(it, corner, model, aspect) }
    }

    fun moveSurfaceBy(layerId: String, delta: Vec2) {
        updateLayerLive(layerId) {
            it.copy(transform = it.transform.copy(offsetX = it.transform.offsetX + delta.x, offsetY = it.transform.offsetY + delta.y))
        }
    }

    fun scaleRotateSurface(layerId: String, zoom: Float, rotationDeg: Float) {
        updateLayerLive(layerId) {
            val t = it.transform
            it.copy(transform = t.copy(scale = (t.scale * zoom).coerceIn(0.05f, 20f), rotationDeg = normalizeAngle(t.rotationDeg + rotationDeg)))
        }
    }

    private fun normalizeAngle(a: Float): Float {
        var r = a % 360f
        if (r > 180f) r -= 360f
        if (r < -180f) r += 360f
        return r
    }

    /** Keyboard nudge, in output pixels. Moves the selected corner, or the whole surface. */
    fun nudge(dxPx: Float, dyPx: Float) {
        val layer = selectedLayer() ?: return
        if (layer.locked) return
        val out = _project.value.output
        val d = Vec2(dxPx / out.width, dyPx / out.height)
        val corner = _editor.value.selectedCorner
        applyEdit { p ->
            ProjectOps.updateLayer(p, layer.id) { l ->
                if (corner != null) {
                    val q = l.finalQuad(out.aspect)
                    ProjectOps.setCorner(l, corner, q.corner(corner) + d, out.aspect)
                } else {
                    l.copy(transform = l.transform.copy(offsetX = l.transform.offsetX + d.x, offsetY = l.transform.offsetY + d.y))
                }
            }
        }
    }

    // ----------------------------------------------------------------- masks

    fun addMask(layerId: String, shape: MaskShape) {
        val layer = _project.value.layer(layerId) ?: return
        val name = "${shape.label} ${layer.masks.size + 1}"
        if (shape == MaskShape.FREEHAND) {
            // Freehand masks are created when the user finishes drawing on the preview.
            _editor.value = _editor.value.copy(mode = EditMode.FREEHAND_DRAW, selectedMaskId = null)
            message("Dibuja la máscara con el dedo sobre la superficie")
            return
        }
        val mask = ProjectOps.defaultMask(shape, name)
        updateLayer(layerId) { it.copy(masks = it.masks + mask) }
        selectMask(mask.id)
    }

    fun addFreehandMask(layerId: String, uvPoints: List<Vec2>) {
        val simplified = ProjectOps.simplifyPath(uvPoints, 0.0015f)
        if (simplified.size < 3) {
            message("Trazo demasiado corto")
            return
        }
        val layer = _project.value.layer(layerId) ?: return
        val mask = Mask(
            id = ProjectOps.newId(),
            name = "${MaskShape.FREEHAND.label} ${layer.masks.size + 1}",
            shape = MaskShape.FREEHAND,
            points = simplified,
        )
        updateLayer(layerId) { it.copy(masks = it.masks + mask) }
        selectMask(mask.id)
    }

    fun updateMask(layerId: String, maskId: String, f: (Mask) -> Mask) =
        updateLayer(layerId) { ProjectOps.updateMask(it, maskId, f) }

    fun updateMaskLive(layerId: String, maskId: String, f: (Mask) -> Mask) =
        updateLayerLive(layerId) { ProjectOps.updateMask(it, maskId, f) }

    fun moveMaskPoint(layerId: String, maskId: String, index: Int, uv: Vec2) {
        updateMaskLive(layerId, maskId) { m ->
            if (index !in m.points.indices) m
            else m.copy(points = m.points.toMutableList().apply { set(index, uv.clamp(-0.25f, 1.25f)) })
        }
    }

    fun deleteMask(layerId: String, maskId: String) {
        updateLayer(layerId) { l -> l.copy(masks = l.masks.filterNot { it.id == maskId }) }
        validateSelection()
    }

    // ---------------------------------------------------------- output, grid

    fun setOutput(settings: OutputSettings) = applyEdit { it.copy(output = settings) }

    fun setGrid(settings: GridSettings) = applyNoHistory { it.copy(grid = settings) }

    fun toggleGrid() = setGrid(_project.value.grid.let { it.copy(enabled = !it.enabled) })

    // ------------------------------------------------------------ projection

    fun startProjection() {
        val target = _project.value.output.target
        if (target == OutputTarget.EXTERNAL && displays.value.isEmpty()) {
            _events.tryEmit(UiEvent.NoExternalDisplay)
            return
        }
        _projection.value = ProjectionState(active = true)
    }

    fun startProjectionOn(target: OutputTarget) {
        setOutput(_project.value.output.copy(target = target))
        _projection.value = ProjectionState(active = true)
    }

    fun stopProjection() {
        _projection.value = ProjectionState(active = false)
    }

    // -------------------------------------------------------------- playback

    fun togglePlay() = media.togglePlay()

    // ------------------------------------------------------- files / project

    fun newProject() {
        commitEdit()
        val p = ProjectOps.newProject()
        history.clear()
        setProjectInternal(p)
        savedProject.value = p
        _documentUri.value = null
        repo.currentDocumentUri = null
        _editor.value = EditorState()
        media.verifyMedia(p)
    }

    fun openProject(uri: Uri) {
        viewModelScope.launch {
            try {
                MediaProbe.persistReadWritePermission(getApplication(), uri)
                val p = repo.load(uri)
                commitEdit()
                history.clear()
                setProjectInternal(p)
                savedProject.value = p
                _documentUri.value = uri
                repo.currentDocumentUri = uri
                _editor.value = EditorState()
                media.verifyMedia(p)
                message("Proyecto abierto: ${p.name}")
            } catch (e: Exception) {
                message("No se pudo abrir: ${e.message}")
            }
        }
    }

    fun save() {
        val uri = _documentUri.value
        if (uri == null) {
            _events.tryEmit(UiEvent.RequestSaveAs)
            return
        }
        saveTo(uri)
    }

    fun saveAs(uri: Uri) {
        MediaProbe.persistReadWritePermission(getApplication(), uri)
        val fileName = MediaProbe.displayName(getApplication(), uri)
        val name = fileName?.substringBeforeLast(".${Project.FILE_EXTENSION}")?.takeIf { it.isNotBlank() }
        if (name != null) applyNoHistory { it.copy(name = name) }
        _documentUri.value = uri
        repo.currentDocumentUri = uri
        saveTo(uri)
    }

    private fun saveTo(uri: Uri) {
        commitEdit()
        val p = _project.value.copy(modifiedAt = System.currentTimeMillis())
        viewModelScope.launch {
            try {
                repo.save(uri, p)
                applyNoHistory { it.copy(modifiedAt = p.modifiedAt) }
                savedProject.value = _project.value
                prefs.edit().putBoolean(KEY_AUTOSAVE_DIRTY, false).apply()
                message("Proyecto guardado")
            } catch (e: Exception) {
                message("Error al guardar: ${e.message}")
            }
        }
    }

    fun exportFrame(uri: Uri) {
        engine.captureFrame { bmp ->
            if (bmp == null) {
                message("No se pudo capturar el fotograma")
                return@captureFrame
            }
            viewModelScope.launch {
                try {
                    repo.exportPng(uri, bmp)
                    message("Fotograma exportado (${bmp.width}x${bmp.height})")
                } catch (e: Exception) {
                    message("Error al exportar: ${e.message}")
                } finally {
                    bmp.recycle()
                }
            }
        }
    }

    // ------------------------------------------------------- missing files

    /** Missing media as (uri, displayName) pairs, one per distinct file. */
    fun missingFiles(missing: Set<String>): List<Pair<String, String>> =
        ProjectOps.mediaRefs(_project.value).map { it.second }.filter { it.uri in missing }
            .distinctBy { it.uri }.map { it.uri to it.displayName }

    fun relinkFile(oldUri: String, newUri: Uri) {
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            MediaProbe.persistReadPermission(ctx, newUri)
            val probed = withContext(Dispatchers.IO) { MediaProbe.probe(ctx, newUri) }
            if (probed == null) {
                message("Ese archivo no es un video/imagen compatible")
                return@launch
            }
            applyEdit { ProjectOps.relinkMedia(it, oldUri, probed.ref) }
            media.clearMissing(oldUri)
            message("Archivo vinculado: ${probed.ref.displayName}")
        }
    }

    fun searchMissingInFolder(treeUri: Uri, missing: Set<String>) {
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            MediaProbe.persistReadPermission(ctx, treeUri)
            val refs = ProjectOps.mediaRefs(_project.value).map { it.second }.filter { it.uri in missing }.distinctBy { it.uri }
            if (refs.isEmpty()) return@launch
            val wanted = refs.associate { it.displayName to it.sizeBytes }
            val found = withContext(Dispatchers.IO) { MediaProbe.findInTree(ctx, treeUri, wanted) }
            var relinked = 0
            for (ref in refs) {
                val uri = found[ref.displayName] ?: continue
                val probed = withContext(Dispatchers.IO) { MediaProbe.probe(ctx, uri) } ?: continue
                applyEdit { ProjectOps.relinkMedia(it, ref.uri, probed.ref) }
                media.clearMissing(ref.uri)
                relinked++
            }
            message("Encontrados $relinked de ${refs.size} archivos")
        }
    }

    private companion object {
        const val KEY_AUTOSAVE_DIRTY = "autosave_dirty"
    }
}
