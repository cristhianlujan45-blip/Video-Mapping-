package com.lujan.mapping.display

import android.app.Presentation
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Display
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import com.lujan.mapping.R
import com.lujan.mapping.render.RenderEngine

/**
 * Clean projector output on the external display: a single fullscreen SurfaceView fed
 * by the render engine. No UI at all is drawn here; the phone stays the controller.
 */
class ProjectionPresentation(
    outerContext: Context,
    display: Display,
    private val engine: RenderEngine,
) : Presentation(outerContext, display, R.style.Theme_LujanMapping_Presentation) {

    private val surfaceView by lazy { SurfaceView(context) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.apply {
            addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            decorView.setBackgroundColor(Color.BLACK)
        }
        setContentView(surfaceView)
        hideSystemBars()
        surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {}

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
                engine.attachTarget(TARGET_ID, holder.surface, width, height, RenderEngine.TargetKind.OUTPUT)
            }

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                engine.detachTarget(TARGET_ID)
            }
        })
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        val w = window ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            w.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    override fun onStop() {
        engine.detachTarget(TARGET_ID)
        super.onStop()
    }

    companion object {
        const val TARGET_ID = "external"
    }
}
