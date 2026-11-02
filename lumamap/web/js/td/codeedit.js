// web/js/td/codeedit.js
// Editor de código del editor de redes (Python y GLSL): números de línea, colores, la línea del
// error marcada, sangría automática (Tab / Mayús+Tab, Enter después de «:» o «{»), comentar con
// Ctrl+/, aplicar con Ctrl+Enter y, en Python, avisa de los errores de escritura mientras escribes.
import { h, btn } from "../ui.js";
import { checkSyntax } from "./py.js";

const PY_KW = new Set("False None True and as assert break continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const PY_BI = new Set("print len range int float str bool list dict tuple set abs min max sum round enumerate zip sorted reversed any all map filter isinstance type math random op ops me absTime parent lumamap scriptOp self".split(" "));
const GL_KW = new Set("return if else for while break continue discard uniform in out inout const struct precision highp mediump lowp".split(" "));
const GL_TY = new Set("void bool int uint float vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 sampler2D".split(" "));
const GL_BI = new Set("sin cos tan asin acos atan pow exp log sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract texture uv time res tex0 tex1 tex2 tex3 px luma rot2 hsv2rgb rgb2hsv snoise fbm u1 u2 u3 u4 vUv vNormal vPos position normal light tex".split(" "));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** El código coloreado (HTML). */
export function highlight(code, lang) {
  const py = lang === "py";
  const re = py
    ? /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rfbRFB]?"(?:\\.|[^"\\\n])*"?|[rfbRFB]?'(?:\\.|[^'\\\n])*'?)|(#[^\n]*)|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b|\b0[xXbBoO][\da-fA-F_]+\b)|([A-Za-z_][A-Za-z0-9_]*)/g
    : /(\/\*[\s\S]*?(?:\*\/|$))|(\/\/[^\n]*)|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b|\.\d+\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [tok, str, com, num, word] = m;
    if (str !== undefined) out += `<span class="${py ? "cs" : "cc"}">${esc(tok)}</span>`;
    else if (com !== undefined) out += `<span class="cc">${esc(tok)}</span>`;
    else if (num !== undefined) out += `<span class="cn">${esc(tok)}</span>`;
    else if (word !== undefined) {
      const k = py ? (PY_KW.has(word) ? "ck" : PY_BI.has(word) ? "cb" : /^def$/.test(word) ? "ck" : "") : (GL_KW.has(word) ? "ck" : GL_TY.has(word) ? "ct" : GL_BI.has(word) ? "cb" : "");
      out += k ? `<span class="${k}">${esc(tok)}</span>` : esc(tok);
    }
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last)) + "\n";
}

/**
 * o: { value, lang: "py" | "glsl", onApply(code), hint?, rows?, tools?: [elementos extra en la barra] }
 * Devuelve el elemento; .getValue(), .setValue(code), .setError(texto|null) (si el texto tiene
 * «Línea N» o «0:N», se marca esa línea).
 */
export function codeEditor(o) {
  const lang = o.lang || "py", IND = lang === "py" ? "    " : "  ";
  const ta = h("textarea", { class: "tdce-ta", spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": o.label || "Código" });
  ta.value = o.value ?? "";
  const pre = h("pre", { class: "tdce-hl", "aria-hidden": "true" });
  const gut = h("div", { class: "tdce-gut", "aria-hidden": "true" });
  const box = h("div", { class: "tdce-box", style: { height: (o.rows || 14) * 18 + 12 + "px" } }, gut, h("div", { class: "tdce-scroll" }, pre, ta));
  const msg = h("div", { class: "tdce-msg" });
  const status = h("small", { class: "tdce-status" });
  const el = h("div", { class: `tdce lang-${lang}` }, box, msg,
    h("div", { class: "row tdce-bar" }, btn({ label: "Aplicar (Ctrl+Enter)", kind: "small primary", onClick: () => apply() }), ...(o.tools || []), status),
    o.hint ? h("small", { class: "tdce-hint" }, o.hint) : null);
  let errLine = 0, dirty = false, timer = 0;
  const paint = () => {
    pre.innerHTML = highlight(ta.value, lang);
    const n = ta.value.split("\n").length;
    if (gut.childElementCount !== n || errLine !== +gut.dataset.err) {
      gut.dataset.err = errLine;
      gut.replaceChildren(...Array.from({ length: n }, (_, k) => h("div", { class: k + 1 === errLine ? "err" : "" }, String(k + 1))));
    }
    sync();
  };
  const sync = () => { pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`; gut.style.transform = `translateY(${-ta.scrollTop}px)`; };
  const setError = (text) => {
    const m = text ? /L[ií]nea (\d+)|0:(\d+)/.exec(text) : null;
    let line = m ? +(m[1] || m[2]) : 0;
    // En GLSL la línea del error cuenta la cabecera que añade LumaMap: se ajusta si se sabe cuántas.
    if (m && m[2]) line = o.glslOffset ? Math.max(1, line - o.glslOffset()) : 0;
    errLine = text ? line : 0;
    msg.textContent = text || "";
    msg.classList.toggle("show", !!text);
    paint();
  };
  const apply = () => { dirty = false; status.textContent = ""; o.onApply?.(ta.value); };
  const lint = () => { if (lang !== "py") return; const e = checkSyntax(ta.value); setError(e || null); };
  ta.addEventListener("input", () => { dirty = true; status.textContent = "sin aplicar"; paint(); clearTimeout(timer); timer = setTimeout(lint, 350); });
  ta.addEventListener("scroll", sync);
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const lineStart = v.lastIndexOf("\n", a - 1) + 1;
    const replaceSel = (text, selA, selB) => { ta.setRangeText(text, a, b, "end"); if (selA !== undefined) { ta.selectionStart = selA; ta.selectionEnd = selB; } ta.dispatchEvent(new Event("input")); };
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      if (a === b && !e.shiftKey) { replaceSel(IND); return; }
      // Sangría de varias líneas (o quitarla con Mayús).
      const endPos = b > a && v[b - 1] === "\n" ? b - 1 : b, s0 = lineStart, s1 = v.indexOf("\n", endPos), end = s1 < 0 ? v.length : s1;
      const block = v.slice(s0, end).split("\n").map(l => e.shiftKey ? l.replace(new RegExp("^ {1," + IND.length + "}"), "") : IND + l).join("\n");
      ta.setRangeText(block, s0, end, "select");
      ta.dispatchEvent(new Event("input"));
      return;
    }
    if (e.key === "Enter") {
      // La sangría de la línea anterior (+1 nivel después de «:» o «{»).
      const cur = v.slice(lineStart, a), ind = /^\s*/.exec(cur)[0];
      const more = lang === "py" ? /:\s*(#.*)?$/.test(cur) : /\{\s*$/.test(cur);
      e.preventDefault();
      replaceSel("\n" + ind + (more ? IND : ""));
      return;
    }
    if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const mark = lang === "py" ? "# " : "// ";
      const s1 = v.indexOf("\n", b), end = s1 < 0 ? v.length : s1;
      const lines = v.slice(lineStart, end).split("\n");
      const all = lines.every(l => !l.trim() || l.trimStart().startsWith(mark.trim()));
      ta.setRangeText(lines.map(l => !l.trim() ? l : all ? l.replace(new RegExp("^(\\s*)" + mark.trim().replace(/\//g, "\\/") + " ?"), "$1") : l.replace(/^(\s*)/, "$1" + mark)).join("\n"), lineStart, end, "select");
      ta.dispatchEvent(new Event("input"));
    }
  });
  paint();
  if (lang === "py") setTimeout(lint, 0);
  el.getValue = () => ta.value;
  el.setValue = (code) => { ta.value = code; dirty = true; status.textContent = "sin aplicar"; paint(); lint(); };
  el.setError = setError;
  el.isDirty = () => dirty;
  el.focusCode = () => ta.focus();
  el.textarea = ta;
  return el;
}
