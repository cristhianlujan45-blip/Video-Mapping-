// Compila el anfitrión de plugins FFGL (ffglhost) y los plugins FFGL de prueba.
//   node ffgl/build.mjs                 este sistema: Windows (MSVC, cl.exe) o Linux (g++)
//   node ffgl/build.mjs --target win32  desde Linux con MinGW (x86_64-w64-mingw32-g++), para revisar
//   node ffgl/build.mjs --host-only     solo el anfitrión (lo que se empaqueta con la app)
// Resultado en ffgl/bin/: ffglhost(.exe) y test/ con los plugins de prueba (.dll / .so).
// Los plugins de prueba NO se empaquetan: solo los usan las pruebas (tests/ffgl.test.js).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BIN = path.join(here, "bin");

/** Plugins de prueba: nombre de archivo → LUMA_KIND (ver testplugin.cpp). */
export const TEST_PLUGINS = { "lumatest-fuente": 0, "lumatest-efecto": 1, "lumatest-ffgl1": 2 };

function noCompiler(msg) { const e = new Error(msg); e.code = "NO_COMPILER"; return e; }
function has(cmd) { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } }

/** vcvars64.bat de Visual Studio (con las herramientas de C++), buscado con vswhere. */
function findVcvars() {
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = path.join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!fs.existsSync(vswhere)) return null;
  try {
    const out = execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).trim();
    const bat = out && path.join(out.split(/\r?\n/)[0], "VC", "Auxiliary", "Build", "vcvars64.bat");
    return bat && fs.existsSync(bat) ? bat : null;
  } catch { return null; }
}

/** Ejecuta varias órdenes de cl.exe en un cmd con el entorno de Visual Studio. */
function runMsvc(lines, log) {
  const vcvars = findVcvars();
  const inPath = (() => { try { execFileSync("where", ["cl.exe"], { stdio: "ignore" }); return true; } catch { return false; } })();
  if (!vcvars && !inPath) throw noCompiler("No se encontró Visual Studio con C++ (cl.exe). Instala «Build Tools for Visual Studio» con «Desarrollo para el escritorio con C++».");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lumamap-ffgl-"));
  const script = path.join(tmp, "build.cmd");
  fs.writeFileSync(script, ["@echo off", vcvars ? `call "${vcvars}" >nul || exit /b 1` : "", ...lines.map(l => `${l} || exit /b 1`)].join("\r\n") + "\r\n");
  try { execFileSync("cmd.exe", ["/d", "/c", script], { cwd: tmp, stdio: log ? "inherit" : "pipe", encoding: "utf8" }); }
  catch (e) { throw new Error("Error al compilar con MSVC:\n" + (e.stdout || "") + (e.stderr || "")); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Compila. Devuelve { host, plugins: { "lumatest-fuente": ruta, … } }.
 * Si no hay compilador lanza un error con code = "NO_COMPILER".
 */
export function buildFFGL({ out = BIN, target = process.platform, hostOnly = false, log = false, force = false } = {}) {
  const testDir = path.join(out, "test");
  fs.mkdirSync(testDir, { recursive: true });
  const src = (f) => path.join(here, f);
  const plugExt = target === "win32" ? ".dll" : ".so";
  const host = path.join(out, target === "win32" ? "ffglhost.exe" : "ffglhost");
  const plugins = hostOnly ? {} : Object.fromEntries(Object.keys(TEST_PLUGINS).map(n => [n, path.join(testDir, n + plugExt)]));
  // Ya compilado y más nuevo que el código: no se repite.
  const newest = Math.max(...["ffglhost.cpp", "testplugin.cpp", "ffgl_defs.h", "glmini.h", "build.mjs"].map(f => fs.statSync(src(f)).mtimeMs));
  const fresh = (f) => { try { return fs.statSync(f).mtimeMs > newest; } catch { return false; } };
  if (!force && [host, ...Object.values(plugins)].every(fresh)) return { host, plugins, cached: true };

  if (target === "win32" && process.platform === "win32") {
    // MSVC: CRT estático (/MT) para no depender del «Visual C++ Redistributable».
    const obj = path.join(os.tmpdir(), "lumamap-ffgl-obj-" + process.pid);
    fs.mkdirSync(obj, { recursive: true });
    const common = `cl /nologo /utf-8 /O2 /EHsc /std:c++17 /MT /W3 /D_CRT_SECURE_NO_WARNINGS /Fo"${obj}\\\\"`;
    const lines = [`${common} /Fe"${host}" "${src("ffglhost.cpp")}" user32.lib gdi32.lib opengl32.lib`];
    for (const [n, k] of Object.entries(TEST_PLUGINS)) if (!hostOnly) lines.push(`${common} /LD /DLUMA_KIND=${k} /Fe"${plugins[n]}" "${src("testplugin.cpp")}" opengl32.lib`);
    let msvcErr = null;
    try { runMsvc(lines, log); } catch (e) { msvcErr = e; } finally { fs.rmSync(obj, { recursive: true, force: true }); }
    for (const f of fs.readdirSync(testDir)) if (/\.(lib|exp|obj)$/i.test(f)) fs.rmSync(path.join(testDir, f), { force: true });
    if (!msvcErr) return { host, plugins };
    // Plan B: MinGW (g++) si está instalado (sin «Visual C++ Redistributable»: todo estático).
    if (!has(process.env.MINGW_CXX || "g++")) throw msvcErr;
    console.warn("Plugins FFGL: MSVC falló, se compila con MinGW:", msvcErr.message.split("\n")[0]);
  }
  if (target === "win32") {
    // MinGW: en Windows como plan B; desde Linux para revisar el código de Windows (y probarlo con Wine).
    const cxx = process.env.MINGW_CXX || (process.platform === "win32" ? "g++" : "x86_64-w64-mingw32-g++");
    if (!has(cxx)) throw noCompiler(`No está ${cxx} (MinGW)`);
    const flags = ["-std=c++17", "-O2", "-Wall", "-Wno-unused-variable", "-Wno-unused-function", "-static", "-static-libgcc", "-static-libstdc++"];
    execFileSync(cxx, [...flags, "-o", host, src("ffglhost.cpp"), "-luser32", "-lgdi32", "-lopengl32"], { stdio: "inherit" });
    for (const [n, k] of Object.entries(TEST_PLUGINS)) if (!hostOnly)
      execFileSync(cxx, [...flags, "-shared", `-DLUMA_KIND=${k}`, "-o", plugins[n], src("testplugin.cpp"), "-lopengl32"], { stdio: "inherit" });
  } else if (target === "linux") {
    const cxx = process.env.CXX || "g++";
    if (!has(cxx)) throw noCompiler(`No hay compilador de C++ (${cxx})`);
    const flags = ["-std=c++17", "-O2", "-Wall", "-Wno-unused-variable", "-Wno-unused-function"];
    try {
      execFileSync(cxx, [...flags, "-o", host, src("ffglhost.cpp"), "-ldl"], { stdio: log ? "inherit" : "pipe" });
      for (const [n, k] of Object.entries(TEST_PLUGINS)) if (!hostOnly)
        execFileSync(cxx, [...flags, "-fPIC", "-shared", "-fvisibility=hidden", `-DLUMA_KIND=${k}`, "-o", plugins[n], src("testplugin.cpp"), "-ldl"], { stdio: log ? "inherit" : "pipe" });
    } catch (e) { throw new Error("Error al compilar con g++:\n" + String(e.stderr || e.message)); }
  } else {
    throw noCompiler(`Plugins FFGL: sin anfitrión para ${target} (solo Windows; Linux para las pruebas)`);
  }
  return { host, plugins };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ti = process.argv.indexOf("--target");
  const target = ti > 0 ? process.argv[ti + 1] : process.platform;
  try {
    const r = buildFFGL({ target, hostOnly: process.argv.includes("--host-only"), log: true });
    console.log("Listo:", [r.host, ...Object.values(r.plugins)].join("\n       "));
  } catch (e) {
    console.error(e.message);
    process.exit(e.code === "NO_COMPILER" ? 2 : 1);
  }
}
