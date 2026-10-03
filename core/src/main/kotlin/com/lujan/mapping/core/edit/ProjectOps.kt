package com.lujan.mapping.core.edit

import com.lujan.mapping.core.geometry.LayerTransform
import com.lujan.mapping.core.geometry.Quad
import com.lujan.mapping.core.geometry.Vec2
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.LayerContent
import com.lujan.mapping.core.model.Mask
import com.lujan.mapping.core.model.MaskShape
import com.lujan.mapping.core.model.MediaRef
import com.lujan.mapping.core.model.Project
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/** Pure, side-effect free project edits. Every function returns a new Project. */
object ProjectOps {

    fun newId(): String = UUID.randomUUID().toString()

    fun newProject(name: String = "Proyecto sin título", now: Long = System.currentTimeMillis()): Project =
        Project(id = newId(), name = name, createdAt = now, modifiedAt = now)

    /**
     * Initial quad for content with the given aspect ratio: centered, ~60% of the output
     * height, keeping the content proportions on the projected image.
     */
    fun defaultQuad(contentAspect: Float, outputAspect: Float): Quad {
        val safeContent = if (contentAspect.isFinite() && contentAspect > 0f) contentAspect else 16f / 9f
        var h = 0.6f
        var w = h * safeContent / outputAspect
        if (w > 0.9f) {
            w = 0.9f
            h = w * outputAspect / safeContent
        }
        return Quad.rect(0.5f, 0.5f, w, h)
    }

    fun uniqueName(project: Project, base: String): String {
        val names = project.layers.map { it.name }.toSet()
        if (base !in names) return base
        var i = 2
        while ("$base $i" in names) i++
        return "$base $i"
    }

    fun createLayer(project: Project, content: LayerContent, baseName: String, contentAspect: Float): Layer =
        Layer(
            id = newId(),
            name = uniqueName(project, baseName),
            corners = defaultQuad(contentAspect, project.output.aspect),
            content = content,
        )

    fun mediaLayerName(media: MediaRef): String = media.displayName.substringBeforeLast('.').ifBlank { "Medio" }

    fun addLayer(project: Project, layer: Layer): Project = project.copy(layers = project.layers + layer)

    fun updateLayer(project: Project, id: String, f: (Layer) -> Layer): Project =
        project.copy(layers = project.layers.map { if (it.id == id) f(it) else it })

    fun removeLayer(project: Project, id: String): Project =
        project.copy(layers = project.layers.filterNot { it.id == id })

    fun duplicateLayer(project: Project, id: String): Pair<Project, String?> {
        val idx = project.layers.indexOfFirst { it.id == id }
        if (idx < 0) return project to null
        val src = project.layers[idx]
        val offset = Vec2(0.03f, 0.03f)
        val copy = src.copy(
            id = newId(),
            name = uniqueName(project, src.name + " copia"),
            corners = src.corners.translate(offset),
            locked = false,
            masks = src.masks.map { it.copy(id = newId()) },
        )
        val list = project.layers.toMutableList().apply { add(idx + 1, copy) }
        return project.copy(layers = list) to copy.id
    }

    /** delta = +1 moves the layer up (drawn later / on top), -1 down. */
    fun moveLayer(project: Project, id: String, delta: Int): Project {
        val idx = project.layers.indexOfFirst { it.id == id }
        if (idx < 0) return project
        val target = (idx + delta).coerceIn(0, project.layers.lastIndex)
        if (target == idx) return project
        val list = project.layers.toMutableList()
        val l = list.removeAt(idx)
        list.add(target, l)
        return project.copy(layers = list)
    }

    fun moveLayerToEdge(project: Project, id: String, top: Boolean): Project {
        val l = project.layer(id) ?: return project
        val rest = project.layers.filterNot { it.id == id }
        return project.copy(layers = if (top) rest + l else listOf(l) + rest)
    }

    /**
     * Folds the transform into the base corners so that dragging a single corner does not
     * move the others through the transform pivot.
     */
    fun bakeTransform(layer: Layer, aspect: Float): Layer =
        if (layer.transform.isIdentity) layer
        else layer.copy(corners = layer.finalQuad(aspect), transform = LayerTransform())

    /** Moves one final-space corner to [p] (corner pinning). */
    fun setCorner(layer: Layer, corner: Int, p: Vec2, aspect: Float): Layer {
        val baked = bakeTransform(layer, aspect)
        return baked.copy(corners = baked.corners.withCorner(corner, p.clamp(-0.5f, 1.5f)))
    }

    fun resetCorners(layer: Layer, aspect: Float): Layer {
        val media = layer.content.media
        val contentAspect = if (media != null && media.width > 0 && media.height > 0)
            media.width.toFloat() / media.height else 16f / 9f
        return layer.copy(corners = defaultQuad(contentAspect, aspect), transform = LayerTransform())
    }

    /** Makes the surface cover the whole output. */
    fun fillOutput(layer: Layer): Layer = layer.copy(corners = Quad.FULL, transform = LayerTransform())

    // ------------------------------------------------------------------ masks

    fun defaultMask(shape: MaskShape, name: String): Mask {
        val pts = when (shape) {
            MaskShape.RECTANGLE, MaskShape.ELLIPSE -> listOf(Vec2(0.2f, 0.2f), Vec2(0.8f, 0.8f))
            MaskShape.POLYGON -> listOf(Vec2(0.5f, 0.15f), Vec2(0.85f, 0.8f), Vec2(0.15f, 0.8f))
            MaskShape.FREEHAND -> emptyList()
        }
        return Mask(id = newId(), name = name, shape = shape, points = pts)
    }

    fun updateMask(layer: Layer, maskId: String, f: (Mask) -> Mask): Layer =
        layer.copy(masks = layer.masks.map { if (it.id == maskId) f(it) else it })

    /** Inserts a vertex in the middle of the longest edge of a polygon mask. */
    fun insertPolygonPoint(mask: Mask): Mask {
        val pts = mask.points
        if (pts.size < 2) return mask
        var best = 0
        var bestLen = -1f
        for (i in pts.indices) {
            val len = pts[i].distanceTo(pts[(i + 1) % pts.size])
            if (len > bestLen) {
                bestLen = len; best = i
            }
        }
        val a = pts[best]
        val b = pts[(best + 1) % pts.size]
        val mid = Vec2((a.x + b.x) / 2f, (a.y + b.y) / 2f)
        return mask.copy(points = pts.toMutableList().apply { add(best + 1, mid) })
    }

    fun removePolygonPoint(mask: Mask, index: Int): Mask {
        if (mask.points.size <= 3 || index !in mask.points.indices) return mask
        return mask.copy(points = mask.points.toMutableList().apply { removeAt(index) })
    }

    /** Normalized bounds [l, t, r, b] for RECTANGLE / ELLIPSE masks. */
    fun maskBounds(mask: Mask): FloatArray {
        if (mask.points.size < 2) return floatArrayOf(0f, 0f, 1f, 1f)
        val a = mask.points[0]
        val b = mask.points[1]
        return floatArrayOf(min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y))
    }

    /**
     * Ramer–Douglas–Peucker simplification for freehand masks: keeps the drawn shape
     * within [epsilon] while dropping the hundreds of redundant touch samples.
     */
    fun simplifyPath(points: List<Vec2>, epsilon: Float = 0.002f): List<Vec2> {
        if (points.size < 3) return points
        val keep = BooleanArray(points.size)
        keep[0] = true
        keep[points.lastIndex] = true
        val stack = ArrayDeque<IntArray>()
        stack.addLast(intArrayOf(0, points.lastIndex))
        while (stack.isNotEmpty()) {
            val (s, e) = stack.removeLast().let { it[0] to it[1] }
            var maxD = 0f
            var idx = -1
            for (i in s + 1 until e) {
                val d = pointSegmentDistance(points[i], points[s], points[e])
                if (d > maxD) {
                    maxD = d; idx = i
                }
            }
            if (idx >= 0 && maxD > epsilon) {
                keep[idx] = true
                stack.addLast(intArrayOf(s, idx))
                stack.addLast(intArrayOf(idx, e))
            }
        }
        return points.filterIndexed { i, _ -> keep[i] }
    }

    fun pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): Float {
        val abx = b.x - a.x
        val aby = b.y - a.y
        val len2 = abx * abx + aby * aby
        if (len2 == 0f) return p.distanceTo(a)
        val t = (((p.x - a.x) * abx + (p.y - a.y) * aby) / len2).coerceIn(0f, 1f)
        return p.distanceTo(Vec2(a.x + t * abx, a.y + t * aby))
    }

    // -------------------------------------------------------------- relinking

    fun mediaRefs(project: Project): List<Pair<String, MediaRef>> =
        project.layers.mapNotNull { l -> l.content.media?.let { l.id to it } }
            .filter { (id, _) ->
                val k = project.layer(id)?.content?.kind
                k == ContentKind.VIDEO || k == ContentKind.IMAGE
            }

    /** Replaces every reference to [oldUri] with [newRef] (several layers may share a file). */
    fun relinkMedia(project: Project, oldUri: String, newRef: MediaRef): Project =
        project.copy(layers = project.layers.map { l ->
            val m = l.content.media
            if (m != null && m.uri == oldUri) l.copy(content = l.content.copy(media = newRef)) else l
        })
}
