package com.lujan.mapping.media

import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.Surface
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.Layer
import com.lujan.mapping.core.model.Playback
import com.lujan.mapping.core.model.Project
import com.lujan.mapping.render.RenderEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * Owns one ExoPlayer per video layer and the decoded image of each image layer, and
 * keeps them in sync with the project. Main thread only.
 *
 * Every video decodes straight into a GPU SurfaceTexture (zero copy). Several videos play
 * at the same time; the real limit is the number of hardware decoder instances of the
 * device (typically 4–16 for H.264 1080p). When a decoder cannot be created the layer
 * shows an explicit error instead of crashing.
 */
class MediaManager(
    private val context: Context,
    private val engine: RenderEngine,
    private val scope: CoroutineScope,
) {
    private class VideoSlot(val layerId: String, val uri: String, val token: Long, val player: ExoPlayer) {
        var surfaceAttached = false
        var lastPlayback: Playback? = null
    }

    private class ImageSlot(val layerId: String, val uri: String, val token: Long) {
        var job: Job? = null
    }

    private val videos = HashMap<String, VideoSlot>()
    private val images = HashMap<String, ImageSlot>()
    private val tokens = AtomicLong()
    private var lastProject: Project? = null

    private val _missingUris = MutableStateFlow<Set<String>>(emptySet())
    /** Media URIs that can no longer be opened (moved, deleted or permission lost). */
    val missingUris: StateFlow<Set<String>> = _missingUris

    private val _errors = MutableStateFlow<Map<String, String>>(emptyMap())
    /** layerId -> human readable playback/decoding error. */
    val errors: StateFlow<Map<String, String>> = _errors

    private val _playing = MutableStateFlow(true)
    val playing: StateFlow<Boolean> = _playing

    // ----------------------------------------------------------------- sync

    fun sync(project: Project) {
        lastProject = project
        val missing = _missingUris.value

        // Release players / images that no longer match their layer.
        for (slot in videos.values.toList()) {
            val l = project.layer(slot.layerId)
            if (l == null || l.content.kind != ContentKind.VIDEO || l.content.media?.uri != slot.uri || slot.uri in missing) {
                releaseVideo(slot)
            }
        }
        for (slot in images.values.toList()) {
            val l = project.layer(slot.layerId)
            if (l == null || l.content.kind != ContentKind.IMAGE || l.content.media?.uri != slot.uri || slot.uri in missing) {
                releaseImage(slot)
            }
        }

        for (layer in project.layers) {
            val media = layer.content.media ?: continue
            if (media.uri in missing) continue
            when (layer.content.kind) {
                ContentKind.VIDEO -> {
                    val slot = videos[layer.id] ?: createVideo(layer.id, media.uri)
                    applyPlayback(slot, layer.playback)
                }
                ContentKind.IMAGE -> if (images[layer.id] == null) createImage(layer.id, media.uri)
                else -> Unit
            }
        }

        val missingLayers = project.layers
            .filter { (it.content.kind == ContentKind.VIDEO || it.content.kind == ContentKind.IMAGE) && it.content.media?.uri in missing }
            .map { it.id }.toSet()
        engine.setMissingLayers(missingLayers)
        val errs = _errors.value.filterKeys { id -> project.layer(id) != null }
        if (errs.size != _errors.value.size) _errors.value = errs
    }

    private fun createVideo(layerId: String, uri: String): VideoSlot {
        val token = tokens.incrementAndGet()
        val player = ExoPlayer.Builder(context)
            // handleAudioFocus=false: with focus handling each new player would pause the others.
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                false
            )
            .build()
        val slot = VideoSlot(layerId, uri, token, player)
        videos[layerId] = slot
        clearError(layerId)

        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                // Posted: handling may release this very player, never do it inside its callback.
                scope.launch { onVideoError(slot, error) }
            }
        })
        player.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
        player.playWhenReady = _playing.value
        player.prepare()

        engine.createVideoSurface(layerId, token) { surface: Surface ->
            val current = videos[layerId]
            if (current == null || current.token != token) {
                engine.releaseVideo(layerId, token)
            } else {
                current.player.setVideoSurface(surface)
                current.surfaceAttached = true
                // A seek makes ExoPlayer render a frame even while paused.
                if (!current.player.playWhenReady) current.player.seekTo(current.player.currentPosition)
            }
        }
        return slot
    }

    private fun applyPlayback(slot: VideoSlot, pb: Playback) {
        if (slot.lastPlayback == pb) return
        slot.lastPlayback = pb
        val p = slot.player
        p.repeatMode = if (pb.loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
        p.setPlaybackSpeed(pb.speed.coerceIn(0.1f, 4f))
        p.volume = if (pb.muted) 0f else pb.volume.coerceIn(0f, 1f)
    }

    private fun releaseVideo(slot: VideoSlot) {
        videos.remove(slot.layerId)
        // release() blocks until the decoder stopped using the surface, then the GL side
        // can safely destroy the SurfaceTexture.
        slot.player.release()
        engine.releaseVideo(slot.layerId, slot.token)
    }

    private fun createImage(layerId: String, uri: String) {
        val token = tokens.incrementAndGet()
        val slot = ImageSlot(layerId, uri, token)
        images[layerId] = slot
        clearError(layerId)
        slot.job = scope.launch {
            val maxSize = min(engine.maxTextureSize(), 4096)
            val parsed = Uri.parse(uri)
            val bmp = withContext(Dispatchers.IO) { MediaProbe.decodeImage(context, parsed, maxSize) }
            if (images[layerId]?.token != token) {
                bmp?.recycle(); return@launch
            }
            if (bmp != null) {
                engine.setImage(layerId, token, bmp)
            } else {
                val reachable = withContext(Dispatchers.IO) { MediaProbe.isReachable(context, parsed) }
                if (!reachable) markMissing(uri) else setError(layerId, "No se pudo decodificar la imagen")
            }
        }
    }

    private fun releaseImage(slot: ImageSlot) {
        images.remove(slot.layerId)
        slot.job?.cancel()
        engine.releaseImage(slot.layerId, slot.token)
    }

    private fun onVideoError(slot: VideoSlot, e: PlaybackException) {
        if (videos[slot.layerId] !== slot) return
        Log.w(TAG, "video error ${e.errorCodeName} on ${slot.uri}", e)
        when (e.errorCode) {
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION -> markMissing(slot.uri)
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ->
                setError(slot.layerId, "El dispositivo no puede decodificar este video (formato/resolución no soportados o demasiados videos simultáneos)")
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED ->
                setError(slot.layerId, "Formato de video no soportado por este dispositivo")
            else -> setError(slot.layerId, "Error de reproducción: ${e.errorCodeName}")
        }
    }

    private fun setError(layerId: String, msg: String) {
        _errors.value = _errors.value + (layerId to msg)
    }

    private fun clearError(layerId: String) {
        if (layerId in _errors.value) _errors.value = _errors.value - layerId
    }

    private fun markMissing(uri: String) {
        if (uri in _missingUris.value) return
        _missingUris.value = _missingUris.value + uri
        lastProject?.let { sync(it) }
    }

    /** Re-checks every media file of [project] (on open / restore / after relinking). */
    fun verifyMedia(project: Project) {
        scope.launch {
            val refs = ProjectOps.mediaRefs(project).map { it.second.uri }.distinct()
            val missing = withContext(Dispatchers.IO) {
                refs.filterNot { MediaProbe.isReachable(context, Uri.parse(it)) }.toSet()
            }
            _missingUris.value = missing
            lastProject?.let { sync(it) }
        }
    }

    fun clearMissing(uri: String) {
        if (uri !in _missingUris.value) return
        _missingUris.value = _missingUris.value - uri
        lastProject?.let { sync(it) }
    }

    // ------------------------------------------------------------- transport

    fun play() {
        _playing.value = true
        for (s in videos.values) {
            if (s.player.playbackState == Player.STATE_ENDED) s.player.seekTo(0)
            s.player.play()
        }
    }

    fun pause() {
        _playing.value = false
        for (s in videos.values) s.player.pause()
    }

    fun togglePlay() = if (_playing.value) pause() else play()

    /** Stop = pause and rewind every video. */
    fun stop() {
        pause()
        for (s in videos.values) s.player.seekTo(0)
    }

    /** Rewinds all videos together so they start in sync. */
    fun restartAll() {
        for (s in videos.values) s.player.seekTo(0)
        if (_playing.value) play()
    }

    fun seek(layerId: String, positionMs: Long) {
        videos[layerId]?.player?.seekTo(positionMs.coerceAtLeast(0))
    }

    fun positionMs(layerId: String): Long = videos[layerId]?.player?.currentPosition ?: 0L

    fun durationMs(layerId: String): Long {
        val d = videos[layerId]?.player?.duration ?: C.TIME_UNSET
        return if (d == C.TIME_UNSET) 0L else d
    }

    fun hasVideo(layer: Layer?): Boolean = layer != null && videos.containsKey(layer.id)

    fun releaseAll() {
        videos.values.toList().forEach { releaseVideo(it) }
        images.values.toList().forEach { releaseImage(it) }
    }

    private companion object {
        const val TAG = "MediaManager"
    }
}
