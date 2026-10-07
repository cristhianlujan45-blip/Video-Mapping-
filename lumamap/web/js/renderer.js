// web/js/renderer.js
// Motor de composición WebGL2 de LumaMap.
//  · Corner pin con homografía exacta (UV homogéneas, división por w en el
//    fragment shader) y malla de deformación Catmull-Rom subdividida.
//  · Fuentes: textura (video, imagen, GIF, cámara, texto, dibujo), color y
//    16 generadores procedurales en GPU.
//  · Efectos por superficie en un solo shader: color, RGB split, pixelado,
//    desenfoque, ruido, caleidoscopio, espejo, ondas, zoom/giro/desplazamiento,
//    estroboscopio, borde animado (neón, persecución, pulso, arcoíris) y máscara.
import { GEN_INDEX } from "./model.js";
import { UNIT_SQUARE, tryHomography, evalMesh, triangulatePolygon, bbox, surfaceUVOutline, surfaceAspect, surfaceCorners } from "./math.js";

const MAXP = 64;

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec3 a_uvh;
out vec3 v_uvh;
void main(){ v_uvh = a_uvh; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_uvh;
out vec4 outColor;
uniform sampler2D u_tex;
uniform int u_src;            // 0 nada · 1 textura · 2 color · 3 generador
uniform vec4 u_fit;           // escala.xy, desplazamiento.xy
uniform int u_contain;
uniform int u_gen;
uniform vec3 u_c1, u_c2;
uniform float u_gscale, u_gtime;
uniform float u_aspect, u_time, u_alpha;
uniform float u_bri, u_con, u_sat, u_hue, u_rgb, u_pix, u_blur, u_noise;
uniform int u_inv, u_mirror;
uniform float u_kal, u_wave, u_zoom, u_rot;
uniform vec2 u_scroll;
uniform float u_border, u_glow;
uniform vec3 u_bcol;
uniform int u_banim;
uniform float u_beat;
uniform vec4 u_lev;           // graves, medios, agudos, número de golpe
uniform vec4 u_d1;            // remolino, ojo de pez, ondas en agua, mosaico
uniform vec4 u_d2;            // polar, glitch, aberración cromática, curvatura CRT
uniform vec4 u_c3;            // posterizar, sepia, gamma, umbral
uniform vec4 u_c4;            // viñeta, líneas de TV, semitono, mapa de color
uniform vec4 u_c5;            // contornos, nitidez, relieve, duotono
uniform vec3 u_duoA, u_duoB;
uniform vec4 u_key;           // croma: tolerancia, suavidad · luma: umbral, suavidad
uniform vec3 u_keyCol;
uniform vec2 u_flip;
uniform vec2 u_texel;
uniform vec2 u_shape[${MAXP}];
uniform int u_shapeN;
uniform vec2 u_mask[${MAXP}];
uniform int u_maskN, u_maskInv;
uniform float u_maskFeather;

const float TAU = 6.28318530718;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<5;i++){ v += a*vnoise(p); p *= 2.03; a *= 0.5; } return v; }
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
}
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-9), 0.0, 1.0);
  return length(pa - ba*h);
}
float gridLine(float x, float n){
  float f = abs(fract(x*n + 0.5) - 0.5) / n;
  float w = fwidth(x) * 1.2;
  return 1.0 - smoothstep(0.0, w, f);
}


// ---- Generadores 16..46 (segunda biblioteca) ----
float hash1(float n){ return fract(sin(n*127.1)*43758.5453); }
float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
vec4 generator2(vec2 uv, vec2 p, float t){
  float s = u_gscale;
  vec3 A = u_c1, B = u_c2;
  float r = length(p), a = atan(p.y, p.x);
  if(u_gen==16){ // Matrix
    vec2 g = vec2(uv.x*40.0*s*u_aspect, uv.y*30.0*s);
    float col = floor(g.x);
    float sp = 0.6 + hash1(col)*1.6;
    float y = fract(-uv.y*0.8 + t*sp*0.25 + hash1(col+3.0));
    float trail = pow(y, 6.0);
    float glyph = step(0.35, hash(floor(g) + floor(t*12.0*sp)));
    vec2 f = fract(g);
    float cell = step(0.12, f.x)*step(f.x, 0.88)*step(0.1, f.y)*step(f.y, 0.9);
    float k = trail*glyph*cell;
    return vec4(B*0.05 + A*k + vec3(1.0)*smoothstep(0.97, 1.0, y)*cell*glyph*0.6, 1.0);
  }
  if(u_gen==17){ // Vórtice
    float v = sin(a*6.0 + r*18.0*s - t*3.0 + 2.0/(r+0.15));
    return vec4(mix(B, A, smoothstep(-0.2, 0.2, v)) * smoothstep(0.0, 0.25, r), 1.0);
  }
  if(u_gen==18){ // Hexágonos
    vec2 q = p*6.0*s;
    vec2 h1 = vec2(1.0, 1.732), hh = h1*0.5;
    vec2 ga = mod(q, h1) - hh, gb = mod(q - hh, h1) - hh;
    vec2 g = dot(ga, ga) < dot(gb, gb) ? ga : gb;
    vec2 id = q - g;
    float e = 0.5 - hexDist(g);
    float w = 0.5 + 0.5*sin(length(id)*0.8 - t*3.0);
    float line = smoothstep(0.06, 0.0, e);
    return vec4(mix(B*0.15 + A*w*0.6, A, line), 1.0);
  }
  if(u_gen==19){ // Celdas (Voronoi)
    vec2 q = p*5.0*s, ip = floor(q), fp = fract(q);
    float d1 = 9.0, d2 = 9.0; vec2 cid = vec2(0.0);
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
      vec2 o = vec2(float(x), float(y));
      vec2 h = vec2(hash(ip+o), hash(ip+o+17.3));
      vec2 pt = o + 0.5 + 0.4*sin(t + TAU*h);
      float d = length(pt - fp);
      if(d < d1){ d2 = d1; d1 = d; cid = ip+o; } else if(d < d2) d2 = d;
    }
    vec3 col = mix(B, A, hash(cid));
    return vec4(mix(col, vec3(1.0), smoothstep(0.08, 0.0, d2-d1)), 1.0);
  }
  if(u_gen==20){ // Aurora
    vec3 col = vec3(0.0);
    for(int i=0;i<4;i++){
      float fi = float(i);
      float y = 0.35 + 0.12*fi + 0.12*sin(uv.x*3.0*s + t*0.5 + fi*1.7) + 0.08*fbm(vec2(uv.x*2.0*s + fi, t*0.2));
      float band = exp(-abs(uv.y - y)*18.0) * (0.6 + 0.4*sin(uv.x*20.0 + t + fi));
      col += mix(A, B, fi/3.0) * band * 0.7;
    }
    return vec4(col + B*0.03, 1.0);
  }
  if(u_gen==21){ // Lava
    vec2 q = p*2.5*s;
    vec2 w = vec2(fbm(q + t*0.15), fbm(q + 5.2 - t*0.12));
    float n = fbm(q + 3.0*w);
    vec3 col = mix(B*0.2, B, smoothstep(0.2, 0.5, n));
    col = mix(col, A, smoothstep(0.5, 0.75, n));
    col = mix(col, vec3(1.0, 0.95, 0.7), smoothstep(0.78, 0.95, n));
    return vec4(col, 1.0);
  }
  if(u_gen==22){ // Agua (cáusticas)
    vec2 q = p*7.0*s;
    float c = 0.0;
    for(int i=0;i<3;i++){
      float fi = float(i);
      q += vec2(sin(q.y*1.3 + t*(0.6 + fi*0.2)), cos(q.x*1.1 - t*(0.5 + fi*0.15)));
      c += 1.0/(1.0 + abs(sin(q.x)*sin(q.y))*10.0);
    }
    float k = smoothstep(0.35, 1.2, c);
    return vec4(mix(B*0.6, A, k) + vec3(pow(k, 4.0)*0.6), 1.0);
  }
  if(u_gen==23){ // Ecualizador (audio)
    float n = 16.0*s;
    float i = floor(uv.x*n);
    float f = fract(uv.x*n);
    float band = i/n < 0.33 ? u_lev.x : (i/n < 0.66 ? u_lev.y : u_lev.z);
    float hgt = clamp(band*(0.55 + 0.45*hash1(i + floor(t*6.0))) + 0.08 + 0.06*sin(t*3.0 + i*0.7), 0.02, 1.0);
    float on = step(1.0 - hgt, uv.y) * step(0.12, f) * step(f, 0.88);
    float seg = step(0.25, fract(uv.y*24.0));
    vec3 col = mix(A, B, uv.y);
    return vec4(col*on*seg + B*0.04, 1.0);
  }
  if(u_gen==24){ // Anillos al ritmo (audio)
    float k = 0.0;
    for(int i=0;i<4;i++){
      float rr = fract(t*0.35 + float(i)*0.25)*0.9;
      k += exp(-abs(r - rr)*(40.0 - 20.0*u_lev.x))*(1.0 - rr);
    }
    k += u_beat*exp(-r*4.0);
    return vec4(B*0.05 + A*k, 1.0);
  }
  if(u_gen==25){ // Rayos de luz
    float k = pow(0.5 + 0.5*sin(a*12.0*s + t*1.2), 8.0) * smoothstep(1.2, 0.0, r);
    k += exp(-r*6.0)*0.8;
    return vec4(B*0.08 + A*k, 1.0);
  }
  if(u_gen==26){ // Confeti
    vec3 col = B*0.05;
    for(int L=0;L<3;L++){
      float fl = float(L);
      vec2 q = vec2(uv.x*u_aspect, uv.y)*(10.0 + fl*6.0)*s + vec2(0.0, t*(0.6 + fl*0.4));
      vec2 id = floor(q), f = fract(q) - 0.5;
      float h = hash(id + fl*13.0);
      vec2 o = vec2(sin(t + h*TAU), cos(t*1.3 + h*TAU))*0.25;
      float d = length(f - o);
      col += hsv2rgb(vec3(h, 0.85, 1.0)) * smoothstep(0.12, 0.05, d) * step(0.5, h);
    }
    return vec4(col, 1.0);
  }
  if(u_gen==27 || u_gen==28){ // Nieve / Lluvia
    bool rain = u_gen==28;
    vec3 col = B*0.08;
    for(int L=0;L<3;L++){
      float fl = float(L);
      vec2 q = vec2(uv.x*u_aspect + (rain ? uv.y*0.25 : 0.0), uv.y);
      q *= vec2(rain ? 60.0 : 18.0, rain ? 3.0 : 18.0)*(1.0 + fl*0.6)*s;
      q.y -= t*(rain ? 6.0 : 1.2)*(1.0 + fl*0.5);
      q.x += rain ? 0.0 : sin(q.y*0.7 + fl)*0.3;
      vec2 id = floor(q), f = fract(q) - 0.5;
      float h = hash(id + fl*7.0);
      float d = rain ? abs(f.x)*6.0 + max(0.0, abs(f.y) - 0.35)*4.0 : length(f);
      col += A*smoothstep(rain ? 0.6 : 0.2, 0.0, d)*step(0.75, h)*(0.5 + 0.5/(fl+1.0));
    }
    return vec4(col, 1.0);
  }
  if(u_gen==29){ // Relámpago
    float seed = floor(t*1.5);
    float flash = step(0.55, hash1(seed)) * exp(-fract(t*1.5)*6.0);
    float x0 = hash1(seed + 1.0);
    float x = x0 + (fbm(vec2(uv.y*6.0, seed)) - 0.5)*0.35;
    float bolt = exp(-abs(uv.x - x)*90.0*s);
    return vec4(B*0.06 + B*flash*0.4 + (A + vec3(0.6))*bolt*flash*1.4, 1.0);
  }
  if(u_gen==30){ // Galaxia
    float arm = sin(a*2.0 + log(r + 0.01)*5.0*s - t*0.6);
    float n = fbm(p*8.0 + t*0.05);
    float k = smoothstep(0.2, 1.0, arm)*exp(-r*2.2)*(0.5 + n);
    float star = step(0.985, hash(floor(p*180.0)))*0.8;
    return vec4(B*0.05 + mix(A, B, r)*k*1.6 + vec3(star) + vec3(exp(-r*12.0)), 1.0);
  }
  if(u_gen==31){ // Mandala
    float n = 8.0;
    float aa = abs(mod(a, TAU/n) - TAU/n*0.5);
    float v = sin(aa*12.0*s + r*30.0 - t*2.0)*cos(r*18.0*s + t);
    return vec4(mix(B, A, smoothstep(-0.1, 0.4, v))*smoothstep(0.95, 0.2, r), 1.0);
  }
  if(u_gen==32){ // Truchet
    vec2 q = vec2(uv.x*u_aspect, uv.y)*8.0*s;
    vec2 id = floor(q), f = fract(q);
    if(hash(id + floor(t*0.5)) > 0.5) f.x = 1.0 - f.x;
    float d = min(abs(length(f) - 0.5), abs(length(f - 1.0) - 0.5));
    float glow = 0.5 + 0.5*sin(t*3.0 + (id.x + id.y)*0.6);
    return vec4(B*0.08 + A*smoothstep(0.08, 0.0, d)*glow, 1.0);
  }
  if(u_gen==33){ // Op-art
    float v = sin((p.x + 0.15*sin(p.y*4.0 + t))*40.0*s + sin(r*10.0 - t)*3.0);
    return vec4(mix(B, A, step(0.0, v)), 1.0);
  }
  if(u_gen==34){ // Moiré
    vec2 c2 = vec2(0.25*sin(t*0.6), 0.2*cos(t*0.4));
    float v = sin(r*120.0*s) * sin(length(p - c2)*120.0*s);
    return vec4(mix(B, A, smoothstep(-0.1, 0.1, v)), 1.0);
  }
  if(u_gen==35){ // Corazones
    vec2 q = vec2(uv.x*u_aspect, uv.y)*5.0*s;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float beat = 1.0 + 0.15*sin(t*6.0 + hash(id)*TAU) + u_beat*0.25;
    f /= beat;
    f.y = -f.y + 0.05;
    f.x = abs(f.x);
    float d = length(vec2(f.x - 0.1, f.y - 0.05 - f.x*0.5)) - 0.18;
    return vec4(mix(B*0.15, A, smoothstep(0.02, -0.02, d)), 1.0);
  }
  if(u_gen==36){ // Fuegos artificiales
    vec3 col = B*0.03;
    for(int i=0;i<4;i++){
      float fi = float(i);
      float cyc = t*0.45 + fi*0.27;
      float seed = floor(cyc) + fi*11.0, ph = fract(cyc);
      vec2 cen = vec2((hash1(seed) - 0.5)*u_aspect*0.8, (hash1(seed + 2.0) - 0.5)*0.5);
      vec2 d = p - cen;
      float ang = atan(d.y, d.x);
      float ray = pow(0.5 + 0.5*cos(ang*16.0 + seed), 30.0);
      float ring = exp(-abs(length(d) - ph*0.45)*60.0);
      col += hsv2rgb(vec3(hash1(seed + 5.0), 0.8, 1.0)) * ring * (0.4 + ray) * (1.0 - ph)*1.4;
    }
    return vec4(col, 1.0);
  }
  if(u_gen==37){ // Synthwave
    vec3 col = mix(B*0.4, vec3(0.0), uv.y);
    if(uv.y < 0.55){
      vec2 sp = vec2((uv.x - 0.5)*u_aspect, uv.y - 0.33);
      float sun = smoothstep(0.2, 0.19, length(sp));
      float stripes = step(0.0, sin(uv.y*90.0 - t*2.0)) + step(0.33, uv.y);
      col = mix(col, mix(A, vec3(1.0, 0.85, 0.2), 1.0 - uv.y*2.0), sun*clamp(stripes, 0.0, 1.0));
    } else {
      float z = 1.0/(uv.y - 0.5 + 0.02);
      vec2 g = vec2((uv.x - 0.5)*z*2.0*s, z*0.6*s + t*1.5);
      vec2 gl = abs(fract(g) - 0.5);
      float line = smoothstep(0.05*z*0.15, 0.0, min(gl.x, gl.y) - 0.0);
      col = mix(vec3(0.02, 0.0, 0.06), A, clamp(line*0.9, 0.0, 1.0));
    }
    return vec4(col, 1.0);
  }
  if(u_gen==38){ // Bloques glitch
    vec2 q = floor(vec2(uv.x*(4.0 + 12.0*hash1(floor(t*8.0))), uv.y*14.0*s));
    float h = hash(q + floor(t*10.0));
    vec3 col = h > 0.8 ? A : (h > 0.6 ? B : vec3(0.0));
    col *= step(0.3, hash(q + 9.0 + floor(t*4.0)));
    return vec4(col, 1.0);
  }
  if(u_gen==39){ // Estática de TV
    float n = hash(floor(uv*vec2(320.0, 240.0)*s) + fract(t*13.0)*100.0);
    float scan = 0.85 + 0.15*sin(uv.y*600.0);
    float roll = smoothstep(0.0, 0.05, abs(fract(uv.y + t*0.3) - 0.5));
    return vec4(mix(B, A, n)*scan*(0.7 + 0.3*roll), 1.0);
  }
  if(u_gen==40){ // Barrido de luz
    float x = fract(t*0.4*u_gscale);
    float k = exp(-abs(uv.x - x)*25.0) + exp(-abs(uv.x - fract(x + 0.5))*25.0)*0.5;
    float bars = step(0.5, fract(uv.y*6.0 + floor(t*2.0)*0.5));
    return vec4(B*0.06 + A*k*(0.6 + 0.4*bars), 1.0);
  }
  if(u_gen==41){ // Destello al golpe (audio)
    float alt = mod(u_lev.w, 2.0);
    vec3 col = mix(A, B, alt) * (0.08 + u_beat);
    return vec4(col, 1.0);
  }
  if(u_gen==42){ // Cuadrados concéntricos
    vec2 q = abs(uv - 0.5)*vec2(u_aspect, 1.0);
    float d = max(q.x, q.y);
    float k = smoothstep(0.35, 0.65, 0.5 + 0.5*sin(d*40.0*s - t*4.0 - u_beat*3.0));
    return vec4(mix(B*0.1, A, k), 1.0);
  }
  if(u_gen==43){ // Chevrons (flechas)
    vec2 q = vec2(uv.x*u_aspect, uv.y)*6.0*s;
    float v = fract(q.x - abs(fract(q.y) - 0.5) - t*0.8);
    return vec4(mix(B, A, step(0.5, v)), 1.0);
  }
  if(u_gen==44){ // Puntos
    vec2 q = vec2(uv.x*u_aspect, uv.y)*14.0*s;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float sz = 0.15 + 0.3*(0.5 + 0.5*sin(length(id)*0.5 - t*3.0));
    return vec4(mix(B*0.08, A, smoothstep(sz, sz - 0.04, length(f))), 1.0);
  }
  if(u_gen==45){ // Fluido
    vec2 q = p*2.0*s;
    for(int i=1;i<5;i++){ float fi = float(i); q += vec2(0.6/fi*sin(fi*q.y + t + 0.3*fi), 0.6/fi*cos(fi*q.x + t*0.8 + 0.3*fi)); }
    return vec4(mix(A, B, 0.5 + 0.5*sin(q.x + q.y)), 1.0);
  }
  // 46: Túnel cuadrado
  vec2 q = abs(p);
  float d = max(q.x, q.y);
  float z = 0.25/max(d, 0.001) + t*0.8;
  float k = step(0.5, fract(z*s));
  return vec4(mix(B, A, k)*clamp(d*3.0, 0.0, 1.0), 1.0);
}

vec4 generator(vec2 uv, vec2 p, float t){
  if(u_gen >= 16) return generator2(uv, p, t);
  float s = u_gscale;
  vec3 A = u_c1, B = u_c2;
  if(u_gen==0){
    float v = sin(p.x*6.0*s + t) + sin((p.y*5.0*s - t)*1.3) + sin((p.x+p.y)*4.0*s + t*1.7) + sin(length(p*8.0*s) - t*2.0);
    return vec4(mix(A, B, 0.5+0.5*sin(v*1.3)), 1.0);
  }
  if(u_gen==1) return vec4(hsv2rgb(vec3(fract(uv.x*s + uv.y*0.2*s + t*0.1), 0.85, 1.0)), 1.0);
  if(u_gen==2){
    float r = length(p), a = atan(p.y, p.x)/TAU;
    float z = 0.35/max(r, 0.001) + t*0.6;
    float ring = step(0.5, fract(z*2.0*s)), seg = step(0.5, fract(a*8.0 + z*0.25));
    return vec4(mix(B, A, abs(ring-seg)) * clamp(r*2.5, 0.0, 1.0), 1.0);
  }
  if(u_gen==3){
    float k = pow(0.5+0.5*sin(length(p)*30.0*s - t*4.0), 3.0);
    return vec4(mix(B, A, k), 1.0);
  }
  if(u_gen==4) return vec4(mix(B, A, smoothstep(0.45, 0.55, abs(fract((uv.x+uv.y)*5.0*s - t*0.4)*2.0-1.0))), 1.0);
  if(u_gen==5){ vec2 g = floor(p*8.0*s + vec2(t*0.5, 0.0)); return vec4(mix(B, A, mod(g.x+g.y, 2.0)), 1.0); }
  if(u_gen==6) return vec4(mix(B, A, smoothstep(0.3, 0.8, fbm(p*3.0*s + vec2(t*0.2, t*0.1)))), 1.0);
  if(u_gen==7){
    vec2 q = vec2(p.x*4.0*s, (1.0-uv.y)*3.0*s);
    float n = fbm(q - vec2(0.0, t*1.6));
    float f = clamp(n*1.7 - (1.0-uv.y)*1.25 + 0.35, 0.0, 1.0);
    vec3 col = mix(vec3(0.0), B, smoothstep(0.0, 0.4, f));
    col = mix(col, A, smoothstep(0.35, 0.75, f));
    col = mix(col, vec3(1.0), smoothstep(0.85, 1.0, f));
    return vec4(col, 1.0);
  }
  if(u_gen==8){
    vec2 q = p*18.0*s, id = floor(q), f = fract(q)-0.5;
    float h = hash(id);
    vec2 o = vec2(hash(id+3.1), hash(id+7.7))-0.5;
    float d = length(f - o*0.6);
    float tw = 0.5+0.5*sin(t*3.0 + h*40.0);
    float k = smoothstep(0.09, 0.0, d) * step(0.55, h) * tw;
    return vec4(B*0.12 + A*k, 1.0);
  }
  if(u_gen==9){
    float r = length(p), a = atan(p.y, p.x);
    return vec4(mix(B, A, smoothstep(0.3, 0.7, 0.5+0.5*sin(a*3.0 + r*20.0*s - t*3.0))), 1.0);
  }
  if(u_gen==10){
    float x = 0.5+0.48*sin(t*1.5), y = 0.5+0.48*sin(t*1.1+1.0);
    float k = exp(-abs(uv.x-x)*70.0/s) + exp(-abs(uv.y-y)*70.0/s);
    return vec4(B*0.1 + A*k, 1.0);
  }
  if(u_gen==11){
    vec2 g = abs(fract(p*6.0*s + vec2(0.0, t*0.3)) - 0.5);
    return vec4(B*0.12 + A*exp(-min(g.x, g.y)*30.0), 1.0);
  }
  if(u_gen==12){
    float y = uv.y*10.0*s + sin(uv.x*8.0 + t*2.0)*0.6;
    return vec4(mix(B*0.1, A, smoothstep(0.12, 0.0, abs(fract(y)-0.5))), 1.0);
  }
  if(u_gen==13) return vec4(mix(A, B, 0.5+0.5*sin(uv.x*3.0*s + uv.y*2.0 + t)), 1.0);
  if(u_gen==14){
    vec2 q = vec2(uv.x*6.0*s*u_aspect, uv.y*12.0*s);
    q.x += step(1.0, mod(q.y, 2.0))*0.5;
    vec2 f = fract(q);
    float m = step(0.05, f.x)*step(0.09, f.y);
    float glow = 0.55 + 0.45*sin(t*2.0 + hash(floor(q))*TAU);
    return vec4(mix(B, A*glow, m), 1.0);
  }
  // 15: calibración — cuadrícula, diagonales, círculo y esquinas de color
  vec3 col = vec3(0.06);
  float l = max(gridLine(uv.x, 8.0), gridLine(uv.y, 8.0));
  col = mix(col, A, l*0.9);
  vec2 c = vec2((uv.x-0.5)*u_aspect, uv.y-0.5);
  float cw = fwidth(c.y)*1.5;
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, cw, abs(length(c) - 0.35)));
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, cw, min(abs(uv.x-uv.y), abs(uv.x+uv.y-1.0))*min(u_aspect,1.0)));
  float e = min(min(uv.x, 1.0-uv.x)*u_aspect, min(uv.y, 1.0-uv.y));
  col = mix(col, vec3(1.0), 1.0 - smoothstep(0.012, 0.012+cw, e));
  vec2 k = vec2(uv.x*u_aspect, uv.y);
  float R = 0.14;
  if(length(k) < R) col = vec3(1.0, 0.15, 0.15);
  if(length(k - vec2(u_aspect, 0.0)) < R) col = vec3(0.15, 1.0, 0.25);
  if(length(k - vec2(u_aspect, 1.0)) < R) col = vec3(0.2, 0.45, 1.0);
  if(length(k - vec2(0.0, 1.0)) < R) col = vec3(1.0, 0.9, 0.1);
  return vec4(col, 1.0);
}

vec2 texUV(vec2 cuv){
  vec2 tuv = (cuv - 0.5) * u_fit.xy + 0.5 + u_fit.zw;
  return (tuv.x<0.0 || tuv.x>1.0 || tuv.y<0.0 || tuv.y>1.0) ? fract(tuv) : tuv;
}
float lumAt(vec2 cuv){ return dot(texture(u_tex, texUV(cuv)).rgb, vec3(0.299, 0.587, 0.114)); }

vec4 sampleTex(vec2 cuv){
  vec2 tuv = (cuv - 0.5) * u_fit.xy + 0.5 + u_fit.zw;
  if(u_contain==1 && (tuv.x<0.0 || tuv.x>1.0 || tuv.y<0.0 || tuv.y>1.0)) return vec4(0.0);
  if(tuv.x<0.0 || tuv.x>1.0 || tuv.y<0.0 || tuv.y>1.0) tuv = fract(tuv);
  if(u_blur > 0.0){
    float r = u_blur * 0.012;
    vec4 acc = texture(u_tex, tuv) * 0.2;
    for(int i=0;i<8;i++){
      float a = float(i) * TAU / 8.0;
      acc += texture(u_tex, tuv + vec2(cos(a), sin(a)) * r) * 0.1;
    }
    return acc;
  }
  if(u_rgb > 0.0 || u_d2.z > 0.0){
    vec2 off = vec2(u_rgb, 0.0) + (cuv - 0.5) * u_d2.z;
    vec4 c = texture(u_tex, tuv);
    c.r = texture(u_tex, tuv + off).r;
    c.b = texture(u_tex, tuv - off).b;
    return c;
  }
  return texture(u_tex, tuv);
}

float maskCoverage(vec2 p){
  bool inside = false;
  float dmin = 1e9;
  for(int i=0;i<${MAXP};i++){
    if(i>=u_maskN) break;
    vec2 a = u_mask[i];
    vec2 b = u_mask[(i+1==u_maskN)?0:i+1];
    dmin = min(dmin, segDist(p, a, b));
    if(((a.y>p.y)!=(b.y>p.y)) && (p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)) inside = !inside;
  }
  if(u_maskInv==1) inside = !inside;
  float f = max(u_maskFeather, 1e-4);
  return clamp(0.5 + (inside?1.0:-1.0)*dmin/(2.0*f), 0.0, 1.0);
}

float shapeDist(vec2 uv){
  vec2 p = vec2(uv.x*u_aspect, uv.y);
  float d = 1e9;
  for(int i=0;i<${MAXP};i++){
    if(i>=u_shapeN) break;
    vec2 a = u_shape[i], b = u_shape[(i+1==u_shapeN)?0:i+1];
    d = min(d, segDist(p, vec2(a.x*u_aspect, a.y), vec2(b.x*u_aspect, b.y)));
  }
  return d;
}

void main(){
  vec2 uv = v_uvh.xy / v_uvh.z;       // geometría (máscara y borde)
  vec2 vuv = uv;                      // contenido
  bool outside = false;
  if(u_d2.w > 0.0){                   // curvatura de TV antigua
    vec2 cc = vuv - 0.5;
    vuv = vuv + cc * dot(cc, cc) * u_d2.w * 1.2;
    outside = vuv.x < 0.0 || vuv.x > 1.0 || vuv.y < 0.0 || vuv.y > 1.0;
  }
  if(u_flip.x > 0.5) vuv.x = 1.0 - vuv.x;
  if(u_flip.y > 0.5) vuv.y = 1.0 - vuv.y;
  // ---- transformación del contenido ----
  vec2 p = vuv - 0.5;
  p.x *= u_aspect;
  if(u_mirror==1 || u_mirror==3) p.x = -abs(p.x);
  if(u_mirror==2 || u_mirror==3) p.y = -abs(p.y);
  if(u_kal >= 2.0){
    float r = length(p), a = atan(p.y, p.x);
    float seg = TAU / u_kal;
    a = mod(a, seg); a = abs(a - seg*0.5);
    p = r * vec2(cos(a), sin(a));
  }
  if(u_d1.x != 0.0){                  // remolino
    float tw = u_d1.x * max(0.0, 1.0 - length(p)/0.65) * 3.0;
    p = mat2(cos(tw), sin(tw), -sin(tw), cos(tw)) * p;
  }
  if(u_d1.y != 0.0) p *= 1.0 - u_d1.y*0.7*max(0.0, 1.0 - length(p)/0.7);   // ojo de pez / pellizco
  if(u_d1.z > 0.0){                   // ondas en agua
    float rr = length(p);
    p += (rr > 0.0 ? p/rr : vec2(0.0)) * sin(rr*40.0 - u_time*6.0) * 0.012 * u_d1.z;
  }
  float cr = cos(u_rot), sr = sin(u_rot);
  p = mat2(cr, sr, -sr, cr) * p;
  p /= max(u_zoom, 0.01);
  if(u_d2.x > 0.5){                   // coordenadas polares (túnel)
    vec2 pp = vec2(atan(p.y, p.x)/TAU + 0.5, length(p)*2.0);
    p = (pp - 0.5) * vec2(u_aspect, 1.0);
  }
  if(u_wave > 0.0){
    p.x += sin(p.y*12.0 + u_time*3.0) * 0.03 * u_wave;
    p.y += cos(p.x*10.0 + u_time*2.4) * 0.03 * u_wave;
  }
  vec2 gp = p;
  vec2 cuv = vec2(p.x / u_aspect, p.y) + 0.5 + u_scroll;
  if(u_d1.w > 1.0) cuv = fract(cuv * u_d1.w);                     // mosaico N×N
  if(u_d2.y > 0.0){                   // glitch: franjas desplazadas
    float row = floor(vuv.y*24.0), gt = floor(u_time*9.0);
    if(hash(vec2(row, gt)) < u_d2.y*0.6) cuv.x += (hash(vec2(row + 3.0, gt)) - 0.5) * 0.25 * u_d2.y;
  }
  if(u_pix > 0.0){
    float cells = mix(260.0, 6.0, u_pix);
    vec2 n = vec2(cells*u_aspect, cells);
    cuv = (floor(cuv*n) + 0.5) / n;
    gp = (cuv - 0.5) * vec2(u_aspect, 1.0);
  }
  // ---- fuente ----
  vec4 c = vec4(0.0);
  if(u_src==1) c = sampleTex(cuv);
  else if(u_src==2) c = vec4(u_c1, 1.0);
  else if(u_src==3) c = generator(fract(cuv), gp, u_gtime);
  if(outside) c = vec4(0.0, 0.0, 0.0, 1.0);
  // ---- recortes: croma (fondo verde/azul) y luma (quitar el negro) ----
  if(u_key.x > 0.0) c.a *= smoothstep(u_key.x, u_key.x + u_key.y + 0.001, distance(c.rgb, u_keyCol));
  if(u_key.z > 0.0) c.a *= smoothstep(u_key.z, u_key.z + u_key.w + 0.001, dot(c.rgb, vec3(0.299, 0.587, 0.114)));
  // ---- efectos que miran a los vecinos (vídeo, imagen, cámara, dibujo) ----
  if(u_src==1 && (u_c5.x > 0.0 || u_c5.y > 0.0 || u_c5.z > 0.0)){
    vec2 d = u_texel * 1.5 / max(u_fit.xy, vec2(0.05));
    float tl = lumAt(cuv + vec2(-d.x, -d.y)), tc = lumAt(cuv + vec2(0.0, -d.y)), tr = lumAt(cuv + vec2(d.x, -d.y));
    float ml = lumAt(cuv + vec2(-d.x, 0.0)), mr = lumAt(cuv + vec2(d.x, 0.0));
    float bl = lumAt(cuv + vec2(-d.x, d.y)), bc = lumAt(cuv + vec2(0.0, d.y)), br = lumAt(cuv + vec2(d.x, d.y));
    if(u_c5.x > 0.0){                 // contornos neón
      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br, gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
      float e = clamp(length(vec2(gx, gy))*2.0, 0.0, 1.0);
      vec3 hue = c.rgb / max(max(c.r, max(c.g, c.b)), 0.05);
      c.rgb = mix(c.rgb, e * mix(vec3(1.0), hue, 0.7) * 1.4, u_c5.x);
    }
    if(u_c5.y > 0.0) c.rgb += (c.rgb - vec3((tc + ml + mr + bc)*0.25)) * u_c5.y * 2.0;   // nitidez
    if(u_c5.z > 0.0) c.rgb = mix(c.rgb, vec3(0.5 + (br - tl)*3.0), u_c5.z);                // relieve
  }
  // ---- color ----
  if(c.a > 0.0){
    if(u_inv==1) c.rgb = 1.0 - c.rgb;
    c.rgb *= u_bri;
    c.rgb = (c.rgb - 0.5) * u_con + 0.5;
    float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(vec3(l), c.rgb, u_sat);
    if(u_hue != 0.0){ vec3 h = rgb2hsv(clamp(c.rgb, 0.0, 1.0)); h.x = fract(h.x + u_hue); c.rgb = hsv2rgb(h); }
    if(u_c3.z != 1.0) c.rgb = pow(max(c.rgb, 0.0), vec3(1.0/max(u_c3.z, 0.05)));        // gamma
    float lum = clamp(dot(c.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    if(u_c3.y > 0.0) c.rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131))), u_c3.y);
    if(u_c5.w > 0.0) c.rgb = mix(c.rgb, mix(u_duoA, u_duoB, lum), u_c5.w);                   // duotono
    int cm = int(u_c4.w + 0.5);       // mapas de color
    if(cm == 1) c.rgb = lum < 0.33 ? mix(vec3(0.0, 0.0, 0.3), vec3(0.6, 0.0, 0.6), lum*3.0) : (lum < 0.66 ? mix(vec3(0.6, 0.0, 0.6), vec3(1.0, 0.3, 0.0), lum*3.0 - 1.0) : mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 1.0, 0.7), lum*3.0 - 2.0));
    else if(cm == 2) c.rgb = vec3(0.15, 1.0, 0.25) * (lum*1.4 + (hash(uv*700.0 + fract(u_time*9.0)) - 0.5)*0.15);
    else if(cm == 3) c.rgb = vec3(0.75, 0.9, 1.0) * (1.0 - lum);
    else if(cm == 4) c.rgb = vec3(1.0, 0.78, 0.3) * lum * 1.35;
    else if(cm == 5) c.rgb = hsv2rgb(vec3(fract(lum + u_time*0.05), 0.9, 1.0));
    else if(cm == 6) c.rgb = mix(vec3(0.0, 0.04, 0.2), vec3(0.65, 0.95, 1.0), lum);
    if(u_c3.x >= 2.0) c.rgb = floor(c.rgb*u_c3.x + 0.5)/u_c3.x;                              // posterizar
    if(u_c3.w > 0.0) c.rgb = vec3(step(u_c3.w, lum));                                          // umbral B/N
    if(u_c4.z > 0.0){                 // semitono (puntos de periódico)
      vec2 g = vec2(vuv.x*u_aspect, vuv.y)*70.0;
      g = mat2(0.707, 0.707, -0.707, 0.707) * g;
      float rad = sqrt(lum)*0.62;
      c.rgb = mix(c.rgb, c.rgb * smoothstep(rad, rad - 0.1, length(fract(g) - 0.5)), u_c4.z);
    }
    if(u_c4.y > 0.0) c.rgb *= 1.0 - u_c4.y*0.55*(0.5 + 0.5*sin(vuv.y*720.0));               // líneas de TV
    if(u_c4.x > 0.0) c.rgb *= 1.0 - u_c4.x*smoothstep(0.3, 0.85, length((uv - 0.5)*1.25));    // viñeta
    if(u_noise > 0.0) c.rgb += (hash(uv*vec2(1920.0, 1080.0) + fract(u_time*7.13)) - 0.5) * u_noise;
  }
  // ---- borde animado (efectos de línea sobre el contorno) ----
  if(u_border > 0.0){
    float d = shapeDist(uv);
    float w = u_border;
    float core = 1.0 - smoothstep(w*0.5, w*0.5 + fwidth(d)*1.5, d);
    float glow = exp(-max(d - w*0.5, 0.0) / max(w*(0.3 + u_glow*2.0), 1e-4)) * u_glow;
    float k = max(core, glow*0.9);
    vec3 bc = u_bcol;
    float ang = atan(uv.y-0.5, (uv.x-0.5)*u_aspect)/TAU + 0.5;
    if(u_banim==1) k *= smoothstep(0.3, 0.7, abs(fract(ang*6.0 - u_time*0.5)*2.0-1.0));
    if(u_banim==2) k *= 0.35 + 0.65*(0.5+0.5*sin(u_time*5.0)) + u_beat;
    if(u_banim==3) bc = hsv2rgb(vec3(fract(ang + u_time*0.2), 0.9, 1.0));
    k = clamp(k, 0.0, 1.0);
    c.rgb = mix(c.rgb * c.a, bc, k);
    c.a = max(c.a, k);
    if(c.a > 0.0) c.rgb /= c.a;
  }
  c.a *= u_alpha;
  if(u_maskN >= 3) c.a *= maskCoverage(uv);
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  if(c.a <= 0.002) discard;
  outColor = vec4(c.rgb * c.a, c.a);   // alfa premultiplicado
}`;

const UNIFORMS = ["u_tex", "u_src", "u_fit", "u_contain", "u_gen", "u_c1", "u_c2", "u_gscale", "u_gtime",
  "u_aspect", "u_time", "u_alpha", "u_bri", "u_con", "u_sat", "u_hue", "u_rgb", "u_pix", "u_blur", "u_noise",
  "u_inv", "u_mirror", "u_kal", "u_wave", "u_zoom", "u_rot", "u_scroll", "u_border", "u_glow", "u_bcol",
  "u_banim", "u_beat", "u_lev", "u_d1", "u_d2", "u_c3", "u_c4", "u_c5", "u_duoA", "u_duoB", "u_key", "u_keyCol", "u_flip", "u_texel", "u_shape", "u_shapeN", "u_mask", "u_maskN", "u_maskInv", "u_maskFeather"];

export function hexToRgb(hex) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

const MIRROR = { none: 0, h: 1, v: 2, quad: 3 };
export const COLORMAP = { none: 0, thermal: 1, night: 2, xray: 3, gold: 4, rainbow: 5, ice: 6 };
const BANIM = { none: 0, chase: 1, pulse: 2, rainbow: 3 };

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("Shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export function webgl2Supported() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

export class Renderer {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: preserve });
    if (!gl) throw new Error("WebGL2 no disponible en este dispositivo");
    this.gl = gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("Link: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    this.loc = {};
    for (const n of UNIFORMS) this.loc[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.textures = new Map();   // key -> {tex, w, h, frame}
    this.meshCache = new Map();  // surfaceId -> {sig, data}
    this.shapeBuf = new Float32Array(MAXP * 2);
    this.maskBuf = new Float32Array(MAXP * 2);
  }

  /** Mayor lado que admite la GPU (texturas y viewport); 8K puede superarlo en móviles. */
  get maxDim() {
    if (!this._maxDim) {
      const gl = this.gl, v = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      this._maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), v[0], v[1], gl.getParameter(gl.MAX_TEXTURE_SIZE));
    }
    return this._maxDim;
  }

  /** Escala que cabe en la GPU para una salida W×H con la escala pedida. */
  fitScale(W, H, k = 1) { return Math.min(k, this.maxDim / W, this.maxDim / H); }

  resize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  begin(clear = [0, 0, 0, 1]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...clear);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
  }

  /** Sube (o reutiliza) una textura; solo vuelve a subir si cambia frameKey. */
  texture(key, source, frameKey) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      t = { tex, w: 0, h: 0, frame: undefined, ok: false };
      this.textures.set(key, t);
    }
    if (source && t.frame !== frameKey) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        t.w = source.videoWidth || source.naturalWidth || source.width || 1;
        t.h = source.videoHeight || source.naturalHeight || source.height || 1;
        t.ok = true;
      } catch { /* fotograma todavía no disponible */ }
      t.frame = frameKey;
    }
    return t.ok ? t : null;
  }

  releaseTexture(key) {
    const t = this.textures.get(key);
    if (t) { this.gl.deleteTexture(t.tex); this.textures.delete(key); }
  }

  /** Malla de la superficie en coordenadas clip (con la vista aplicada). */
  mesh(s, view, cw, ch) {
    const sig = `${view.sx},${view.sy},${view.tx},${view.ty},${cw},${ch},${s.cols},${s.rows},` +
      s.points.map(p => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(";");
    const cached = this.meshCache.get(s.id);
    if (cached && cached.sig === sig) return cached.data;
    const X = (x) => ((x * view.sx + view.tx) / cw) * 2 - 1;
    const Y = (y) => 1 - ((y * view.sy + view.ty) / ch) * 2;
    const v = [];
    if (s.type === "quad" && s.cols === 2 && s.rows === 2) {
      // Corner pin exacto: (u/w, v/w, 1/w) es lineal en pantalla, así que la
      // interpolación del rasterizador + la división en el fragment shader
      // reproducen la perspectiva sin aproximaciones. La vista es afín y no
      // altera w, por eso basta la homografía en coordenadas de proyecto.
      const corners = surfaceCorners(s);
      const H = tryHomography(UNIT_SQUARE, corners);
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [u, w] = UNIT_SQUARE[i];
        const [x, y] = corners[i];
        const q = H ? 1 / (H[6] * u + H[7] * w + H[8]) : 1;
        v.push(X(x), Y(y), u * q, w * q, q);
      }
    } else if (s.type === "quad") {
      const S = 10, N = (s.cols - 1) * S, M = (s.rows - 1) * S;
      const grid = [];
      for (let r = 0; r <= M; r++) for (let c = 0; c <= N; c++) grid.push(evalMesh(s.points, s.cols, s.rows, c / N, r / M));
      const at = (c, r) => grid[r * (N + 1) + c];
      for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
        const q = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r], [c + 1, r + 1], [c, r + 1]];
        for (const [cc, rr] of q) { const p = at(cc, rr); v.push(X(p.x), Y(p.y), cc / N, rr / M, 1); }
      }
    } else {
      const b = bbox(s.points);
      for (const i of triangulatePolygon(s.points)) {
        const p = s.points[i];
        v.push(X(p.x), Y(p.y), (p.x - b.x) / b.w, (p.y - b.y) / b.h, 1);
      }
    }
    const data = new Float32Array(v);
    this.meshCache.set(s.id, { sig, data });
    return data;
  }

  /**
   * Dibuja una superficie con su look.
   * o = { view, time, alpha, tex:{tex,w,h}|null, levels, master, react }
   */
  drawSurface(s, look, o) {
    const gl = this.gl, L = this.loc, fx = look.fx, src = look.source;
    const cw = this.canvas.width, ch = this.canvas.height;
    const lv = o.levels || { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };
    const { aspect } = surfaceAspect(s);

    // Audio reactivo por superficie: modula el parámetro elegido.
    let bri = fx.brightness, alpha = look.opacity * o.alpha, zoom = fx.zoom, hue = fx.hue, border = fx.border, strobe = fx.strobe;
    let rot = (fx.rotate || 0) * Math.PI / 180 + (fx.spin || 0) * o.time;
    hue += (fx.hueCycle || 0) * o.time * 0.1;                     // tono que gira solo
    let shakeX = 0, shakeY = 0;                                  // temblor (más fuerte en cada golpe)
    if (fx.shake) { const k = fx.shake * (0.004 + (lv.beat || 0) * 0.02); shakeX = Math.sin(o.time * 61.3) * k; shakeY = Math.cos(o.time * 47.9) * k; }
    let gtime = o.time * (src.speed ?? 1);
    if (look.audio?.enabled) {
      const a = (lv[look.audio.band] ?? 0) * (look.audio.amount ?? 1);
      switch (look.audio.target) {
        case "brightness": bri *= 0.25 + a * 1.25; break;
        case "opacity": alpha *= Math.min(1, 0.1 + a); break;
        case "scale": zoom *= 1 + a * 0.35; break;
        case "hue": hue += a * 0.5; break;
        case "border": border = Math.max(border, 0.004) * (1 + a * 4); break;
        case "strobe": if (lv.beat < 0.5 * (look.audio.amount ?? 1)) alpha *= 0.05; break;
      }
      gtime += lv.beat * 0.3;
    }
    // Modo ritmo global: todo el mapping late con los golpes y el BPM.
    const R = o.react;
    if (R?.enabled) {
      const k = R.amount ?? 1, beat = lv.beat || 0, n = lv.count || 0;
      if (R.pulse) bri *= 1 + beat * 0.9 * k;
      if (R.zoom) zoom *= 1 + beat * 0.14 * k;
      if (R.color) hue += ((n * 0.13 * Math.min(1, k)) % 1);
      if (R.motion) { gtime += (lv.pos ?? n) * 0.5 * k; rot += beat * 0.06 * k; } // avanza al compás: empuja en cada golpe
      if (R.flash) alpha *= Math.min(1, 0.15 + beat * 1.2);
      if (border > 0) border *= 1 + beat * 1.5 * k;
    }
    if (strobe > 0 && Math.floor(o.time * strobe * 2) % 2 === 1) alpha *= 0.0;
    if (alpha <= 0.002) return;

    let srcType = 0;
    if (src.type === "color") srcType = 2;
    else if (src.type === "gen") srcType = 3;
    else if (o.tex) srcType = 1;
    if (srcType === 0 && border <= 0) return;

    gl.uniform1i(L.u_src, srcType);
    if (srcType === 1) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.tex.tex);
      gl.uniform1i(L.u_tex, 0);
      const ta = o.tex.w / Math.max(1, o.tex.h);
      let sx = 1, sy = 1;
      if (look.fit === "cover") { if (ta > aspect) sx = aspect / ta; else sy = ta / aspect; }
      else if (look.fit === "contain") { if (ta > aspect) sy = ta / aspect; else sx = aspect / ta; }
      gl.uniform4f(L.u_fit, sx, sy, 0, 0);
      gl.uniform1i(L.u_contain, look.fit === "contain" ? 1 : 0);
    } else {
      gl.uniform4f(L.u_fit, 1, 1, 0, 0);
      gl.uniform1i(L.u_contain, 0);
    }
    gl.uniform1i(L.u_gen, GEN_INDEX[src.gen] ?? 0);
    gl.uniform3fv(L.u_c1, hexToRgb(src.color));
    gl.uniform3fv(L.u_c2, hexToRgb(src.color2));
    gl.uniform1f(L.u_gscale, src.scale || 1);
    gl.uniform1f(L.u_gtime, gtime);
    gl.uniform1f(L.u_aspect, aspect);
    gl.uniform1f(L.u_time, o.time);
    gl.uniform1f(L.u_alpha, Math.min(1, alpha) * (o.master ?? 1));
    gl.uniform1f(L.u_bri, bri);
    gl.uniform1f(L.u_con, fx.contrast);
    gl.uniform1f(L.u_sat, fx.saturation);
    gl.uniform1f(L.u_hue, hue);
    gl.uniform1f(L.u_rgb, fx.rgbShift);
    gl.uniform1f(L.u_pix, fx.pixelate);
    gl.uniform1f(L.u_blur, srcType === 1 ? fx.blur : 0);
    gl.uniform1f(L.u_noise, fx.noise);
    gl.uniform1i(L.u_inv, fx.invert ? 1 : 0);
    gl.uniform1i(L.u_mirror, MIRROR[fx.mirror] ?? 0);
    gl.uniform1f(L.u_kal, fx.kaleido || 0);
    gl.uniform1f(L.u_wave, fx.wave);
    gl.uniform1f(L.u_zoom, zoom);
    gl.uniform1f(L.u_rot, rot);
    gl.uniform2f(L.u_scroll, ((fx.scrollX || 0) * o.time) % 1 + shakeX, ((fx.scrollY || 0) * o.time) % 1 + shakeY);
    gl.uniform1f(L.u_border, border);
    gl.uniform1f(L.u_glow, fx.borderGlow ?? 0.5);
    gl.uniform3fv(L.u_bcol, hexToRgb(fx.borderColor));
    gl.uniform1i(L.u_banim, BANIM[fx.borderAnim] ?? 0);
    gl.uniform1f(L.u_beat, lv.beat || 0);
    gl.uniform4f(L.u_lev, lv.bass || 0, lv.mid || 0, lv.high || 0, lv.count || 0);
    gl.uniform4f(L.u_d1, fx.twirl || 0, fx.bulge || 0, fx.ripple || 0, fx.tile || 1);
    gl.uniform4f(L.u_d2, fx.polar ? 1 : 0, fx.glitch || 0, fx.chroma || 0, fx.crt || 0);
    gl.uniform4f(L.u_c3, fx.posterize || 0, fx.sepia || 0, fx.gamma ?? 1, fx.threshold || 0);
    gl.uniform4f(L.u_c4, fx.vignette || 0, fx.scanlines || 0, fx.halftone || 0, COLORMAP[fx.colormap] || 0);
    gl.uniform4f(L.u_c5, fx.edges || 0, fx.sharpen || 0, fx.emboss || 0, fx.duotone || 0);
    gl.uniform3fv(L.u_duoA, hexToRgb(fx.duoA || "#1a0033"));
    gl.uniform3fv(L.u_duoB, hexToRgb(fx.duoB || "#00e5ff"));
    gl.uniform4f(L.u_key, fx.chromaKey || 0, fx.keySoft ?? 0.1, fx.lumaKey || 0, fx.lumaSoft ?? 0.05);
    gl.uniform3fv(L.u_keyCol, hexToRgb(fx.keyColor || "#00ff00"));
    gl.uniform2f(L.u_flip, fx.flipX ? 1 : 0, fx.flipY ? 1 : 0);
    gl.uniform2f(L.u_texel, srcType === 1 ? 1 / Math.max(1, o.tex.w) : 0, srcType === 1 ? 1 / Math.max(1, o.tex.h) : 0);

    if (border > 0) {
      const shape = surfaceUVOutline(s);
      const n = Math.min(shape.length, MAXP);
      for (let i = 0; i < n; i++) { this.shapeBuf[i * 2] = shape[i].x; this.shapeBuf[i * 2 + 1] = shape[i].y; }
      gl.uniform2fv(L.u_shape, this.shapeBuf);
      gl.uniform1i(L.u_shapeN, n);
    } else gl.uniform1i(L.u_shapeN, 0);

    const m = s.mask;
    if (m && m.enabled && m.points.length >= 3) {
      const n = Math.min(m.points.length, MAXP);
      for (let i = 0; i < n; i++) { this.maskBuf[i * 2] = m.points[i].x; this.maskBuf[i * 2 + 1] = m.points[i].y; }
      gl.uniform2fv(L.u_mask, this.maskBuf);
      gl.uniform1i(L.u_maskN, n);
      gl.uniform1i(L.u_maskInv, m.invert ? 1 : 0);
      gl.uniform1f(L.u_maskFeather, m.feather || 0.0005);
    } else gl.uniform1i(L.u_maskN, 0);

    switch (look.blend) {
      case "add": gl.blendFunc(gl.ONE, gl.ONE); break;
      case "screen": gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case "multiply": gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    const data = this.mesh(s, o.view, cw, ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
  }

  forgetSurface(id) { this.meshCache.delete(id); }
}
