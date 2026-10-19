package com.lumamap.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * USB-DMX en Android (la WebView no trae Web Serial).
 *
 * Interfaces con chip FTDI (vendor 0x0403) que hablan «DMX USB Pro» (Enttec Pro
 * y compatibles): la página arma el paquete (web/js/usbdmx.js, proPacket) y aquí
 * solo se envía por USB con el modo «host» de Android (cable OTG).
 *
 * SIN PROBAR CON HARDWARE REAL: los valores siguen la hoja de datos de FTDI y lo
 * que usan libftdi / usb-serial-for-android. Si algo falla se cierra la interfaz
 * y la página lo dice; nunca se bloquea el editor (todo va en un hilo aparte y un
 * fotograma se salta si el anterior aún se está enviando).
 */
class UsbDmx(private val context: Context, private val toJs: (JSONObject) -> Unit) {
    companion object {
        const val FTDI_VID = 0x0403
        private const val ACTION_PERMISSION = "com.lumamap.app.USB_DMX_PERMISSION"
        // Peticiones de control de FTDI (salida, tipo «vendor», al dispositivo).
        private const val REQ_OUT = 0x40
        private const val SIO_RESET = 0
        private const val SIO_SET_FLOW_CTRL = 2
        private const val SIO_SET_BAUD_RATE = 3
        private const val SIO_SET_DATA = 4
    }

    private val usb: UsbManager? = context.getSystemService(Context.USB_SERVICE) as? UsbManager
    private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "LumaMap USB-DMX").apply { isDaemon = true } }
    private val busy = AtomicBoolean(false)
    @Volatile private var conn: UsbDeviceConnection? = null
    @Volatile private var iface: UsbInterface? = null
    @Volatile private var out: UsbEndpoint? = null
    @Volatile private var device: UsbDevice? = null
    private var fails = 0
    private var registered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val dev = deviceOf(intent)
            when (intent.action) {
                ACTION_PERMISSION -> toJs(JSONObject().put("state", "permission").put("ok", intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)))
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> if (dev?.vendorId == FTDI_VID) toJs(JSONObject().put("state", "attached"))
                UsbManager.ACTION_USB_DEVICE_DETACHED -> if (dev != null && dev.deviceName == device?.deviceName) {
                    close()
                    toJs(JSONObject().put("state", "detached"))
                }
            }
        }
    }

    private fun deviceOf(i: Intent): UsbDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) i.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else @Suppress("DEPRECATION") i.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)

    /** Avisos de enchufar / quitar y del permiso (se llama una vez, al activar las luces). */
    @Synchronized
    fun watch() {
        if (registered || usb == null) return
        registered = true
        val f = IntentFilter().apply {
            addAction(ACTION_PERMISSION)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(context, receiver, f, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    private fun find(): UsbDevice? = usb?.deviceList?.values?.firstOrNull { it.vendorId == FTDI_VID }

    /**
     * Abre la primera interfaz FTDI. Devuelve JSON {ok, code, name}: code = "ok",
     * "none" (no hay ninguna), "asked" (se pidió permiso; la respuesta llega luego),
     * "permission" (falta permiso y no se pidió) o "error".
     */
    @Synchronized
    fun open(askPermission: Boolean): String {
        watch()
        val r = JSONObject()
        val m = usb ?: return r.put("ok", false).put("code", "error").put("msg", "Este teléfono no tiene USB host").toString()
        if (conn != null) return r.put("ok", true).put("code", "ok").put("name", nameOf(device)).toString()
        val dev = find() ?: return r.put("ok", false).put("code", "none").toString()
        if (!m.hasPermission(dev)) {
            if (!askPermission) return r.put("ok", false).put("code", "permission").toString()
            // El sistema añade a este Intent el aparato y la respuesta: debe ser mutable (Android 12+)
            // y explícito (con paquete) para que Android 14 lo acepte.
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pi = PendingIntent.getBroadcast(context, 0, Intent(ACTION_PERMISSION).setPackage(context.packageName), flags)
            m.requestPermission(dev, pi)
            return r.put("ok", false).put("code", "asked").toString()
        }
        return try {
            setup(m, dev)
            r.put("ok", true).put("code", "ok").put("name", nameOf(dev)).toString()
        } catch (e: Exception) {
            close()
            r.put("ok", false).put("code", "error").put("msg", e.message ?: e.javaClass.simpleName).toString()
        }
    }

    private fun nameOf(d: UsbDevice?): String = d?.productName?.takeIf { it.isNotBlank() } ?: "Interfaz USB-DMX (FTDI)"

    private fun setup(m: UsbManager, dev: UsbDevice) {
        val c = m.openDevice(dev) ?: throw IllegalStateException("No se pudo abrir el USB")
        val itf = dev.getInterface(0)
        if (!c.claimInterface(itf, true)) { c.close(); throw IllegalStateException("La interfaz USB está en uso") }
        var ep: UsbEndpoint? = null
        for (i in 0 until itf.endpointCount) {
            val e = itf.getEndpoint(i)
            if (e.type == UsbConstants.USB_ENDPOINT_XFER_BULK && e.direction == UsbConstants.USB_DIR_OUT) { ep = e; break }
        }
        if (ep == null) { c.releaseInterface(itf); c.close(); throw IllegalStateException("La interfaz USB no tiene salida") }
        // Puerto A = índice 1 (como libftdi). En chips de un solo puerto el índice se ignora.
        val port = 1
        val ctl = { req: Int, value: Int, index: Int ->
            if (c.controlTransfer(REQ_OUT, req, value, index, null, 0, 1000) < 0) throw IllegalStateException("La interfaz USB no respondió ($req)")
        }
        ctl(SIO_RESET, 0, port)
        // 250 000 baudios: divisor 12 sobre la base de 3 MHz (sin fracción). En chips de varios
        // puertos el byte alto del índice lleva los bits altos del divisor (0) y el bajo, el puerto.
        ctl(SIO_SET_BAUD_RATE, 12, if (dev.interfaceCount > 1) port else 0)
        ctl(SIO_SET_DATA, 0x1008, port)       // 8 bits, sin paridad, 2 bits de parada (8N2)
        ctl(SIO_SET_FLOW_CTRL, 0, port)       // sin control de flujo
        conn = c; iface = itf; out = ep; device = dev; fails = 0
    }

    /** Envía un paquete ya armado (base64). false si se saltó porque el anterior aún se envía. */
    fun send(b64: String): Boolean {
        val c = conn ?: return false
        val ep = out ?: return false
        if (!busy.compareAndSet(false, true)) return false
        val data = try { Base64.decode(b64, Base64.NO_WRAP) } catch (_: Exception) { busy.set(false); return false }
        writer.execute {
            try {
                val n = c.bulkTransfer(ep, data, data.size, 200)
                if (n < 0) {
                    if (++fails >= 5) { close(); toJs(JSONObject().put("state", "lost")) }
                } else fails = 0
            } catch (_: Exception) {
                close(); toJs(JSONObject().put("state", "lost"))
            } finally {
                busy.set(false)
            }
        }
        return true
    }

    @Synchronized
    fun close() {
        val c = conn
        conn = null; out = null; device = null
        iface?.let { runCatching { c?.releaseInterface(it) } }
        iface = null
        runCatching { c?.close() }
    }

    fun shutdown() {
        close()
        if (registered) runCatching { context.unregisterReceiver(receiver) }
        registered = false
        writer.shutdownNow()
    }
}
