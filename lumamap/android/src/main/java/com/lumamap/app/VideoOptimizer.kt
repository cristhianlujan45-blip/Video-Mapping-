package com.lumamap.app

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import java.io.File

/**
 * Optimización automática de videos al importarlos (como Alley de Resolume,
 * pero sin hacer nada): si el video es más grande que la salida, usa un códec
 * pesado (HEVC, AV1, ProRes…) o tiene un bitrate excesivo, se convierte a H.264
 * con el codificador por hardware del teléfono. Si ya es adecuado se usa tal
 * cual, al instante.
 */
@UnstableApi
class VideoOptimizer(private val context: Context) {

    data class Info(val mime: String, val width: Int, val height: Int, val bitrate: Int, val fps: Float)
    data class Plan(val convert: Boolean, val reason: String, val outHeight: Int?)

    private val main = Handler(Looper.getMainLooper())

    fun probe(uri: Uri): Info? = runCatching {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(context, uri, null)
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("video/")) continue
                var w = f.getInteger(MediaFormat.KEY_WIDTH)
                var h = f.getInteger(MediaFormat.KEY_HEIGHT)
                val rot = if (f.containsKey(MediaFormat.KEY_ROTATION)) f.getInteger(MediaFormat.KEY_ROTATION) else 0
                if (rot == 90 || rot == 270) { val t = w; w = h; h = t }
                val br = if (f.containsKey(MediaFormat.KEY_BIT_RATE)) f.getInteger(MediaFormat.KEY_BIT_RATE) else 0
                val fps = if (f.containsKey(MediaFormat.KEY_FRAME_RATE)) runCatching { f.getInteger(MediaFormat.KEY_FRAME_RATE).toFloat() }.getOrElse { f.getFloat(MediaFormat.KEY_FRAME_RATE) } else 0f
                return@runCatching Info(mime, w, h, br, fps)
            }
            null
        } finally { ex.release() }
    }.getOrNull()

    fun decide(info: Info, targetW: Int, targetH: Int): Plan {
        val good = info.mime == MimeTypes.VIDEO_H264 || info.mime == MimeTypes.VIDEO_VP8 || info.mime == MimeTypes.VIDEO_VP9
        val big = info.width > targetW * 1.05 && info.height > targetH * 1.05
        // Altura de salida conservando la proporción y sin pasar del tamaño de la composición.
        val k = minOf(1.0, targetW.toDouble() / info.width, targetH.toDouble() / info.height)
        val outH = ((info.height * k).toInt() / 2) * 2
        return when {
            big -> Plan(true, "${info.width}×${info.height} es más grande que la salida", outH)
            !good -> Plan(true, "códec ${info.mime.removePrefix("video/").uppercase()} pesado", null)
            info.bitrate > 30_000_000 -> Plan(true, "bitrate muy alto (${info.bitrate / 1_000_000} Mbps)", null)
            info.fps > 61f -> Plan(true, "${info.fps.toInt()} fps", outH.takeIf { k < 1.0 })
            else -> Plan(false, "ya es ligero", null)
        }
    }

    /**
     * Convierte si hace falta. onProgress(0..1) y onDone(uri a usar, mensaje|null)
     * se llaman en el hilo principal. Si algo falla se devuelve el original.
     */
    fun optimize(uri: Uri, targetW: Int, targetH: Int, onProgress: (Float) -> Unit, onDone: (Uri, String?) -> Unit) {
        val info = probe(uri)
        val plan = info?.let { decide(it, targetW, targetH) }
        if (info == null || plan == null || !plan.convert) { onDone(uri, null); return }
        val dir = File(context.cacheDir, "optimized").apply { mkdirs() }
        // Limpieza: los optimizados anteriores ya están guardados en la biblioteca de la app.
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
        val out = File(dir, "video-${System.currentTimeMillis()}.mp4")
        val t0 = System.currentTimeMillis()
        val effects = if (plan.outHeight != null) Effects(listOf(), listOf(Presentation.createForHeight(plan.outHeight))) else Effects.EMPTY
        val item = EditedMediaItem.Builder(MediaItem.fromUri(uri)).setEffects(effects).build()
        lateinit var transformer: Transformer
        var finished = false
        transformer = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    finished = true
                    val secs = (System.currentTimeMillis() - t0) / 1000f
                    val result = FileProvider.getUriForFile(context, context.packageName + ".files", out)
                    onDone(result, "Video optimizado en %.1f s · %s".format(secs, plan.reason))
                }

                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    finished = true
                    out.delete()
                    onDone(uri, "No se pudo optimizar, se usa el original")
                }
            })
            .build()
        transformer.start(item, out.absolutePath)
        val holder = ProgressHolder()
        val poll = object : Runnable {
            override fun run() {
                if (finished) return
                if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress / 100f)
                main.postDelayed(this, 400)
            }
        }
        main.postDelayed(poll, 400)
    }
}
