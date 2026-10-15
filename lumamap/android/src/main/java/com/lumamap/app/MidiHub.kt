package com.lumamap.app

import android.content.Context
import android.content.pm.PackageManager
import android.media.midi.MidiDevice
import android.media.midi.MidiDeviceInfo
import android.media.midi.MidiInputPort
import android.media.midi.MidiManager
import android.media.midi.MidiOutputPort
import android.media.midi.MidiReceiver
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * MIDI en Android (la WebView no trae Web MIDI).
 *
 * Abre los controladores conectados (USB y los Bluetooth que el sistema ya tenga
 * conectados) con el MIDI de Android y pasa los bytes a la página, donde
 * web/js/midi-android.js imita Web MIDI para midi.js. Igual que en Web MIDI:
 *  - «entrada» de LumaMap = puerto de salida del aparato (lo que el aparato envía);
 *  - «salida» de LumaMap = puerto de entrada del aparato (feedback, MIDI Clock).
 * Todo se recibe en un hilo propio; los mensajes se agrupan en lotes para no
 * llamar a la página por cada byte. Enchufar o quitar un aparato avisa a la
 * página (onstatechange).
 */
class MidiHub(private val context: Context, private val main: Handler, private val toJs: (String) -> Unit) {
    private class Opened(val info: MidiDeviceInfo, val device: MidiDevice) {
        val outs = mutableListOf<MidiOutputPort>()
        val ins = ConcurrentHashMap<Int, MidiInputPort>()
    }

    private val manager: MidiManager? by lazy {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_MIDI)) null
        else context.getSystemService(Context.MIDI_SERVICE) as? MidiManager
    }
    private val threadLazy = lazy { HandlerThread("LumaMap MIDI").also { it.start() } }
    private val thread by threadLazy
    private val handler by lazy { Handler(thread.looper) }
    private val opened = ConcurrentHashMap<Int, Opened>()
    private var started = false

    // Lote de mensajes pendientes de entregar a la página.
    private val batch = StringBuilder()
    private var flushPosted = false

    private val callback = object : MidiManager.DeviceCallback() {
        override fun onDeviceAdded(device: MidiDeviceInfo) { open(device) }
        override fun onDeviceRemoved(device: MidiDeviceInfo) {
            opened.remove(device.id)?.let { closeDevice(it) }
            changed()
        }
    }

    /** Empieza a escuchar (al activar MIDI en la página). false si el teléfono no tiene MIDI. */
    @Synchronized
    fun start(): Boolean {
        val m = manager ?: return false
        if (started) return true
        started = true
        registerCallback(m)
        for (info in devices(m)) open(info)
        return true
    }

    @Suppress("DEPRECATION")
    private fun registerCallback(m: MidiManager) = m.registerDeviceCallback(callback, handler)

    @Suppress("DEPRECATION")
    private fun devices(m: MidiManager): Collection<MidiDeviceInfo> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) m.getDevicesForTransport(MidiManager.TRANSPORT_MIDI_BYTE_STREAM)
        else m.devices.toList()

    private fun open(info: MidiDeviceInfo) {
        val m = manager ?: return
        if (opened.containsKey(info.id)) return
        m.openDevice(info, { device ->
            if (device == null) return@openDevice
            val o = Opened(info, device)
            for (p in info.ports) {
                runCatching {
                    if (p.type == MidiDeviceInfo.PortInfo.TYPE_OUTPUT) {
                        device.openOutputPort(p.portNumber)?.let { port ->
                            port.connect(receiverFor(portId(info, "i", p.portNumber)))
                            o.outs += port
                        }
                    } else if (p.type == MidiDeviceInfo.PortInfo.TYPE_INPUT) {
                        device.openInputPort(p.portNumber)?.let { o.ins[p.portNumber] = it }
                    }
                }
            }
            opened[info.id] = o
            changed()
        }, handler)
    }

    private fun receiverFor(id: String) = object : MidiReceiver() {
        override fun onSend(msg: ByteArray, offset: Int, count: Int, timestamp: Long) {
            val sb = StringBuilder(16 + count * 4)
            sb.append("[").append(JSONObject.quote(id)).append(",").append(timestamp / 1_000_000.0)
            for (i in offset until offset + count) sb.append(",").append(msg[i].toInt() and 0xff)
            sb.append("]")
            synchronized(batch) {
                if (batch.isNotEmpty()) batch.append(",")
                batch.append(sb)
                if (!flushPosted) { flushPosted = true; main.post { deliverBatch() } }
            }
        }
    }

    // (No se llama flush: MidiReceiver ya tiene un flush() propio.)
    private fun deliverBatch() {
        val js = synchronized(batch) {
            flushPosted = false
            if (batch.isEmpty()) return
            val s = "window.__lumaMidi&&window.__lumaMidi([$batch])"
            batch.setLength(0)
            s
        }
        toJs(js)
    }

    private fun changed() = main.post { toJs("window.__lumaMidiState&&window.__lumaMidiState()") }

    private fun portId(info: MidiDeviceInfo, kind: String, n: Int) = "${info.id}:$kind$n"

    /** Puertos abiertos: [{id, name, manufacturer, type: "input"|"output"}] (como Web MIDI). */
    fun ports(): String {
        val out = JSONArray()
        for (o in opened.values) {
            val props = o.info.properties
            val dev = props.getString(MidiDeviceInfo.PROPERTY_NAME)
                ?: props.getString(MidiDeviceInfo.PROPERTY_PRODUCT) ?: "MIDI ${o.info.id}"
            val maker = props.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER) ?: ""
            val many = o.info.outputPortCount > 1 || o.info.inputPortCount > 1
            for (p in o.info.ports) {
                val type = when (p.type) {
                    MidiDeviceInfo.PortInfo.TYPE_OUTPUT -> "input"   // el aparato envía → entrada de LumaMap
                    MidiDeviceInfo.PortInfo.TYPE_INPUT -> "output"
                    else -> continue
                }
                if (type == "output" && !o.ins.containsKey(p.portNumber)) continue
                // Con un solo puerto se usa el nombre del aparato tal cual: los mapeos se asocian por nombre.
                val pn = p.name ?: ""
                val name = if (many && pn.isNotBlank() && pn != dev) "$dev $pn" else if (many) "$dev ${p.portNumber + 1}" else dev
                out.put(JSONObject().put("id", portId(o.info, if (type == "input") "i" else "o", p.portNumber))
                    .put("name", name).put("manufacturer", maker).put("type", type))
            }
        }
        return out.toString()
    }

    /** Envía bytes ("176,7,100") a un puerto de salida de LumaMap. */
    fun send(id: String, csv: String): Boolean {
        val dev = id.substringBefore(":").toIntOrNull() ?: return false
        val n = id.substringAfter(":o", "").toIntOrNull() ?: return false
        val port = opened[dev]?.ins?.get(n) ?: return false
        return try {
            val parts = csv.split(",")
            if (parts.isEmpty() || parts.size > 1000) return false
            val bytes = ByteArray(parts.size) { (parts[it].trim().toInt() and 0xff).toByte() }
            port.send(bytes, 0, bytes.size)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun closeDevice(o: Opened) {
        for (p in o.outs) runCatching { p.close() }
        for (p in o.ins.values) runCatching { p.close() }
        runCatching { o.device.close() }
    }

    fun closeAll() {
        if (started) runCatching { manager?.unregisterDeviceCallback(callback) }
        started = false
        for (k in opened.keys) opened.remove(k)?.let { closeDevice(it) }
        if (threadLazy.isInitialized()) runCatching { thread.quitSafely() }
    }
}
