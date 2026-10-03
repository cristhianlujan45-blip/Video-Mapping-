package com.lujan.mapping.render

import org.junit.Assert.assertEquals
import org.junit.Test

class ViewRectTest {
    @Test
    fun letterboxWideView() {
        val r = ViewRect.fit(2000f, 1000f, 16f / 9f)
        assertEquals(1000f, r.height, 1e-3f)
        assertEquals(1000f * 16f / 9f, r.width, 1e-3f)
        assertEquals((2000f - r.width) / 2f, r.left, 1e-3f)
    }

    @Test
    fun pillarboxTallView() {
        val r = ViewRect.fit(1000f, 1000f, 16f / 9f, margin = 10f)
        assertEquals(980f, r.width, 1e-3f)
        assertEquals(10f, r.left, 1e-3f)
        val (mx, my) = r.toModel(r.left + r.width, r.top + r.height)
        assertEquals(1f, mx, 1e-5f)
        assertEquals(1f, my, 1e-5f)
    }
}
