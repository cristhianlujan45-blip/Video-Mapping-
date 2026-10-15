# desktop/updater.ps1
# Actualizador independiente de LumaMap para Windows. Lo lanza la app justo antes
# de cerrarse (ya guardó el proyecto y liberó cámaras, MIDI, DMX, GPU y
# exportaciones). Como es un proceso aparte, nunca intenta reemplazar archivos
# que la app tiene en uso.
#
#   1. Espera a que LumaMap (y sus procesos auxiliares) se cierren.
#   2. Copia de seguridad de la instalación actual.
#   3. Ejecuta el instalador nuevo en silencio.
#   4. Verifica: el ejecutable existe y tiene la versión esperada.
#   5. Si algo falla: ROLLBACK (restaura la copia) y lo anota.
#   6. Vuelve a abrir LumaMap.
# Modo -Mode rollback: restaura la última copia de seguridad (volver a la versión anterior).
param(
  [int]$AppPid = 0,
  [string]$Installer = "",
  [string]$InstallDir = "",
  [string]$Exe = "LumaMap.exe",
  [string]$Version = "",
  [string]$ResultFile = "",
  [string]$BackupRoot = "",
  [ValidateSet("update", "rollback", "repair")][string]$Mode = "update",
  [switch]$NoRelaunch
)
$ErrorActionPreference = "Stop"
if (-not $BackupRoot) { $BackupRoot = Join-Path $env:LOCALAPPDATA "LumaMap-backup" }
$LogFile = Join-Path $BackupRoot "updater.log"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

function Log($msg) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}
function Result($ok, $state, $msg) {
  if (-not $ResultFile) { return }
  $o = [ordered]@{ ok = $ok; state = $state; message = $msg; version = $Version; mode = $Mode; at = (Get-Date).ToString("o") }
  ($o | ConvertTo-Json -Compress) | Set-Content -Path $ResultFile -Encoding UTF8
}
function ExePath { Join-Path $InstallDir $Exe }
function InstalledVersion {
  $p = ExePath
  if (-not (Test-Path $p)) { return $null }
  return (Get-Item $p).VersionInfo.ProductVersion
}
function StopLeftovers {
  # Procesos que sigan ejecutándose desde la carpeta de instalación (salidas, servicios…)
  Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
    Log "Cerrando proceso que quedó abierto: $($_.ProcessName) ($($_.Id))"
    try { $_.Kill(); $_.WaitForExit(5000) | Out-Null } catch {}
  }
}
function Relaunch {
  if ($NoRelaunch) { return }
  $p = ExePath
  if (Test-Path $p) { Start-Process -FilePath $p -WorkingDirectory $InstallDir | Out-Null; Log "LumaMap abierto de nuevo" }
}

try {
  Log "==== $Mode → versión '$Version' · instalación: $InstallDir"
  if (-not $InstallDir -or -not (Test-Path $InstallDir)) { throw "No se encuentra la carpeta de instalación '$InstallDir'" }

  # 1) Esperar a que la app se cierre (hasta 60 s); después, cerrar lo que quede.
  if ($AppPid -gt 0) {
    try { $p = Get-Process -Id $AppPid -ErrorAction Stop; if (-not $p.WaitForExit(60000)) { Log "La app no se cerró en 60 s: se cierra" ; $p.Kill() } } catch { }
  }
  Start-Sleep -Milliseconds 500
  StopLeftovers

  $backup = Join-Path $BackupRoot "previous"
  if ($Mode -eq "rollback") {
    if (-not (Test-Path (Join-Path $backup $Exe))) { throw "No hay una versión anterior guardada" }
    Log "Restaurando la versión anterior desde $backup"
    Remove-Item -Recurse -Force (Join-Path $InstallDir "*") -ErrorAction SilentlyContinue
    Copy-Item -Recurse -Force (Join-Path $backup "*") $InstallDir
    Result $true "rolledBack" "Se restauró la versión anterior ($(InstalledVersion))"
    Relaunch
    exit 0
  }

  if (-not (Test-Path $Installer)) { throw "No se encuentra el instalador '$Installer'" }

  # 2) Copia de seguridad de la instalación actual (se guarda una: la anterior).
  $before = InstalledVersion
  $tmp = Join-Path $BackupRoot "incoming"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Copy-Item -Recurse -Force $InstallDir $tmp
  Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
  Rename-Item $tmp "previous"
  Log "Copia de seguridad de la versión $before en $backup"

  # 3) Instalar en silencio (NSIS: /S; /D= carpeta de destino, al final y sin comillas aunque tenga espacios).
  $proc = Start-Process -FilePath $Installer -ArgumentList "/S /D=$InstallDir" -PassThru -Wait
  Log "Instalador terminado con código $($proc.ExitCode)"

  # 4) Verificar
  Start-Sleep -Milliseconds 800
  $after = InstalledVersion
  $okExe = Test-Path (ExePath)
  $okVer = (-not $Version) -or ($after -and $after.StartsWith($Version.Split("-")[0]))
  if ($proc.ExitCode -ne 0 -or -not $okExe -or -not $okVer) {
    throw "Verificación fallida (código $($proc.ExitCode), ejecutable: $okExe, versión instalada: '$after', esperada: '$Version')"
  }
  # Guardar el instalador para poder reparar sin internet.
  $cache = Join-Path $BackupRoot "installer"
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  Copy-Item -Force $Installer (Join-Path $cache "LumaMap-Setup.exe") -ErrorAction SilentlyContinue
  Log "Actualizado: $before → $after"
  Result $true "updated" "LumaMap $after instalado"
  Relaunch
  exit 0
}
catch {
  $err = $_.Exception.Message
  Log "ERROR: $err"
  # 5) ROLLBACK
  $backup = Join-Path $BackupRoot "previous"
  if ($Mode -ne "rollback" -and (Test-Path (Join-Path $backup $Exe))) {
    try {
      Log "Rollback: restaurando $backup"
      StopLeftovers
      Remove-Item -Recurse -Force (Join-Path $InstallDir "*") -ErrorAction SilentlyContinue
      Copy-Item -Recurse -Force (Join-Path $backup "*") $InstallDir
      Result $false "rolledBack" "La actualización falló y se restauró la versión anterior: $err"
    } catch {
      Log "ERROR en el rollback: $($_.Exception.Message)"
      Result $false "failed" "La actualización falló y no se pudo restaurar: $err"
    }
  } else {
    Result $false "failed" $err
  }
  Relaunch
  exit 1
}
