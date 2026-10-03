package com.lujan.mapping.core

import com.lujan.mapping.core.geometry.Homography
import com.lujan.mapping.core.geometry.LayerTransform
import com.lujan.mapping.core.geometry.Quad
import com.lujan.mapping.core.geometry.Vec2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomographyTest {

    private val eps = 1e-4f

    private fun assertVec(expected: Vec2, actual: Vec2?) {
        assertNotNull(actual)
        assertEquals(expected.x, actual!!.x, eps)
        assertEquals(expected.y, actual.y, eps)
    }

    private val keystone = Quad(Vec2(0.1f, 0.2f), Vec2(0.85f, 0.1f), Vec2(0.95f, 0.9f), Vec2(0.05f, 0.75f))

    @Test
    fun cornersMapExactly() {
        val h = Homography.squareToQuad(keystone)!!
        assertVec(keystone.tl, h.map(0.0, 0.0))
        assertVec(keystone.tr, h.map(1.0, 0.0))
        assertVec(keystone.br, h.map(1.0, 1.0))
        assertVec(keystone.bl, h.map(0.0, 1.0))
    }

    @Test
    fun inverseRoundTrips() {
        val h = Homography.squareToQuad(keystone)!!
        val inv = h.inverse()!!
        for (u in listOf(0.0, 0.25, 0.5, 0.9)) for (v in listOf(0.0, 0.33, 1.0)) {
            val p = h.map(u, v)!!
            assertVec(Vec2(u.toFloat(), v.toFloat()), inv.map(p))
        }
    }

    @Test
    fun straightLinesStayStraight() {
        // Points along the content's horizontal center line must be collinear after mapping.
        val h = Homography.squareToQuad(keystone)!!
        val a = h.map(0.0, 0.5)!!
        val b = h.map(0.5, 0.5)!!
        val c = h.map(1.0, 0.5)!!
        val cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
        assertEquals(0f, cross, 1e-5f)
    }

    @Test
    fun identityForUnitSquare() {
        val h = Homography.squareToQuad(Quad.FULL)!!
        assertVec(Vec2(0.3f, 0.7f), h.map(0.3, 0.7))
    }

    @Test
    fun degenerateAndConcaveQuadsAreRejected() {
        val collapsed = Quad(Vec2(0f, 0f), Vec2(0f, 0f), Vec2(0f, 0f), Vec2(0f, 0f))
        assertNull(Homography.squareToQuad(collapsed))
        val concave = Quad(Vec2(0f, 0f), Vec2(1f, 0f), Vec2(0.2f, 0.2f), Vec2(0f, 1f))
        assertFalse(concave.isConvex())
        assertNull(Homography.squareToQuad(concave))
        assertTrue(keystone.isConvex())
    }

    @Test
    fun glMatrixIsColumnMajor() {
        val h = Homography.squareToQuad(keystone)!!
        val m = h.toGlMat3()
        // column 2 = translation = top-left corner
        assertEquals(keystone.tl.x, m[6], eps)
        assertEquals(keystone.tl.y, m[7], eps)
        assertEquals(1f, m[8], eps)
    }

    @Test
    fun containsPoint() {
        assertTrue(keystone.contains(Vec2(0.5f, 0.5f)))
        assertFalse(keystone.contains(Vec2(0.01f, 0.01f)))
    }

    @Test
    fun rotationKeepsSquaresSquareOnWideOutputs() {
        val aspect = 16f / 9f
        // A square in pixels: width in normalized units = height / aspect.
        val base = Quad.rect(0.5f, 0.5f, 0.3f / aspect, 0.3f)
        val rotated = LayerTransform(rotationDeg = 90f).apply(base, aspect)
        fun pxLen(a: Vec2, b: Vec2) = Vec2((a.x - b.x) * aspect, a.y - b.y).length()
        assertEquals(pxLen(base.tl, base.tr), pxLen(rotated.tl, rotated.tr), 1e-4f)
        assertEquals(pxLen(base.tr, base.br), pxLen(rotated.tr, rotated.br), 1e-4f)
        assertVec(base.centroid(), rotated.centroid())
    }
}
