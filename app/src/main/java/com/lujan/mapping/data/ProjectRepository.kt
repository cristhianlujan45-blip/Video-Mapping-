package com.lujan.mapping.data

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import com.lujan.mapping.core.io.ProjectCodec
import com.lujan.mapping.core.model.Project
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException

/**
 * Project persistence:
 *  - Autosave to app-private storage (atomic write: temp file + rename), restored at launch.
 *  - Save / open .mapping files anywhere through the Storage Access Framework.
 */
class ProjectRepository(private val context: Context) {

    private val autosaveFile = File(context.filesDir, "autosave.${Project.FILE_EXTENSION}")
    private val prefs = context.getSharedPreferences("lujan_mapping", Context.MODE_PRIVATE)

    var currentDocumentUri: Uri?
        get() = prefs.getString(KEY_DOC_URI, null)?.let(Uri::parse)
        set(value) = prefs.edit().putString(KEY_DOC_URI, value?.toString()).apply()

    suspend fun writeAutosave(project: Project) = withContext(Dispatchers.IO) {
        try {
            val tmp = File(autosaveFile.parentFile, autosaveFile.name + ".tmp")
            tmp.writeText(ProjectCodec.encode(project))
            if (!tmp.renameTo(autosaveFile)) {
                autosaveFile.delete()
                tmp.renameTo(autosaveFile)
            }
        } catch (e: Exception) {
            Log.e(TAG, "autosave failed", e)
        }
    }

    suspend fun loadAutosave(): Project? = withContext(Dispatchers.IO) {
        if (!autosaveFile.exists()) return@withContext null
        try {
            ProjectCodec.decode(autosaveFile.readText())
        } catch (e: Exception) {
            Log.e(TAG, "autosave unreadable, ignoring", e)
            null
        }
    }

    /** Throws on failure (caller shows the message). */
    suspend fun save(uri: Uri, project: Project) = withContext(Dispatchers.IO) {
        val bytes = ProjectCodec.encode(project).toByteArray(Charsets.UTF_8)
        val stream = (try {
            context.contentResolver.openOutputStream(uri, "wt")
        } catch (e: IllegalArgumentException) {
            context.contentResolver.openOutputStream(uri, "w") // provider without truncate mode
        } catch (e: FileNotFoundException) {
            context.contentResolver.openOutputStream(uri, "w")
        }) ?: throw FileNotFoundException("No se puede escribir en $uri")
        stream.use { it.write(bytes) }
    }

    suspend fun load(uri: Uri): Project = withContext(Dispatchers.IO) {
        val text = context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: throw FileNotFoundException("No se puede abrir $uri")
        ProjectCodec.decode(text)
    }

    suspend fun exportPng(uri: Uri, bitmap: Bitmap) = withContext(Dispatchers.IO) {
        context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            ?: throw FileNotFoundException("No se puede escribir en $uri")
    }

    private companion object {
        const val TAG = "ProjectRepository"
        const val KEY_DOC_URI = "current_document_uri"
    }
}
