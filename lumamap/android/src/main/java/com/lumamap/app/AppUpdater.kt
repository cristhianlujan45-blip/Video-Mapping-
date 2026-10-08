package com.lumamap.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Actualizaciones de la app: lee version.json de la página de descargas,
 * descarga el APK nuevo y abre la pantalla de instalación de Android (un toque
 * en «Actualizar»). Todas las versiones van firmadas con la misma clave, así que
 * se instala encima sin perder proyectos.
 */
class AppUpdater(private val activity: MainActivity) {

    private fun open(url: String): HttpURLConnection {
        var u = URL(url)
        // GitHub redirige a su CDN: se siguen las redirecciones a mano (también entre dominios).
        repeat(6) {
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.setRequestProperty("Cache-Control", "no-cache")
            val code = c.responseCode
            if (code in 300..399) {
                u = URL(u, c.getHeaderField("Location"))
                c.disconnect()
            } else {
                if (code != 200) throw IllegalStateException("HTTP $code")
                return c
            }
        }
        throw IllegalStateException("Demasiadas redirecciones")
    }

    /** Consulta version.json y lo entrega a la página (window.__lumaUpdateInfo). */
    fun check(url: String) {
        thread(name = "lumamap-update-check") {
            val json = runCatching { open(url).inputStream.bufferedReader().use { it.readText() } }.getOrNull()
            activity.runOnUiThread { activity.toEditorJs("window.__lumaUpdateInfo && window.__lumaUpdateInfo(${if (json != null) JSONObject.quote(json) else "null"})") }
        }
    }

    /** Descarga el APK y abre el instalador del sistema. */
    fun install(url: String) {
        // Android exige permitir «instalar apps desconocidas» a LumaMap la primera vez.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            activity.runOnUiThread {
                activity.event(JSONObject().put("type", "updateError").put("msg", "Permite «Instalar apps desconocidas» para LumaMap y vuelve a tocar Actualizar"))
                runCatching {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
                }
            }
            return
        }
        thread(name = "lumamap-update-download") {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                val apk = File(dir, "LumaMap-update.apk")
                val c = open(url)
                val total = c.contentLengthLong
                var got = 0L
                var last = 0L
                c.inputStream.use { input ->
                    apk.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            got += n
                            val now = System.currentTimeMillis()
                            if (total > 0 && now - last > 250) {
                                last = now
                                val p = got.toDouble() / total
                                activity.runOnUiThread { activity.event(JSONObject().put("type", "updateProgress").put("pct", p)) }
                            }
                        }
                    }
                }
                if (total > 0 && got < total) throw IllegalStateException("Descarga incompleta")
                activity.runOnUiThread {
                    val uri = FileProvider.getUriForFile(activity, activity.packageName + ".files", apk)
                    val intent = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    activity.event(JSONObject().put("type", "updateReady"))
                }
            } catch (e: Exception) {
                activity.runOnUiThread { activity.event(JSONObject().put("type", "updateError").put("msg", e.message ?: "error")) }
            }
        }
    }
}
