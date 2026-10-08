# desktop/test-install.ps1 — prueba real del ciclo de vida en Windows (CI).
# Instalación limpia → abrir → actualizar con la app ABIERTA → rollback por fallo
# → volver a la versión anterior → reparar → desinstalar (conserva datos) →
# reinstalar. Cada paso comprueba el resultado; cualquier fallo detiene la prueba.
param([string]$Setup = (Get-ChildItem "$PSScriptRoot\dist\LumaMap-Setup*.exe" | Select-Object -First 1).FullName)
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "Programs\LumaMap"
$exe = Join-Path $dir "LumaMap.exe"
$data = Join-Path $env:APPDATA "LumaMap"
$result = Join-Path $env:TEMP "lumamap-update-result.json"
$updater = Join-Path $PSScriptRoot "updater.ps1"
function Step($t) { Write-Host "`n==== $t" -ForegroundColor Cyan }
function Fail($t) { throw "FALLO: $t" }
function Launch { $p = Start-Process -FilePath $exe -PassThru; Start-Sleep -Seconds 12; if ($p.HasExited) { Fail "LumaMap se cerró al arrancar (código $($p.ExitCode))" }; return $p }
function StopAll { Get-Process LumaMap -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2 }
function RunUpdater($extra) {
  Remove-Item $result -Force -ErrorAction SilentlyContinue
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $updater, "-InstallDir", $dir, "-ResultFile", $result, "-NoRelaunch") + $extra
  $p = Start-Process powershell.exe -ArgumentList $args -PassThru
  return $p
}
function ReadResult { if (-not (Test-Path $result)) { Fail "el actualizador no dejó resultado" }; return (Get-Content $result -Raw -Encoding UTF8 | ConvertFrom-Json) }
$ver = (Get-Item $Setup).VersionInfo.ProductVersion

Step "1. Instalación limpia ($Setup, versión $ver)"
Start-Process -Wait -FilePath $Setup -ArgumentList "/S"
if (-not (Test-Path $exe)) { Fail "no se instaló $exe" }
Write-Host "Instalado: $exe ($((Get-Item $exe).VersionInfo.ProductVersion))"

Step "2. Abrir y cerrar"
$p = Launch
if (-not (Test-Path $data)) { Fail "no se creó la carpeta de datos $data" }
Set-Content -Path (Join-Path $data "ci-marker.txt") -Value "datos del usuario"
$p.CloseMainWindow() | Out-Null; Start-Sleep -Seconds 4; StopAll

Step "3. Actualizar con la app ABIERTA (el actualizador espera a que se cierre)"
$app = Launch
$u = RunUpdater @("-AppPid", $app.Id, "-Installer", $Setup, "-Version", $ver, "-Mode", "update")
Start-Sleep -Seconds 5
if ($u.HasExited) { Fail "el actualizador no esperó a la app" }
$app.CloseMainWindow() | Out-Null          # la app se cierra (como al pulsar «Actualizar»)
$u.WaitForExit(240000) | Out-Null
$r = ReadResult
Write-Host ($r | ConvertTo-Json -Compress)
if (-not $r.ok -or $r.state -ne "updated") { Fail "la actualización no terminó bien" }
if (-not (Test-Path (Join-Path $env:LOCALAPPDATA "LumaMap-backup\previous\LumaMap.exe"))) { Fail "no hay copia de seguridad de la versión anterior" }
$p = Launch; StopAll

Step "4. Instalador defectuoso → ROLLBACK automático"
$bad = Join-Path $env:TEMP "instalador-roto.exe"
Copy-Item "$env:SystemRoot\System32\where.exe" $bad -Force     # termina con error
$u = RunUpdater @("-Installer", $bad, "-Version", "99.0.0", "-Mode", "update")
$u.WaitForExit(240000) | Out-Null
$r = ReadResult
Write-Host ($r | ConvertTo-Json -Compress)
if ($r.ok -or $r.state -ne "rolledBack") { Fail "no se hizo rollback" }
if (-not (Test-Path $exe)) { Fail "tras el rollback no existe el ejecutable" }
$p = Launch; StopAll

Step "5. Volver a la versión anterior (manual)"
$u = RunUpdater @("-Mode", "rollback")
$u.WaitForExit(240000) | Out-Null
$r = ReadResult
if ($r.state -ne "rolledBack") { Fail "no se pudo volver a la versión anterior" }
$p = Launch; StopAll

Step "6. Reparar (reinstalar encima)"
Start-Process -Wait -FilePath $Setup -ArgumentList "/S"
if (-not (Test-Path $exe)) { Fail "la reparación dejó la app sin ejecutable" }
$p = Launch; StopAll

Step "7. Desinstalar: se conservan los datos del usuario"
$un = Get-ChildItem $dir -Filter "Uninstall*.exe" | Select-Object -First 1
if (-not $un) { Fail "no hay desinstalador" }
Start-Process -Wait -FilePath $un.FullName -ArgumentList "/S"
Start-Sleep -Seconds 5
if (Test-Path $exe) { Fail "la app sigue instalada" }
if (-not (Test-Path (Join-Path $data "ci-marker.txt"))) { Fail "la desinstalación borró los datos del usuario" }

Step "8. Reinstalar: los datos siguen ahí"
Start-Process -Wait -FilePath $Setup -ArgumentList "/S"
$p = Launch; StopAll
if (-not (Test-Path (Join-Path $data "ci-marker.txt"))) { Fail "se perdieron los datos" }
Write-Host "`nTODO CORRECTO" -ForegroundColor Green
