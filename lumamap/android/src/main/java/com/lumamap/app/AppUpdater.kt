package com.lumamap.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Actualizaciones de la app: lee version.json de la página de descargas y descarga el APK nuevo
 * en segundo plano. Se instala con el instalador del sistema (PackageInstaller):
 *  · la primera vez Android pide confirmar con «Actualizar» (LumaMap aún no es quien instaló la app);
 *  · desde ahí, en Android 12 o más, se instala SOLA cuando LumaMap pasa a segundo plano (nunca
 *    mientras se proyecta). Todas las versiones van firmadas con la misma clave: no se pierde nada.
 */
class AppUpdater(private val activity: MainActivity) {

    private val dir get() = File(activity.cacheDir, "updates").apply { mkdirs() }
    private val pendingApk get() = File(dir, "LumaMap-pending.apk")
    private val pendingInfo get() = File(dir, "pending.txt")
    @Volatile private var downloading = false
    @Volatile private var installing = false

    /** Compilación de esta app (versionCode = 1000 + compilación). */
    private fun currentBuild(): Long {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        return code - 1000
    }
    /** ¿Android instalará las actualizaciones sin preguntar? (12+ y LumaMap es quien instaló la app). */
    fun canInstallSilently(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            runCatching { activity.packageManager.getInstallSourceInfo(activity.packageName).installingPackageName == activity.packageName }.getOrDefault(false)

    /** Compilación del APK ya descargado (0 si no hay o ya está instalado). */
    fun pendingBuild(): Long {
        val b = runCatching { pendingInfo.readText().trim().toLong() }.getOrDefault(0L)
        if (b <= 0 || !pendingApk.exists() || b <= currentBuild()) {
            // Ya instalado (o roto): fuera.
            if (pendingApk.exists() && b <= currentBuild()) { pendingApk.delete(); pendingInfo.delete() }
            return 0
        }
        return b
    }

    private fun open(url: String): HttpURLConnection {
        var u = URL(url)
        // GitHub redirige a su CDN: se siguen las redirecciones a mano (también entre dominios).
        repeat(6) {
            // Solo HTTPS: la app permite HTTP sin cifrar para la IA local de la red de casa,
            // pero una actualización nunca se descarga sin cifrar (ni tras una redirección).
            if (u.protocol != "https") throw IllegalStateException("Las actualizaciones solo se descargan por HTTPS")
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

    /**
     * Descarga el APK de la compilación `build` en segundo plano (si no estaba ya) y avisa a la
     * página con «updateDownloaded». quiet = sin avisos de progreso (la descarga automática).
     */
    fun download(url: String, build: Long, quiet: Boolean, then: (() -> Unit)? = null) {
        if (pendingBuild() >= build && build > 0) {
            activity.runOnUiThread { activity.event(JSONObject().put("type", "updateDownloaded").put("build", build)); then?.invoke() }
            return
        }
        if (downloading) return
        downloading = true
        thread(name = "lumamap-update-download") {
            try {
                val tmp = File(dir, "LumaMap-download.apk")
                val c = open(url)
                val total = c.contentLengthLong
                var got = 0L
                var last = 0L
                c.inputStream.use { input ->
                    tmp.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            got += n
                            val now = System.currentTimeMillis()
                            if (!quiet && total > 0 && now - last > 250) {
                                last = now
                                val p = got.toDouble() / total
                                activity.runOnUiThread { activity.event(JSONObject().put("type", "updateProgress").put("pct", p)) }
                            }
                        }
                    }
                }
                if (total > 0 && got < total) throw IllegalStateException("Descarga incompleta")
                // Que sea de verdad un APK de LumaMap (mismo paquete) antes de guardarlo.
                val info = activity.packageManager.getPackageArchiveInfo(tmp.path, 0)
                if (info?.packageName != activity.packageName) { tmp.delete(); throw IllegalStateException("El archivo descargado no es LumaMap") }
                pendingApk.delete(); tmp.renameTo(pendingApk)
                pendingInfo.writeText(build.toString())
                activity.runOnUiThread { activity.event(JSONObject().put("type", "updateDownloaded").put("build", build)); then?.invoke() }
            } catch (e: Exception) {
                activity.runOnUiThread { activity.event(JSONObject().put("type", "updateError").put("msg", e.message ?: "error").put("quiet", quiet)) }
            } finally { downloading = false }
        }
    }

    /** Descarga e instala ahora (botón «Actualizar»): Android puede pedir confirmar. */
    fun install(url: String, build: Long = 0) {
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
        download(url, build, quiet = false) { installPending(silentOnly = false) }
    }

    /**
     * Instala el APK descargado con el instalador del sistema. silentOnly = solo si Android deja
     * hacerlo sin preguntar (Android 12+ y LumaMap ya es quien instaló la app); si no, se deja
     * para cuando la persona toque «Actualizar».
     */
    fun installPending(silentOnly: Boolean): Boolean {
        val apk = pendingApk
        if (!apk.exists() || installing) return false
        if (silentOnly && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) return false
        installing = true
        return try {
            val pi = activity.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(activity.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            val id = pi.createSession(params)
            pi.openSession(id).use { s ->
                s.openWrite("lumamap.apk", 0, apk.length()).use { out -> apk.inputStream().use { it.copyTo(out) }; s.fsync(out) }
                val intent = Intent(activity, UpdateReceiver::class.java).putExtra(UpdateReceiver.SILENT_ONLY, silentOnly)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                s.commit(PendingIntent.getBroadcast(activity, id, intent, flags).intentSender)
            }
            true
        } catch (e: Exception) {
            Log.w("LumaMap", "actualización", e)
            activity.runOnUiThread { activity.event(JSONObject().put("type", "updateError").put("msg", e.message ?: "error").put("quiet", silentOnly)) }
            false
        } finally { installing = false }
    }
}

/** Respuesta del instalador del sistema: pedir confirmación (si se puede) o anotar el resultado. */
class UpdateReceiver : BroadcastReceiver() {
    companion object { const val SILENT_ONLY = "silentOnly" }
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // En la instalación automática (en segundo plano) no se interrumpe a nadie: la
                // página lo ofrecerá con «Actualizar» la próxima vez.
                if (intent.getBooleanExtra(SILENT_ONLY, false)) return
                @Suppress("DEPRECATION")
                val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { ctx.startActivity(confirm) }
            }
            PackageInstaller.STATUS_SUCCESS -> Log.i("LumaMap", "Actualización instalada")
            else -> Log.w("LumaMap", "Actualización no instalada: " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }
}
