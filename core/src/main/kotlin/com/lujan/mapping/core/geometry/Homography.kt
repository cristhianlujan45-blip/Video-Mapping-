package com.lujan.mapping.core.geometry

import kotlin.math.abs

/**
 * 3x3 projective transform (row-major, double precision).
 *
 * Projection mapping needs a *true* perspective mapping between the content rectangle
 * and the four user-placed corners. Splitting the quad in two affine triangles (what a
 * naive textured quad does) produces a visible bend along the diagonal; a homography
 * maps straight lines to straight lines exactly, like a real projector keystone.
 *
 * The renderer evaluates the inverse homography per fragment, which gives pixel-exact
 * results regardless of how the quad is rasterized.
 */
class Homography(private val m: DoubleArray) {

    init {
        require(m.size == 9)
    }

    operator fun get(row: Int, col: Int): Double = m[row * 3 + col]

    /** Maps a point. Returns null when the point maps to infinity / behind the projection. */
    fun map(x: Double, y: Double): Vec2? {
        val w = m[6] * x + m[7] * y + m[8]
        if (abs(w) < 1e-12) return null
        return Vec2(
            ((m[0] * x + m[1] * y + m[2]) / w).toFloat(),
            ((m[3] * x + m[4] * y + m[5]) / w).toFloat()
        )
    }

    fun map(p: Vec2): Vec2? = map(p.x.toDouble(), p.y.toDouble())

    /** Homogeneous w for a point; its sign tells on which side of the horizon the point lies. */
    fun w(x: Double, y: Double): Double = m[6] * x + m[7] * y + m[8]

    fun inverse(): Homography? {
        val a = m[0]; val b = m[1]; val c = m[2]
        val d = m[3]; val e = m[4]; val f = m[5]
        val g = m[6]; val h = m[7]; val i = m[8]
        val A = e * i - f * h
        val B = -(d * i - f * g)
        val C = d * h - e * g
        val det = a * A + b * B + c * C
        if (abs(det) < 1e-15) return null
        val inv = doubleArrayOf(
            A, -(b * i - c * h), b * f - c * e,
            B, a * i - c * g, -(a * f - c * d),
            C, -(a * h - b * g), a * e - b * d
        )
        for (k in 0 until 9) inv[k] /= det
        return Homography(inv)
    }

    /** Column-major float array, ready for glUniformMatrix3fv. */
    fun toGlMat3(out: FloatArray = FloatArray(9)): FloatArray {
        for (row in 0 until 3) for (col in 0 until 3) out[col * 3 + row] = m[row * 3 + col].toFloat()
        return out
    }

    companion object {
        /**
         * Homography mapping the unit square (u,v in 0..1) to [quad]:
         * (0,0)->tl, (1,0)->tr, (1,1)->br, (0,1)->bl. (Heckbert, "Fundamentals of
         * Texture Mapping", 1989.) Returns null for degenerate quads.
         */
        fun squareToQuad(q: Quad): Homography? {
            val x0 = q.tl.x.toDouble(); val y0 = q.tl.y.toDouble()
            val x1 = q.tr.x.toDouble(); val y1 = q.tr.y.toDouble()
            val x2 = q.br.x.toDouble(); val y2 = q.br.y.toDouble()
            val x3 = q.bl.x.toDouble(); val y3 = q.bl.y.toDouble()

            val dx1 = x1 - x2; val dx2 = x3 - x2; val dx3 = x0 - x1 + x2 - x3
            val dy1 = y1 - y2; val dy2 = y3 - y2; val dy3 = y0 - y1 + y2 - y3

            val den = dx1 * dy2 - dx2 * dy1
            if (abs(den) < 1e-15) return null
            val g = (dx3 * dy2 - dx2 * dy3) / den
            val h = (dx1 * dy3 - dx3 * dy1) / den
            val a = x1 - x0 + g * x1
            val b = x3 - x0 + h * x3
            val d = y1 - y0 + g * y1
            val e = y3 - y0 + h * y3
            val result = Homography(doubleArrayOf(a, b, x0, d, e, y0, g, h, 1.0))
            // Reject quads whose interior crosses the horizon line (w must keep its sign).
            val ws = doubleArrayOf(result.w(0.0, 0.0), result.w(1.0, 0.0), result.w(1.0, 1.0), result.w(0.0, 1.0))
            if (ws.any { it <= 1e-9 }) return null
            return result
        }

        /** Inverse of [squareToQuad]: maps output space to content UV. */
        fun quadToSquare(q: Quad): Homography? = squareToQuad(q)?.inverse()
    }
}
