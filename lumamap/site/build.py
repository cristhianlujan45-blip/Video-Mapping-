#!/usr/bin/env python3
"""Monta site/index.html a partir de template.html: la colección, los looks y el código de los
efectos en vivo (el comparador y la demo de «Escribe y se construye»)."""
import os, html
here = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(here, "template.html"), encoding="utf-8").read()
PL = '<span class="chip">WIN</span><span class="chip">MAC</span><span class="chip">ANDROID</span><span class="chip">WEB</span>'
CARDS = [
  ("cinta", "Cinta", "box-cinta", "VHS · CIRCUITO", "Color corrido, banda de tracking, cambio de cabezas y una señal que pierde la sincronía.", "#analogico"),
  ("pelicula", "Película", "box-pelicula", "COPIA DE CINE", "Siete caracteres de película, grano, halación, polvo, rayones y quemaduras.", "#analogico"),
  ("mosh", "Datamosh", "box-mosh", "TIEMPO ROTO", "Bloques que siguen el movimiento, slit-scan, ecos y fotogramas congelados al golpe.", "#analogico"),
  ("pantalla", "Pantallas", "box-pantalla", "TUBO · LED · LCD", "Rejilla de tubo, arcade, LCD y pared de LED, y la pantalla fotografiada con lente.", "#analogico"),
  ("nodos", "Nodos", "box-nodos", "ESCRIBE Y SE CONSTRUYE", "117 operadores como TouchDesigner. Describe lo que quieres y la red se arma sola.", "#construye"),
  ("agentes", "Agentes", "box-agente", "MCP", "Claude Code, Cursor o Claude Desktop manejan LumaMap y miran el resultado.", "#agentes"),
]
cards = []
for key, name, img, tag, desc, href in CARDS:
    cards.append(f'''<article class="card">
          <div class="media" style="--img:url(img/{img}.jpg)" aria-hidden="true"><div class="box"><i class="front" style="--img:url(img/{img}.jpg)"><span class="lm">LM</span><b>{html.escape(name.upper())}</b><em>{tag}</em></i><i class="side"><span>{html.escape(name.upper())}</span></i><i class="top"></i></div></div>
          <div class="body"><div class="t"><h3>{html.escape(name)}</h3><span class="price">Incluido</span></div><p>{html.escape(desc)}</p><div class="plats">{PL}</div><a class="pill" href="{href}">Ver {html.escape(name.lower())} ↗</a></div>
        </article>''')
TILES = [("tile-burn", "Quemaduras", "Película quemada"), ("tile-leak", "Fugas de luz", "Foto vintage desvaída"), ("tile-dust", "Polvo y rayones", "Blanco y negro de cine"),
         ("tile-vhs", "VHS y circuito", "TV sin sintonía"), ("tile-slit", "Slit-scan", "Slit-scan desde el centro"), ("tile-echo", "Ecos de movimiento", "Ecos + TV de puntos")]
tiles = [f'<div class="tile"><figure><div class="im" style="--img:url(img/{i}.jpg)" role="img" aria-label="{html.escape(a)}, hecho con LumaMap"></div><figcaption>{html.escape(a)}<span>{html.escape(b)}</span></figcaption></figure></div>' for i, a, b in TILES]
part = lambda f: open(os.path.join(here, f), encoding="utf-8").read()
t = t.replace("<!--CARDS-->", "\n        ".join(cards)).replace("<!--TILES-->", "\n        ".join(tiles))
t = t.replace("/*CMPSHADER*/", part("parts/cmp-shader.js")).replace("/*BUILDDEMO*/", part("parts/build-demo.js"))
open(os.path.join(here, "index.html"), "w", encoding="utf-8").write(t)
print("site/index.html", len(t) // 1024, "KB")
