    const U = glProgram(cgl, `
      uniform sampler2D tex; uniform float t, split; uniform int look; uniform vec2 res;
      float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
      vec3 S(vec2 q){ return texture2D(tex, vec2(q.x, 1.0 - q.y)).rgb; }
      vec3 aces(vec3 x){ return (x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14); }
      vec3 yiq(vec3 c){ return vec3(lum(c), dot(c, vec3(0.596,-0.274,-0.322)), dot(c, vec3(0.211,-0.523,0.312))); }
      vec3 rgbOf(vec3 y){ return vec3(y.x+0.956*y.y+0.621*y.z, y.x-0.272*y.y-0.647*y.z, y.x-1.106*y.y+1.703*y.z); }
      vec3 film(vec2 q, bool bw){
        float fr = floor(t*24.0);
        q += (vec2(hash(vec2(fr,1.0)), hash(vec2(2.0,fr))) - 0.5) * 0.0025;
        vec3 c = S(q);
        vec3 b = vec3(0.0); for (int i = 0; i < 8; i++) { float a = float(i)*0.785; b += S(q + vec2(cos(a),sin(a))*0.012); }
        float h = lum(max(b/8.0 - 0.55, 0.0)) * 2.6;
        c += vec3(1.0,0.3,0.1) * h * 0.7;
        vec3 f = clamp(aces(c)/0.8038, 0.0, 1.0);
        float l = lum(f);
        if (bw) f = vec3(clamp((l-0.5)*1.25+0.5, 0.0, 1.0)) * vec3(1.02,1.0,0.96);
        else f += vec3(0.03,0.0,-0.035)*smoothstep(0.45,1.0,l) + vec3(-0.02,0.006,0.03)*(1.0-smoothstep(0.0,0.4,l));
        f = f*0.95 + 0.03;
        f *= 1.0 + (hash(vec2(fr,3.7)) - 0.5) * 0.07;
        vec2 gq = floor(q*res/1.4); float n = hash(gq + fr*1.71) + hash(gq*1.3 + fr*2.33) - 1.0;
        f += n * (bw ? 0.12 : 0.07) * (1.0 - abs(l-0.5)*1.3);
        if (bw) { vec2 gg = q*vec2(48.0,27.0); if (hash(floor(gg)+fr) > 0.996) f = mix(f, vec3(0.04), smoothstep(0.12, 0.0, length(fract(gg)-0.5))); }
        return f;
      }
      vec3 vhs(vec2 q){
        float line = floor(q.y*240.0), fr = floor(t*24.0);
        float band = 1.0 - fract(t*0.07); float trk = 1.0 - smoothstep(0.0, 0.04, abs(q.y - band));
        q.x += (hash(vec2(line, floor(t*20.0))) - 0.5) * 0.002 + trk*(hash(vec2(line, fr))-0.5)*0.04 + smoothstep(0.965,1.0,q.y)*0.03;
        float yc = lum(S(q)), yb = 0.0; for (int i = -2; i <= 2; i++) yb += lum(S(q + vec2(float(i)*1.5/res.x, 0.0))) * 0.2;
        float Y = yb + (yc - yb) * 1.4;
        vec2 iq = vec2(0.0); float ws = 0.0;
        for (int i = 0; i < 10; i++) { float w = exp(-float(i)*0.3); iq += yiq(S(q - vec2(float(i)*2.5/res.x + 0.003, 0.0))).yz * w; ws += w; }
        vec3 c = rgbOf(vec3(Y, iq/ws*0.78));
        c += trk*0.3*hash(q*res + fract(t)*100.0) + (hash(q*res + fract(t*7.0)*100.0)-0.5)*0.07;
        c *= 0.9 + 0.1*sin(q.y*res.y*3.1416);
        return c;
      }
      vec3 tube(vec2 q){
        vec2 c = q - 0.5; c *= 1.0 + dot(c,c)*0.22; q = c + 0.5;
        if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec3(0.0);
        vec3 col = S(q), glow = vec3(0.0);
        for (int i = 0; i < 6; i++) { float a = float(i)*1.047; glow += S(q + vec2(cos(a),sin(a))*0.006); }
        float px = gl_FragCoord.x / 1.4; float k = mod(floor(px), 3.0);
        vec3 m = vec3(k==0.0, k==1.0, k==2.0) * (0.55 + 0.45*smoothstep(0.0,0.25,fract(px))*(1.0-smoothstep(0.75,1.0,fract(px))));
        col = col * mix(vec3(1.0), m*3.0, 0.6) + glow/6.0*0.18;
        col *= 0.85 + 0.15*sin(q.y*res.y*1.6);
        col *= 1.0 - dot(c,c)*1.4;
        return col;
      }
      vec3 led(vec2 q){
        vec2 cells = vec2(96.0, 54.0); vec2 id = floor(q*cells); vec3 c = S((id+0.5)/cells);
        float d = length(fract(q*cells) - 0.5);
        return c * (1.0 - smoothstep(0.26, 0.42, d)) * 1.6 * (1.15 - 0.15*hash(id));
      }
      vec3 bend(vec2 q){
        float ep = floor(t*0.6), fr = floor(t*24.0), seam = 1.0;
        if (hash(vec2(ep,2.0)) < 0.7) { q.y = fract(q.y + fract(t*0.35)); seam = smoothstep(0.0,0.035,q.y)*smoothstep(1.0,0.985,q.y); }
        float bid = floor(q.y*14.0 + hash(vec2(fr,1.0))*3.0);
        if (hash(vec2(bid, floor(t*7.0))) > 0.68) q.x += (hash(vec2(bid,fr)) - 0.5)*0.18;
        vec3 c = S(q);
        float bb = hash(vec2(floor(q.y*6.0 + t*2.0), floor(t*4.0)));
        if (bb > 0.75) c = bb > 0.93 ? 1.0 - c : c.brg;
        c = clamp(mix(vec3(lum(c)), c, 1.6), 0.0, 1.0) + sin((q.x*3.0 + q.y*45.0 + t*9.0)*6.2831)*0.04;
        return c * seam;
      }
      void main(){
        vec2 q = uv;
        vec3 c;
        if (q.x < split) c = S(q);
        else if (look == 1) c = film(q, false);
        else if (look == 2) c = vhs(q);
        else if (look == 3) c = tube(q);
        else if (look == 4) c = led(q);
        else if (look == 5) c = bend(q);
        else c = film(q, true);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`);