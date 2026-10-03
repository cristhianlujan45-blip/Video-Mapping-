package com.lujan.mapping.render

/**
 * GLSL ES 1.00 sources (run on every ES 2.0+ GPU).
 *
 * Coordinate conventions:
 *  - "model" space: normalized output, (0,0) top-left, (1,1) bottom-right.
 *  - content "uv": (0,0) top-left of the media.
 */
object Shaders {

    enum class Source { EXTERNAL_OES, TEXTURE_2D, TEST_PATTERN, SOLID }

    /** Vertex shader shared by layers and full-screen passes. */
    const val MODEL_VERTEX = """
attribute vec2 aModel;
varying vec2 vModel;
void main() {
    vModel = aModel;
    gl_Position = vec4(aModel.x * 2.0 - 1.0, 1.0 - aModel.y * 2.0, 0.0, 1.0);
}
"""

    private const val PRECISION = """
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
"""

    /**
     * Layer fragment shader. The surface is drawn as its bounding box; every fragment
     * computes its exact content UV with the inverse homography, so perspective is
     * pixel-exact and edges get analytic antialiasing.
     */
    fun layerFragment(source: Source, shaderBlend: Boolean): String {
        val header = if (source == Source.EXTERNAL_OES) "#extension GL_OES_EGL_image_external : require\n" else ""
        val sourceDecl = when (source) {
            Source.EXTERNAL_OES -> """
uniform samplerExternalOES uTex;
uniform mat4 uTexMatrix;
vec4 sampleSource(vec2 c) {
    // SurfaceTexture coordinates have v=0 at the bottom of the frame.
    vec2 t = (uTexMatrix * vec4(c.x, 1.0 - c.y, 0.0, 1.0)).xy;
    return texture2D(uTex, t);
}
"""
            Source.TEXTURE_2D -> """
uniform sampler2D uTex;
vec4 sampleSource(vec2 c) { return texture2D(uTex, c); }
"""
            Source.TEST_PATTERN -> """
uniform vec4 uSolid;
vec4 sampleSource(vec2 c) {
    // Calibration pattern: checker, grid lines, diagonals and colored corner markers
    // (TL red, TR green, BR blue, BL yellow) to identify orientation on the wall.
    vec2 g = floor(c * 8.0);
    float chk = mod(g.x + g.y, 2.0);
    vec3 col = mix(vec3(0.10), vec3(0.22), chk);
    vec2 f = abs(fract(c * 8.0 + 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.03, min(f.x, f.y));
    col = mix(col, vec3(0.65), line * 0.6);
    float diag = 1.0 - smoothstep(0.0, 0.006, min(abs(c.x - c.y), abs(c.x - (1.0 - c.y))));
    col = mix(col, vec3(0.9), diag * 0.5);
    vec2 cc = abs(c - 0.5);
    float crossMark = step(max(cc.x, cc.y), 0.08) * (1.0 - step(0.006, min(cc.x, cc.y)));
    col = mix(col, vec3(1.0), crossMark);
    float m = 0.12;
    if (c.x < m && c.y < m) col = vec3(1.0, 0.15, 0.15);
    else if (c.x > 1.0 - m && c.y < m) col = vec3(0.15, 1.0, 0.25);
    else if (c.x > 1.0 - m && c.y > 1.0 - m) col = vec3(0.2, 0.4, 1.0);
    else if (c.x < m && c.y > 1.0 - m) col = vec3(1.0, 0.9, 0.1);
    float border = 1.0 - step(0.012, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
    col = mix(col, vec3(1.0), border);
    return vec4(col * uSolid.rgb, 1.0);
}
"""
            Source.SOLID -> """
uniform vec4 uSolid;
vec4 sampleSource(vec2 c) { return vec4(uSolid.rgb * uSolid.a, uSolid.a); }
"""
        }
        val blendDecl = if (shaderBlend) """
uniform sampler2D uBackdrop;
uniform vec2 uOutSize;
uniform float uMode;
vec3 blendFn(vec3 s, vec3 d) {
    if (uMode < 0.5) {
        vec3 lo = 2.0 * s * d;
        vec3 hi = 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
        return mix(lo, hi, step(0.5, d));
    } else if (uMode < 1.5) {
        return abs(s - d);
    } else if (uMode < 2.5) {
        return max(s, d);
    }
    return min(s, d);
}
""" else ""
        val output = if (shaderBlend) """
    vec3 d = texture2D(uBackdrop, gl_FragCoord.xy / uOutSize).rgb;
    gl_FragColor = vec4(mix(d, blendFn(rgb, d), a), 1.0);
""" else """
    gl_FragColor = vec4(rgb * a, a);
"""
        return header + PRECISION + """
varying vec2 vModel;
uniform mat3 uHinv;
uniform vec2 uPixel;
uniform vec4 uCrop;
uniform vec2 uFlip;
uniform float uOpacity;
uniform float uFeather;
uniform vec4 uAdjust;
uniform float uInvert;
uniform sampler2D uMask;
""" + sourceDecl + blendDecl + """
vec2 toUv(vec2 p) {
    vec3 h = uHinv * vec3(p, 1.0);
    return h.xy / h.z;
}

vec3 hueRotate(vec3 c, float a) {
    // Rotation around the grey axis in YIQ space.
    const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toYiq * c;
    float cs = cos(a);
    float sn = sin(a);
    yiq.yz = vec2(yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
    return toRgb * yiq;
}

void main() {
    vec3 hp = uHinv * vec3(vModel, 1.0);
    if (hp.z <= 0.0) discard;
    vec2 uv = hp.xy / hp.z;
    // UV change per output pixel, for 1-pixel antialiased edges.
    vec2 duv = max(abs(toUv(vModel + vec2(uPixel.x, 0.0)) - uv), abs(toUv(vModel + vec2(0.0, uPixel.y)) - uv));
    duv = max(duv, vec2(1e-6));
    vec2 e = min(uv, 1.0 - uv);
    vec2 aa = clamp(e / duv + 0.5, 0.0, 1.0);
    float alpha = aa.x * aa.y;
    if (alpha <= 0.0) discard;
    if (uFeather > 0.0) alpha *= smoothstep(0.0, uFeather, e.x) * smoothstep(0.0, uFeather, e.y);
    vec2 suv = clamp(uv, 0.0, 1.0);
    alpha *= texture2D(uMask, suv).a * uOpacity;
    if (alpha <= 0.002) discard;

    vec2 c = mix(suv, 1.0 - suv, uFlip);
    c = uCrop.xy + c * uCrop.zw;
    vec4 src = sampleSource(c);
    vec3 rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
    // Color adjustments: brightness, contrast, saturation, hue, invert.
    rgb = rgb + uAdjust.x;
    rgb = (rgb - 0.5) * uAdjust.y + 0.5;
    float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(vec3(luma), rgb, uAdjust.z);
    if (uAdjust.w != 0.0) rgb = hueRotate(rgb, uAdjust.w);
    rgb = mix(rgb, 1.0 - rgb, uInvert);
    rgb = clamp(rgb, 0.0, 1.0);
    float a = src.a * alpha;
""" + output + """
}
"""
    }

    /** Procedural calibration overlay in output pixel space. */
    val GRID_FRAGMENT = PRECISION + """
varying vec2 vModel;
uniform vec2 uOutSize;
uniform float uDiv;
uniform float uThick;
uniform vec4 uColor;
uniform float uPattern;

float lineMask(float d, float halfW) { return 1.0 - smoothstep(halfW - 0.5, halfW + 0.5, d); }

void main() {
    vec2 px = vModel * uOutSize;
    vec2 center = uOutSize * 0.5;
    float cell = max(uOutSize.x / max(uDiv, 1.0), 4.0);
    vec2 q = px - center;
    vec2 m = mod(q + cell * 0.5, cell) - cell * 0.5;   // offset to the nearest intersection
    float halfW = max(uThick * 0.5, 0.5);
    float a = 0.0;
    vec3 col = uColor.rgb;

    if (uPattern < 0.5) {            // GRID
        a = max(lineMask(abs(m.x), halfW), lineMask(abs(m.y), halfW));
    } else if (uPattern < 1.5) {     // DOTS
        a = lineMask(length(m), halfW * 2.0);
    } else if (uPattern < 2.5) {     // CROSSES
        float arm = cell * 0.18;
        float h = lineMask(abs(m.y), halfW) * step(abs(m.x), arm);
        float v = lineMask(abs(m.x), halfW) * step(abs(m.y), arm);
        a = max(h, v);
    } else if (uPattern < 3.5) {     // CHECKER
        vec2 g = floor((q + cell * 0.5) / cell);
        col = mix(vec3(0.0), uColor.rgb, mod(g.x + g.y, 2.0));
        a = 1.0;
    } else {                         // COLOR BARS + grey ramp
        float x = vModel.x;
        if (vModel.y < 0.7) {
            int i = int(floor(x * 8.0));
            if (i == 0) col = vec3(1.0);
            else if (i == 1) col = vec3(1.0, 1.0, 0.0);
            else if (i == 2) col = vec3(0.0, 1.0, 1.0);
            else if (i == 3) col = vec3(0.0, 1.0, 0.0);
            else if (i == 4) col = vec3(1.0, 0.0, 1.0);
            else if (i == 5) col = vec3(1.0, 0.0, 0.0);
            else if (i == 6) col = vec3(0.0, 0.0, 1.0);
            else col = vec3(0.0);
        } else {
            col = vec3(floor(x * 11.0) / 10.0);
        }
        a = 1.0;
    }

    // Always: output border, center cross and an inscribed circle (should look round
    // on the wall when the projector is square to it).
    float border = lineMask(min(min(px.x, uOutSize.x - px.x), min(px.y, uOutSize.y - px.y)), halfW * 2.0);
    float centerCross = max(lineMask(abs(q.x), halfW * 1.5), lineMask(abs(q.y), halfW * 1.5));
    float circle = lineMask(abs(length(q) - uOutSize.y * 0.45), halfW);
    float guide = max(border, max(centerCross, circle));
    if (uPattern > 2.5) {
        col = mix(col, vec3(1.0, 0.4, 0.0), guide);
    } else {
        a = max(a, guide);
    }
    a *= uColor.a;
    gl_FragColor = vec4(col * a, a);
}
"""

    /** Presents the composition texture into a window rect. */
    const val BLIT_VERTEX = """
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
    vUv = aUv;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
"""

    val BLIT_FRAGMENT = PRECISION + """
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }
"""
}
