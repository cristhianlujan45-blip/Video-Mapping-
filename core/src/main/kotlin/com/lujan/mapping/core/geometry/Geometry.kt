package com.lujan.mapping.core.geometry

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * 2D point. Surfaces live in *normalized output space*: (0,0) is the top-left of the
 * projector output and (1,1) the bottom-right, independent of the output resolution.
 * Masks live in *surface space* (content UV): (0,0) top-left of the surface content.
 */
@Serializable
data class Vec2(val x: Float, val y: Float) {
    operator fun plus(o: Vec2) = Vec2(x + o.x, y + o.y)
    operator fun minus(o: Vec2) = Vec2(x - o.x, y - o.y)
    operator fun times(s: Float) = Vec2(x * s, y * s)
    fun length(): Float = hypot(x, y)
    fun distanceTo(o: Vec2): Float = hypot(x - o.x, y - o.y)
    fun clamp(min: Float, max: Float) = Vec2(x.coerceIn(min, max), y.coerceIn(min, max))

    companion object {
        val ZERO = Vec2(0f, 0f)
    }
}

/** Corner indices, in the order used everywhere (clockwise from top-left). */
object Corner {
    const val TOP_LEFT = 0
    const val TOP_RIGHT = 1
    const val BOTTOM_RIGHT = 2
    const val BOTTOM_LEFT = 3
}

/**
 * The four corners of a mapped surface. Corner i maps content UV:
 * TL=(0,0), TR=(1,0), BR=(1,1), BL=(0,1).
 */
@Serializable
data class Quad(val tl: Vec2, val tr: Vec2, val br: Vec2, val bl: Vec2) {

    val corners: List<Vec2> get() = listOf(tl, tr, br, bl)

    fun corner(index: Int): Vec2 = when (index) {
        Corner.TOP_LEFT -> tl
        Corner.TOP_RIGHT -> tr
        Corner.BOTTOM_RIGHT -> br
        Corner.BOTTOM_LEFT -> bl
        else -> throw IndexOutOfBoundsException("corner $index")
    }

    fun withCorner(index: Int, p: Vec2): Quad = when (index) {
        Corner.TOP_LEFT -> copy(tl = p)
        Corner.TOP_RIGHT -> copy(tr = p)
        Corner.BOTTOM_RIGHT -> copy(br = p)
        Corner.BOTTOM_LEFT -> copy(bl = p)
        else -> throw IndexOutOfBoundsException("corner $index")
    }

    fun map(f: (Vec2) -> Vec2) = Quad(f(tl), f(tr), f(br), f(bl))

    fun translate(d: Vec2) = map { it + d }

    fun centroid(): Vec2 = Vec2((tl.x + tr.x + br.x + bl.x) / 4f, (tl.y + tr.y + br.y + bl.y) / 4f)

    /** Axis aligned bounds: [minX, minY, maxX, maxY]. */
    fun bounds(): FloatArray {
        val xs = floatArrayOf(tl.x, tr.x, br.x, bl.x)
        val ys = floatArrayOf(tl.y, tr.y, br.y, bl.y)
        return floatArrayOf(xs.min(), ys.min(), xs.max(), ys.max())
    }

    /** Point-in-polygon (even-odd). Works for non-convex quads too. */
    fun contains(p: Vec2): Boolean {
        val pts = corners
        var inside = false
        var j = pts.size - 1
        for (i in pts.indices) {
            val a = pts[i]
            val b = pts[j]
            if ((a.y > p.y) != (b.y > p.y) &&
                p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x
            ) inside = !inside
            j = i
        }
        return inside
    }

    /** True when the quad is strictly convex and non-degenerate (valid for perspective mapping). */
    fun isConvex(): Boolean {
        val pts = corners
        var sign = 0
        for (i in 0 until 4) {
            val a = pts[i]
            val b = pts[(i + 1) % 4]
            val c = pts[(i + 2) % 4]
            val cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
            if (abs(cross) < 1e-9f) return false
            val s = if (cross > 0) 1 else -1
            if (sign == 0) sign = s else if (s != sign) return false
        }
        return true
    }

    companion object {
        /** Axis-aligned rectangle centered at (cx, cy). */
        fun rect(cx: Float, cy: Float, w: Float, h: Float): Quad {
            val hw = w / 2f
            val hh = h / 2f
            return Quad(
                Vec2(cx - hw, cy - hh), Vec2(cx + hw, cy - hh),
                Vec2(cx + hw, cy + hh), Vec2(cx - hw, cy + hh)
            )
        }

        val FULL = Quad(Vec2(0f, 0f), Vec2(1f, 0f), Vec2(1f, 1f), Vec2(0f, 1f))
    }
}

/**
 * Persistent position / scale / rotation applied on top of the base corners.
 *
 * Rotation is applied in *pixel-proportional* space (x multiplied by the output aspect
 * ratio) so that rotating a square surface keeps it square on a 16:9 output.
 */
@Serializable
data class LayerTransform(
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val scale: Float = 1f,
    val rotationDeg: Float = 0f,
) {
    val isIdentity: Boolean
        get() = offsetX == 0f && offsetY == 0f && scale == 1f && rotationDeg == 0f

    fun apply(base: Quad, aspect: Float): Quad {
        if (isIdentity) return base
        val c = base.centroid()
        val rad = Math.toRadians(rotationDeg.toDouble())
        val cs = cos(rad).toFloat()
        val sn = sin(rad).toFloat()
        return base.map { p ->
            val dx = (p.x - c.x) * aspect
            val dy = p.y - c.y
            val rx = (dx * cs - dy * sn) * scale
            val ry = (dx * sn + dy * cs) * scale
            Vec2(c.x + rx / aspect + offsetX, c.y + ry + offsetY)
        }
    }
}
