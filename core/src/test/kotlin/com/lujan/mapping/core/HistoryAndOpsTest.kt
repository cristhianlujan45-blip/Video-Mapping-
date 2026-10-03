package com.lujan.mapping.core

import com.lujan.mapping.core.edit.ProjectOps
import com.lujan.mapping.core.geometry.Corner
import com.lujan.mapping.core.geometry.LayerTransform
import com.lujan.mapping.core.geometry.Vec2
import com.lujan.mapping.core.history.History
import com.lujan.mapping.core.model.LayerContent
import com.lujan.mapping.core.model.MaskShape
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryAndOpsTest {

    @Test
    fun undoRedo() {
        val h = History<Int>()
        var state = 0
        h.record(state); state = 1
        h.record(state); state = 2
        state = h.undo(state)!!
        assertEquals(1, state)
        state = h.undo(state)!!
        assertEquals(0, state)
        assertNull(h.undo(state))
        state = h.redo(state)!!
        assertEquals(1, state)
        h.record(state); state = 5 // new branch clears redo
        assertFalse(h.canRedo)
        assertEquals(1, h.undo(state))
    }

    @Test
    fun historyIsBounded() {
        val h = History<Int>(limit = 3)
        repeat(10) { h.record(it) }
        var s = 99
        var n = 0
        while (true) { s = h.undo(s) ?: break; n++ }
        assertEquals(3, n)
        assertEquals(7, s)
    }

    @Test
    fun layerOps() {
        var p = ProjectOps.newProject()
        val a = ProjectOps.createLayer(p, LayerContent(), "Superficie", 1f)
        p = ProjectOps.addLayer(p, a)
        val b = ProjectOps.createLayer(p, LayerContent(), "Superficie", 1f)
        assertEquals("Superficie 2", b.name)
        p = ProjectOps.addLayer(p, b)
        p = ProjectOps.moveLayer(p, b.id, -1)
        assertEquals(b.id, p.layers[0].id)
        val (p2, copyId) = ProjectOps.duplicateLayer(p, a.id)
        assertEquals(3, p2.layers.size)
        assertEquals(copyId, p2.layers[2].id)
        assertEquals(2, ProjectOps.removeLayer(p2, a.id).layers.size)
    }

    @Test
    fun cornerDragBakesTransform() {
        val p = ProjectOps.newProject()
        val aspect = p.output.aspect
        val layer = ProjectOps.createLayer(p, LayerContent(), "S", 1f)
            .copy(transform = LayerTransform(offsetX = 0.1f, rotationDeg = 30f, scale = 1.2f))
        val before = layer.finalQuad(aspect)
        val moved = ProjectOps.setCorner(layer, Corner.TOP_LEFT, Vec2(0.2f, 0.2f), aspect)
        val after = moved.finalQuad(aspect)
        assertTrue(moved.transform.isIdentity)
        assertEquals(0.2f, after.tl.x, 1e-5f)
        // Other corners must not move when one corner is dragged.
        assertEquals(before.tr.x, after.tr.x, 1e-5f)
        assertEquals(before.br.y, after.br.y, 1e-5f)
        assertEquals(before.bl.x, after.bl.x, 1e-5f)
    }

    @Test
    fun defaultQuadKeepsContentAspect() {
        val outAspect = 16f / 9f
        val q = ProjectOps.defaultQuad(4f / 3f, outAspect)
        val wPx = (q.tr.x - q.tl.x) * outAspect
        val hPx = q.bl.y - q.tl.y
        assertEquals(4f / 3f, wPx / hPx, 1e-4f)
    }

    @Test
    fun polygonEditing() {
        val m = ProjectOps.defaultMask(MaskShape.POLYGON, "m")
        val m4 = ProjectOps.insertPolygonPoint(m)
        assertEquals(4, m4.points.size)
        assertEquals(3, ProjectOps.removePolygonPoint(m4, 0).points.size)
        assertEquals(3, ProjectOps.removePolygonPoint(m, 0).points.size) // never below 3
    }

    @Test
    fun simplifyKeepsShape() {
        val line = (0..100).map { Vec2(it / 100f, 0.5f) }
        val s = ProjectOps.simplifyPath(line)
        assertEquals(2, s.size)
        val corner = (0..50).map { Vec2(it / 50f, 0f) } + (1..50).map { Vec2(1f, it / 50f) }
        assertEquals(3, ProjectOps.simplifyPath(corner).size)
    }
}
