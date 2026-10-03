package com.lujan.mapping.core

import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.io.ProjectCodec
import com.lujan.mapping.core.io.ProjectFormatException
import com.lujan.mapping.core.model.BlendMode
import com.lujan.mapping.core.model.ContentKind
import com.lujan.mapping.core.model.LayerContent
import com.lujan.mapping.core.model.MaskShape
import com.lujan.mapping.core.model.MediaRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectCodecTest {

    @Test
    fun roundTrip() {
        var p = ProjectOps.newProject("Fachada")
        val media = MediaRef("content://media/1", "clip.mp4", "video/mp4", 1234, 1920, 1080, 5000)
        var l = ProjectOps.createLayer(p, LayerContent(ContentKind.VIDEO, media), "clip", 16f / 9f)
        l = l.copy(
            blendMode = BlendMode.SCREEN, opacity = 0.5f,
            masks = listOf(ProjectOps.defaultMask(MaskShape.POLYGON, "m1").copy(inverted = true))
        )
        p = ProjectOps.addLayer(p, l)
        val text = ProjectCodec.encode(p)
        assertEquals(p, ProjectCodec.decode(text))
    }

    @Test
    fun unknownKeysAndMissingDefaults() {
        val text = """{"formatVersion":1,"id":"x","name":"n","futureField":42,
            "layers":[{"id":"l","name":"L","somethingNew":true}]}"""
        val p = ProjectCodec.decode(text)
        assertEquals(1, p.layers.size)
        assertEquals(1f, p.layers[0].opacity)
    }

    @Test
    fun rejectsNewerVersionsAndGarbage() {
        val newer = runCatching { ProjectCodec.decode("""{"formatVersion":999,"id":"x","name":"n"}""") }
        assertTrue(newer.exceptionOrNull() is ProjectFormatException)
        val garbage = runCatching { ProjectCodec.decode("not json") }
        assertTrue(garbage.exceptionOrNull() is ProjectFormatException)
        val notProject = runCatching { ProjectCodec.decode("""{"hello":1}""") }
        assertTrue(notProject.exceptionOrNull() is ProjectFormatException)
    }
}
