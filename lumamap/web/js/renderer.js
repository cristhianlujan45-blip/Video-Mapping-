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
import { PRO_MODE_IDS } from "./fx-pro.js";
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
uniform int u_src;            // 0 nada · 1 textura · 2 color · 3 generador · 4 cuerpo (máscara + generador)
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
uniform vec4 u_tr;      // transición: modo (0 nada, 1 disolver, 2 cortinilla →, 3 cortinilla ↓, 4 iris), progreso, papel (0 sale, 1 entra)
uniform vec4 u_frame;   // rectángulo de la salida en píxeles del lienzo (x, y desde abajo, ancho, alto)
uniform vec4 u_sty;     // estilo (0 ninguno · ver STYLES), filas de celdas, resplandor, 0
uniform vec3 u_styCol;
uniform sampler2D u_glyph;   // letras y números (8×8 celdas): rampa « .,:;-=+*#%@», 0-9, A-Z

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

// ---- Generadores 47..71 (tercera biblioteca) ----
vec4 generator3(vec2 uv, vec2 p, float t){
  float s = u_gscale;
  vec3 A = u_c1, B = u_c2;
  float r = length(p), a = atan(p.y, p.x);
  if(u_gen==47){ // Circuito
    vec2 q = vec2(uv.x*u_aspect, uv.y)*10.0*s;
    vec2 id = floor(q), f = fract(q);
    float h = hash(id);
    float line = h > 0.5 ? smoothstep(0.06, 0.0, abs(f.y - 0.5)) : smoothstep(0.06, 0.0, abs(f.x - 0.5));
    float node = smoothstep(0.14, 0.08, length(f - 0.5)) * step(0.8, hash(id + 4.0));
    float pulse = smoothstep(0.15, 0.0, abs(fract((h > 0.5 ? f.x : f.y) + h*3.0 - t*0.8) - 0.5) - 0.35);
    return vec4(B*0.08 + A*(line*(0.25 + pulse) + node), 1.0);
  }
  if(u_gen==48){ // Burbujas
    vec3 col = B*0.12;
    for(int L=0;L<3;L++){
      float fl = float(L);
      vec2 q = vec2(uv.x*u_aspect, uv.y)*(6.0 + fl*3.0)*s;
      q.y += t*(0.5 + fl*0.3);
      q.x += sin(q.y*0.8 + fl)*0.2;
      vec2 id = floor(q), f = fract(q) - 0.5;
      float h = hash(id + fl*9.0), rad = 0.12 + 0.2*h;
      float d = length(f);
      float ring = smoothstep(0.03, 0.0, abs(d - rad)) + smoothstep(rad*0.5, 0.0, length(f - vec2(-rad*0.35, rad*0.35)))*0.5;
      col += A*ring*step(0.55, h);
    }
    return vec4(col, 1.0);
  }
  if(u_gen==49){ // Humo
    vec2 q = vec2(p.x*2.0*s, (1.0 - uv.y)*2.0*s - t*0.3);
    float n = fbm(q + fbm(q*1.5 + t*0.1));
    float k = smoothstep(0.35, 0.85, n) * smoothstep(0.0, 0.6, 1.0 - uv.y + 0.2);
    return vec4(mix(B*0.05, A, k), 1.0);
  }
  if(u_gen==50){ // Océano
    float y = uv.y;
    float w = 0.0;
    for(int i=0;i<5;i++){ float fi = float(i); w += sin(uv.x*(4.0 + fi*3.0)*s + t*(1.0 + fi*0.4) + fi)*0.02/(fi + 1.0); }
    float sea = step(0.45 + w, y);
    vec3 sky = mix(A*0.6, B*0.3, y*2.0);
    vec3 water = mix(B, B*0.3, (y - 0.45)*1.8) + A*0.3*pow(0.5 + 0.5*sin(uv.x*60.0 + t*3.0 + y*40.0), 20.0);
    return vec4(mix(sky, water, sea), 1.0);
  }
  if(u_gen==51){ // Atardecer
    vec2 sp = vec2((uv.x - 0.5)*u_aspect, uv.y - 0.55 - 0.05*sin(t*0.2));
    vec3 sky = mix(A, B, uv.y*1.2);
    float sun = smoothstep(0.16, 0.15, length(sp)) * step(uv.y, 0.62);
    float glow = exp(-length(sp)*4.0);
    vec3 col = sky + vec3(1.0, 0.8, 0.4)*glow*0.6 + vec3(1.0, 0.9, 0.6)*sun;
    if(uv.y > 0.62) col = mix(col*0.4, A*0.2, (uv.y - 0.62)*2.0) + vec3(1.0, 0.7, 0.3)*0.3*pow(0.5 + 0.5*sin(uv.y*120.0 + t*2.0 + uv.x*6.0), 6.0)*smoothstep(0.25, 0.0, abs(uv.x - 0.5));
    return vec4(col, 1.0);
  }
  if(u_gen==52){ // Ondas neón
    vec3 col = vec3(0.0);
    for(int i=0;i<6;i++){
      float fi = float(i);
      float y = 0.5 + 0.3*sin(uv.x*(3.0 + fi)*s + t*(1.0 + fi*0.2) + fi*1.3)*(0.4 + 0.1*fi);
      col += hsv2rgb(vec3(fract(fi/6.0 + t*0.05), 0.8, 1.0))*exp(-abs(uv.y - y)*80.0)*0.9;
    }
    return vec4(col*mix(vec3(1.0), A, 0.3) + B*0.04, 1.0);
  }
  if(u_gen==53){ // Suelo 3D
    float hz = 0.4;
    if(uv.y < hz) return vec4(B*0.1*(uv.y/hz), 1.0);
    float z = 1.0/(uv.y - hz + 0.01);
    vec2 g = vec2((uv.x - 0.5)*z*1.5*s, z*0.5*s + t*2.0);
    float ck = mod(floor(g.x) + floor(g.y), 2.0);
    return vec4(mix(B, A, ck)*clamp((uv.y - hz)*3.0, 0.0, 1.0), 1.0);
  }
  if(u_gen==54){ // Esferas
    vec2 q = vec2(uv.x*u_aspect, uv.y)*6.0*s;
    vec2 id = floor(q), f = fract(q) - 0.5;
    float rad = 0.32 + 0.1*sin(t*2.0 + hash(id)*TAU);
    float d = length(f);
    float z = sqrt(max(0.0, rad*rad - d*d))/rad;
    float shade = clamp(dot(normalize(vec3(f, z*rad)), normalize(vec3(-0.5, -0.6, 0.6))), 0.0, 1.0);
    vec3 col = mix(A, B, hash(id))*shade + vec3(pow(shade, 20.0));
    return vec4(mix(B*0.05, col, step(d, rad)), 1.0);
  }
  if(u_gen==55){ // Triángulos
    vec2 q = vec2(uv.x*u_aspect*1.1547, uv.y)*8.0*s;
    q.x += q.y*0.5;
    vec2 id = floor(q), f = fract(q);
    float up = step(f.x, f.y);
    float h = hash(id*2.0 + up);
    float on = step(0.5, sin(t*2.0 + h*TAU));
    return vec4(mix(B*0.2, mix(A, B, h), on)*(0.8 + 0.2*up), 1.0);
  }
  if(u_gen==56){ // Escamas
    vec2 q = vec2(uv.x*u_aspect, uv.y)*10.0*s;
    q.x += 0.5*mod(floor(q.y), 2.0);
    vec2 f = fract(q) - vec2(0.5, 0.0);
    float d = length(f);
    float k = smoothstep(0.55, 0.45, d) - smoothstep(0.48, 0.42, d)*0.6;
    float sh = 0.5 + 0.5*sin(floor(q.y)*0.6 - t*2.0);
    return vec4(mix(B, A, sh)*(0.4 + 0.6*k), 1.0);
  }
  if(u_gen==57){ // Cortina LED
    float n = 32.0*s;
    float col = floor(uv.x*n);
    float f = fract(uv.x*n);
    float v = 0.5 + 0.5*sin(t*3.0 + col*0.7 + u_lev.x*4.0);
    float drop = fract(uv.y - t*(0.5 + hash1(col)) - hash1(col + 2.0));
    float k = smoothstep(0.2, 0.5, f)*smoothstep(0.8, 0.5, f)*(v*0.5 + pow(1.0 - drop, 3.0));
    return vec4(mix(B*0.05, mix(A, B, hash1(col)), k), 1.0);
  }
  if(u_gen==58){ // Persiana
    float open = 0.5 + 0.5*sin(t*1.2);
    float k = step(fract(uv.y*10.0*s), open);
    return vec4(mix(B*0.05, A, k), 1.0);
  }
  if(u_gen==59){ // Barrido diagonal
    float d = fract((uv.x*u_aspect + uv.y)*0.5*s - t*0.4);
    float k = smoothstep(0.0, 0.05, d)*smoothstep(0.5, 0.45, d);
    float trail = exp(-d*6.0)*0.3;
    return vec4(B*0.05 + A*(k + trail), 1.0);
  }
  if(u_gen==60){ // Radar
    float sweep = fract(a/TAU - t*0.3);
    float beam = pow(1.0 - sweep, 6.0)*step(r, 0.5);
    float rings = smoothstep(0.01, 0.0, abs(fract(r*8.0) - 0.5) - 0.48)*step(r, 0.5);
    vec2 bl = p*8.0; vec2 id = floor(bl);
    float blip = step(0.93, hash(id))*smoothstep(0.2, 0.0, length(fract(bl) - 0.5))*pow(1.0 - fract(atan(id.y + 0.5, id.x + 0.5)/TAU - t*0.3), 3.0);
    return vec4(B*0.06 + A*(beam*0.8 + rings*0.4 + blip*2.0)*step(r, 0.5), 1.0);
  }
  if(u_gen==61){ // Pulso cardíaco
    float x = fract(uv.x - t*0.35);
    float ph = fract(x*2.0*s);
    float ecg = 0.5 - (ph > 0.4 && ph < 0.45 ? (ph - 0.4)*8.0 : ph > 0.45 && ph < 0.5 ? (0.5 - ph)*16.0 - 0.4 : ph > 0.5 && ph < 0.55 ? (ph - 0.55)*4.0 : 0.0);
    float k = exp(-abs(uv.y - ecg)*120.0);
    float grid = max(gridLine(uv.x, 20.0), gridLine(uv.y, 12.0))*0.15;
    return vec4(B*0.05 + B*grid + A*k*1.5*(0.3 + 0.7*smoothstep(0.0, 0.3, 1.0 - x)), 1.0);
  }
  if(u_gen==62){ // Láseres cruzados
    vec3 col = B*0.04;
    vec2 base = vec2(0.0, 0.55);
    for(int i=0;i<6;i++){
      float fi = float(i);
      float ang = -1.5708 + sin(t*(0.7 + fi*0.13) + fi*1.7)*0.9;
      vec2 o = vec2((fi/5.0 - 0.5)*u_aspect*0.9, 0.5);
      vec2 d = p - o;
      vec2 dir = vec2(cos(ang), sin(ang));
      float dist = abs(d.x*dir.y - d.y*dir.x);
      col += mix(A, B, fi/5.0)*exp(-dist*160.0)*step(0.0, dot(d, dir));
    }
    return vec4(col + vec3(0.02)*fbm(p*3.0 + t*0.2), 1.0);
  }
  if(u_gen==63){ // Espiral de puntos
    vec3 col = B*0.05;
    for(int i=0;i<96;i++){
      float fi = float(i);
      float rr = sqrt(fi/96.0)*0.48;
      float aa = fi*2.39996 + t*0.4;
      vec2 c = rr*vec2(cos(aa), sin(aa));
      col += hsv2rgb(vec3(fract(fi/96.0 + t*0.1), 0.7, 1.0))*smoothstep(0.016*s + 0.004, 0.0, length(p - c));
    }
    return vec4(mix(col, col*A*2.0, 0.3), 1.0);
  }
  if(u_gen==64){ // Interferencia
    vec2 c1 = vec2(-0.25 + 0.1*sin(t*0.5), 0.0), c2 = vec2(0.25, 0.1*cos(t*0.4));
    float v = sin(length(p - c1)*60.0*s - t*4.0) + sin(length(p - c2)*60.0*s - t*4.0);
    return vec4(mix(B, A, smoothstep(-0.5, 1.5, v)), 1.0);
  }
  if(u_gen==65) return vec4(hsv2rgb(vec3(fract(a/TAU + t*0.1), 0.85, 1.0))*smoothstep(0.0, 0.1, r), 1.0); // Arcoíris circular
  if(u_gen==66){ // Rombos (argyle)
    vec2 q = vec2(uv.x*u_aspect, uv.y)*5.0*s;
    vec2 g = abs(fract(q) - 0.5);
    float dia = step(g.x + g.y, 0.5);
    float lines = smoothstep(0.03, 0.0, abs(fract(q.x + q.y) - 0.5) - 0.47) + smoothstep(0.03, 0.0, abs(fract(q.x - q.y + t*0.2) - 0.5) - 0.47);
    return vec4(mix(B, A, dia) + vec3(lines*0.5), 1.0);
  }
  if(u_gen==67){ // Neblina de color
    vec3 col = vec3(0.0);
    for(int i=0;i<5;i++){
      float fi = float(i);
      vec2 c = vec2(sin(t*0.3 + fi*2.1)*0.6*u_aspect*0.5, cos(t*0.25 + fi*1.3)*0.35);
      col += hsv2rgb(vec3(fract(fi*0.2 + t*0.03), 0.8, 1.0))*exp(-length(p - c)*3.0/s);
    }
    return vec4(mix(col, col*mix(A, B, uv.y), 0.4)*0.8, 1.0);
  }
  if(u_gen==68){ // Bloques que caen
    vec2 q = vec2(uv.x*12.0*s*u_aspect, uv.y*20.0*s);
    float col = floor(q.x);
    float fall = fract(t*0.15*(0.5 + hash1(col)) + hash1(col + 3.0));
    float stack = 0.2 + 0.6*hash1(col + floor(t*0.15));
    vec2 f = fract(q);
    float cell = step(0.06, f.x)*step(f.x, 0.94)*step(0.06, f.y)*step(f.y, 0.94);
    float isStack = step(1.0 - stack, uv.y);
    float isDrop = step(abs(uv.y - fall*(1.0 - stack)), 0.05);
    return vec4(mix(B*0.05, mix(A, B, hash1(col)), max(isStack, isDrop)*cell), 1.0);
  }
  if(u_gen==69){ // Estrellas fugaces
    vec3 col = B*0.08 + vec3(step(0.996, hash(floor(uv*vec2(400.0, 250.0)))))*0.8;
    for(int i=0;i<3;i++){
      float fi = float(i);
      float cyc = t*0.3 + fi*0.37, seed = floor(cyc) + fi*5.0, ph = fract(cyc);
      vec2 st = vec2(hash1(seed)*1.2 - 0.1, hash1(seed + 1.0)*0.4);
      vec2 head = st + vec2(0.6, 0.35)*ph;
      vec2 d = uv - head;
      vec2 dir = normalize(vec2(0.6, 0.35));
      float along = -dot(d, dir), across = abs(d.x*dir.y - d.y*dir.x);
      col += A*exp(-across*400.0)*smoothstep(0.25, 0.0, along)*step(0.0, along)*(1.0 - ph);
    }
    return vec4(col, 1.0);
  }
  if(u_gen==70){ // Electricidad
    float n = fbm(p*4.0*s + vec2(t*2.0, 0.0));
    float arc = exp(-abs(p.y - (n - 0.5)*0.6)*40.0) + exp(-abs(p.y - (fbm(p*5.0 + 9.0 - t*2.5) - 0.5)*0.6)*50.0)*0.7;
    float flick = 0.7 + 0.3*hash1(floor(t*20.0));
    return vec4(B*0.05 + (A + vec3(0.5))*arc*flick, 1.0);
  }
  // 71: Ventanas (fachada que se enciende)
  vec2 q = vec2(uv.x*u_aspect*4.0*s, uv.y*6.0*s);
  vec2 id = floor(q), f = fract(q);
  float win = step(0.15, f.x)*step(f.x, 0.85)*step(0.2, f.y)*step(f.y, 0.85);
  float on = step(0.45, hash(id + floor(t*0.5 + hash(id)*3.0)));
  float flick = 0.85 + 0.15*sin(t*7.0 + hash(id)*30.0);
  return vec4(mix(B*0.15, mix(A, vec3(1.0, 0.85, 0.5), 0.3)*flick, win*on) + B*0.05*(1.0 - win), 1.0);
}

// ---- Animaciones virales (72+) ----
vec4 generator4(vec2 uv, vec2 p, float t){
  float s = u_gscale;
  vec3 A = u_c1, B = u_c2;
  float r = length(p), a = atan(p.y, p.x);
  float bt = u_beat;
  if(u_gen==72){ // Hipnosis
    float v = fract(a/TAU*2.0 + log(r + 0.001)*1.6*s - t*0.6);
    float k = smoothstep(0.45, 0.55, v) - smoothstep(0.95, 1.0, v);
    return vec4(mix(B, A, k)*(0.85 + 0.3*bt), 1.0);
  }
  if(u_gen==73){ // Hiperespacio
    vec3 c = B*0.05;
    for(int l=0;l<3;l++){
      float fl = float(l);
      float cells = 90.0 + fl*40.0;
      float ac = a/TAU*cells;
      float id = floor(ac);
      float h = hash(vec2(id, fl*7.0));
      float z = fract(h*5.0 + t*(0.35 + fl*0.15)*(1.0 + bt));
      float rp = z*z*0.9;
      float len = 0.02 + z*0.25;
      float streak = smoothstep(len, 0.0, abs(r - rp)) * smoothstep(0.5, 0.15, abs(fract(ac) - 0.5)) * step(0.55, hash(vec2(id, fl + 3.0)));
      c += mix(A, vec3(1.0), z)*streak*z*1.6;
    }
    return vec4(c, 1.0);
  }
  if(u_gen==74){ // Agujero negro
    vec3 c = vec3(step(0.995, hash(floor(p*240.0))))*0.6*smoothstep(0.2, 0.5, r);
    float sw = a + 0.35/max(r, 0.02) - t*1.2;
    float disk = exp(-abs(r - 0.32*s)*10.0)*(0.55 + 0.45*sin(sw*5.0 + fbm(vec2(sw, r*8.0))*4.0));
    float ring = exp(-abs(r - 0.17*s)*60.0);
    c += mix(B, A, smoothstep(0.1, 0.5, r))*disk*1.5 + mix(A, vec3(1.0), 0.6)*ring;
    c *= smoothstep(0.13*s, 0.15*s, r);
    return vec4(c, 1.0);
  }
  if(u_gen==75){ // ADN
    float x = p.x*6.0*s + t*1.5;
    float y = p.y*2.6;
    float y1 = sin(x)*0.7, y2 = -y1;
    float d1 = abs(y - y1), d2 = abs(y - y2);
    float z1 = cos(x), w = 0.09;
    vec3 c = B*0.08;
    float rung = step(abs(fract(x/0.6) - 0.5), 0.08) * step(abs(y), abs(y1));
    c += mix(A, B, 0.5)*rung*0.7;
    c += A*smoothstep(w, 0.0, d1)*(0.6 + 0.4*z1) + B*smoothstep(w, 0.0, d2)*(0.6 - 0.4*z1);
    return vec4(c + A*exp(-min(d1, d2)*12.0)*0.25, 1.0);
  }
  if(u_gen==76){ // Fractal Julia
    vec2 z = p*2.6/s;
    vec2 c = vec2(-0.8 + 0.12*sin(t*0.21), 0.156 + 0.08*cos(t*0.17));
    float n = 0.0, m2 = 0.0;
    for(int i=0;i<64;i++){
      z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
      m2 = dot(z, z);
      if(m2 > 64.0) break;
      n += 1.0;
    }
    if(n >= 64.0) return vec4(B*0.15, 1.0);
    float sn = n - log2(log2(m2)) + 4.0;
    float k = clamp(sn/28.0, 0.0, 1.0);
    vec3 col = mix(B, A, k);
    col = mix(col, hsv2rgb(vec3(fract(sn*0.035 + t*0.05), 0.75, 1.0)), 0.35);
    return vec4(col*(0.25 + 1.1*k), 1.0);
  }
  if(u_gen==77){ // Metabolas (lámpara de lava)
    float f = 0.0;
    for(int i=0;i<6;i++){
      float fi = float(i);
      vec2 c = vec2(sin(t*0.4*(1.0 + fi*0.17) + fi*2.1)*0.45*u_aspect, sin(t*0.33*(1.0 + fi*0.11) + fi*1.3)*0.38);
      f += (0.018*s*s + bt*0.004)/max(dot(p - c, p - c), 0.0005);
    }
    float body = smoothstep(0.9, 1.1, f);
    return vec4(mix(B*0.15, mix(A, vec3(1.0), smoothstep(2.0, 6.0, f)*0.5), body) + A*0.15*smoothstep(0.4, 1.0, f)*(1.0 - body), 1.0);
  }
  if(u_gen==78){ // Metal líquido
    float n = fbm(p*2.2*s + vec2(t*0.15, -t*0.1));
    float m = fbm(p*2.2*s + n*2.0 + vec2(-t*0.12, t*0.08));
    float v = 0.5 + 0.5*sin(m*14.0 + t);
    float spec = pow(v, 6.0);
    return vec4(mix(B*0.25, mix(A, vec3(0.9), 0.6), v)*0.8 + vec3(spec), 1.0);
  }
  if(u_gen==79){ // Bola disco
    vec3 c = B*0.04;
    vec2 q = p*7.0*s + vec2(t*0.8, sin(t*0.3)*0.5);
    vec2 id = floor(q), f = fract(q) - 0.5;
    vec2 o = vec2(hash(id), hash(id + 9.0)) - 0.5;
    float spot = smoothstep(0.22, 0.0, length(f - o*0.5))*step(0.45, hash(id + 3.0));
    c += mix(A, hsv2rgb(vec3(hash(id + 5.0), 0.6, 1.0)), 0.5)*spot*(0.6 + 0.6*bt);
    float br = 0.2*s;
    if(r < br){
      vec2 fac = vec2(a*6.0/TAU*4.0 + t*0.6, r*30.0/s);
      float g = hash(floor(fac));
      float shade = sqrt(1.0 - (r/br)*(r/br));
      c = mix(vec3(0.15), vec3(0.95), g*0.6 + 0.2)*shade + A*step(0.93, g)*1.5;
    }
    return vec4(c, 1.0);
  }
  if(u_gen==80){ // Portal
    float sw = a + 4.0*r - t*2.0;
    float rim = exp(-abs(r - 0.3*s)*25.0)*(0.7 + 0.3*sin(sw*7.0));
    float inside = smoothstep(0.31*s, 0.28*s, r);
    float swirl = 0.5 + 0.5*sin(sw*5.0 + fbm(p*4.0 + t*0.4)*5.0);
    vec3 c = mix(B*0.02, mix(B, A, swirl)*0.7, inside) + mix(A, vec3(1.0), 0.4)*rim*1.6;
    c += A*fbm(vec2(a*3.0, r*10.0 - t*3.0))*exp(-abs(r - 0.3*s)*8.0)*0.4;
    return vec4(c, 1.0);
  }
  if(u_gen==81){ // Células neón (Voronoi)
    vec2 q = p*5.0*s;
    vec2 id = floor(q), f = fract(q);
    float d1 = 8.0, d2 = 8.0; vec2 best = vec2(0.0);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.4*sin(t*0.8 + TAU*vec2(hash(id + g), hash(id + g + 13.0)));
      float d = length(g + o - f);
      if(d < d1){ d2 = d1; d1 = d; best = id + g; } else if(d < d2) d2 = d;
    }
    float edge = smoothstep(0.06, 0.0, d2 - d1);
    return vec4(B*0.12*hash(best) + mix(A, B, hash(best))*edge*(1.0 + bt), 1.0);
  }
  if(u_gen==82){ // Logo rebotando (DVD)
    vec2 box = vec2(0.24, 0.14)*s;
    vec2 lim = vec2(u_aspect*0.5, 0.5) - box;
    float tx = t*0.11, ty = t*0.083;
    vec2 c = vec2((abs(fract(tx)*2.0 - 1.0)*2.0 - 1.0)*lim.x, (abs(fract(ty)*2.0 - 1.0)*2.0 - 1.0)*lim.y);
    float bounces = floor(tx*2.0) + floor(ty*2.0);
    vec3 col = hsv2rgb(vec3(fract(hash1(bounces)*0.7 + 0.1), 0.85, 1.0));
    vec2 d = abs(p - c) - box;
    float rr = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    float logo = smoothstep(0.012, 0.0, rr - 0.02);
    vec2 e = (p - c)/box;
    float disc = smoothstep(0.06, 0.0, abs(length(e*vec2(0.9, 2.2) + vec2(0.0, -0.45)) - 0.55));
    return vec4(B*0.04 + col*logo*(1.0 - 0.75*disc), 1.0);
  }
  if(u_gen==83){ // Osciloscopio (Lissajous)
    float d = 9.0;
    vec2 prev = vec2(0.0);
    for(int i=0;i<=80;i++){
      float u = float(i)/80.0*TAU;
      vec2 q = vec2(sin(3.0*u + t*0.7)*0.42*u_aspect, sin(4.0*u + t*0.5)*0.4)*s;
      if(i > 0){
        vec2 pa = p - prev, ba = q - prev;
        float h = clamp(dot(pa, ba)/max(dot(ba, ba), 1e-6), 0.0, 1.0);
        d = min(d, length(pa - ba*h));
      }
      prev = q;
    }
    return vec4(B*0.05 + A*(exp(-d*160.0)*1.3 + exp(-d*25.0)*0.35)*(1.0 + bt), 1.0);
  }
  if(u_gen==84){ // Ecualizador pixel
    float cols = 32.0*s, rows = 18.0*s;
    vec2 q = vec2(uv.x*cols, (1.0 - uv.y)*rows);
    vec2 id = floor(q), f = fract(q);
    float hgt = (0.45 + 0.3*sin(id.x*0.45 + t*3.0) + 0.2*sin(id.x*1.3 - t*4.7))*(0.7 + 0.6*max(u_lev.x, bt));
    float lit = step(id.y/rows, hgt)*step(0.12, f.x)*step(f.x, 0.88)*step(0.15, f.y)*step(f.y, 0.85);
    vec3 col = mix(A, B, id.y/rows);
    return vec4(mix(col*0.06, col, lit), 1.0);
  }
  if(u_gen==85){ // Glitch RGB
    float band = floor(uv.y*14.0);
    float g = step(0.6, hash(vec2(band, floor(t*7.0))))*(0.5 + bt);
    float off = (hash(vec2(band, floor(t*13.0))) - 0.5)*0.15*g;
    float ph = floor(uv.y*3.0)*0.33 + t*0.2;
    vec3 c = vec3(step(0.5, fract((uv.x - off*1.5)*4.0*s + ph)), step(0.5, fract(uv.x*4.0*s + ph)), step(0.5, fract((uv.x + off*1.5)*4.0*s + ph)));
    vec3 base = mix(B, A, (c.r + c.g + c.b)/3.0);
    return vec4(mix(base, c, g*0.8) + vec3(step(0.97, hash(vec2(floor(uv.y*200.0), floor(t*20.0)))))*0.4, 1.0);
  }
  if(u_gen==86){ // Caleidoscopio vivo
    float seg = TAU/8.0;
    float aa = abs(mod(a + t*0.2, seg) - seg*0.5);
    vec2 q = vec2(cos(aa), sin(aa))*r*3.0*s;
    float n = fbm(q + vec2(t*0.3, -t*0.2));
    float m = fbm(q*1.7 - n*2.0 + t*0.1);
    vec3 c = mix(B, A, smoothstep(0.3, 0.7, m));
    c = mix(c, hsv2rgb(vec3(fract(n + t*0.05), 0.7, 1.0)), 0.35);
    return vec4(c*(0.8 + 0.4*bt), 1.0);
  }
  if(u_gen==87){ // Carretera arcoíris
    vec3 c = mix(B*0.3, B*0.05, uv.y*2.0);
    c += vec3(step(0.996, hash(floor(p*200.0))))*step(p.y, 0.0);
    if(p.y > 0.02){
      float z = 0.25/p.y;
      float x = p.x*z;
      float road = step(abs(x), 1.0*s);
      vec3 rb = hsv2rgb(vec3(fract(x/(2.0*s) + 0.5), 0.9, 1.0));
      float dash = step(0.5, fract(z*0.5 - t*1.5));
      float edge = smoothstep(0.08, 0.0, abs(abs(x) - s));
      c = mix(c, rb*(0.6 + 0.4*dash), road) + A*edge;
      c *= smoothstep(0.0, 0.25, p.y) * 0.8 + 0.2;
    }
    return vec4(c, 1.0);
  }
  if(u_gen==88){ // Zoom infinito
    float ang = t*0.3;
    vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang))*p;
    float m = max(abs(q.x), abs(q.y));
    float k = log2(max(m, 0.0005))*2.0*s - t*0.8;
    float id = floor(k);
    float v = step(0.5, fract(k));
    vec3 c = mix(B, A, v)*(0.7 + 0.3*hash1(id));
    return vec4(c*smoothstep(0.0, 0.05, m), 1.0);
  }
  if(u_gen==89){ // Show de láseres
    vec2 o = vec2(0.0, 0.55);
    vec2 d = p - o;
    float ang = atan(d.x, -d.y);
    vec3 c = B*0.03 + A*0.05*fbm(p*3.0 + vec2(t*0.1, 0.0));
    for(int i=0;i<10;i++){
      float fi = float(i);
      float ai = (fi/9.0 - 0.5)*1.6*s + sin(t*0.9 + fi*0.7)*0.25;
      float w = abs(ang - ai);
      vec3 lc = mod(fi, 2.0) < 1.0 ? A : mix(A, B, 0.6);
      c += lc*(exp(-w*220.0) + exp(-w*30.0)*0.12)*(0.7 + 0.6*bt);
    }
    return vec4(c, 1.0);
  }
  if(u_gen==90){ // Visualizador circular
    float n = 64.0;
    float sa = (a/TAU + 0.5)*n;
    float id = floor(sa);
    float lv = 0.5 + 0.5*sin(id*0.7 + t*3.0)*sin(id*0.23 - t*1.7);
    float len = (0.04 + 0.2*lv)*(0.6 + 0.8*max(u_lev.x, bt))*s;
    float r0 = 0.2*s;
    float bar = step(r0, r)*step(r, r0 + len)*step(0.2, fract(sa))*step(fract(sa), 0.8);
    vec3 col = hsv2rgb(vec3(fract(id/n + t*0.05), 0.75, 1.0));
    col = mix(col, A, 0.4);
    float ring = exp(-abs(r - r0*0.85)*80.0);
    return vec4(B*0.05 + col*bar + A*ring*(0.6 + bt), 1.0);
  }
  // 91: Flujo de partículas
  vec3 c = B*0.06;
  for(int l=0;l<2;l++){
    float fl = float(l);
    vec2 q = p*(7.0 + fl*5.0)*s;
    q += vec2(fbm(q*0.2 + vec2(t*0.12, fl)), fbm(q*0.2 + vec2(5.0, -t*0.12)))*4.0;
    q.x += t*(1.0 + fl*0.6);
    vec2 id = floor(q), f = fract(q) - 0.5;
    vec2 o = (vec2(hash(id + 1.0), hash(id + 7.0)) - 0.5)*0.5;
    float pt = smoothstep(0.2, 0.0, length(f - o))*step(0.35, hash(id));
    c += mix(A, B + 0.3, hash(id + 2.0))*pt*(1.2 - fl*0.4)*(1.0 + bt);
  }
  return vec4(c, 1.0);
}

vec4 generator(vec2 uv, vec2 p, float t){
  if(u_gen >= 72) return generator4(uv, p, t);
  if(u_gen >= 47) return generator3(uv, p, t);
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

float glyph(float idx, vec2 f){ vec2 at = (vec2(mod(idx, 8.0), floor(idx / 8.0)) + clamp(f, 0.04, 0.96)) / 8.0; return texture(u_glyph, at).a; }
float bayer8(vec2 p){ // umbral ordenado 8×8 (0..1)
  vec2 q = mod(floor(p), 8.0); float v = 0.0, s = 1.0;
  for(int i = 0; i < 3; i++){ vec2 b = mod(floor(q / s), 2.0); v = v * 4.0 + (b.x * 2.0 + abs(b.x - b.y)); s *= 2.0; }
  return (v + 0.5) / 64.0;
}
/** Estilos tipo «Ladybug»: ASCII, texto, Matrix, semitonos, RISO, dither, Game Boy, térmica, trazo neón… */
vec3 stylize(int st, vec3 col, vec2 f, vec2 id, vec2 uv){
  float L = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  float glow = u_sty.z;
  vec3 tint = u_styCol;
  vec3 hueC = col / max(max(col.r, max(col.g, col.b)), 0.04);
  if(st == 1) return hueC * (0.35 + L) * glyph(floor(sqrt(L) * 11.99), f) * (1.2 + glow);                                   // ASCII a color
  if(st == 2) return vec3(glyph(floor(sqrt(L) * 11.99), f)) * (0.45 + L) * (1.1 + glow * 0.6);                // ASCII blanco
  if(st == 3){                                                                                          // Matrix
    float sp = 0.5 + hash(vec2(id.x, 3.0)) * 1.5;
    float head = fract(hash(vec2(id.x, 7.0)) - u_time * sp * 0.25 + id.y * 0.035);
    float g = glyph(22.0 + floor(hash(id + floor(u_time * (2.0 + hash(id.yx) * 6.0))) * 26.0), f);
    float k = g * (0.3 + sqrt(L) * 1.5) * (0.45 + 0.55 * pow(1.0 - head, 3.0));
    return tint * k + vec3(0.7, 1.0, 0.8) * g * step(0.97, 1.0 - head) * L;
  }
  if(st == 4){                                                                                          // campo de números
    float g = glyph(12.0 + floor(hash(id + floor(u_time * (1.0 + hash(id) * 3.0))) * 10.0), f);
    float on = smoothstep(0.18, 0.4, L);
    return tint * g * on * (0.6 + L) * (1.0 + glow) + tint * 0.05 * on;
  }
  if(st == 5) return mix(vec3(0.02, 0.0, 0.06), vec3(0.9, 0.85, 1.0), glyph(22.0 + floor(hash(id * 1.7) * 26.0), f) * smoothstep(0.08, 0.9, L)) * (1.0 + glow * 0.5);   // texto dither
  if(st == 6){                                                                                          // código de píxeles
    float h = hash(id * 3.1);
    if(h < L * 0.45) return col * (0.8 + glow * 0.4);
    return mix(col * 0.25, hueC * (0.5 + L), glyph(h < 0.6 ? 12.0 + floor(h * 16.0) : 22.0 + floor(h * 26.0), f));
  }
  vec2 q = f - 0.5;
  if(st == 7){                                                                                          // semitonos dorados
    float r = sqrt(L) * 0.55, d = length(q);
    float core = smoothstep(r, r - 0.12, d), halo = exp(-max(d - r, 0.0) * 14.0) * 0.35 * (0.5 + glow);
    return mix(vec3(1.0, 0.35, 0.02), vec3(1.0, 0.85, 0.45), L) * (core * 1.2 + halo * step(0.05, L));
  }
  if(st == 8){                                                                                          // RISO (dos tintas)
    float a = length(q) - sqrt(L) * 0.6, b = length(q - vec2(0.18, 0.12)) - sqrt(1.0 - L) * 0.32;
    vec3 paper = vec3(0.07, 0.03, 0.16);
    vec3 c2 = mix(paper, vec3(0.22, 0.35, 1.0), smoothstep(0.04, -0.04, a));
    c2 = mix(c2, vec3(0.92, 0.95, 1.0), smoothstep(0.04, -0.04, a + 0.18) * step(0.6, L));
    return mix(c2, vec3(1.0, 0.2, 0.35), smoothstep(0.04, -0.04, b) * 0.7) + (hash(uv * 900.0) - 0.5) * 0.06;
  }
  if(st == 9){                                                                                          // píldoras con texto
    vec2 b = abs(q) - vec2(0.42, 0.3); float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - 0.12;
    float fill = smoothstep(0.03, -0.03, d), edge = smoothstep(0.05, 0.0, abs(d));
    vec3 pc = mix(col, hueC, 0.4) * (0.55 + L * 0.7);
    float g = glyph(22.0 + floor(hash(id) * 26.0), vec2(fract(f.x * 2.4) , f.y));
    return mix(vec3(0.03), mix(pc, pc * 0.25, g * 0.8), fill) + edge * pc * 0.4;
  }
  if(st == 10){                                                                                         // rejilla de glifos
    float box = step(0.46, max(abs(q.x), abs(q.y)));
    float g = glyph(22.0 + floor(hash(id + floor(u_time * 0.5)) * 26.0), f);
    return hueC * (g * (0.3 + L) + box * 0.25 * L) * (1.0 + glow * 0.5);
  }
  if(st == 11) return mix(vec3(0.0), tint, step(bayer8(gl_FragCoord.xy / 2.0), L));                    // dither 1 bit
  if(st == 12){ float d = step(bayer8(gl_FragCoord.xy / 2.0), L); return tint * d * (0.7 + glow) + tint * L * 0.25 * glow; }   // dither con brillo
  if(st == 13){                                                                                         // píxel dither
    float s = 0.5 * smoothstep(0.05, 0.9, L);
    float sq = step(max(abs(q.x), abs(q.y)), s);
    return tint * sq * (0.55 + L) * (1.0 + glow * 0.5);
  }
  if(st == 14){                                                                                         // Game Boy
    float v = clamp(L + (bayer8(f * 8.0 + id * 8.0) - 0.5) * 0.25, 0.0, 0.999);
    int k = int(v * 4.0);
    return k == 0 ? vec3(0.06, 0.22, 0.06) : k == 1 ? vec3(0.19, 0.38, 0.19) : k == 2 ? vec3(0.55, 0.67, 0.06) : vec3(0.61, 0.74, 0.06);
  }
  if(st == 15) return L < 0.25 ? mix(vec3(0.0, 0.0, 0.25), vec3(0.4, 0.0, 0.6), L * 4.0) : L < 0.5 ? mix(vec3(0.4, 0.0, 0.6), vec3(0.95, 0.1, 0.2), L * 4.0 - 1.0) : L < 0.75 ? mix(vec3(0.95, 0.1, 0.2), vec3(1.0, 0.75, 0.0), L * 4.0 - 2.0) : mix(vec3(1.0, 0.75, 0.0), vec3(1.0), L * 4.0 - 3.0);   // térmica
  if(st == 16) return mix(mix(vec3(0.55, 0.85, 1.0), vec3(0.85, 0.65, 1.0), smoothstep(0.0, 0.45, L)), vec3(1.0, 0.72, 0.85), smoothstep(0.4, 0.9, L)) * (0.85 + 0.15 * L);   // térmica rosa
  if(st == 17){                                                                                         // trazo neón (bordes arcoíris)
    float e = clamp(fwidth(L) * 18.0, 0.0, 1.0);
    vec3 rb = hsv2rgb(vec3(fract(uv.x * 0.8 + uv.y * 0.4 + u_time * 0.15 + L), 0.85, 1.0));
    float dots = 0.75 + 0.25 * step(0.5, fract(gl_FragCoord.x / 3.0)) * step(0.5, fract(gl_FragCoord.y / 3.0));
    return (col * 0.22 + rb * e * (1.4 + glow)) * dots;
  }
  if(st == 18){                                                                                         // polvo de estrellas
    float h = hash(id + floor(u_time * 3.0 * (0.3 + hash(id))));
    float star = step(1.0 - L * 0.75, h) * exp(-length(q) * 9.0) * 2.2;
    float streak = smoothstep(0.08, 0.0, abs(q.y)) * smoothstep(0.5, -0.5, q.x) * L * 0.25;
    return mix(vec3(1.0, 0.75, 0.45), vec3(1.0), 0.3) * (star + streak) * (1.0 + glow) + col * 0.06;
  }
  return col;
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
  // ---- estilos por celdas (ASCII, semitonos, píxeles…): se muestrea el centro de cada celda ----
  int st = int(u_sty.x + 0.5);
  vec2 cellF = vec2(0.5), cellId = vec2(0.0);
  if(st > 0 && st != 11 && st != 12 && st != 15 && st != 16 && st != 17){
    float rows = max(u_sty.y, 4.0);
    float cw = (st <= 6 || st == 10) ? 0.62 : (st == 9 ? 2.4 : 1.0);   // letras más altas que anchas; píldoras alargadas
    vec2 n = vec2(rows * u_aspect / cw, rows);
    cellF = fract(cuv * n); cellId = floor(cuv * n);
    cuv = (cellId + 0.5) / n;
    gp = (cuv - 0.5) * vec2(u_aspect, 1.0);
  }
  // ---- fuente ----
  vec4 c = vec4(0.0);
  if(u_src==1) c = sampleTex(cuv);
  else if(u_src==2) c = vec4(u_c1, 1.0);
  else if(u_src==3) c = generator(fract(cuv), gp, u_gtime);
  else if(u_src==4){ // cuerpo: R = silueta con la animación, G = contorno, B = estela
    vec4 m = sampleTex(cuv);
    vec4 g = generator(fract(cuv), gp, u_gtime);
    vec3 trail = hsv2rgb(vec3(fract(m.b*0.9 + u_time*0.08), 0.75, 1.0));
    c = vec4(g.rgb*m.r + mix(g.rgb, u_c1, 0.5)*m.g*1.8 + trail*m.b*0.9, 1.0);
  }
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
    if(st > 0) c.rgb = stylize(st, c.rgb, cellF, cellId, uv);
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
  if(u_tr.x > 0.5){
    vec2 sp = (gl_FragCoord.xy - u_frame.xy) / max(u_frame.zw, vec2(1.0));
    float t, s = 0.03;
    if(u_tr.x < 1.5){ t = fract(sin(dot(floor((gl_FragCoord.xy - u_frame.xy) / 3.0), vec2(12.9898, 78.233))) * 43758.5453); s = 0.0; }
    else if(u_tr.x < 2.5) t = sp.x;
    else if(u_tr.x < 3.5) t = 1.0 - sp.y;
    else t = length((sp - 0.5) * vec2(u_frame.z / max(u_frame.w, 1.0), 1.0)) / length(vec2(0.5 * u_frame.z / max(u_frame.w, 1.0), 0.5));
    float p = u_tr.y * (1.0 + 2.0 * s) - s;
    float vis = 1.0 - smoothstep(p - s, p + s + 1e-5, t);
    c.a *= u_tr.z > 0.5 ? vis : 1.0 - vis;
  }
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  if(c.a <= 0.002) discard;
  outColor = vec4(c.rgb * c.a, c.a);   // alfa premultiplicado
}`;

const UNIFORMS = ["u_tex", "u_src", "u_fit", "u_contain", "u_gen", "u_c1", "u_c2", "u_gscale", "u_gtime",
  "u_aspect", "u_time", "u_alpha", "u_bri", "u_con", "u_sat", "u_hue", "u_rgb", "u_pix", "u_blur", "u_noise",
  "u_inv", "u_mirror", "u_kal", "u_wave", "u_zoom", "u_rot", "u_scroll", "u_border", "u_glow", "u_bcol",
  "u_banim", "u_beat", "u_lev", "u_d1", "u_d2", "u_c3", "u_c4", "u_c5", "u_duoA", "u_duoB", "u_key", "u_keyCol", "u_flip", "u_texel", "u_shape", "u_shapeN", "u_mask", "u_maskN", "u_maskInv", "u_maskFeather", "u_tr", "u_frame", "u_sty", "u_styCol", "u_glyph"];

/** 64 caracteres en una rejilla 8×8: rampa « .,:;-=+*#%@» (0-11), 0-9 (12-21), A-Z (22-47) y símbolos. */
function makeGlyphAtlas(gl) {
  const chars = " .,:;-=+*#%@0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/\\|()[]{}?!&$+x";
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  try {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.font = "bold 50px monospace";
    for (let i = 0; i < 64; i++) x.fillText(chars[i] || "", (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  } catch { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}

export function hexToRgb(hex) {
  const h = String(hex || "#ffffff").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6), 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

const MIRROR = { none: 0, h: 1, v: 2, quad: 3 };
export const COLORMAP = { none: 0, thermal: 1, night: 2, xray: 3, gold: 4, rainbow: 5, ice: 6 };
/** Estilos tipo «Ladybug» (efectos de imagen): [id, nombre, color por defecto]. El orden es el índice del shader. */
export const STYLES = [
  ["none", "Ninguno"], ["ascii", "ASCII a color"], ["asciiw", "ASCII blanco"], ["matrix", "Retro Matrix", "#39ff6a"],
  ["numeros", "Campo de números", "#3dffb0"], ["texto", "Texto dither"], ["pixelcode", "Código de píxeles"],
  ["oro", "Semitonos dorados"], ["riso", "RISO"], ["pildoras", "Píldoras con texto"], ["glifos", "Rejilla de glifos"],
  ["dither", "Dither 1 bit", "#ffffff"], ["ditherglow", "Dither con brillo", "#ff4fd8"], ["pixeldither", "Píxel dither", "#c6ff1a"],
  ["gameboy", "Game Boy"], ["termica", "Térmica"], ["termicarosa", "Térmica rosa"], ["trazo", "Trazo neón"], ["polvo", "Polvo de estrellas"],
];
export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s[0], i]));
const BANIM = { none: 0, chase: 1, pulse: 2, rainbow: 3 };

function compile(gl, type, src, check = true) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (check && !gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("Shader: " + gl.getShaderInfoLog(sh));
  return sh;
}

export function webgl2Supported() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

export class Renderer {
  /**
   * background: true → el sombreador (muy grande) se compila en segundo plano si la tarjeta
   * lo permite (KHR_parallel_shader_compile): la app no se congela; `ready` dice cuándo está.
   */
  constructor(canvas, { preserve = false, background = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: preserve });
    if (!gl) throw new Error("WebGL2 no disponible en este dispositivo");
    this.gl = gl;
    this.parallel = background ? gl.getExtension("KHR_parallel_shader_compile") : null;
    const prog = gl.createProgram();
    this.shaders = [compile(gl, gl.VERTEX_SHADER, VERT, !this.parallel), compile(gl, gl.FRAGMENT_SHADER, FRAG, !this.parallel)];
    for (const sh of this.shaders) gl.attachShader(prog, sh);
    gl.linkProgram(prog);
    this.prog = prog;
    this.ready = false;
    if (!this.parallel) this.finish();
  }
  /** ¿Terminó la compilación en segundo plano? (y entonces se prepara). Nunca bloquea. */
  poll() {
    if (this.ready) return true;
    if (!this.gl.getProgramParameter(this.prog, this.parallel.COMPLETION_STATUS_KHR)) return false;
    this.finish();
    return true;
  }
  finish() {
    const gl = this.gl, prog = this.prog;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const why = this.shaders.map(sh => gl.getShaderInfoLog(sh)).filter(Boolean).join(" ") || gl.getProgramInfoLog(prog);
      throw new Error("Link: " + why);
    }
    this.ready = true;
    gl.useProgram(prog);
    this.loc = {};
    for (const n of UNIFORMS) this.loc[n] = gl.getUniformLocation(prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Atlas de letras para los estilos ASCII / texto (unidad de textura 1).
    this.glyphTex = makeGlyphAtlas(gl);
    gl.uniform1i(this.loc.u_glyph, 1);
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
    if (clear) { gl.clearColor(...clear); gl.clear(gl.COLOR_BUFFER_BIT); }
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
    // Transiciones de escena con efecto: destello (flash) y glitch, máximos a mitad de la transición.
    const trK = o.tr ? Math.sin(Math.PI * o.tr.p) : 0;
    if (o.tr?.mode === "flash") bri *= 1 + trK * 5;
    const trGlitch = o.tr?.mode === "glitch" ? trK : 0;
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
    else if (src.type === "body" && o.tex) srcType = src.bodyMode === "persona" || PRO_MODE_IDS.has(src.bodyMode) ? 1 : 4;
    else if (o.tex) srcType = 1;
    if (srcType === 0 && border <= 0) return;

    gl.uniform1i(L.u_src, srcType);
    if (srcType === 1 || srcType === 4) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.tex.tex);
      gl.uniform1i(L.u_tex, 0);
      const ta = o.tex.w / Math.max(1, o.tex.h);
      // span = { a, b }: esta superficie muestra solo el trozo a..b (en horizontal) de una imagen
      // repartida entre varios proyectores (holograma ancho, pantallas unidas con bordes suaves).
      const sp = look.span, sw = sp ? Math.max(0.01, sp.b - sp.a) : 1, asp = aspect / sw;
      let sx = 1, sy = 1;
      if (look.fit === "cover") { if (ta > asp) sx = asp / ta; else sy = ta / asp; }
      else if (look.fit === "contain") { if (ta > asp) sy = ta / asp; else sx = asp / ta; }
      gl.uniform4f(L.u_fit, sx * sw, sy, sp ? sx * ((sp.a + sp.b) / 2 - 0.5) : 0, 0);
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
    gl.uniform1f(L.u_rgb, fx.rgbShift + trGlitch * 0.02);
    const TRM = { dissolve: 1, wipe: 2, wipeV: 3, iris: 4 }[o.tr?.mode] || 0;
    gl.uniform4f(L.u_tr, TRM, o.tr?.p || 0, o.tr?.role || 0, 0);
    const vw = o.frameRect || [0, 0, cw, ch];
    gl.uniform4f(L.u_frame, vw[0], vw[1], vw[2], vw[3]);
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
    gl.uniform4f(L.u_d2, fx.polar ? 1 : 0, Math.min(1, (fx.glitch || 0) + trGlitch), (fx.chroma || 0) + trGlitch * 0.03, fx.crt || 0);
    gl.uniform4f(L.u_c3, fx.posterize || 0, fx.sepia || 0, fx.gamma ?? 1, fx.threshold || 0);
    gl.uniform4f(L.u_c4, fx.vignette || 0, fx.scanlines || 0, fx.halftone || 0, COLORMAP[fx.colormap] || 0);
    gl.uniform4f(L.u_c5, fx.edges || 0, fx.sharpen || 0, fx.emboss || 0, fx.duotone || 0);
    gl.uniform3fv(L.u_duoA, hexToRgb(fx.duoA || "#1a0033"));
    gl.uniform3fv(L.u_duoB, hexToRgb(fx.duoB || "#00e5ff"));
    gl.uniform4f(L.u_key, fx.chromaKey || 0, fx.keySoft ?? 0.1, fx.lumaKey || 0, fx.lumaSoft ?? 0.05);
    gl.uniform3fv(L.u_keyCol, hexToRgb(fx.keyColor || "#00ff00"));
    gl.uniform2f(L.u_flip, fx.flipX ? 1 : 0, fx.flipY ? 1 : 0);
    const sti = STYLE_INDEX[fx.style] || 0;
    gl.uniform4f(L.u_sty, sti, 14 + (1 - (fx.styleSize ?? 0.5)) * 110, fx.styleGlow ?? 0.5, 0);
    gl.uniform3fv(L.u_styCol, hexToRgb(fx.styleColor || STYLES[sti]?.[2] || "#39ff6a"));
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
