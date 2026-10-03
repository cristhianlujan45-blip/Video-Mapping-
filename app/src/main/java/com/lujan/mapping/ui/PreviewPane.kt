package com.lujan.mapping.ui

import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateRotation
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.sp
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.geometry.Homography
import com.lujan.mapping.core.geometry.Quad
import com.lujan.mapping.core.geometry.Vec2
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.Mask
import com.lujan.mapping.core.model.MaskShape
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.core.model.ScaleMode
import com.lujan.mapping.render.RenderEngine
import com.lujan.mapping.render.ViewRect
import com.lujan.mapping.ui.theme.LujanColors
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * GL surface that receives the composition (registered as a render target).
 */
@Composable
fun RenderSurface(
    engine: RenderEngine,
    targetId: String,
    kind: RenderEngine.TargetKind,
    marginPx: Float,
    modifier: Modifier = Modifier,
) {
    val callback = remember(targetId, kind, marginPx) {
        object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {}
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                engine.attachTarget(targetId, holder.surface, width, height, kind, marginPx)
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                engine.detachTarget(targetId)
            }
        }
    }
    DisposableEffect(targetId) {
        onDispose { engine.detachTarget(targetId) }
    }
    AndroidView(
        factory = { ctx -> SurfaceView(ctx).apply { holder.addCallback(callback) } },
        modifier = modifier,
    )
}

private sealed interface DragTarget {
    data class CornerHandle(val layerId: String, val corner: Int, var view: Offset) : DragTarget
    data class Surface(val layerId: String) : DragTarget
    data class MaskPoint(val layerId: String, val maskId: String, val index: Int, var view: Offset) : DragTarget
    data class MaskMove(val layerId: String, val maskId: String) : DragTarget
    data class Freehand(val layerId: String) : DragTarget
}

/**
 * Editor preview: the live GL output plus the touch overlay used for mapping.
 * [outputMode] = true renders like the projector (no margin, honors scale mode) and only
 * draws handles when [showHandles] is set (used by the INTERNAL fullscreen output).
 */
@Composable
fun MappingView(
    vm: EditorViewModel,
    project: Project,
    editor: EditorState,
    targetId: String,
    outputMode: Boolean,
    showHandles: Boolean,
    modifier: Modifier = Modifier,
    margin: Dp = 28.dp,
) {
    val density = LocalDensity.current
    val marginPx = if (outputMode) 0f else with(density) { margin.toPx() }
    val handleRadius = with(density) { 13.dp.toPx() }
    val hitRadius = with(density) { 30.dp.toPx() }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var menu by remember { mutableStateOf<Pair<Offset, String>?>(null) }
    val freehand = remember { mutableStateListOf<Offset>() }
    val textMeasurer = rememberTextMeasurer()

    val aspect = project.output.aspect
    val rect = when {
        size.width == 0 -> ViewRect(0f, 0f, 1f, 1f)
        outputMode && project.output.scaleMode == ScaleMode.STRETCH -> ViewRect.full(size.width.toFloat(), size.height.toFloat())
        else -> ViewRect.fit(size.width.toFloat(), size.height.toFloat(), aspect, marginPx)
    }
    val currentProject by rememberUpdatedState(project)
    val currentEditor by rememberUpdatedState(editor)
    val currentRect by rememberUpdatedState(rect)
    val handlesEnabled by rememberUpdatedState(showHandles)

    fun toView(p: Vec2, r: ViewRect = currentRect) = Offset(r.left + p.x * r.width, r.top + p.y * r.height)
    fun toModel(o: Offset, r: ViewRect = currentRect) = Vec2((o.x - r.left) / r.width, (o.y - r.top) / r.height)

    fun layerAt(pos: Offset): Layer? {
        val m = toModel(pos)
        val asp = currentProject.output.aspect
        return currentProject.layers.lastOrNull { it.visible && !it.locked && it.finalQuad(asp).contains(m) }
    }

    Box(modifier.onSizeChanged { size = it }) {
        RenderSurface(
            engine = vm.engine,
            targetId = targetId,
            kind = if (outputMode) RenderEngine.TargetKind.OUTPUT else RenderEngine.TargetKind.PREVIEW,
            marginPx = marginPx,
            modifier = Modifier.fillMaxSize(),
        )

        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = { pos ->
                            if (!handlesEnabled) return@detectTapGestures
                            val ed = currentEditor
                            val asp = currentProject.output.aspect
                            val sel = currentProject.layer(ed.selectedLayerId)
                            if (sel != null && ed.mode == EditMode.SURFACE) {
                                val q = sel.finalQuad(asp)
                                val idx = (0 until 4).minByOrNull { (toView(q.corner(it)) - pos).getDistance() }!!
                                if ((toView(q.corner(idx)) - pos).getDistance() < hitRadius && !sel.locked) {
                                    vm.selectCorner(idx); return@detectTapGestures
                                }
                            }
                            if (ed.mode != EditMode.SURFACE && sel != null && sel.finalQuad(asp).contains(toModel(pos))) {
                                return@detectTapGestures
                            }
                            val hit = layerAt(pos)
                            if (ed.mode != EditMode.SURFACE && hit?.id != sel?.id) vm.setMode(EditMode.SURFACE)
                            vm.selectLayer(hit?.id)
                            vm.selectCorner(null)
                        },
                        onDoubleTap = { pos ->
                            if (!handlesEnabled) return@detectTapGestures
                            // Double tap cycles through overlapping surfaces under the finger.
                            val m = toModel(pos)
                            val asp = currentProject.output.aspect
                            val hits = currentProject.layers.filter { it.visible && it.finalQuad(asp).contains(m) }.reversed()
                            if (hits.isEmpty()) return@detectTapGestures
                            val cur = hits.indexOfFirst { it.id == currentEditor.selectedLayerId }
                            vm.selectLayer(hits[(cur + 1) % hits.size].id)
                        },
                        onLongPress = { pos ->
                            if (!handlesEnabled) return@detectTapGestures
                            val m = toModel(pos)
                            val asp = currentProject.output.aspect
                            val hit = currentProject.layers.lastOrNull { it.visible && it.finalQuad(asp).contains(m) }
                            if (hit != null) {
                                vm.selectLayer(hit.id)
                                menu = pos to hit.id
                            }
                        },
                    )
                }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        if (!handlesEnabled) return@awaitEachGesture
                        val ed = currentEditor
                        val proj = currentProject
                        val asp = proj.output.aspect
                        val sel = proj.layer(ed.selectedLayerId)?.takeIf { !it.locked && it.visible }
                        val pos = down.position

                        val target: DragTarget = when {
                            sel != null && ed.mode == EditMode.FREEHAND_DRAW -> DragTarget.Freehand(sel.id)
                            sel != null && ed.mode == EditMode.MASK && ed.selectedMaskId != null -> {
                                val mask = sel.masks.firstOrNull { it.id == ed.selectedMaskId }
                                val h = Homography.squareToQuad(sel.finalQuad(asp))
                                if (mask == null || h == null) null else {
                                    val handles = maskHandles(mask)
                                    val nearest = handles.indices.minByOrNull { i ->
                                        h.map(handles[i])?.let { (toView(it) - pos).getDistance() } ?: Float.MAX_VALUE
                                    }
                                    val nearestView = nearest?.let { h.map(handles[it]) }?.let { toView(it) }
                                    if (nearest != null && nearestView != null && (nearestView - pos).getDistance() < hitRadius) {
                                        DragTarget.MaskPoint(sel.id, mask.id, nearest, nearestView)
                                    } else if (sel.finalQuad(asp).contains(toModel(pos))) {
                                        DragTarget.MaskMove(sel.id, mask.id)
                                    } else null
                                }
                            }
                            else -> {
                                var t: DragTarget? = null
                                if (sel != null) {
                                    val q = sel.finalQuad(asp)
                                    val idx = (0 until 4).minByOrNull { (toView(q.corner(it)) - pos).getDistance() }!!
                                    val cornerView = toView(q.corner(idx))
                                    if ((cornerView - pos).getDistance() < hitRadius) {
                                        t = DragTarget.CornerHandle(sel.id, idx, cornerView)
                                    } else if (q.contains(toModel(pos))) {
                                        t = DragTarget.Surface(sel.id)
                                    }
                                }
                                if (t == null) {
                                    val hit = layerAt(pos)
                                    if (hit != null) {
                                        vm.selectLayer(hit.id)
                                        t = DragTarget.Surface(hit.id)
                                    }
                                }
                                t
                            }
                        } ?: return@awaitEachGesture

                        if (target is DragTarget.CornerHandle) vm.selectCorner(target.corner)
                        val fine = if (ed.fineMode) 0.2f else 1f
                        var pastSlop = false
                        vm.beginEdit()
                        if (target is DragTarget.Freehand) {
                            freehand.clear()
                            freehand.add(pos)
                        }
                        try {
                            while (true) {
                                val event = awaitPointerEvent()
                                val pressed = event.changes.filter { it.pressed }
                                if (pressed.isEmpty()) break
                                val primary = event.changes.firstOrNull { it.id == down.id } ?: pressed.first()
                                if (!pastSlop) {
                                    if ((primary.position - pos).getDistance() < viewConfiguration.touchSlop && pressed.size < 2) continue
                                    pastSlop = true
                                }
                                val r = currentRect
                                when (target) {
                                    is DragTarget.CornerHandle -> {
                                        target.view = target.view + primary.positionChange() * fine
                                        vm.dragCornerTo(target.layerId, target.corner, toModel(target.view, r))
                                    }
                                    is DragTarget.Surface -> {
                                        val pan = event.calculatePan() * fine
                                        vm.moveSurfaceBy(target.layerId, Vec2(pan.x / r.width, pan.y / r.height))
                                        if (pressed.size >= 2) {
                                            val zoom = event.calculateZoom()
                                            val rot = event.calculateRotation()
                                            vm.scaleRotateSurface(target.layerId, 1f + (zoom - 1f) * fine, rot * fine)
                                        }
                                    }
                                    is DragTarget.MaskPoint -> {
                                        target.view = target.view + primary.positionChange() * fine
                                        val layer = currentProject.layer(target.layerId)
                                        val inv = layer?.let { Homography.quadToSquare(it.finalQuad(currentProject.output.aspect)) }
                                        val uv = inv?.map(toModel(target.view, r))
                                        if (uv != null) moveHandle(vm, target.layerId, target.maskId, target.index, uv)
                                    }
                                    is DragTarget.MaskMove -> {
                                        val layer = currentProject.layer(target.layerId)
                                        val inv = layer?.let { Homography.quadToSquare(it.finalQuad(currentProject.output.aspect)) }
                                        val prevPos = primary.previousPosition
                                        val curPos = prevPos + primary.positionChange() * fine
                                        val a = inv?.map(toModel(prevPos, r))
                                        val b = inv?.map(toModel(curPos, r))
                                        if (a != null && b != null) {
                                            val d = b - a
                                            vm.updateMaskLive(target.layerId, target.maskId) { m -> m.copy(points = m.points.map { it + d }) }
                                        }
                                    }
                                    is DragTarget.Freehand -> freehand.add(primary.position)
                                }
                                event.changes.forEach { if (it.positionChange() != Offset.Zero) it.consume() }
                            }
                        } finally {
                            vm.commitEdit()
                            if (target is DragTarget.Freehand) {
                                val layer = currentProject.layer(target.layerId)
                                val inv = layer?.let { Homography.quadToSquare(it.finalQuad(currentProject.output.aspect)) }
                                if (inv != null && freehand.size > 2) {
                                    val uv = freehand.mapNotNull { inv.map(toModel(it)) }
                                    vm.addFreehandMask(target.layerId, uv)
                                }
                                freehand.clear()
                            }
                        }
                    }
                }
        ) {
            if (!showHandles) return@Canvas
            drawOverlay(project, editor, rect, handleRadius, freehand, textMeasurer)
        }

        val m = menu
        if (m != null) {
            Box(Modifier.offset { IntOffset(m.first.x.roundToInt(), m.first.y.roundToInt()) }) {
                LayerContextMenu(vm, m.second, onDismiss = { menu = null })
            }
        }
    }
}

/** Handle points of a mask in UV space. */
private fun maskHandles(mask: Mask): List<Vec2> = when (mask.shape) {
    MaskShape.RECTANGLE, MaskShape.ELLIPSE -> mask.points.take(2)
    MaskShape.POLYGON -> mask.points
    MaskShape.FREEHAND -> if (mask.points.size <= 60) mask.points else emptyList()
}

private fun moveHandle(vm: EditorViewModel, layerId: String, maskId: String, index: Int, uv: Vec2) {
    vm.moveMaskPoint(layerId, maskId, index, uv)
}

/** Mask outline in UV space (closed polygon). */
private fun maskOutline(mask: Mask): List<Vec2> = when (mask.shape) {
    MaskShape.RECTANGLE -> {
        val b = ProjectOps.maskBounds(mask)
        listOf(Vec2(b[0], b[1]), Vec2(b[2], b[1]), Vec2(b[2], b[3]), Vec2(b[0], b[3]))
    }
    MaskShape.ELLIPSE -> {
        val b = ProjectOps.maskBounds(mask)
        val cx = (b[0] + b[2]) / 2f
        val cy = (b[1] + b[3]) / 2f
        val rx = (b[2] - b[0]) / 2f
        val ry = (b[3] - b[1]) / 2f
        (0 until 64).map { i ->
            val a = i / 64.0 * 2 * PI
            Vec2(cx + rx * cos(a).toFloat(), cy + ry * sin(a).toFloat())
        }
    }
    MaskShape.POLYGON, MaskShape.FREEHAND -> mask.points
}

private fun DrawScope.drawOverlay(
    project: Project,
    editor: EditorState,
    rect: ViewRect,
    handleRadius: Float,
    freehand: List<Offset>,
    textMeasurer: TextMeasurer,
) {
    fun v(p: Vec2) = Offset(rect.left + p.x * rect.width, rect.top + p.y * rect.height)
    val aspect = project.output.aspect
    val thin = 1.dp.toPx()
    val thick = 2.dp.toPx()

    // Output frame.
    drawRect(Color(0x55FFFFFF), topLeft = Offset(rect.left, rect.top),
        size = androidx.compose.ui.geometry.Size(rect.width, rect.height), style = Stroke(thin))

    fun quadPath(q: Quad) = Path().apply {
        moveTo(v(q.tl).x, v(q.tl).y); lineTo(v(q.tr).x, v(q.tr).y)
        lineTo(v(q.br).x, v(q.br).y); lineTo(v(q.bl).x, v(q.bl).y); close()
    }

    for (layer in project.layers) {
        if (!layer.visible || layer.id == editor.selectedLayerId) continue
        drawPath(quadPath(layer.finalQuad(aspect)), Color(0x66FFFFFF), style = Stroke(thin))
    }

    val sel = project.layer(editor.selectedLayerId) ?: return
    val q = sel.finalQuad(aspect)
    val h = Homography.squareToQuad(q)
    val valid = h != null
    val outline = when {
        !valid -> LujanColors.Danger
        sel.locked -> Color(0xFF8A8F99)
        else -> LujanColors.Outline
    }
    drawPath(quadPath(q), outline, style = Stroke(thick,
        pathEffect = if (sel.locked) PathEffect.dashPathEffect(floatArrayOf(12f, 8f)) else null))

    // Perspective guides: content mid-lines through the homography.
    if (h != null) {
        for (t in listOf(0.25f, 0.5f, 0.75f)) {
            val a = h.map(t.toDouble(), 0.0); val b = h.map(t.toDouble(), 1.0)
            val c = h.map(0.0, t.toDouble()); val d = h.map(1.0, t.toDouble())
            if (a != null && b != null) drawLine(outline.copy(alpha = 0.25f), v(a), v(b), thin)
            if (c != null && d != null) drawLine(outline.copy(alpha = 0.25f), v(c), v(d), thin)
        }
    }

    if (editor.mode == EditMode.SURFACE && !sel.locked) {
        // Corner handles carry the same colors as the test pattern corners (TL red, TR green, BR blue, BL yellow).
        val cornerColors = listOf(Color(0xFFFF2626), Color(0xFF26FF40), Color(0xFF3366FF), Color(0xFFFFE619))
        for (i in 0 until 4) {
            val c = v(q.corner(i))
            val selected = editor.selectedCorner == i
            drawCircle(Color(0xAA000000), handleRadius + thick, c)
            drawCircle(if (selected) Color.White else LujanColors.Handle, handleRadius, c)
            drawCircle(cornerColors[i], handleRadius * 0.45f, c)
            if (selected) drawCircle(LujanColors.Handle, handleRadius + 3 * thick, c, style = Stroke(thick))
        }
        val center = v(q.centroid())
        drawLine(LujanColors.Outline, center - Offset(10f, 0f), center + Offset(10f, 0f), thick)
        drawLine(LujanColors.Outline, center - Offset(0f, 10f), center + Offset(0f, 10f), thick)
    }

    if (h != null) {
        for (mask in sel.masks) {
            val isSel = mask.id == editor.selectedMaskId
            if (!isSel && editor.mode == EditMode.SURFACE) continue
            val pts = maskOutline(mask).mapNotNull { h.map(it) }
            if (pts.size < 2) continue
            val path = Path().apply {
                moveTo(v(pts[0]).x, v(pts[0]).y)
                for (k in 1 until pts.size) lineTo(v(pts[k]).x, v(pts[k]).y)
                close()
            }
            drawPath(path, if (isSel) LujanColors.MaskOutline else LujanColors.MaskOutline.copy(alpha = 0.35f),
                style = Stroke(if (isSel) thick else thin, pathEffect = if (mask.inverted) PathEffect.dashPathEffect(floatArrayOf(10f, 6f)) else null))
            if (isSel && editor.mode == EditMode.MASK) {
                maskHandles(mask).forEach { p ->
                    h.map(p)?.let {
                        drawCircle(Color(0xAA000000), handleRadius * 0.8f + thick, v(it))
                        drawCircle(LujanColors.MaskOutline, handleRadius * 0.8f, v(it))
                    }
                }
            }
        }
    }

    if (freehand.size > 1) {
        val path = Path().apply {
            moveTo(freehand[0].x, freehand[0].y)
            for (k in 1 until freehand.size) lineTo(freehand[k].x, freehand[k].y)
        }
        drawPath(path, LujanColors.MaskOutline, style = Stroke(thick))
    }

    if (!valid) {
        drawText(
            textMeasurer,
            "Esquinas cruzadas: la superficie no se puede deformar así",
            topLeft = Offset(rect.left + 8.dp.toPx(), rect.top + 8.dp.toPx()),
            style = TextStyle(color = LujanColors.Danger, fontSize = 14.sp),
        )
    }
}

@Composable
fun LayerContextMenu(vm: EditorViewModel, layerId: String, onDismiss: () -> Unit) {
    val layer = vm.project.value.layer(layerId) ?: return
    DropdownMenu(expanded = true, onDismissRequest = onDismiss) {
        Text(layer.name, modifier = Modifier.offset(x = 16.dp), color = LujanColors.TextDim)
        HorizontalDivider()
        DropdownMenuItem(text = { Text("Duplicar") }, onClick = { vm.duplicateLayer(layerId); onDismiss() })
        DropdownMenuItem(text = { Text(if (layer.locked) "Desbloquear" else "Bloquear") },
            onClick = { vm.updateLayer(layerId) { it.copy(locked = !it.locked) }; onDismiss() })
        DropdownMenuItem(text = { Text("Espejo horizontal") },
            onClick = { vm.updateLayer(layerId) { it.copy(flipH = !it.flipH) }; onDismiss() })
        DropdownMenuItem(text = { Text("Espejo vertical") },
            onClick = { vm.updateLayer(layerId) { it.copy(flipV = !it.flipV) }; onDismiss() })
        DropdownMenuItem(text = { Text("Restablecer esquinas") },
            onClick = { vm.updateLayer(layerId) { ProjectOps.resetCorners(it, vm.aspect) }; onDismiss() })
        DropdownMenuItem(text = { Text("Ocupar toda la salida") },
            onClick = { vm.updateLayer(layerId) { ProjectOps.fillOutput(it) }; onDismiss() })
        DropdownMenuItem(text = { Text("Traer al frente") }, onClick = { vm.moveLayerToEdge(layerId, true); onDismiss() })
        DropdownMenuItem(text = { Text("Enviar al fondo") }, onClick = { vm.moveLayerToEdge(layerId, false); onDismiss() })
        HorizontalDivider()
        DropdownMenuItem(text = { Text("Eliminar…", color = LujanColors.Danger) },
            onClick = { vm.confirmDeleteLayer.value = layerId; onDismiss() })
    }
}
