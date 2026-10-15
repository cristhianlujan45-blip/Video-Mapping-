package com.lumamap.app

import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.Inet6Address
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * Descargas de internet para la página (buscar GIF animados): la página no puede
 * leer imágenes de otros sitios por CORS, así que las baja la app (como el proceso
 * principal en Windows, «net:get» en desktop/main.js). Mismas reglas que allí:
 *  - solo https y solo internet (nunca el teléfono ni la red local);
 *  - tamaño máximo y tiempo máximo.
 * La respuesta vuelve a window.__lumaNetGet(id, { ok, status, type, b64 }).
 */
class NetGet(private val done: (Int, JSONObject) -> Unit) {
    private val pool = Executors.newFixedThreadPool(3) { r -> Thread(r, "LumaMap descargas").apply { isDaemon = true } }

    private fun localAddress(a: InetAddress): Boolean = a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress ||
        a.isAnyLocalAddress || (a is Inet6Address && (a.address[0].toInt() and 0xfe) == 0xfc)

    fun get(id: Int, url: String, maxBytes: Int) {
        pool.execute {
            val r = JSONObject()
            try {
                var u = URL(url)
                val limit = maxBytes.coerceIn(1, 16_000_000)
                var hops = 0
                while (true) {
                    if (u.protocol != "https") { done(id, r.put("ok", false).put("error", "not-https")); return@execute }
                    if (InetAddress.getAllByName(u.host).any { localAddress(it) }) { done(id, r.put("ok", false).put("error", "not-public")); return@execute }
                    val c = u.openConnection() as HttpsURLConnection
                    c.instanceFollowRedirects = false   // cada salto se comprueba con las mismas reglas
                    c.connectTimeout = 10000
                    c.readTimeout = 20000
                    c.setRequestProperty("User-Agent", "LumaMap")
                    val code = c.responseCode
                    if (code in 300..399 && hops < 4) {
                        val loc = c.getHeaderField("Location"); c.disconnect()
                        if (loc == null) { done(id, r.put("ok", false).put("status", code)); return@execute }
                        u = URL(u, loc); hops++; continue
                    }
                    if (c.contentLengthLong > limit) { c.disconnect(); done(id, r.put("ok", false).put("error", "too-big")); return@execute }
                    val stream = if (code >= 400) c.errorStream else c.inputStream
                    val out = ByteArrayOutputStream()
                    stream?.use { s ->
                        val buf = ByteArray(16384)
                        while (true) {
                            val n = s.read(buf); if (n < 0) break
                            out.write(buf, 0, n)
                            if (out.size() > limit) { c.disconnect(); done(id, r.put("ok", false).put("error", "too-big")); return@execute }
                        }
                    }
                    val type = c.contentType ?: ""
                    c.disconnect()
                    done(id, r.put("ok", code in 200..299).put("status", code).put("type", type)
                        .put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)))
                    return@execute
                }
            } catch (e: SocketTimeoutException) {
                done(id, r.put("ok", false).put("error", "timeout"))
            } catch (e: Exception) {
                done(id, r.put("ok", false).put("error", "network"))
            }
        }
    }

    fun shutdown() { pool.shutdownNow() }
}
