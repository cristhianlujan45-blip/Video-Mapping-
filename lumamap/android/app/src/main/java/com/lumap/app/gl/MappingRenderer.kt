package com.lumap.app.gl

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * Motor nativo de mapping (FASE 10.2): quad con corner pin proyectivo real.
 * Mismo algoritmo que el renderer WebGL2: el vertex shader interpola UV
 * homogéneos (a_uvh) y el fragment divide por w.
 *
 * Fuentes de medios: Bitmap (imágenes) o MediaPlayer+SurfaceTexture (video).
 * NOTA: código fuente entregado sin compilación en este entorno (sin Android
 * SDK); requiere prueba en dispositivo. Ver android/README.md.
 */
class MappingRenderer(private val context: Context) : GLSurfaceView.Renderer {

    // Vértices del cuadrado unidad en clip space, CCW, con UV (0..1)
    private val quad = floatArrayOf(
        -1f, -1f, 0f, 0f,
         1f, -1f, 1f, 0f,
         1f,  1f, 1f, 1f,
        -1f,  1f, 0f, 1f)
    private val indices = shortArrayOf(0, 1, 2, 0, 2, 3)

    // Esquinas de la superficie en coordenadas UV 0..1 del lienzo (arrastrables)
    var corners = arrayOf(
        doubleArrayOf(0.1, 0.1), doubleArrayOf(0.9, 0.1),
        doubleArrayOf(0.9, 0.9), doubleArrayOf(0.1, 0.9))
        set(value) { field = value; homographyDirty = true }

    var opacity = 1f
    var videoPath: String? = null; set(v) { field = v; mediaDirty = true }
    var bitmap: Bitmap? = null;    set(b) { field = b; mediaDirty = true }

    private var homographyDirty = true
    private var mediaDirty = true
    private var uvh = FloatArray(12)   // 4 vértices × (u·H, v·H, w)
    private var program = 0
    private var texId = 0
    private var isExternalTex = false
    private var surfaceTexture: SurfaceTexture? = null
    private var mediaPlayer: MediaPlayer? = null
    private val vbo = IntArray(1)
    private val texMatrix = FloatArray(16)

    private val vert = """
        uniform mat4 uTexMatrix;      // SurfaceTexture transform (video externo)
        attribute vec4 aPosUv;        // xy = clip, zw = uv unidad
        attribute vec3 aUvh;          // uv homogéneo (H·(u,v,1))
        varying vec2 vUv;
        void main() {
            vec4 t = uTexMatrix * vec4(aUvh.x / aUvh.z, aUvh.y / aUvh.z, 0.0, 1.0);
            vUv = t.xy;
            gl_Position = vec4(aPosUv.xy, 0.0, 1.0);
        }"""

    private val fragExternal = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        varying vec2 vUv;
        uniform samplerExternalOES uTex;
        uniform float uOpacity;
        void main() {
            vec4 c = texture2D(uTex, vUv);
            gl_FragColor = vec4(c.rgb, c.a * uOpacity);
        }"""

    private val frag2D = """
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform float uOpacity;
        void main() {
            vec4 c = texture2D(uTex, vUv);
            gl_FragColor = vec4(c.rgb, c.a * uOpacity);
        }"""

    private fun compile(type: Int, src: String): Int {
        val s = GLES20.glCreateShader(type)
        GLES20.glShaderSource(s, src); GLES20.glCompileShader(s)
        return s
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        val vs = compile(GLES20.GL_VERTEX_SHADER, vert)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER,
            if (isExternalTex) fragExternal else frag2D)
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vs); GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        GLES20.glUseProgram(program)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        val bb = ByteBuffer.allocateDirect(quad.size * 4).order(ByteOrder.nativeOrder())
        bb.asFloatBuffer().put(quad).position(0)
        GLES20.glGenBuffers(1, vbo, 0)
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0])
        GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, quad.size * 4, bb, GLES20.GL_STATIC_DRAW)
        texMatrix.let { android.opengl.Matrix.setIdentityM(it, 0) }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES20.glViewport(0, 0, width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        if (mediaDirty) { rebuildMedia(); mediaDirty = false }
        if (homographyDirty) { rebuildHomography(); homographyDirty = false }
        surfaceTexture?.updateTexImage()
        surfaceTexture?.getTransformMatrix(texMatrix)

        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        GLES20.glUseProgram(program)
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0])
        val aPosUv = GLES20.glGetAttribLocation(program, "aPosUv")
        GLES20.glEnableVertexAttribArray(aPosUv)
        GLES20.glVertexAttribPointer(aPosUv, 4, GLES20.GL_FLOAT, false, 16, 0)
        val aUvh = GLES20.glGetAttribLocation(program, "aUvh")
        GLES20.glEnableVertexAttribArray(aUvh)
        val uvb = ByteBuffer.allocateDirect(uvh.size * 4).order(ByteOrder.nativeOrder())
        uvb.asFloatBuffer().put(uvh).position(0)
        GLES20.glVertexAttribPointer(aUvh, 3, GLES20.GL_FLOAT, false, 12, uvb)
        GLES20.glGetUniformLocation(program, "uTexMatrix")
            .also { GLES20.glUniformMatrix4fv(it, 1, false, texMatrix, 0) }
        GLES20.glGetUniformLocation(program, "uOpacity")
            .also { GLES20.glUniform1f(it, opacity) }
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(
            if (isExternalTex) GLES11Ext.GL_TEXTURE_EXTERNAL_OES else GLES20.GL_TEXTURE_2D, texId)
        GLES20.glGetUniformLocation(program, "uTex").also { GLES20.glUniform1i(it, 0) }
        val ib = ByteBuffer.allocateDirect(indices.size * 2).order(ByteOrder.nativeOrder())
        ib.asShortBuffer().put(indices).position(0)
        GLES20.glDrawElements(GLES20.GL_TRIANGLES, indices.size, GLES20.GL_UNSIGNED_SHORT, ib)
    }

    /** Recalcula los UV homogéneos desde las 4 esquinas (mismo DLT que web). */
    private fun rebuildHomography() {
        val src = arrayOf(
            doubleArrayOf(0.0, 0.0), doubleArrayOf(1.0, 0.0),
            doubleArrayOf(1.0, 1.0), doubleArrayOf(0.0, 1.0))
        val H = Homography.fromQuad(src, corners)
        val uvUnit = arrayOf(floatArrayOf(0f, 0f), floatArrayOf(1f, 0f),
                             floatArrayOf(1f, 1f), floatArrayOf(0f, 1f))
        val tmp = FloatArray(3)
        for (i in 0 until 4) {
            Homography.apply(H, uvUnit[i][0], uvUnit[i][1], tmp, 0)
            uvh[i*3] = tmp[0]; uvh[i*3+1] = tmp[1]; uvh[i*3+2] = tmp[2]
        }
    }

    private fun rebuildMedia() {
        mediaPlayer?.release(); surfaceTexture?.release()
        mediaPlayer = null; surfaceTexture = null
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        texId = ids[0]
        val path = videoPath
        if (path != null) {
            isExternalTex = true
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            surfaceTexture = SurfaceTexture(texId)
            val surface = Surface(surfaceTexture)
            mediaPlayer = MediaPlayer().apply {
                setDataSource(path); setSurface(surface); isLooping = true
                setOnPreparedListener { it.start() }
                prepareAsync()
            }
            surface.release()
        } else {
            isExternalTex = false
            bitmap?.let {
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, it, 0)
            }
        }
    }

    fun release() {
        mediaPlayer?.release(); surfaceTexture?.release()
        mediaPlayer = null; surfaceTexture = null
    }
}
