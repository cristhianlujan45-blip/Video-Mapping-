package com.lumap.app.gl

/** Matemática proyectiva (corner pin) — port del módulo shared/homography.js. */
object Homography {
    /** Resuelve A·x = b (n×n) por eliminación gaussiana con pivoteo parcial. */
    fun solveLinear(A: Array<DoubleArray>, b: DoubleArray): DoubleArray {
        val n = b.size
        val M = Array(n) { i -> A[i].copyOf(n + 1).also { it[n] = b[i] } }
        for (col in 0 until n) {
            var piv = col
            for (r in col + 1 until n)
                if (kotlin.math.abs(M[r][col]) > kotlin.math.abs(M[piv][col])) piv = r
            require(kotlin.math.abs(M[piv][col]) > 1e-12) { "matriz singular" }
            val tmp = M[col]; M[col] = M[piv]; M[piv] = tmp
            for (r in 0 until n) {
                if (r == col) continue
                val f = M[r][col] / M[col][col]
                for (c in col..n) M[r][c] -= f * M[col][c]
            }
        }
        return DoubleArray(n) { i -> M[i][n] / M[i][i] }
    }

    /**
     * Homografía 3x3 (fila mayor) que mapea 4 puntos fuente a 4 destino.
     * pts: [x, y] en coordenadas de píxeles del lienzo.
     */
    fun fromQuad(src: Array<DoubleArray>, dst: Array<DoubleArray>): FloatArray {
        val A = Array(8) { DoubleArray(8) }
        val b = DoubleArray(8)
        for (i in 0 until 4) {
            val (x, y) = src[i]; val (u, v) = dst[i]
            A[2*i]   = doubleArrayOf(x, y, 1.0, 0.0, 0.0, 0.0, -u*x, -u*y); b[2*i] = u
            A[2*i+1] = doubleArrayOf(0.0, 0.0, 0.0, x, y, 1.0, -v*x, -v*y); b[2*i+1] = v
        }
        val h = solveLinear(A, b)
        return floatArrayOf(
            h[0].toFloat(), h[1].toFloat(), h[2].toFloat(),
            h[3].toFloat(), h[4].toFloat(), h[5].toFloat(),
            h[6].toFloat(), h[7].toFloat(), 1f)
    }

    /** Aplica H a (x, y) con w homogéneo (devuelve numerador y w para el shader). */
    fun apply(h: FloatArray, x: Float, y: Float, out: FloatArray, off: Int) {
        out[off]     = h[0]*x + h[1]*y + h[2]
        out[off + 1] = h[3]*x + h[4]*y + h[5]
        out[off + 2] = h[6]*x + h[7]*y + h[8]
    }
}
