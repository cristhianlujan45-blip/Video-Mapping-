package com.lumap.app.gl

import android.app.Presentation
import android.content.Context
import android.content.DialogInterface
import android.hardware.display.DisplayManager
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.view.Display

/**
 * Presentación en pantalla externa (proyector vía HDMI/DisplayPort/USB-C alt-mode).
 * El sistema la detecta con DisplayManager.DISPLAY_CATEGORY_PRESENTATION.
 */
class MappingPresentation(context: Context, display: Display,
                          private val renderer: MappingRenderer)
    : Presentation(context, display) {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view = GLSurfaceView(context)
        view.setEGLContextClientVersion(2)
        view.setRenderer(renderer)
        view.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        setContentView(view)
    }
    override fun dismiss() { renderer.release(); super.dismiss() }
}

object Projector {
    /** Devuelve la primera pantalla de presentación disponible, o null. */
    fun findPresentationDisplay(context: Context): Display? {
        val dm = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        return dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).firstOrNull()
    }
}
