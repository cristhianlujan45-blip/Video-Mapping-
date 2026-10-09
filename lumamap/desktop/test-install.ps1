# desktop/test-install.ps1 — prueba real del ciclo de vida en Windows (CI).
# Instalación con el asistente (clics de verdad) → no reinstalar al reabrirlo → accesos
# directos que se recrean solos → instalación silenciosa → abrir → actualizar con la app ABIERTA → rollback por fallo
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
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "LumaMap.lnk"
$startLnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\LumaMap.lnk"

# ---- Clics de verdad en las ventanas (UI Automation), como un usuario ----
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
function Controls($procId, $type) {
  $byProc = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $procId)
  $byType = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)
  foreach ($w in $AE::RootElement.FindAll($Scope::Children, $byProc)) { foreach ($c in $w.FindAll($Scope::Descendants, $byType)) { $c } }
}
function Press($procId, [string[]]$names) {
  foreach ($b in (Controls $procId ([System.Windows.Automation.ControlType]::Button))) {
    $n = ($b.Current.Name -replace "&", "").Trim()
    foreach ($want in $names) {
      if ($n -like $want -and $b.Current.IsEnabled) { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return $n }
    }
  }
  return $null
}
function LinkTarget($f) { (New-Object -ComObject WScript.Shell).CreateShortcut($f).TargetPath }

Step "0. Instalar con el asistente (doble clic y «Siguiente», como un usuario)"
$wiz = Start-Process -FilePath $Setup -PassThru
$clicked = @(); $sawCheck = $false; $sawRadio = $false
$deadline = (Get-Date).AddMinutes(5)
while (-not $wiz.HasExited -and (Get-Date) -lt $deadline) {
  # La casilla del acceso directo tiene que salir, marcada; la pregunta «¿para quién?» ya no.
  foreach ($c in (Controls $wiz.Id ([System.Windows.Automation.ControlType]::CheckBox))) {
    if ($c.Current.Name -like "*acceso directo*escritorio*") {
      $sawCheck = $true
      $st = $c.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState
      if ("$st" -ne "On") { Fail "la casilla del acceso directo no viene marcada ($st)" }
    }
  }
  if (@(Controls $wiz.Id ([System.Windows.Automation.ControlType]::RadioButton)).Count -gt 0) { $sawRadio = $true }
  $c = Press $wiz.Id @("Terminar", "Finish", "Instalar", "Install", "Siguiente*", "Next*")
  if ($c) { $clicked += $c; Write-Host "  clic: $c" }
  Start-Sleep -Milliseconds 800
}
if (-not $wiz.HasExited) { $wiz.Kill(); Fail "el asistente no terminó (pulsado: $($clicked -join ', '))" }
Write-Host "Pulsado: $($clicked -join ' → ')"
if (-not $sawCheck) { Fail "no apareció la casilla «Crear un acceso directo en el escritorio»" }
if ($sawRadio) { Fail "sigue apareciendo la pregunta «¿para quién instalar?»" }
if (-not (Test-Path $exe)) { Fail "el asistente no instaló $exe" }
if (-not (Test-Path $lnk)) { Fail "el asistente no creó el acceso directo del escritorio ($lnk)" }
if ((LinkTarget $lnk) -ne $exe) { Fail "el acceso directo apunta a '$(LinkTarget $lnk)' en vez de a $exe" }
if (-not (Test-Path $startLnk)) { Fail "no está en el menú Inicio ($startLnk)" }
$reg = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" | ? { (Get-ItemProperty $_.PSPath).DisplayName -like "LumaMap*" }
if (-not $reg) { Fail "no aparece en «Aplicaciones instaladas» de Windows" }
# «Terminar» abre LumaMap (casilla «Ejecutar LumaMap»).
$t = 0; while (-not (Get-Process LumaMap -ErrorAction SilentlyContinue) -and $t -lt 30) { Start-Sleep 1; $t++ }
if (-not (Get-Process LumaMap -ErrorAction SilentlyContinue)) { Fail "al terminar no se abrió LumaMap" }
Write-Host "Instalado con el asistente: escritorio → $(LinkTarget $lnk), menú Inicio y Aplicaciones instaladas"
Start-Sleep -Seconds 6; StopAll

Step "0b. Abrir otra vez el MISMO instalador: no reinstala, ofrece abrir LumaMap"
$stamp = (Get-Item $exe).LastWriteTimeUtc
$again = Start-Process -FilePath $Setup -PassThru
$c = $null; $t = 0
while (-not $c -and -not $again.HasExited -and $t -lt 60) { Start-Sleep -Milliseconds 500; $c = Press $again.Id @("Sí", "Si", "Yes"); $t++ }
if (-not $c) { if (-not $again.HasExited) { $again.Kill() }; Fail "no salió el aviso «LumaMap ya está instalado»" }
if (-not $again.WaitForExit(20000)) { $again.Kill(); Fail "el instalador no se cerró tras elegir abrir LumaMap" }
$t = 0; while (-not (Get-Process LumaMap -ErrorAction SilentlyContinue) -and $t -lt 30) { Start-Sleep 1; $t++ }
if (-not (Get-Process LumaMap -ErrorAction SilentlyContinue)) { Fail "no se abrió LumaMap desde el aviso" }
if ((Get-Item $exe).LastWriteTimeUtc -ne $stamp) { Fail "se reinstaló aunque ya estaba instalado" }
StopAll

Step "0c. Si alguien borra el acceso directo, LumaMap lo vuelve a crear al abrirse"
Remove-Item $lnk, $startLnk -Force
$p = Launch
$t = 0; while (-not ((Test-Path $lnk) -and (Test-Path $startLnk)) -and $t -lt 30) { Start-Sleep 1; $t++ }
if (-not (Test-Path $lnk)) { Fail "LumaMap no recreó el acceso directo del escritorio" }
if (-not (Test-Path $startLnk)) { Fail "LumaMap no recreó el acceso del menú Inicio" }
if ((LinkTarget $lnk) -ne $exe) { Fail "el acceso directo recreado apunta a '$(LinkTarget $lnk)'" }
StopAll

Step "1. Instalación encima en silencio ($Setup, versión $ver)"
Start-Process -Wait -FilePath $Setup -ArgumentList "/S"
if (-not (Test-Path $exe)) { Fail "no se instaló $exe" }
Write-Host "Instalado: $exe ($((Get-Item $exe).VersionInfo.ProductVersion))"
if (-not (Test-Path $lnk)) { Fail "no se creó el acceso directo en el escritorio ($lnk)" }
Write-Host "Acceso directo: $lnk"

Step "2. Abrir y cerrar"
$p = Launch
if (-not (Test-Path $data)) { Fail "no se creó la carpeta de datos $data" }
Set-Content -Path (Join-Path $data "ci-marker.txt") -Value "datos del usuario"
$p.CloseMainWindow() | Out-Null; Start-Sleep -Seconds 4; StopAll

Step "2b. Instalar encima con la app ABIERTA (doble clic en el instalador): debe cerrarla sola"
$p = Launch
$kids = @(Get-CimInstance Win32_Process | ? { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir) }).Count
Write-Host "Procesos de LumaMap abiertos: $kids"
Remove-Item $lnk -Force -ErrorAction SilentlyContinue
$i = Start-Process -FilePath $Setup -ArgumentList "/S" -PassThru
if (-not $i.WaitForExit(120000)) { $i.Kill(); Fail "el instalador se quedó esperando con la app abierta" }
if ($i.ExitCode -ne 0) { Fail "el instalador terminó con código $($i.ExitCode) con la app abierta" }
if (-not (Test-Path $exe)) { Fail "la app quedó sin ejecutable" }
if (-not (Test-Path $lnk)) { Fail "al actualizar no se volvió a crear el acceso directo del escritorio" }
StopAll

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
