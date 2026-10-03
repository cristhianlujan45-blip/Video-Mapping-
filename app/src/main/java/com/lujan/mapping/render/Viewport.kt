package com.lujan.mapping.render

/**
 * Rectangle (in pixels, origin top-left) where the output is shown inside a view.
 * Shared by the GL presenter and the touch overlay so handles line up exactly with
 * the rendered image.
 */
data class ViewRect(val left: Float, val top: Float, val width: Float, val height: Float) {
    val right: Float get() = left + width
    val bottom: Float get() = top + height

    /** Normalized output coordinates -> view pixels. */
    fun toView(x: Float, y: Float): Pair<Float, Float> = (left + x * width) to (top + y * height)

    /** View pixels -> normalized output coordinates. */
    fun toModel(px: Float, py: Float): Pair<Float, Float> = ((px - left) / width) to ((py - top) / height)

    companion object {
        /** Largest rect of the given aspect ratio centered inside viewW x viewH (letterbox). */
        fun fit(viewW: Float, viewH: Float, aspect: Float, margin: Float = 0f): ViewRect {
            val w = (viewW - 2 * margin).coerceAtLeast(1f)
            val h = (viewH - 2 * margin).coerceAtLeast(1f)
            return if (w / h > aspect) {
                val fw = h * aspect
                ViewRect(margin + (w - fw) / 2f, margin, fw, h)
            } else {
                val fh = w / aspect
                ViewRect(margin, margin + (h - fh) / 2f, w, fh)
            }
        }

        fun full(viewW: Float, viewH: Float) = ViewRect(0f, 0f, viewW, viewH)
    }
}
