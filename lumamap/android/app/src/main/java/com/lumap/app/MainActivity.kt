package com.lumap.app

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

// LumaMap Android v0.1: contenedor WebView que carga la aplicación web
// servida por el backend (editor + mando remoto). El motor de mapping nativo
// (OpenGL ES + corner pin en GPU) es FASE 10.2 del roadmap (ROADMAP.md).
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            domStorageEnabled = true
        }
        web.webViewClient = WebViewClient()
        setContentView(web)
        // IP del equipo donde corre `npm start` (se muestra en el arranque).
        // 10.0.2.2 = localhost del host cuando se usa el emulador.
        val server = intent?.getStringExtra("server") ?: "http://10.0.2.2:8080"
        web.loadUrl("$server/controller.html") // "/index.html" para el editor completo
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
}
