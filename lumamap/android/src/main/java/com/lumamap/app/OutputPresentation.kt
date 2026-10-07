package com.lumamap.app

import android.annotation.SuppressLint
import android.app.Presentation
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/**
 * Salida limpia en la pantalla externa (proyector por HDMI, USB-C DisplayPort
 * o pantalla inalámbrica). Muestra `output.html`: solo la composición, sin
 * interfaz. El editor le envía el proyecto y el estado por el puente nativo y
 * los medios se leen de IndexedDB, compartida porque ambas WebView tienen el
 * mismo origen.
 */
class OutputPresentation(private val activity: MainActivity, display: Display) :
    Presentation(activity, display, R.style.Theme_LumaMap_Presentation) {

    private var web: WebView? = null
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val w = WebView(context)
        // Si el motor de la salida falla, se cierra limpiamente y el editor sigue;
        // la salida se puede volver a abrir con «Proyectar».
        activity.configureWebView(w) { main.post { runCatching { dismiss() } } }
        w.addJavascriptInterface(activity.Bridge(isEditor = false), "LumaNative")
        w.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                // La salida puede necesitar la cámara (contenido en vivo).
                main.post { activity.handlePermission(request) }
            }
        }
        setContentView(w)
        window?.let { win ->
            WindowCompat.getInsetsController(win, w).apply {
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsetsCompat.Type.systemBars())
            }
        }
        w.loadUrl("https://appassets.androidplatform.net/output.html?native=1")
        web = w
    }

    /** Mensaje del editor → página de salida. */
    fun deliver(msg: String) {
        main.post {
            web?.evaluateJavascript("window.__lumaIn && window.__lumaIn(${JSONObject.quote(msg)})", null)
        }
    }

    override fun onStop() {
        web?.destroy()
        web = null
        super.onStop()
    }
}
