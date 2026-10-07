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
fs.copyFileSync(path.join(here, "main.js"), path.join(stage, "main.js"));
fs.cpSync(path.join(here, "..", "web"), path.join(stage, "web"), { recursive: true });
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: "main.js", license: pkg.license, author: pkg.author,
}, null, 2));
if (process.argv.includes("--stage")) process.exit(0);

const [platform = "win32", arch = "x64"] = process.argv.slice(2);
const { packager } = await import("@electron/packager");
const electronVersion = pkg.devDependencies.electron.replace(/^[^\d]*/, "");
const out = path.join(here, "dist");
const [appDir] = await packager({
  dir: stage, out, platform, arch, electronVersion, overwrite: true, asar: true,
  name: "LumaMap", executableName: "LumaMap", appVersion: pkg.version,
  appCopyright: "MIT", prune: false,
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
