package com.lujan.mapping.render

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.util.Log
import android.view.Surface

/**
 * Owns the single EGL context of the app.
 *
 * One context renders the composition once per frame into an offscreen framebuffer and
 * then presents it to every window surface (phone preview, external display, phone
 * fullscreen). Using one context avoids shared-context driver bugs and lets video
 * SurfaceTextures (bound to one context) be sampled for every output.
 */
class EglCore {

    val display: EGLDisplay
    val context: EGLContext
    private val config: EGLConfig
    val glesVersion: Int

    init {
        val dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (dpy == EGL14.EGL_NO_DISPLAY) throw RuntimeException("eglGetDisplay failed")
        val version = IntArray(2)
        if (!EGL14.eglInitialize(dpy, version, 0, version, 1)) throw RuntimeException("eglInitialize failed")
        display = dpy

        var cfg = chooseConfig(EGLExt.EGL_OPENGL_ES3_BIT_KHR)
        var ctx: EGLContext = EGL14.EGL_NO_CONTEXT
        var ver = 3
        if (cfg != null) {
            ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
        }
        if (cfg == null || ctx == EGL14.EGL_NO_CONTEXT) {
            ver = 2
            cfg = chooseConfig(EGL14.EGL_OPENGL_ES2_BIT)
                ?: throw RuntimeException("No suitable EGL config (RGBA8888, ES2)")
            ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
            if (ctx == EGL14.EGL_NO_CONTEXT) throw RuntimeException("eglCreateContext failed: ${eglErrorString()}")
        }
        config = cfg
        context = ctx
        glesVersion = ver
        Log.i(TAG, "EGL context created, OpenGL ES $ver")
    }

    private fun chooseConfig(renderableType: Int): EGLConfig? {
        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, renderableType,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val num = IntArray(1)
        if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, num, 0) || num[0] == 0) return null
        return configs[0]
    }

    fun createWindowSurface(surface: Surface): EGLSurface {
        val s = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
        if (s == null || s == EGL14.EGL_NO_SURFACE) throw RuntimeException("eglCreateWindowSurface: ${eglErrorString()}")
        return s
    }

    fun createPbufferSurface(width: Int, height: Int): EGLSurface {
        val s = EGL14.eglCreatePbufferSurface(display, config,
            intArrayOf(EGL14.EGL_WIDTH, width, EGL14.EGL_HEIGHT, height, EGL14.EGL_NONE), 0)
        if (s == null || s == EGL14.EGL_NO_SURFACE) throw RuntimeException("eglCreatePbufferSurface: ${eglErrorString()}")
        return s
    }

    fun makeCurrent(surface: EGLSurface): Boolean = EGL14.eglMakeCurrent(display, surface, surface, context)

    /** Returns false if the surface is gone (e.g. display unplugged). */
    fun swapBuffers(surface: EGLSurface): Boolean = EGL14.eglSwapBuffers(display, surface)

    fun setSwapInterval(interval: Int) {
        EGL14.eglSwapInterval(display, interval)
    }

    fun releaseSurface(surface: EGLSurface) {
        EGL14.eglDestroySurface(display, surface)
    }

    fun release() {
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
        EGL14.eglTerminate(display)
    }

    companion object {
        private const val TAG = "EglCore"
        fun eglErrorString(): String = "0x" + Integer.toHexString(EGL14.eglGetError())
    }
}
