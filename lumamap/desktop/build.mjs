// Empaqueta LumaMap para escritorio.
//   node build.mjs --stage        prepara .stage/ (para `npm start`)
//   node build.mjs win32 x64      genera dist/LumaMap-Windows-x64.zip (portable, sin instalar)
// La app web (../web) se copia dentro: el escritorio usa exactamente el mismo código.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.join(here, ".stage");
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of ["main.js", "preload.js", "ai.js", "net.js", "optimize.js", "dmx-service.mjs", "remote-service.mjs", "updater.ps1"]) fs.copyFileSync(path.join(here, f), path.join(stage, f));
// ffmpeg para optimizar videos: se incluye su paquete (con el binario de esta plataforma).
fs.cpSync(path.join(here, "node_modules", "ffmpeg-static"), path.join(stage, "node_modules", "ffmpeg-static"), { recursive: true });
// SDK de Claude para el asistente (y lo que necesita al ejecutarse), sin tipos ni mapas de código.
for (const m of ["@anthropic-ai/sdk", "standardwebhooks", "@stablelib/base64", "fast-sha256"])
  fs.cpSync(path.join(here, "node_modules", m), path.join(stage, "node_modules", m), { recursive: true,
    filter: (src) => !/\.(map|d\.ts|d\.mts|d\.cts)$/.test(src) && !/[\\/]src([\\/]|$)/.test(path.relative(path.join(here, "node_modules", m), src)) });
// Compilando para Windows desde otro sistema: se descarga el ffmpeg.exe de Windows.
const targetPlatform = process.argv[2] === "installer" ? "win32" : (process.argv[2] || process.platform);
if (!process.argv.includes("--stage") && targetPlatform !== process.platform) {
  const dir = path.join(stage, "node_modules", "ffmpeg-static");
  for (const f of ["ffmpeg", "ffmpeg.exe"]) fs.rmSync(path.join(dir, f), { force: true });
  execFileSync(process.execPath, [path.join(dir, "install.js")], { cwd: dir, stdio: "inherit",
    env: { ...process.env, npm_config_platform: targetPlatform, npm_config_arch: "x64" } });
}
fs.cpSync(path.join(here, "..", "web"), path.join(stage, "web"), { recursive: true });
// Los servicios (Node) importan módulos de web/js: son ES modules.
fs.writeFileSync(path.join(stage, "web", "package.json"), JSON.stringify({ type: "module" }));
// Servidor del mando remoto y OSC (mismo código que la versión web).
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
for (const f of ["index.js", "osc.js", "tls.js"]) fs.copyFileSync(path.join(here, "..", "server", f), path.join(stage, "server", f));
fs.writeFileSync(path.join(stage, "server", "package.json"), JSON.stringify({ type: "module" }));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: "main.js", license: pkg.license, author: pkg.author,
  dependencies: { "ffmpeg-static": pkg.dependencies["ffmpeg-static"], "@anthropic-ai/sdk": pkg.dependencies["@anthropic-ai/sdk"] },
}, null, 2));
if (process.argv.includes("--stage")) process.exit(0);

// Instalador de Windows (.exe): doble clic, instala y crea accesos directos.
if (process.argv[2] === "installer") {
  const { build, Platform, Arch } = await import("electron-builder");
  const files = await build({
    targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
    projectDir: here,
    publish: "never",
    config: {
      appId: "com.lumamap.desktop",
      productName: "LumaMap",
      copyright: "MIT",
      directories: { app: stage, output: path.join(here, "dist") },
      electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ""),
      asar: true,
      asarUnpack: ["**/node_modules/ffmpeg-static/**"],   // el binario de ffmpeg debe poder ejecutarse
      npmRebuild: false,
      publish: null, // sin autoactualización: no se generan archivos de canal
      artifactName: "LumaMap-Setup.${ext}",   // nombre fijo: el enlace de descarga y el actualizador no cambian
      win: {
        icon: path.join(stage, "web", "icon.png"),
        // Sin certificado de firma: no se edita el .exe (evita depender de Wine al compilar en Linux).
        signAndEditExecutable: process.platform === "win32",
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: false,   // lo crea installer.nsh según la casilla «Crear acceso directo en el escritorio»
        createStartMenuShortcut: true,
        shortcutName: "LumaMap",
        runAfterFinish: true,
        installerLanguages: ["es_ES"],
        language: "3082",
        include: path.join(here, "build", "installer.nsh"),   // desinstalar conservando los datos (salvo que se pida)
        deleteAppDataOnUninstall: false,
      },
    },
  });
  console.log("Listo:", files.filter(f => f.endsWith(".exe")).join("\n"));
  process.exit(0);
}

const [platform = "win32", arch = "x64"] = process.argv.slice(2);
const { packager } = await import("@electron/packager");
const electronVersion = pkg.devDependencies.electron.replace(/^[^\d]*/, "");
const out = path.join(here, "dist");
const [appDir] = await packager({
  dir: stage, out, platform, arch, electronVersion, overwrite: true,
  name: "LumaMap", executableName: "LumaMap", appVersion: pkg.version,
  appCopyright: "MIT", prune: false, asar: { unpack: "**/node_modules/ffmpeg-static/**" },
});
const label = { win32: "Windows", darwin: "macOS", linux: "Linux" }[platform] || platform;
const zipFile = path.join(out, `LumaMap-${pkg.version}-${label}-${arch}.zip`);
fs.rmSync(zipFile, { force: true });
if (process.platform === "win32") {
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${appDir}\\*' -DestinationPath '${zipFile}'`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-qry", zipFile, "."], { cwd: appDir, stdio: "inherit" });
}
console.log("Listo:", zipFile);
