package com.lujan.mapping.core.io

import com.lujan.mapping.core.model.Project
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ProjectFormatException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The `.mapping` file format: UTF-8 JSON with a `formatVersion` field.
 *
 * JSON was chosen over a binary/Room format because projects are small (KBs), must be
 * portable between devices, human-inspectable and forward compatible (unknown keys are
 * ignored, missing keys take defaults). Media is referenced by URI + name + size, not
 * embedded, so a 2 GB video does not get copied into every save.
 */
object ProjectCodec {

    private val json = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun encode(project: Project): String = json.encodeToString(Project.serializer(), project)

    fun decode(text: String): Project {
        val root = try {
            json.parseToJsonElement(text).jsonObject
        } catch (e: Exception) {
            throw ProjectFormatException("El archivo no es un proyecto válido", e)
        }
        val version = root["formatVersion"]?.jsonPrimitive?.intOrNull
            ?: throw ProjectFormatException("Falta formatVersion: no es un archivo .mapping")
        if (version > Project.CURRENT_FORMAT_VERSION) {
            throw ProjectFormatException(
                "El proyecto fue creado con una versión más nueva de la app (formato $version)"
            )
        }
        val migrated = migrate(root.toString(), version)
        return try {
            json.decodeFromString(Project.serializer(), migrated)
                .copy(formatVersion = Project.CURRENT_FORMAT_VERSION)
        } catch (e: SerializationException) {
            throw ProjectFormatException("Proyecto dañado: ${e.message}", e)
        } catch (e: IllegalArgumentException) {
            throw ProjectFormatException("Proyecto dañado: ${e.message}", e)
        }
    }

    /** Hook for future format migrations (v1 -> v2 ...). */
    @Suppress("UNUSED_PARAMETER")
    private fun migrate(text: String, fromVersion: Int): String = text
}
