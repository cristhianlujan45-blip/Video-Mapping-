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
import android.view.InputDevice
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
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
    private lateinit var root: FrameLayout
    private var lastBack = 0L
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
        // Videos: se optimizan antes de entregarlos al editor (si hace falta).
        optimizeAll(uris, 0, mutableListOf()) { cb.onReceiveValue(it.toTypedArray()) }
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
        root = FrameLayout(this)
        root.setBackgroundColor(0xFF0B0D12.toInt())
        setContentView(root)
        createEditor()
        // Borde a borde (Android 15): la interfaz web no debe quedar bajo las barras del sistema.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__lumaBack ? window.__lumaBack() : false") { consumed ->
                    if (consumed == "true") return@evaluateJavascript
                    // Doble pulsación para salir: evita cerrar el show por accidente.
                    val now = System.currentTimeMillis()
                    if (now - lastBack < 2000) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    } else {
                        lastBack = now
                        Toast.makeText(this@MainActivity, "Pulsa Atrás otra vez para salir", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
        displayManager.registerDisplayListener(displayListener, main)
    }

    /* ------------------------------------------------------------ optimización de video */

    private val optimizer by lazy { VideoOptimizer(this) }
    private var videoTargetW = 1920
    private var videoTargetH = 1080
    private var autoOptimize = true

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun optimizeAll(uris: List<Uri>, i: Int, out: MutableList<Uri>, done: (List<Uri>) -> Unit) {
        if (i >= uris.size) { done(out); return }
        val uri = uris[i]
        val isVideo = contentResolver.getType(uri)?.startsWith("video/") == true
        if (!autoOptimize || !isVideo) { out += uri; optimizeAll(uris, i + 1, out, done); return }
        nativeEvent(JSONObject().put("type", "optimize").put("stage", "probe"))
        optimizer.optimize(uri, videoTargetW, videoTargetH,
            onProgress = { p -> nativeEvent(JSONObject().put("type", "optimize").put("stage", "progress").put("pct", p.toDouble())) },
            onDone = { result, msg ->
                if (msg != null) nativeEvent(JSONObject().put("type", "optimize").put("stage", "done").put("msg", msg))
                out += result
                optimizeAll(uris, i + 1, out, done)
            })
    }

    /** Crea (o vuelve a crear tras un fallo) la WebView del editor. */
    private fun createEditor() {
        val w = WebView(this)
        configureWebView(w) { crashed ->
            // El motor de la WebView se cerró (memoria, GPU…): se recrea y el
            // proyecto vuelve del autoguardado, en lugar de cerrarse la app.
            root.removeView(crashed)
            crashed.destroy()
            createEditor()
            Toast.makeText(this, "LumaMap se recuperó de un error y restauró tu proyecto", Toast.LENGTH_LONG).show()
        }
        w.addJavascriptInterface(Bridge(isEditor = true), "LumaNative")
        w.webChromeClient = EditorChrome()
        root.addView(w, 0, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        web = w
        w.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    /**
     * Mandos de juego (Xbox, PlayStation…): Android convierte el botón B (o ○) en «Atrás»
     * y cerraría paneles o la app. Los botones del mando van siempre a la página, que los
     * lee con la Gamepad API y los usa según lo asignado.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val fromPad = event.isFromSource(InputDevice.SOURCE_GAMEPAD) || event.isFromSource(InputDevice.SOURCE_JOYSTICK)
        if (fromPad && (KeyEvent.isGamepadButton(event.keyCode) || event.keyCode == KeyEvent.KEYCODE_BACK) && ::web.isInitialized) {
            web.dispatchKeyEvent(event)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Si el sistema cerró la salida (pantalla bloqueada, parpadeo del HDMI), vuelve sola.
        if (wantExternal && presentation == null) showPresentation()
        notifyDisplays(resumed = presentation != null)
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
        udp.closeAll()
        // Solo lo que se llegó a usar (no se crean al cerrar).
        if (midiLazy.isInitialized()) midi.closeAll()
        if (usbDmxLazy.isInitialized()) usbDmx.shutdown()
        if (localAiLazy.isInitialized()) localAi.shutdown()
        web.destroy()
        super.onDestroy()
    }

    /* ------------------------------------------------------------ WebView */

    @SuppressLint("SetJavaScriptEnabled")
    fun configureWebView(w: WebView, onCrash: (WebView) -> Unit = {}) {
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

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                android.util.Log.w("LumaMap", "WebView render process gone (crash=${detail.didCrash()})")
                main.post { onCrash(view) }
                return true // la app sigue viva
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
            p.setOnDismissListener {
                if (presentation === p) presentation = null
                // Cerrada por el sistema (no por el usuario): se reabre en cuanto se pueda.
                if (wantExternal && !isFinishing) main.postDelayed({ if (wantExternal && presentation == null && !isFinishing) showPresentation() }, 800)
            }
            p.show()
            presentation = p
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            true
        }.getOrElse {
            android.util.Log.e("LumaMap", "No se pudo abrir la salida", it)
            false
        }
    }

    /** Para las clases auxiliares (actualizador): evento hacia la página y JS directo. */
    fun event(json: JSONObject) = nativeEvent(json)
    fun toEditorJs(js: String) { web.evaluateJavascript(js, null) }
    private val updater by lazy { AppUpdater(this) }

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

        /** Tamaño de la composición: los videos más grandes se reducen a él al importarlos. */
        @JavascriptInterface
        fun setVideoTarget(w: Int, h: Int) { videoTargetW = w.coerceIn(320, 7680); videoTargetH = h.coerceIn(240, 4320) }

        @JavascriptInterface
        fun setAutoOptimize(on: Boolean) { autoOptimize = on }

        /** "versión|código", p. ej. "2.3.14|1014". */
        @JavascriptInterface
        fun appVersion(): String {
            val info = packageManager.getPackageInfo(packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
            return "${info.versionName}|$code"
        }

        @JavascriptInterface
        fun checkUpdate(url: String) = updater.check(url)

        @JavascriptInterface
        fun installUpdate(url: String) = updater.install(url)

        /* Luces: UDP para Art-Net / sACN / RDM (solo el editor). */
        @JavascriptInterface
        fun udpOpen(id: Int, port: Int, address: String, multicast: Boolean): Boolean = isEditor && udp.open(id, port, address, multicast)

        @JavascriptInterface
        fun udpSend(id: Int, host: String, port: Int, b64: String): String = if (isEditor) udp.send(id, host, port, b64) else "No disponible"

        @JavascriptInterface
        fun udpClose(id: Int) { if (isEditor) udp.close(id) }

        @JavascriptInterface
        fun udpJoin(id: Int, group: String) { if (isEditor) runCatching { udp.join(id, group) } }

        @JavascriptInterface
        fun udpLeave(id: Int, group: String) { if (isEditor) runCatching { udp.leave(id, group) } }

        @JavascriptInterface
        fun udpError(id: Int): String = udp.error(id)

        @JavascriptInterface
        fun netInterfaces(): String = udp.interfaces()

        /* MIDI: controladores USB / Bluetooth (web/js/midi-android.js imita Web MIDI). */
        @JavascriptInterface
        fun midiStart(): Boolean = isEditor && midi.start()

        @JavascriptInterface
        fun midiPorts(): String = if (isEditor) midi.ports() else "[]"

        @JavascriptInterface
        fun midiSend(id: String, bytes: String): Boolean = isEditor && midi.send(id, bytes)

        /* USB-DMX: interfaces FTDI «DMX USB Pro» con cable OTG (web/js/usbdmx.js). */
        @JavascriptInterface
        fun usbDmxOpen(askPermission: Boolean): String =
            if (isEditor) usbDmx.open(askPermission) else "{\"ok\":false,\"code\":\"error\"}"

        @JavascriptInterface
        fun usbDmxSend(b64: String): Boolean = isEditor && usbDmx.send(b64)

        @JavascriptInterface
        fun usbDmxClose() { if (isEditor) usbDmx.close() }

        @JavascriptInterface
        fun usbDmxWatch() { if (isEditor) usbDmx.watch() }

        /* IA local (Ollama en este teléfono o en un PC de la red): la respuesta llega a window.__lumaAiHttp(id, r). */
        @JavascriptInterface
        fun aiHttp(id: Int, url: String, method: String, body: String, timeoutMs: Int) {
            if (isEditor) localAi.request(id, url, method, body, timeoutMs)
        }

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

        /** Trozo binario (base64) para videos e imágenes. */
        @JavascriptInterface
        fun saveChunkBase64(b64: String) {
            saveFile?.appendBytes(android.util.Base64.decode(b64, android.util.Base64.DEFAULT))
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

    /* ------------------------------------------------------------ luces (UDP) */

    /** Sockets UDP de las luces; lo recibido se entrega a la página (web/js/dmx-android.js). */
    private val udp by lazy {
        UdpHub(this) { id, from, port, b64 ->
            main.post { web.evaluateJavascript("window.__lumaUdp&&window.__lumaUdp($id,${JSONObject.quote(from)},$port,${JSONObject.quote(b64)})", null) }
        }
    }

    /* ------------------------------------------------------------ MIDI, USB-DMX e IA local */

    private val midiLazy = lazy { MidiHub(this, main) { js -> web.evaluateJavascript(js, null) } }
    private val midi by midiLazy

    private val usbDmxLazy = lazy {
        UsbDmx(this) { ev -> main.post { web.evaluateJavascript("window.__lumaUsbDmx&&window.__lumaUsbDmx($ev)", null) } }
    }
    private val usbDmx by usbDmxLazy

    private val localAiLazy = lazy {
        LocalAi { id, r -> main.post { web.evaluateJavascript("window.__lumaAiHttp&&window.__lumaAiHttp($id,$r)", null) } }
    }
    private val localAi by localAiLazy
}
