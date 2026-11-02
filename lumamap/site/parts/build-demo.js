  /* ---------------- Escribe y se construye: la red se arma sola ---------------- */
  const DEMOS = [
    { text: "colores que bailan con la música en caleidoscopio", src: "sin IA",
      nodes: [["Ruido", "TOP · imagen", "top", 0, 0], ["Caleidoscopio", "TOP · efecto", "top", 1, 0], ["Salida", "TOP · lo que se proyecta", "out", 2, 0], ["Audio", "CHOP · música", "chop", 1, 1]],
      wires: [[0, 1], [1, 2]], chop: [3, 1], say: "Construí: colores que se mueven, caleidoscopio, con la música. 4 nodos." },
    { text: "mi cámara con bordes de neón y estela", src: "sin IA",
      nodes: [["Cámara", "TOP · en vivo", "top", 0, 0], ["Bordes", "TOP · efecto", "top", 1, 0], ["Resplandor", "TOP · neón", "top", 2, 0], ["Salida", "TOP · con estela", "out", 3, 0], ["Feedback", "TOP · estela", "top", 2, 1]],
      wires: [[0, 1], [1, 2], [2, 3], [4, 3]], say: "Construí: tu cámara, bordes, resplandor neón, con estela. 8 nodos." },
    { text: "un cubo 3D que gira con ruido de colores al golpe", src: "IA local",
      nodes: [["Caja", "SOP · forma", "top", 0, 1], ["Ruido", "TOP · textura", "top", 0, 0], ["Objeto 3D", "COMP · gira", "top", 1, 1], ["Render 3D", "TOP · cámara y luz", "top", 2, 0], ["Salida", "TOP", "out", 3, 0], ["Ritmo", "CHOP · golpe", "chop", 2, 1]],
      wires: [[0, 2], [1, 2], [2, 3], [3, 4]], chop: [5, 2], say: "Construí: un cubo con colores que se mueven, al golpe. 9 nodos." },
  ];
  const typed = document.getElementById("typed"), graph = document.getElementById("graph"), wiresSvg = document.getElementById("wires"), sayEl = document.getElementById("say"), srcEl = document.getElementById("buildSrc");
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  function layout(demo) {
    graph.querySelectorAll(".node").forEach(n => n.remove()); wiresSvg.innerHTML = "";
    const W = graph.clientWidth, cols = Math.max(...demo.nodes.map(n => n[3])) + 1;
    const nw = Math.min(132, (W - 12 * (cols - 1)) / cols), gap = cols > 1 ? (W - nw * cols) / (cols - 1) : 0;
    const els = demo.nodes.map(([name, kind, cls, c, r]) => {
      const el = document.createElement("div"); el.className = "node " + cls; el.style.width = nw + "px";
      el.style.left = (c * (nw + gap)) + "px"; el.style.top = (r === 0 ? 20 : 130) + "px";
      el.innerHTML = `<small>${kind}</small>${name}`; graph.append(el); return el;
    });
    const pt = (el, side) => { const x = parseFloat(el.style.left) + (side ? el.offsetWidth : 0), y = parseFloat(el.style.top) + el.offsetHeight / 2; return [x, y]; };
    const path = (a, b, cls) => { const [x1, y1] = pt(els[a], 1), [x2, y2] = pt(els[b], 0); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); const mx = (x1 + x2) / 2; p.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`); p.setAttribute("class", "wire " + cls); wiresSvg.append(p); return p; };
    const ws = demo.wires.map(([a, b]) => ({ to: b, el: path(a, b, "") }));
    let chop = null;
    if (demo.chop) { const [a, b] = demo.chop; const [x1, y1] = [parseFloat(els[a].style.left) + els[a].offsetWidth / 2, parseFloat(els[a].style.top)]; const [x2, y2] = [parseFloat(els[b].style.left) + els[b].offsetWidth / 2, parseFloat(els[b].style.top) + els[b].offsetHeight]; const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", `M${x1},${y1} L${x2},${y2}`); p.setAttribute("class", "wire chop"); wiresSvg.append(p); chop = p; }
    return { els, ws, chop };
  }
  async function play(demo, instant) {
    srcEl.textContent = demo.src;
    sayEl.textContent = "";
    const g2 = layout(demo);
    if (instant) { typed.textContent = demo.text; g2.els.forEach(e => e.classList.add("on")); g2.ws.forEach(w => w.el.classList.add("on")); g2.chop?.classList.add("on"); sayEl.textContent = "✅ " + demo.say; return; }
    typed.textContent = "";
    for (const ch of demo.text) { typed.textContent += ch; await wait(38 + Math.random() * 40); }
    await wait(500);
    sayEl.textContent = "🔧 Construyendo…";
    for (let i = 0; i < g2.els.length; i++) {
      g2.els[i].classList.add("on");
      g2.ws.filter(w => w.to === i || g2.els.indexOf(g2.els[w.to]) <= i).forEach(w => { if (g2.els[w.to].classList.contains("on")) w.el.classList.add("on"); });
      await wait(420);
    }
    g2.ws.forEach(w => w.el.classList.add("on")); g2.chop?.classList.add("on");
    await wait(300);
    sayEl.textContent = "✅ " + demo.say;
  }
  const term = document.querySelector(".term");
  io?.observe(term);
  (async () => {
    if (reduce) { play(DEMOS[0], true); return; }
    for (let k = 0; ; k = (k + 1) % DEMOS.length) {
      while (!onScreen(term) || paused) await wait(400);
      await play(DEMOS[k], false);
      await wait(2600);
    }
  })();
  addEventListener("resize", () => { if (reduce) play(DEMOS[0], true); });

