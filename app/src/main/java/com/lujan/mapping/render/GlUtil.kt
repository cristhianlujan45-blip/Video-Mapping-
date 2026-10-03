package com.lujan.mapping.render

import android.graphics.Bitmap
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLUtils
import android.util.Log

/** Small helpers around raw GLES20 calls. All must run on the render thread. */
object GlUtil {
    private const val TAG = "GlUtil"

    fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val status = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) {
            val log = GLES20.glGetShaderInfoLog(shader)
            GLES20.glDeleteShader(shader)
            throw RuntimeException("Shader compile error: $log\n$source")
        }
        return shader
    }

    fun linkProgram(vertexSrc: String, fragmentSrc: String): Int {
        val vs = compileShader(GLES20.GL_VERTEX_SHADER, vertexSrc)
        val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)
        val program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vs)
        GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        GLES20.glDeleteShader(vs)
        GLES20.glDeleteShader(fs)
        val status = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0)
        if (status[0] == 0) {
            val log = GLES20.glGetProgramInfoLog(program)
            GLES20.glDeleteProgram(program)
            throw RuntimeException("Program link error: $log")
        }
        return program
    }

    fun genTexture(target: Int = GLES20.GL_TEXTURE_2D): Int {
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        GLES20.glBindTexture(target, ids[0])
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(target, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return ids[0]
    }

    fun genExternalTexture(): Int = genTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES)

    /** Uploads a bitmap (rows top-to-bottom => v=0 is the top of the image). */
    fun uploadBitmap(bitmap: Bitmap, existing: Int = 0): Int {
        val tex = if (existing != 0) existing else genTexture()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        return tex
    }

    fun deleteTexture(tex: Int) {
        if (tex != 0) GLES20.glDeleteTextures(1, intArrayOf(tex), 0)
    }

    fun logError(op: String) {
        val err = GLES20.glGetError()
        if (err != GLES20.GL_NO_ERROR) Log.w(TAG, "$op: glError 0x${Integer.toHexString(err)}")
    }

    fun maxTextureSize(): Int {
        val v = IntArray(1)
        GLES20.glGetIntegerv(GLES20.GL_MAX_TEXTURE_SIZE, v, 0)
        return v[0]
    }
}

/** Offscreen RGBA8 render target. */
class Framebuffer(val width: Int, val height: Int) {
    val texture: Int = GlUtil.genTexture()
    val fbo: Int

    init {
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, width, height, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
        val ids = IntArray(1)
        GLES20.glGenFramebuffers(1, ids, 0)
        fbo = ids[0]
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0,
            GLES20.GL_TEXTURE_2D, texture, 0)
        val status = GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        if (status != GLES20.GL_FRAMEBUFFER_COMPLETE) {
            release()
            throw RuntimeException("Framebuffer ${width}x$height incomplete: 0x${Integer.toHexString(status)}")
        }
    }

    fun release() {
        GLES20.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
        GlUtil.deleteTexture(texture)
    }
}
