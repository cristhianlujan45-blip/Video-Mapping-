package com.lumamap.app

import org.json.JSONObject
import java.net.Inet6Address
import java.net.InetAddress
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.Executors

/**
 * IA local (Ollama) desde Android: la página se sirve por https y no puede pedir
 * http://192.168.x.x:11434, así que la petición la hace la app (como el proceso
 * principal en Windows, desktop/ai.js). Mismas reglas que allí:
 *  - solo este teléfono o la red local (nunca internet), comprobado también con
 *    la IP ya resuelta;
 *  - solo las rutas de la API de Ollama;
 *  - con tiempo máximo. La respuesta vuelve a la página con su número de petición.
 */
class LocalAi(private val done: (Int, JSONObject) -> Unit) {
    private val pool = Executors.newFixedThreadPool(2) { r -> Thread(r, "LumaMap IA local").apply { isDaemon = true } }
    private val paths = Regex("^/api/(tags|version|chat|show|ps|generate|pull)$")

    /** ¿Es este equipo o una IP privada de la red local? (igual que isLocalHost en desktop/ai.js) */
    private fun localName(h: String): Boolean {
        if (h == "localhost" || h == "::1" || h.endsWith(".local")) return true
        val m = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$").find(h) ?: return false
        val a = m.groupValues[1].toInt(); val b = m.groupValues[2].toInt()
        return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b in 16..31) || (a == 169 && b == 254)
    }

    /** 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, fe80::/10 y fc00::/7. */
    private fun localAddress(a: InetAddress): Boolean = a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress ||
        (a is Inet6Address && (a.address[0].toInt() and 0xfe) == 0xfc)

    fun request(id: Int, url: String, method: String, body: String, timeoutMs: Int) {
        pool.execute {
            val r = JSONObject()
            try {
                val u = URL(url)
                val host = u.host.removePrefix("[").removeSuffix("]")
                if ((u.protocol != "http" && u.protocol != "https") || !localName(host)) { done(id, r.put("ok", false).put("error", "not-local")); return@execute }
                if (!paths.matches(u.path)) { done(id, r.put("ok", false).put("error", "bad-path")); return@execute }
                // El nombre debe resolver a una IP local (evita que un .local apunte a internet).
                if (InetAddress.getAllByName(host).any { !localAddress(it) }) { done(id, r.put("ok", false).put("error", "not-local")); return@execute }
                // Descargar un modelo (varios GB) puede tardar mucho: hasta 3 horas.
                val t = timeoutMs.coerceIn(1000, if (u.path == "/api/pull") 10_800_000 else 600000)
                val c = u.openConnection() as HttpURLConnection
                c.instanceFollowRedirects = false   // una redirección podría sacar la petición de la red local
                c.connectTimeout = minOf(t, 8000)
                c.readTimeout = t
                c.setRequestProperty("content-type", "application/json")
                if (method == "POST") {
                    c.requestMethod = "POST"
                    c.doOutput = true
                    c.outputStream.use { it.write((body.ifEmpty { "{}" }).toByteArray(Charsets.UTF_8)) }
                }
                val code = c.responseCode
                val stream = if (code >= 400) c.errorStream else c.inputStream
                val text = stream?.bufferedReader(Charsets.UTF_8)?.use { rd ->
                    val sb = StringBuilder()
                    val buf = CharArray(8192)
                    while (sb.length < 4_000_000) { val n = rd.read(buf); if (n < 0) break; sb.append(buf, 0, n) }
                    sb.toString()
                } ?: ""
                c.disconnect()
                done(id, r.put("ok", code in 200..299).put("status", code).put("text", text))
            } catch (e: SocketTimeoutException) {
                done(id, r.put("ok", false).put("error", "timeout"))
            } catch (e: Exception) {
                done(id, r.put("ok", false).put("error", "network"))
            }
        }
    }

    fun shutdown() { pool.shutdownNow() }
}
