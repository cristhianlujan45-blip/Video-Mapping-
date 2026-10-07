package com.lumamap.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Display
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File

/**
 * LumaMap para Android.
 *
 * El editor y el motor de mapping (WebGL2) son la app web empaquetada en los
 * assets, servida offline desde https://appassets.androidplatform.net/.
 * La actividad añade lo que la web no puede hacer sola:
 *  - salida limpia al proyector por HDMI / USB-C / pantalla inalámbrica
 *    ([OutputPresentation]) mientras el teléfono sigue siendo el editor;
 *  - selector de archivos, cámara y micrófono con permisos de Android;
 *  - exportar proyectos con el selector de documentos del sistema;
 *  - pantalla siempre encendida, modo inmersivo, vibración y botón Atrás.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var displayManager: DisplayManager
    private val main = Handler(Looper.getMainLooper())
    private var presentation: OutputPresentation? = null
    /** El usuario pidió proyectar: si el cable se reconecta, la salida vuelve sola. */
    private var wantExternal = false

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    private var saveFile: File? = null
    private var saveMime = "application/octet-stream"

    val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    /* ------------------------------------------------------------ resultados */

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = r.data
        val uris = mutableListOf<Uri>()
        if (r.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) uris += clip.getItemAt(i).uri
            else data.data?.let { uris += it }
        }
        cb.onReceiveValue(uris.toTypedArray())
    }

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val req = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        val allowed = req.resources.filter { res ->
            val perm = androidPermissionFor(res)
            perm == null || granted[perm] == true || hasPermission(perm)
        }
        if (allowed.isEmpty()) req.deny() else req.grant(allowed.toTypedArray())
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val src = saveFile
        saveFile = null
        val uri = r.data?.data
        var ok = false
        if (r.resultCode == RESULT_OK && uri != null && src != null) {
            ok = runCatching {
                contentResolver.openOutputStream(uri)?.use { out -> src.inputStream().use { it.copyTo(out) } } != null
            }.getOrDefault(false)
        }
        src?.delete()
        nativeEvent(JSONObject().put("type", "saved").put("ok", ok))
    }

    /* ------------------------------------------------------------ ciclo de vida */

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (0 != applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) WebView.setWebContentsDebuggingEnabled(true)

        displayManager = getSystemService(DisplayManager::class.java)
        web = WebView(this)
        configureWebView(web)
        web.addJavascriptInterface(Bridge(isEditor = true), "LumaNative")
        web.webChromeClient = EditorChrome()

        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF0B0D12.toInt())
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // Borde a borde (Android 15): la interfaz web no debe quedar bajo las barras del sistema.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        web.loadUrl("https://appassets.androidplatform.net/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__lumaBack ? window.__lumaBack() : false") { consumed ->
                    if (consumed != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
        displayManager.registerDisplayListener(displayListener, main)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        notifyDisplays()
    }

    override fun onPause() {
        // Si se está proyectando, la salida debe seguir aunque el editor pase a segundo plano.
        if (presentation == null) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        displayManager.unregisterDisplayListener(displayListener)
        presentation?.dismiss()
        presentation = null
        web.destroy()
        super.onDestroy()
    }

    /* ------------------------------------------------------------ WebView */

    @SuppressLint("SetJavaScriptEnabled")
    fun configureWebView(w: WebView) {
        w.setBackgroundColor(0xFF000000.toInt())
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
        }
        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // Enlaces externos: al navegador del sistema.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }
        }
    }

    private inner class EditorChrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val mimes = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.contains("/") }.distinct()
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (mimes.size == 1) mimes[0] else "*/*"
                if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            }
            return runCatching { pickFiles.launch(intent); true }.getOrElse {
                fileCallback = null
                false
            }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            main.post { handlePermission(request) }
        }

        override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
            android.util.Log.d("LumaMap", "${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
            return true
        }
    }

    private fun androidPermissionFor(resource: String): String? = when (resource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
        else -> null
    }

    private fun hasPermission(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    /** Concede cámara/micrófono a la página tras pedir el permiso de Android si hace falta. */
    fun handlePermission(request: PermissionRequest) {
        val missing = request.resources.mapNotNull { androidPermissionFor(it) }.filterNot { hasPermission(it) }
        if (missing.isEmpty()) {
            request.grant(request.resources)
            return
        }
        pendingPermission?.deny()
        pendingPermission = request
        askPermissions.launch(missing.toTypedArray())
    }

    /* ------------------------------------------------------------ pantallas externas */

    private fun externalDisplay(): Display? =
        displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).firstOrNull()

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {
            if (wantExternal && presentation == null) showPresentation()
            notifyDisplays(resumed = presentation != null)
        }

        override fun onDisplayRemoved(displayId: Int) {
            val p = presentation
            if (p != null && p.display.displayId == displayId) {
                p.dismiss()
                presentation = null
            }
            notifyDisplays()
        }

        override fun onDisplayChanged(displayId: Int) = Unit
    }

    private fun notifyDisplays(resumed: Boolean = false) {
        val count = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).size
        nativeEvent(JSONObject().put("type", "displays").put("count", count).put("resumed", resumed))
    }

    private fun showPresentation(): Boolean {
        val display = externalDisplay() ?: return false
        presentation?.dismiss()
        return runCatching {
            val p = OutputPresentation(this, display)
            p.setOnDismissListener { if (presentation === p) presentation = null }
            p.show()
            presentation = p
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            true
        }.getOrElse {
            android.util.Log.e("LumaMap", "No se pudo abrir la salida", it)
            false
        }
    }

    private fun nativeEvent(json: JSONObject) {
        main.post {
            web.evaluateJavascript("window.__lumaNativeEvent && window.__lumaNativeEvent(${json})", null)
        }
    }

    /** Entrega un mensaje de la salida al editor. */
    fun deliverToEditor(msg: String) {
        main.post { web.evaluateJavascript("window.__lumaIn && window.__lumaIn(${JSONObject.quote(msg)})", null) }
    }

    /* ------------------------------------------------------------ puente JS */

    /** Expuesto como `window.LumaNative` en el editor y en la salida. */
    inner class Bridge(private val isEditor: Boolean) {
        @JavascriptInterface
        fun externalCount(): Int = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).size

        @JavascriptInterface
        fun externalSize(): String {
            val d = externalDisplay() ?: return ""
            val mode = d.mode
            return "${mode.physicalWidth}x${mode.physicalHeight}"
        }

        @JavascriptInterface
        fun startExternal(): Boolean {
            if (externalDisplay() == null) return false
            wantExternal = true
            main.post { showPresentation() }
            return true
        }

        @JavascriptInterface
        fun stopExternal() {
            wantExternal = false
            main.post {
                presentation?.dismiss()
                presentation = null
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        @JavascriptInterface
        fun toOutput(msg: String) {
            if (isEditor) presentation?.deliver(msg)
        }

        @JavascriptInterface
        fun toEditor(msg: String) {
            if (!isEditor) deliverToEditor(msg)
        }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) = main.post {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else if (presentation == null) window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }.let { }

        @JavascriptInterface
        fun setImmersive(on: Boolean) = main.post {
            val c = WindowInsetsControllerCompat(window, window.decorView)
            if (on) {
                c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsetsCompat.Type.systemBars())
            } else c.show(WindowInsetsCompat.Type.systemBars())
        }.let { }

        @JavascriptInterface
        fun haptic() {
            val v = getSystemService(Vibrator::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) v.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
            else v.vibrate(VibrationEffect.createOneShot(10, VibrationEffect.DEFAULT_AMPLITUDE))
        }

        /* Exportar: el texto llega por trozos y se guarda con el selector del sistema. */
        @JavascriptInterface
        fun saveBegin(name: String, mime: String) {
            saveFile?.delete()
            saveMime = mime
            saveFile = File(cacheDir, "export.tmp").apply { writeText("") }
            pendingSaveName = name
        }

        @JavascriptInterface
        fun saveChunk(text: String) {
            saveFile?.appendText(text)
        }

        @JavascriptInterface
        fun saveEnd() {
            val name = pendingSaveName
            main.post {
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = saveMime
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                runCatching { createDocument.launch(intent) }.onFailure {
                    nativeEvent(JSONObject().put("type", "saved").put("ok", false))
                }
            }
        }
    }

    private var pendingSaveName = "proyecto.lumamap"
}
