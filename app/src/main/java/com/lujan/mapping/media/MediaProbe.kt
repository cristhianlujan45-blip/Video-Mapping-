package com.lujan.mapping.media

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.MediaRef
import kotlin.math.max

/** Blocking helpers (call from Dispatchers.IO) to inspect, decode and locate media files. */
object MediaProbe {
    private const val TAG = "MediaProbe"

    data class Probed(val ref: MediaRef, val kind: ContentKind)

    /** Keeps read access to a SAF document across reboots (needed to reopen projects). */
    fun persistReadPermission(context: Context, uri: Uri) {
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: SecurityException) {
            Log.w(TAG, "No persistable permission for $uri (will work until reboot)")
        }
    }

    fun persistReadWritePermission(context: Context, uri: Uri) {
        try {
            context.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "No persistable rw permission for $uri")
        }
    }

    fun displayName(context: Context, uri: Uri): String? {
        return try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (e: Exception) {
            null
        }
    }

    fun probe(context: Context, uri: Uri): Probed? {
        val cr = context.contentResolver
        var name = uri.lastPathSegment ?: "medio"
        var size = -1L
        try {
            cr.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    if (!c.isNull(0)) name = c.getString(0)
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "query failed for $uri", e)
        }
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = cr.getType(uri) ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        val kind = when {
            mime?.startsWith("video/") == true -> ContentKind.VIDEO
            mime?.startsWith("image/") == true -> ContentKind.IMAGE
            ext in setOf("mp4", "m4v", "mov", "webm", "mkv", "3gp", "ts") -> ContentKind.VIDEO
            ext in setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "avif") -> ContentKind.IMAGE
            else -> return null
        }
        var w = 0
        var h = 0
        var duration = 0L
        if (kind == ContentKind.VIDEO) {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(context, uri)
                w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                if (rot == 90 || rot == 270) {
                    val t = w; w = h; h = t
                }
                duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            } catch (e: Exception) {
                Log.w(TAG, "metadata failed for $uri", e)
            } finally {
                try {
                    r.release()
                } catch (_: Exception) {
                }
            }
        } else {
            val dims = imageSize(context, uri)
            w = dims.first
            h = dims.second
        }
        return Probed(MediaRef(uri.toString(), name, mime, size, w, h, duration), kind)
    }

    private fun imageSize(context: Context, uri: Uri): Pair<Int, Int> {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                var size = 0 to 0
                // Header-only decode: setTargetSize(1,1) keeps it cheap; the size is pre-orientation-corrected.
                val src = ImageDecoder.createSource(context.contentResolver, uri)
                ImageDecoder.decodeBitmap(src) { decoder, info, _ ->
                    size = info.size.width to info.size.height
                    decoder.setTargetSize(1, 1)
                }.recycle()
                return size
            }
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            return opts.outWidth to opts.outHeight
        } catch (e: Exception) {
            Log.w(TAG, "image bounds failed for $uri", e)
            return 0 to 0
        }
    }

    /** True if the file can still be opened (not moved / deleted / permission lost). */
    fun isReachable(context: Context, uri: Uri): Boolean = try {
        context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { } != null
    } catch (e: Exception) {
        false
    }

    /**
     * Decodes an image as a software ARGB_8888 bitmap no larger than [maxSize] (GPU
     * texture limit), honoring EXIF orientation on Android 9+.
     */
    fun decodeImage(context: Context, uri: Uri, maxSize: Int): Bitmap? {
        val bmp: Bitmap? = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val src = ImageDecoder.createSource(context.contentResolver, uri)
                ImageDecoder.decodeBitmap(src) { decoder, info, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    val w = info.size.width
                    val h = info.size.height
                    val biggest = max(w, h)
                    if (biggest > maxSize) {
                        val s = maxSize.toFloat() / biggest
                        decoder.setTargetSize((w * s).toInt().coerceAtLeast(1), (h * s).toInt().coerceAtLeast(1))
                    }
                }
            } else {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
                var sample = 1
                while (max(bounds.outWidth, bounds.outHeight) / sample > maxSize) sample *= 2
                val opts = BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "decode failed for $uri", e)
            null
        } catch (e: OutOfMemoryError) {
            Log.e(TAG, "OOM decoding $uri", e)
            null
        }
        if (bmp == null) return null
        if (bmp.config == Bitmap.Config.ARGB_8888) return bmp
        val converted = bmp.copy(Bitmap.Config.ARGB_8888, false)
        bmp.recycle()
        return converted
    }

    /**
     * "Buscar archivos perdidos" in a folder: walks a SAF tree (depth/entry limited) and
     * returns name -> document URI for every wanted file name. When several files share a
     * name, the one whose size matches [wanted] wins.
     */
    fun findInTree(context: Context, treeUri: Uri, wanted: Map<String, Long>): Map<String, Uri> {
        val cr = context.contentResolver
        val found = HashMap<String, Uri>()
        val exact = HashSet<String>()
        val queue = ArrayDeque<Pair<String, Int>>()
        queue.addLast(DocumentsContract.getTreeDocumentId(treeUri) to 0)
        var visited = 0
        val cols = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        while (queue.isNotEmpty() && visited < 20_000 && exact.size < wanted.size) {
            val (docId, depth) = queue.removeFirst()
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
            try {
                cr.query(children, cols, null, null, null)?.use { c ->
                    while (c.moveToNext()) {
                        visited++
                        val id = c.getString(0)
                        val name = c.getString(1) ?: continue
                        val mime = c.getString(2)
                        val size = if (c.isNull(3)) -1L else c.getLong(3)
                        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                            if (depth < 8) queue.addLast(id to depth + 1)
                        } else if (name in wanted && name !in exact) {
                            found[name] = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)
                            val want = wanted[name] ?: -1L
                            if (want < 0 || want == size) exact += name
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "tree query failed", e)
            }
        }
        return found
    }
}
