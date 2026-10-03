package com.lujan.mapping.render

import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.Project
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The GPU engine. One dedicated thread owns the EGL context; everything else talks to it
 * through thread-safe methods that post work to that thread.
 *
 * Frame pacing: frames are driven by [Choreographer] (vsync) and only rendered when
 * something changed (a new video frame, a project edit, a new output). An idle
 * project costs no GPU time, which keeps the phone cool during long shows.
 */
class RenderEngine {

    enum class TargetKind { PREVIEW, OUTPUT }

    data class GlInfo(
        val renderer: String,
        val vendor: String,
        val version: String,
        val contextVersion: Int,
        val maxTextureSize: Int,
        val externalOes: Boolean,
    )

    data class Stats(val fps: Float = 0f, val frameMs: Float = 0f, val outputWidth: Int = 0, val outputHeight: Int = 0)

    private class WindowTarget(
        val id: String,
        val surface: Surface,
        val eglSurface: EGLSurface,
        var width: Int,
        var height: Int,
        val kind: TargetKind,
        val margin: Float,
    )

    private class VideoSource(val token: Long, val texture: Int, val surfaceTexture: SurfaceTexture, val surface: Surface) {
        val frameAvailable = AtomicBoolean(false)
        val matrix = FloatArray(16).also { android.opengl.Matrix.setIdentityM(it, 0) }
        var hasFrame = false
    }

    private class ImageSource(val token: Long, val texture: Int)

    private class MaskTexture(val masks: Any, val texture: Int)

    private val _glInfo = MutableStateFlow<GlInfo?>(null)
    val glInfo: StateFlow<GlInfo?> = _glInfo
    private val _stats = MutableStateFlow(Stats())
    val stats: StateFlow<Stats> = _stats
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val thread = HandlerThread("LujanRender", Process.THREAD_PRIORITY_DISPLAY).apply { start() }
    private val handler = Handler(thread.looper)
    private val mainHandler = Handler(Looper.getMainLooper())

    // ---- render-thread state ----
    private var egl: EglCore? = null
    private var pbuffer: EGLSurface? = null
    private var compositor: Compositor? = null
    private var choreographer: Choreographer? = null
    private val targets = LinkedHashMap<String, WindowTarget>()
    private val videos = HashMap<String, VideoSource>()
    private val images = HashMap<String, ImageSource>()
    private val maskTextures = HashMap<String, MaskTexture>()
    private var frameScheduled = false
    private var lastFrameNanos = 0L
    private var frameCount = 0
    private var fpsWindowStart = 0L
    private var frameTimeAccum = 0f
    private var previewToggle = false
    private var maxTextureSize = 4096

    // ---- cross-thread state ----
    @Volatile private var project: Project? = null
    @Volatile private var missingLayers: Set<String> = emptySet()
    private val dirty = AtomicBoolean(true)
    private val projectChanged = AtomicBoolean(true)
    private val schedulePending = AtomicBoolean(false)

    private val frameCallback = Choreographer.FrameCallback { onVsync(it) }
    private val scheduleRunnable = Runnable {
        schedulePending.set(false)
        scheduleFrame()
    }

    init {
        handler.post { initGl() }
    }

    // ------------------------------------------------------------------ public API

    fun setProject(p: Project) {
        project = p
        projectChanged.set(true)
        requestRender()
    }

    fun setMissingLayers(ids: Set<String>) {
        missingLayers = ids
        projectChanged.set(true)
        requestRender()
    }

    fun requestRender() {
        dirty.set(true)
        if (schedulePending.compareAndSet(false, true)) handler.post(scheduleRunnable)
    }

    /**
     * Registers a window (SurfaceView surface) that receives the composition.
     * PREVIEW targets letterbox with [marginPx] and never block on vsync; OUTPUT
     * targets (projector) are vsync-locked for tear-free playback.
     */
    fun attachTarget(id: String, surface: Surface, width: Int, height: Int, kind: TargetKind, marginPx: Float = 0f) {
        handler.post {
            val core = egl ?: return@post
            val existing = targets[id]
            if (existing != null && existing.surface == surface) {
                // Same window, new size (surfaceChanged): no need to recreate the EGL surface.
                existing.width = width
                existing.height = height
                projectChanged.set(true)
                dirty.set(true)
                scheduleFrame()
                return@post
            }
            targets.remove(id)?.let {
                pbuffer?.let { pb -> core.makeCurrent(pb) }
                core.releaseSurface(it.eglSurface)
            }
            try {
                val s = core.createWindowSurface(surface)
                core.makeCurrent(s)
                core.setSwapInterval(if (kind == TargetKind.PREVIEW) 0 else 1)
                targets[id] = WindowTarget(id, surface, s, width, height, kind, marginPx)
                pbuffer?.let { core.makeCurrent(it) }
                Log.i(TAG, "target $id attached ${width}x$height $kind")
            } catch (e: Exception) {
                Log.e(TAG, "attachTarget $id failed", e)
                _error.value = "No se pudo usar la superficie de salida: ${e.message}"
            }
            projectChanged.set(true)
            dirty.set(true)
            scheduleFrame()
        }
    }

    fun resizeTarget(id: String, width: Int, height: Int) {
        handler.post {
            targets[id]?.let {
                it.width = width
                it.height = height
            }
            projectChanged.set(true)
            dirty.set(true)
            scheduleFrame()
        }
    }

    /**
     * Must be called from SurfaceHolder.Callback.surfaceDestroyed: blocks until the GL
     * thread no longer uses the surface (required by Android before the surface dies).
     */
    fun detachTarget(id: String) {
        runOnGlThreadBlocking {
            val core = egl ?: return@runOnGlThreadBlocking
            targets.remove(id)?.let {
                pbuffer?.let { pb -> core.makeCurrent(pb) }
                core.releaseSurface(it.eglSurface)
                Log.i(TAG, "target $id detached")
            }
        }
    }

    /** Creates a video texture + Surface for a decoder; [onReady] runs on the main thread. */
    fun createVideoSurface(layerId: String, token: Long, onReady: (Surface) -> Unit) {
        handler.post {
            if (egl == null) return@post
            videos.remove(layerId)?.let { releaseVideoSource(it) }
            val tex = GlUtil.genExternalTexture()
            val st = SurfaceTexture(tex)
            val src = VideoSource(token, tex, st, Surface(st))
            st.setOnFrameAvailableListener({
                src.frameAvailable.set(true)
                requestRender()
            }, handler)
            videos[layerId] = src
            mainHandler.post { onReady(src.surface) }
        }
    }

    /** Call only after the player stopped writing to the surface (player released / surface cleared). */
    fun releaseVideo(layerId: String, token: Long) {
        handler.post {
            val src = videos[layerId] ?: return@post
            if (src.token != token) return@post
            videos.remove(layerId)
            releaseVideoSource(src)
            requestRender()
        }
    }

    /** Takes ownership of [bitmap] (recycled after upload). */
    fun setImage(layerId: String, token: Long, bitmap: Bitmap) {
        handler.post {
            if (egl == null) {
                bitmap.recycle(); return@post
            }
            images.remove(layerId)?.let { GlUtil.deleteTexture(it.texture) }
            try {
                val tex = GlUtil.uploadBitmap(bitmap)
                images[layerId] = ImageSource(token, tex)
            } catch (e: Exception) {
                Log.e(TAG, "image upload failed", e)
            } finally {
                bitmap.recycle()
            }
            projectChanged.set(true)
            requestRender()
        }
    }

    fun releaseImage(layerId: String, token: Long) {
        handler.post {
            val img = images[layerId] ?: return@post
            if (img.token != token) return@post
            images.remove(layerId)
            GlUtil.deleteTexture(img.texture)
            requestRender()
        }
    }

    /** Renders the composition once and returns it as a Bitmap on the main thread. */
    fun captureFrame(callback: (Bitmap?) -> Unit) {
        handler.post {
            val bmp = try {
                if (renderComposition()) compositor?.readPixels() else null
            } catch (e: Exception) {
                Log.e(TAG, "capture failed", e)
                null
            }
            mainHandler.post { callback(bmp) }
        }
    }

    /** Max texture size reported by the GPU (valid after init). */
    fun maxTextureSize(): Int = _glInfo.value?.maxTextureSize ?: 4096

    // ------------------------------------------------------------ render thread

    private fun initGl() {
        try {
            val core = EglCore()
            egl = core
            val pb = core.createPbufferSurface(1, 1)
            pbuffer = pb
            core.makeCurrent(pb)
            maxTextureSize = GlUtil.maxTextureSize()
            val ext = GLES20.glGetString(GLES20.GL_EXTENSIONS) ?: ""
            _glInfo.value = GlInfo(
                renderer = GLES20.glGetString(GLES20.GL_RENDERER) ?: "?",
                vendor = GLES20.glGetString(GLES20.GL_VENDOR) ?: "?",
                version = GLES20.glGetString(GLES20.GL_VERSION) ?: "?",
                contextVersion = core.glesVersion,
                maxTextureSize = maxTextureSize,
                externalOes = ext.contains("GL_OES_EGL_image_external"),
            )
            compositor = Compositor()
            choreographer = Choreographer.getInstance()
        } catch (e: Exception) {
            Log.e(TAG, "GL init failed", e)
            _error.value = "No se pudo iniciar OpenGL ES: ${e.message}"
        }
    }

    private fun scheduleFrame() {
        val ch = choreographer ?: return
        if (frameScheduled || targets.isEmpty()) return
        frameScheduled = true
        ch.postFrameCallback(frameCallback)
    }

    private fun onVsync(frameTimeNanos: Long) {
        frameScheduled = false
        if (targets.isEmpty()) return
        val fpsLimit = (project?.output?.fpsLimit ?: 60).coerceIn(10, 240)
        val minInterval = 1_000_000_000L / fpsLimit
        // 2 ms slack so a 60 fps limit on a 60 Hz panel never drops to 30.
        if (lastFrameNanos != 0L && frameTimeNanos - lastFrameNanos < minInterval - 2_000_000L) {
            if (dirty.get()) scheduleFrame()
            return
        }
        if (!dirty.getAndSet(false)) return
        lastFrameNanos = frameTimeNanos
        val start = SystemClock.elapsedRealtimeNanos()
        try {
            drawFrame()
        } catch (e: Exception) {
            Log.e(TAG, "frame failed", e)
            _error.value = "Error de render: ${e.message}"
        }
        updateStats((SystemClock.elapsedRealtimeNanos() - start) / 1_000_000f)
        if (dirty.get()) scheduleFrame()
    }

    /** Latches video frames, updates masks and draws the composition into the framebuffer. */
    private fun renderComposition(): Boolean {
        val core = egl ?: return false
        val pb = pbuffer ?: return false
        val comp = compositor ?: return false
        val p = project ?: return false
        if (!core.makeCurrent(pb)) return false

        for (v in videos.values) {
            if (v.frameAvailable.getAndSet(false)) {
                try {
                    v.surfaceTexture.updateTexImage()
                    v.surfaceTexture.getTransformMatrix(v.matrix)
                    v.hasFrame = true
                } catch (e: Exception) {
                    Log.w(TAG, "updateTexImage failed", e)
                }
            }
        }
        syncMasks(p)

        // Clamp the output resolution to what the GPU supports, keeping the aspect ratio.
        var w = p.output.width.coerceAtLeast(16)
        var h = p.output.height.coerceAtLeast(16)
        val maxSize = maxTextureSize
        if (w > maxSize || h > maxSize) {
            val s = min(maxSize.toFloat() / w, maxSize.toFloat() / h)
            w = (w * s).roundToInt()
            h = (h * s).roundToInt()
        }
        comp.ensureSize(w, h)

        val missing = missingLayers
        comp.renderComposition(
            p,
            sourceFor = { layer -> boundSource(layer) },
            maskFor = { layer -> maskTextures[layer.id]?.texture ?: 0 },
            missing = { layer -> layer.id in missing },
        )
        return true
    }

    private fun boundSource(layer: Layer): BoundSource? {
        videos[layer.id]?.let { v -> return if (v.hasFrame) BoundSource.Video(v.texture, v.matrix) else null }
        images[layer.id]?.let { return BoundSource.Image(it.texture) }
        return null
    }

    private fun drawFrame() {
        val core = egl ?: return
        val comp = compositor ?: return
        val p = project ?: return
        val changed = projectChanged.getAndSet(false)
        if (!renderComposition()) return

        val hasOutput = targets.values.any { it.kind == TargetKind.OUTPUT }
        previewToggle = !previewToggle
        val dead = ArrayList<String>()
        for (t in targets.values) {
            // While a projector is attached, video-only frames refresh the phone preview at
            // half rate: the projector gets every frame, the controller saves GPU/battery.
            if (t.kind == TargetKind.PREVIEW && hasOutput && !changed && !previewToggle) continue
            if (!core.makeCurrent(t.eglSurface)) {
                dead += t.id; continue
            }
            comp.present(t.width, t.height, t.kind == TargetKind.PREVIEW, p.output.scaleMode, t.margin)
            if (!core.swapBuffers(t.eglSurface)) dead += t.id
        }
        pbuffer?.let { core.makeCurrent(it) }
        for (id in dead) {
            Log.w(TAG, "target $id lost (${EglCore.eglErrorString()})")
            targets.remove(id)?.let { core.releaseSurface(it.eglSurface) }
        }
    }

    private fun syncMasks(p: Project) {
        val ids = HashSet<String>()
        for (layer in p.layers) {
            if (!MaskRasterizer.hasActiveMasks(layer.masks)) continue
            ids += layer.id
            val cached = maskTextures[layer.id]
            if (cached != null && cached.masks == layer.masks) continue
            val bmp = MaskRasterizer.rasterize(layer.masks) ?: continue
            val tex = GlUtil.uploadBitmap(bmp, cached?.texture ?: 0)
            bmp.recycle()
            maskTextures[layer.id] = MaskTexture(layer.masks, tex)
        }
        val it = maskTextures.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (e.key !in ids) {
                GlUtil.deleteTexture(e.value.texture)
                it.remove()
            }
        }
    }

    private fun releaseVideoSource(src: VideoSource) {
        src.surfaceTexture.setOnFrameAvailableListener(null)
        src.surface.release()
        src.surfaceTexture.release()
        GlUtil.deleteTexture(src.texture)
    }

    private fun updateStats(frameMs: Float) {
        val now = SystemClock.elapsedRealtime()
        if (fpsWindowStart == 0L) fpsWindowStart = now
        frameCount++
        frameTimeAccum += frameMs
        val elapsed = now - fpsWindowStart
        if (elapsed >= 1000) {
            val comp = compositor
            _stats.value = Stats(
                fps = frameCount * 1000f / elapsed,
                frameMs = frameTimeAccum / frameCount,
                outputWidth = comp?.outputWidth ?: 0,
                outputHeight = comp?.outputHeight ?: 0,
            )
            frameCount = 0
            frameTimeAccum = 0f
            fpsWindowStart = now
        }
    }

    private fun runOnGlThreadBlocking(block: () -> Unit) {
        if (Looper.myLooper() == thread.looper) {
            block(); return
        }
        val latch = CountDownLatch(1)
        handler.post {
            try {
                block()
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(2, TimeUnit.SECONDS)) Log.w(TAG, "GL thread did not answer in time")
    }

    private companion object {
        const val TAG = "RenderEngine"
    }
}
