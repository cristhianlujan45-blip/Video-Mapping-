package com.lumamap.app

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap

/**
 * UDP para las luces en Android (Art-Net, sACN, RDM y descubrimiento de nodos).
 *
 * La lógica de red es la misma que en Windows (web/js/dmxnet.js): aquí solo se
 * abren sockets, se envían bytes y lo recibido se pasa a la página. Cada socket
 * recibe en su propio hilo: una red lenta nunca bloquea la interfaz.
 * El «multicast lock» de Wi-Fi hace que Android entregue los paquetes de
 * difusión (ArtPollReply, RDM) mientras haya sockets abiertos.
 */
class UdpHub(private val context: Context, private val deliver: (Int, String, Int, String) -> Unit) {
    private val socks = ConcurrentHashMap<Int, DatagramSocket>()
    private val errors = ConcurrentHashMap<Int, String>()
    private var lock: WifiManager.MulticastLock? = null

    fun open(id: Int, port: Int, address: String, multicast: Boolean): Boolean = try {
        val s: DatagramSocket = if (multicast) MulticastSocket(null) else DatagramSocket(null)
        s.reuseAddress = true
        s.broadcast = true
        s.bind(if (address.isEmpty() || address == "0.0.0.0") InetSocketAddress(port) else InetSocketAddress(InetAddress.getByName(address), port))
        socks[id] = s
        acquireLock()
        Thread({
            val buf = ByteArray(2048)
            while (!s.isClosed) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    val from = p.address?.hostAddress ?: continue
                    deliver(id, from, p.port, Base64.encodeToString(p.data, p.offset, p.length, Base64.NO_WRAP))
                } catch (_: Exception) {
                    if (s.isClosed) break
                }
            }
        }, "LumaMap UDP $id").apply { isDaemon = true }.start()
        true
    } catch (e: Exception) {
        errors[id] = e.message ?: e.javaClass.simpleName
        false
    }

    /** Devuelve "" si salió bien o el motivo del error. */
    fun send(id: Int, host: String, port: Int, b64: String): String {
        val s = socks[id] ?: return "Socket cerrado"
        return try {
            val d = Base64.decode(b64, Base64.NO_WRAP)
            s.send(DatagramPacket(d, d.size, InetAddress.getByName(host), port))
            ""
        } catch (e: Exception) {
            e.message ?: e.javaClass.simpleName
        }
    }

    fun join(id: Int, group: String) { (socks[id] as? MulticastSocket)?.joinGroup(InetAddress.getByName(group)) }
    fun leave(id: Int, group: String) { (socks[id] as? MulticastSocket)?.leaveGroup(InetAddress.getByName(group)) }
    fun error(id: Int): String = errors[id] ?: ""

    fun close(id: Int) {
        socks.remove(id)?.close()
        if (socks.isEmpty()) releaseLock()
    }

    fun closeAll() {
        for (k in socks.keys) close(k)
        releaseLock()
    }

    /** Interfaces IPv4 activas: [{name, address, netmask, internal}]. */
    fun interfaces(): String {
        val out = JSONArray()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp) continue
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address as? Inet4Address ?: continue
                    val bits = ia.networkPrefixLength.toInt().coerceIn(0, 32)
                    val mask = if (bits == 0) 0L else (0xffffffffL shl (32 - bits)) and 0xffffffffL
                    val m = "${(mask shr 24) and 255}.${(mask shr 16) and 255}.${(mask shr 8) and 255}.${mask and 255}"
                    out.put(JSONObject().put("name", ni.displayName ?: ni.name).put("address", a.hostAddress).put("netmask", m).put("internal", ni.isLoopback))
                }
            }
        } catch (_: Exception) { }
        return out.toString()
    }

    private fun acquireLock() {
        if (lock?.isHeld == true) return
        try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
            lock = wm.createMulticastLock("lumamap-dmx").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) { }
    }

    private fun releaseLock() {
        try { if (lock?.isHeld == true) lock?.release() } catch (_: Exception) { }
        lock = null
    }
}
