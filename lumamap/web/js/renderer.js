// web/js/renderer.js
// Motor de composición WebGL2: corner pin, perspective warp, máscaras,
// efectos por fragment shader y blend modes. Sin dependencias externas.
import { homography, triangulatePolygon } from "/shared/homography.js";

const MAX_MASK = 32;

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;   // clip space
layout(location=1) in vec3 a_uvh;   // uv homogéneo (warp proyectivo)
out vec3 v_uvh;
void main(){ v_uvh = a_uvh; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_uvh;
out vec4 outColor;
uniform sampler2D u_tex;
uniform int u_hasTex;
uniform vec2 u_texSize;
uniform vec4 u_tint;            // rgb tint * alpha en .a
uniform float u_brightness, u_contrast, u_saturation, u_hue, u_rgbShift,
              u_noise, u_pixelate, u_blur, u_time, u_threshold, u_colorizeAmt;
uniform vec3 u_colorize;
uniform int u_invert;
uniform int u_useMask, u_maskInvert;
uniform float u_maskFeather;
uniform vec2 u_mask[${MAX_MASK}];
uniform int u_maskCount;

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h);
}
float polyCoverage(vec2 p){
  bool inside = false;
  float dmin = 1e9;
  for(int i=0;i<${MAX_MASK};i++){
    if(i>=u_maskCount) break;
    vec2 a = u_mask[i];
    vec2 b = u_mask[(i+1==u_maskCount)?0:i+1];
    dmin = min(dmin, segDist(p,a,b));
    if( ((a.y>p.y)!=(b.y>p.y)) && (p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) ) inside = !inside;
  }
  if(u_maskInvert) inside = !inside;
  float f = max(u_maskFeather, 1e-4);
  float cov = clamp(0.5 + (inside?1.0:-1.0)*dmin/(2.0*f), 0.0, 1.0);
  return cov;
}
vec4 sampleMedia(vec2 uv){
  if(u_hasTex==0) return vec4(1.0);
  if(u_pixelate>1.0){
    vec2 cells = u_texSize / max(u_pixelate,1.0);
    uv = (floor(uv*cells)+0.5)/cells;
  }
  vec2 off = vec2(u_rgbShift, 0.0);
  vec4 c;
  if(u_blur>0.0){
    vec2 t = u_blur/u_texSize;
    c = texture(u_tex,uv)*0.4
      + texture(u_tex,uv+vec2(t.x,0.))*0.15 + texture(u_tex,uv-vec2(t.x,0.))*0.15
      + texture(u_tex,uv+vec2(0.,t.y))*0.15 + texture(u_tex,uv-vec2(0.,t.y))*0.15;
  } else {
    float r = texture(u_tex, uv+off).r;
    float g = texture(u_tex, uv).g;
    float b = texture(u_tex, uv-off).b;
    float a = texture(u_tex, uv).a;
    c = vec4(r,g,b,a);
  }
  return c;
}
void main(){
  vec3 uvw = v_uvh;
  vec2 uv = uvw.xy / max(uvw.z, 1e-6);
  vec4 c = sampleMedia(uv);
  if(u_hasTex==0) c = vec4(1.0,1.0,1.0,1.0);
  // threshold (posterize duro)
  if(u_threshold>0.0){
    float lum = dot(c.rgb, vec3(0.299,0.587,0.114));
    c.rgb = vec3(step(u_threshold, lum));
  }
  if(u_invert==1) c.rgb = 1.0 - c.rgb;
  c.rgb *= u_brightness;
  c.rgb = (c.rgb - 0.5) * u_contrast + 0.5;
  float l = dot(c.rgb, vec3(0.299,0.587,0.114));
  c.rgb = mix(vec3(l), c.rgb, u_saturation);
  if(u_hue!=0.0){
    vec3 hsv = rgb2hsv(clamp(c.rgb,0.0,1.0));
    hsv.x = fract(hsv.x + u_hue);
    c.rgb = hsv2rgb(hsv);
  }
  c.rgb = mix(c.rgb, u_colorize * l * 2.0, u_colorizeAmt);
  c.rgb *= u_tint.rgb;
  c.a *= u_tint.a;
  if(u_noise>0.0){
    float n = hash(uv*vec2(1920.0,1080.0)+fract(u_time)*7.13)-0.5;
    c.rgb += n * u_noise;
  }
  if(u_useMask==1){
    c.a *= polyCoverage(uv);
  }
  if(c.a<=0.001) discard;
  outColor = c;
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error("Shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL2 no disponible en este navegador/dispositivo");
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error("Link: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    this.loc = {};
    for (const n of ["u_tex","u_hasTex","u_texSize","u_tint","u_brightness","u_contrast",
      "u_saturation","u_hue","u_rgbShift","u_noise","u_pixelate","u_blur","u_time",
      "u_threshold","u_colorizeAmt","u_colorize","u_invert","u_useMask","u_maskInvert",
      "u_maskFeather","u_mask","u_maskCount"])
      this.loc[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
    this.texCache = new Map(); // mediaId -> {tex, w, h, lastFrame}
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.clearColor = [0, 0, 0, 0];
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  textureFor(media) {
    const gl = this.gl;
    if (!media || !media.element) return null;
    let t = this.texCache.get(media.id);
    if (!t) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      t = { tex, w: 0, h: 0 };
      this.texCache.set(media.id, t);
    }
    const el = media.element;
    const frameId = media.kind === "video" ? el.currentTime + ":" + el.readyState : "static";
    if (t.lastFrame !== frameId) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        t.w = el.videoWidth || el.naturalWidth || el.width;
        t.h = el.videoHeight || el.naturalHeight || el.height;
      } catch { /* frame aún no listo */ }
      t.lastFrame = frameId;
    }
    return t;
  }

  /** Construye la malla de una superficie. px/py en coordenadas de canvas (px). */
  buildMesh(surface, W, H) {
    const toClip = (x, y) => [(x / W) * 2 - 1, 1 - (y / H) * 2];
    const pts = surface.points;
    const verts = [];
    if (surface.type === "quad" && pts.length === 4) {
      const src = [[0,0],[1,0],[1,1],[0,1]];
      const dst = pts.map(p => [p.x, p.y]);
      const Hm = homography(src, dst);
      const order = [0, 1, 2, 0, 2, 3];
      for (const i of order) {
        const [cx, cy] = toClip(pts[i].x, pts[i].y);
        const u = src[i][0], v = src[i][1];
        verts.push(cx, cy,
          Hm[0]*u + Hm[1]*v + Hm[2],
          Hm[3]*u + Hm[4]*v + Hm[5],
          Hm[6]*u + Hm[7]*v + Hm[8]);
      }
    } else {
      // Polígono libre: triangulación con UVs afines del bounding box
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (const p of pts) { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
      const bw = Math.max(maxX-minX, 1), bh = Math.max(maxY-minY, 1);
      const tris = triangulatePolygon(pts);
      for (const ti of tris) {
        const p = pts[ti];
        const [cx, cy] = toClip(p.x, p.y);
        verts.push(cx, cy, (p.x-minX)/bw, (p.y-minY)/bh, 1);
      }
    }
    return new Float32Array(verts);
  }

  /**
   * Dibuja una escena.
   * scene: {layers:[{surfaceId}]}, surfaces: Map id->surface, media: Map id->mediaRuntime
   */
  drawScene(scene, surfaces, media, { time = 0, globalAlpha = 1, W, H, drawOutline = false, selectedId = null, hoverPoint = null } = {}) {
    const gl = this.gl;
    this.resize(W, H);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.clearColor(...this.clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const layer of scene.layers) {
      const s = surfaces.get(layer.surfaceId);
      if (!s || s.hidden) continue;
      const mediaRt = s.mediaId ? media.get(s.mediaId) : null;
      const tex = this.textureFor(mediaRt);
      const f = s.fx || {};
      const alpha = (s.opacity ?? 1) * globalAlpha * (layer.opacity ?? 1);
      if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.tex); }
      gl.uniform1i(this.loc.u_tex, 0);
      gl.uniform1i(this.loc.u_hasTex, tex ? 1 : 0);
      gl.uniform2f(this.loc.u_texSize, tex ? tex.w : 1, tex ? tex.h : 1);
      const tint = s.tint || [1,1,1];
      gl.uniform4f(this.loc.u_tint, tint[0], tint[1], tint[2], alpha);
      gl.uniform1f(this.loc.u_brightness, f.brightness ?? 1);
      gl.uniform1f(this.loc.u_contrast, f.contrast ?? 1);
      gl.uniform1f(this.loc.u_saturation, f.saturation ?? 1);
      gl.uniform1f(this.loc.u_hue, f.hue ?? 0);
      gl.uniform1f(this.loc.u_rgbShift, f.rgbShift ?? 0);
      gl.uniform1f(this.loc.u_noise, f.noise ?? 0);
      gl.uniform1f(this.loc.u_pixelate, f.pixelate ?? 1);
      gl.uniform1f(this.loc.u_blur, f.blur ?? 0);
      gl.uniform1f(this.loc.u_time, time);
      gl.uniform1f(this.loc.u_threshold, f.threshold ?? 0);
      gl.uniform1f(this.loc.u_colorizeAmt, f.colorizeAmt ?? 0);
      const cz = f.colorize || [1,0,1];
      gl.uniform3f(this.loc.u_colorize, cz[0], cz[1], cz[2]);
      gl.uniform1i(this.loc.u_invert, f.invert ? 1 : 0);
      const mask = s.mask;
      const useMask = mask && mask.enabled && mask.points && mask.points.length >= 3;
      gl.uniform1i(this.loc.u_useMask, useMask ? 1 : 0);
      if (useMask) {
        gl.uniform1i(this.loc.u_maskInvert, mask.invert ? 1 : 0);
        gl.uniform1f(this.loc.u_maskFeather, mask.feather ?? 0);
        const arr = new Float32Array(MAX_MASK * 2);
        const n = Math.min(mask.points.length, MAX_MASK);
        for (let i = 0; i < n; i++) { arr[i*2] = mask.points[i].x; arr[i*2+1] = mask.points[i].y; }
        gl.uniform2fv(this.loc.u_mask, arr);
        gl.uniform1i(this.loc.u_maskCount, n);
      }
      const mesh = this.buildMesh(s, W, H);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
      const blend = s.blend || "normal";
      if (blend === "add") gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else if (blend === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.length / 5);
    }
  }

  /** Limpia texturas de medios eliminados (evita memory leaks). */
  releaseMedia(mediaId) {
    const t = this.texCache.get(mediaId);
    if (t) { this.gl.deleteTexture(t.tex); this.texCache.delete(mediaId); }
  }
  dispose() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  }
}

export function webgl2Supported() {
  const c = document.createElement("canvas");
  return !!c.getContext("webgl2");
}
