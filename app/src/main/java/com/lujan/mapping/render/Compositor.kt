package com.lujan.mapping.render

import android.graphics.Bitmap
import android.graphics.Matrix
import android.opengl.GLES11Ext
import android.opengl.GLES20
import com.lujan.mapping.core.geometry.Homography
import com.lujan.mapping.core.model.BlendMode
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.core.model.ScaleMode
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.floor

/** What the compositor needs to draw one layer's content. */
internal sealed class BoundSource {
    class Video(val texture: Int, val texMatrix: FloatArray) : BoundSource()
    class Image(val texture: Int) : BoundSource()
}

/**
 * Draws the project into an offscreen framebuffer at the configured output resolution
 * and presents that framebuffer into window surfaces. Render thread only.
 */
internal class Compositor {

    private class Program(val id: Int) {
        private val uniforms = HashMap<String, Int>()
        val aModel: Int = GLES20.glGetAttribLocation(id, "aModel")
        fun u(name: String): Int = uniforms.getOrPut(name) { GLES20.glGetUniformLocation(id, name) }
    }

    private val layerPrograms = HashMap<Int, Program>()
    private val gridProgram = Program(GlUtil.linkProgram(Shaders.MODEL_VERTEX, Shaders.GRID_FRAGMENT))
    private val blitProgram = GlUtil.linkProgram(Shaders.BLIT_VERTEX, Shaders.BLIT_FRAGMENT)
    private val blitPos = GLES20.glGetAttribLocation(blitProgram, "aPos")
    private val blitUv = GLES20.glGetAttribLocation(blitProgram, "aUv")
    private val blitTex = GLES20.glGetUniformLocation(blitProgram, "uTex")

    private val whiteTexture: Int
    private var framebuffer: Framebuffer? = null
    private var backdropTexture = 0
    private var backdropW = 0
    private var backdropH = 0

    private val quad: FloatBuffer = floatBuffer(8)
    private val blit: FloatBuffer = floatBuffer(16)
    private val mat3 = FloatArray(9)

    val outputWidth: Int get() = framebuffer?.width ?: 0
    val outputHeight: Int get() = framebuffer?.height ?: 0

    init {
        whiteTexture = GlUtil.genTexture()
        val px = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())
        px.put(byteArrayOf(-1, -1, -1, -1)).position(0)
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, 1, 1, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px)
    }

    private fun programFor(source: Shaders.Source, shaderBlend: Boolean): Program {
        val key = source.ordinal * 2 + if (shaderBlend) 1 else 0
        return layerPrograms.getOrPut(key) {
            Program(GlUtil.linkProgram(Shaders.MODEL_VERTEX, Shaders.layerFragment(source, shaderBlend)))
        }
    }

    fun ensureSize(width: Int, height: Int) {
        val fb = framebuffer
        if (fb != null && fb.width == width && fb.height == height) return
        fb?.release()
        framebuffer = Framebuffer(width, height)
        if (backdropTexture != 0) {
            GlUtil.deleteTexture(backdropTexture)
            backdropTexture = 0
        }
    }

    private fun ensureBackdrop(w: Int, h: Int) {
        if (backdropTexture != 0 && backdropW == w && backdropH == h) return
        GlUtil.deleteTexture(backdropTexture)
        backdropTexture = GlUtil.genTexture()
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        backdropW = w
        backdropH = h
    }

    /**
     * Renders all visible layers bottom-to-top and the calibration grid.
     * [sourceFor] returns null when the media is not ready yet (layer is skipped),
     * [missing] tells whether the media file is missing (drawn as a red test pattern
     * so the surface can still be mapped).
     */
    fun renderComposition(
        project: Project,
        sourceFor: (Layer) -> BoundSource?,
        maskFor: (Layer) -> Int,
        missing: (Layer) -> Boolean,
    ) {
        val fb = framebuffer ?: return
        val w = fb.width
        val h = fb.height
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb.fbo)
        GLES20.glViewport(0, 0, w, h)
        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glDisable(GLES20.GL_SCISSOR_TEST)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

        val aspect = w.toFloat() / h
        val grid = project.grid
        if (!grid.enabled || grid.showContent) {
            for (layer in project.layers) {
                if (!layer.visible || layer.opacity <= 0f) continue
                drawLayer(layer, aspect, w, h, sourceFor, maskFor, missing)
            }
        }
        if (grid.enabled) drawGrid(project, w, h)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawLayer(
        layer: Layer, aspect: Float, w: Int, h: Int,
        sourceFor: (Layer) -> BoundSource?, maskFor: (Layer) -> Int, missing: (Layer) -> Boolean,
    ) {
        val q = layer.finalQuad(aspect)
        val hinv = Homography.quadToSquare(q) ?: return
        val b = q.bounds()
        val l = b[0].coerceIn(0f, 1f)
        val t = b[1].coerceIn(0f, 1f)
        val r = b[2].coerceIn(0f, 1f)
        val btm = b[3].coerceIn(0f, 1f)
        if (r <= l || btm <= t) return

        val isMissing = missing(layer)
        val kind = layer.content.kind
        var bound: BoundSource? = null
        val source: Shaders.Source = when {
            isMissing -> Shaders.Source.TEST_PATTERN
            kind == ContentKind.TEST_PATTERN -> Shaders.Source.TEST_PATTERN
            kind == ContentKind.SOLID_COLOR -> Shaders.Source.SOLID
            else -> {
                bound = sourceFor(layer) ?: return
                if (bound is BoundSource.Video) Shaders.Source.EXTERNAL_OES else Shaders.Source.TEXTURE_2D
            }
        }

        val shaderBlend = layer.blendMode.needsBackdrop
        if (shaderBlend) {
            // Copy the backdrop under the layer's bounding box into a texture the shader can read.
            ensureBackdrop(w, h)
            val x0 = floor(l * w).toInt().coerceIn(0, w)
            val x1 = ceil(r * w).toInt().coerceIn(0, w)
            val y0 = floor((1f - btm) * h).toInt().coerceIn(0, h)
            val y1 = ceil((1f - t) * h).toInt().coerceIn(0, h)
            if (x1 <= x0 || y1 <= y0) return
            GLES20.glActiveTexture(GLES20.GL_TEXTURE2)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, backdropTexture)
            GLES20.glCopyTexSubImage2D(GLES20.GL_TEXTURE_2D, 0, x0, y0, x0, y0, x1 - x0, y1 - y0)
            GLES20.glDisable(GLES20.GL_BLEND)
        } else {
            GLES20.glEnable(GLES20.GL_BLEND)
            // Premultiplied colors; the composite alpha is kept at 1 (ZERO, ONE).
            when (layer.blendMode) {
                BlendMode.ADD -> GLES20.glBlendFuncSeparate(GLES20.GL_ONE, GLES20.GL_ONE, GLES20.GL_ZERO, GLES20.GL_ONE)
                BlendMode.SCREEN -> GLES20.glBlendFuncSeparate(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_COLOR, GLES20.GL_ZERO, GLES20.GL_ONE)
                BlendMode.MULTIPLY -> GLES20.glBlendFuncSeparate(GLES20.GL_DST_COLOR, GLES20.GL_ONE_MINUS_SRC_ALPHA, GLES20.GL_ZERO, GLES20.GL_ONE)
                else -> GLES20.glBlendFuncSeparate(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA, GLES20.GL_ZERO, GLES20.GL_ONE)
            }
        }

        val p = programFor(source, shaderBlend)
        GLES20.glUseProgram(p.id)

        GLES20.glUniformMatrix3fv(p.u("uHinv"), 1, false, hinv.toGlMat3(mat3), 0)
        GLES20.glUniform2f(p.u("uPixel"), 1f / w, 1f / h)
        val c = layer.crop
        GLES20.glUniform4f(p.u("uCrop"), c.left, c.top, c.right - c.left, c.bottom - c.top)
        GLES20.glUniform2f(p.u("uFlip"), if (layer.flipH) 1f else 0f, if (layer.flipV) 1f else 0f)
        GLES20.glUniform1f(p.u("uOpacity"), layer.opacity.coerceIn(0f, 1f))
        GLES20.glUniform1f(p.u("uFeather"), layer.edgeFeather.coerceIn(0f, 0.5f))
        val adj = layer.color
        GLES20.glUniform4f(p.u("uAdjust"), adj.brightness, adj.contrast, adj.saturation,
            Math.toRadians(adj.hue.toDouble()).toFloat())
        GLES20.glUniform1f(p.u("uInvert"), if (adj.invert) 1f else 0f)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
        val maskTex = maskFor(layer)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, if (maskTex != 0) maskTex else whiteTexture)
        GLES20.glUniform1i(p.u("uMask"), 1)

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        when (source) {
            Shaders.Source.EXTERNAL_OES -> {
                val v = bound as BoundSource.Video
                GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, v.texture)
                GLES20.glUniform1i(p.u("uTex"), 0)
                GLES20.glUniformMatrix4fv(p.u("uTexMatrix"), 1, false, v.texMatrix, 0)
            }
            Shaders.Source.TEXTURE_2D -> {
                val img = bound as BoundSource.Image
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, img.texture)
                GLES20.glUniform1i(p.u("uTex"), 0)
            }
            Shaders.Source.TEST_PATTERN -> {
                if (isMissing) GLES20.glUniform4f(p.u("uSolid"), 1f, 0.35f, 0.35f, 1f)
                else setColorUniform(p.u("uSolid"), layer.content.colorArgb)
            }
            Shaders.Source.SOLID -> setColorUniform(p.u("uSolid"), layer.content.colorArgb)
        }

        if (shaderBlend) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE2)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, backdropTexture)
            GLES20.glUniform1i(p.u("uBackdrop"), 2)
            GLES20.glUniform2f(p.u("uOutSize"), w.toFloat(), h.toFloat())
            val mode = when (layer.blendMode) {
                BlendMode.OVERLAY -> 0f
                BlendMode.DIFFERENCE -> 1f
                BlendMode.LIGHTEN -> 2f
                else -> 3f
            }
            GLES20.glUniform1f(p.u("uMode"), mode)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        }

        drawModelRect(p.aModel, l, t, r, btm)
    }

    private fun setColorUniform(loc: Int, argb: Long) {
        val a = ((argb shr 24) and 0xFF) / 255f
        val r = ((argb shr 16) and 0xFF) / 255f
        val g = ((argb shr 8) and 0xFF) / 255f
        val b = (argb and 0xFF) / 255f
        GLES20.glUniform4f(loc, r, g, b, a)
    }

    private fun drawModelRect(attr: Int, l: Float, t: Float, r: Float, b: Float) {
        quad.position(0)
        quad.put(l).put(t).put(r).put(t).put(l).put(b).put(r).put(b)
        quad.position(0)
        GLES20.glEnableVertexAttribArray(attr)
        GLES20.glVertexAttribPointer(attr, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(attr)
    }

    private fun drawGrid(project: Project, w: Int, h: Int) {
        val g = project.grid
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFuncSeparate(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA, GLES20.GL_ZERO, GLES20.GL_ONE)
        val p = gridProgram
        GLES20.glUseProgram(p.id)
        GLES20.glUniform2f(p.u("uOutSize"), w.toFloat(), h.toFloat())
        GLES20.glUniform1f(p.u("uDiv"), g.divisions.coerceIn(1, 200).toFloat())
        GLES20.glUniform1f(p.u("uThick"), g.thickness.coerceIn(0.5f, 50f))
        val argb = g.colorArgb
        GLES20.glUniform4f(p.u("uColor"),
            ((argb shr 16) and 0xFF) / 255f, ((argb shr 8) and 0xFF) / 255f, (argb and 0xFF) / 255f,
            g.opacity.coerceIn(0f, 1f))
        GLES20.glUniform1f(p.u("uPattern"), g.pattern.ordinal.toFloat())
        drawModelRect(p.aModel, 0f, 0f, 1f, 1f)
    }

    /**
     * Presents the composition into the currently bound window surface.
     * [margin] keeps a border around the preview so edge handles stay reachable.
     */
    fun present(viewW: Int, viewH: Int, preview: Boolean, scaleMode: ScaleMode, margin: Float) {
        val fb = framebuffer ?: return
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glViewport(0, 0, viewW, viewH)
        GLES20.glDisable(GLES20.GL_BLEND)
        if (preview) GLES20.glClearColor(0.07f, 0.075f, 0.09f, 1f) else GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

        val aspect = fb.width.toFloat() / fb.height
        val rect = if (preview) ViewRect.fit(viewW.toFloat(), viewH.toFloat(), aspect, margin)
        else if (scaleMode == ScaleMode.STRETCH) ViewRect.full(viewW.toFloat(), viewH.toFloat())
        else ViewRect.fit(viewW.toFloat(), viewH.toFloat(), aspect)

        val x0 = rect.left / viewW * 2f - 1f
        val x1 = rect.right / viewW * 2f - 1f
        val yTop = 1f - rect.top / viewH * 2f
        val yBottom = 1f - rect.bottom / viewH * 2f

        blit.position(0)
        blit.put(x0).put(yBottom).put(0f).put(0f)
        blit.put(x1).put(yBottom).put(1f).put(0f)
        blit.put(x0).put(yTop).put(0f).put(1f)
        blit.put(x1).put(yTop).put(1f).put(1f)

        GLES20.glUseProgram(blitProgram)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, fb.texture)
        GLES20.glUniform1i(blitTex, 0)
        blit.position(0)
        GLES20.glEnableVertexAttribArray(blitPos)
        GLES20.glVertexAttribPointer(blitPos, 2, GLES20.GL_FLOAT, false, 16, blit)
        blit.position(2)
        GLES20.glEnableVertexAttribArray(blitUv)
        GLES20.glVertexAttribPointer(blitUv, 2, GLES20.GL_FLOAT, false, 16, blit)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(blitPos)
        GLES20.glDisableVertexAttribArray(blitUv)
    }

    /** Reads the composition back (for "export current frame"). */
    fun readPixels(): Bitmap? {
        val fb = framebuffer ?: return null
        val buf = ByteBuffer.allocateDirect(fb.width * fb.height * 4).order(ByteOrder.nativeOrder())
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb.fbo)
        GLES20.glReadPixels(0, 0, fb.width, fb.height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        buf.position(0)
        val raw = Bitmap.createBitmap(fb.width, fb.height, Bitmap.Config.ARGB_8888)
        raw.copyPixelsFromBuffer(buf)
        // GL rows are bottom-up.
        val flipped = Bitmap.createBitmap(raw, 0, 0, fb.width, fb.height, Matrix().apply { preScale(1f, -1f) }, false)
        if (flipped != raw) raw.recycle()
        return flipped
    }

    fun release() {
        layerPrograms.values.forEach { GLES20.glDeleteProgram(it.id) }
        layerPrograms.clear()
        GLES20.glDeleteProgram(gridProgram.id)
        GLES20.glDeleteProgram(blitProgram)
        framebuffer?.release()
        framebuffer = null
        GlUtil.deleteTexture(backdropTexture)
        GlUtil.deleteTexture(whiteTexture)
    }

    private companion object {
        fun floatBuffer(n: Int): FloatBuffer =
            ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
    }
}
