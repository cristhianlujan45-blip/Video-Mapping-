package com.lujan.mapping.render

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.model.Mask
import com.lujan.mapping.core.model.MaskShape

/**
 * Rasterizes a layer's masks into one alpha texture in surface (UV) space.
 *
 * Using the Android 2D canvas (Skia) gives antialiased polygons, ellipses, free paths
 * and Gaussian feathering for free; the result is only regenerated when a mask changes,
 * so per-frame GPU cost is a single texture lookup per fragment.
 */
object MaskRasterizer {

    const val SIZE = 1024

    fun hasActiveMasks(masks: List<Mask>): Boolean = masks.any { isActive(it) }

    private fun isActive(m: Mask): Boolean {
        if (!m.enabled || m.opacity <= 0f) return false
        return when (m.shape) {
            MaskShape.RECTANGLE, MaskShape.ELLIPSE -> m.points.size >= 2
            MaskShape.POLYGON, MaskShape.FREEHAND -> m.points.size >= 3
        }
    }

    /** Returns null when no mask is active (the layer is fully visible). */
    fun rasterize(masks: List<Mask>, size: Int = SIZE): Bitmap? {
        val active = masks.filter { isActive(it) }
        if (active.isEmpty()) return null

        val result = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        result.eraseColor(android.graphics.Color.WHITE)
        val canvas = Canvas(result)
        val coverage = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val coverageCanvas = Canvas(coverage)

        for (m in active) {
            coverage.eraseColor(android.graphics.Color.TRANSPARENT)
            val shapePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.WHITE
                style = Paint.Style.FILL
                if (m.feather > 0f) maskFilter = BlurMaskFilter(m.feather * size, BlurMaskFilter.Blur.NORMAL)
            }
            coverageCanvas.drawPath(pathFor(m, size), shapePaint)

            // coverage c -> visibility v:  normal: v = 1 - op*(1-c);  inverted: v = 1 - op*c
            val op = m.opacity.coerceIn(0f, 1f)
            val (k, b) = if (m.inverted) -op to 255f else op to (1f - op) * 255f
            val matrix = ColorMatrix(floatArrayOf(
                0f, 0f, 0f, 0f, 255f,
                0f, 0f, 0f, 0f, 255f,
                0f, 0f, 0f, 0f, 255f,
                0f, 0f, 0f, k, b,
            ))
            val combine = Paint().apply {
                colorFilter = ColorMatrixColorFilter(matrix)
                xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
            }
            canvas.drawBitmap(coverage, 0f, 0f, combine)
        }
        coverage.recycle()
        return result
    }

    fun pathFor(m: Mask, size: Int): Path {
        val s = size.toFloat()
        val path = Path()
        when (m.shape) {
            MaskShape.RECTANGLE -> {
                val r = ProjectOps.maskBounds(m)
                path.addRect(r[0] * s, r[1] * s, r[2] * s, r[3] * s, Path.Direction.CW)
            }
            MaskShape.ELLIPSE -> {
                val r = ProjectOps.maskBounds(m)
                path.addOval(r[0] * s, r[1] * s, r[2] * s, r[3] * s, Path.Direction.CW)
            }
            MaskShape.POLYGON, MaskShape.FREEHAND -> {
                m.points.forEachIndexed { i, p ->
                    if (i == 0) path.moveTo(p.x * s, p.y * s) else path.lineTo(p.x * s, p.y * s)
                }
                path.close()
            }
        }
        return path
    }
}
