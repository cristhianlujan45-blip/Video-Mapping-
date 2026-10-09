; desktop/build/installer.nsh — personalización del instalador NSIS de LumaMap.

; ---- Cerrar LumaMap antes de instalar / actualizar / desinstalar ----
; Sustituye la comprobación estándar, que solo buscaba «LumaMap.exe» y a veces
; terminaba en «No se puede cerrar LumaMap»: también cierra los procesos
; auxiliares que usan archivos de la carpeta de instalación (servicio DMX, mando
; remoto, ventanas de salida, ffmpeg al optimizar videos) y espera a que suelten
; los archivos. Solo pregunta si de verdad no se puede (p. ej. LumaMap abierto
; como administrador): entonces explica qué hacer.
!macro customCheckAppRunning
  StrCpy $R1 0
  ${Do}
    DetailPrint "Cerrando LumaMap…"
    ; Árbol de procesos de LumaMap del usuario actual (forzado).
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
    Pop $0
    ; Cualquier otro proceso que se ejecute desde la carpeta de instalación.
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | ? { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase') } | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Sleep 700
    ; ¿Queda algo? (0 = sí)
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (@(Get-CimInstance Win32_Process | ? { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase') }).Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop $0
    ${If} $0 != 0
      ${Break}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 10
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "LumaMap sigue abierto y no se puede cerrar automáticamente (puede que se haya abierto como administrador).$\r$\n$\r$\nCiérralo desde el Administrador de tareas (Ctrl+Mayús+Esc → LumaMap → Finalizar tarea) o reinicia el equipo, y pulsa Reintentar." /SD IDCANCEL IDRETRY +2
      Quit
      StrCpy $R1 0
    ${EndIf}
    Sleep 1000
  ${Loop}
!macroend

; ---- Desinstalar ----
; Se conservan proyectos, medios y ajustes, salvo que el usuario elija borrarlos.
; En las actualizaciones (y en modo silencioso) nunca se borran.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también tus proyectos, medios y ajustes de LumaMap?$\r$\n$\r$\nSi eliges «No» se conservan y los recuperarás al volver a instalar." /SD IDNO IDNO keepData
      RMDir /r "$APPDATA\LumaMap"
      RMDir /r "$LOCALAPPDATA\LumaMap-backup"
      RMDir /r "$LOCALAPPDATA\LumaMap-updates"
    keepData:
  ${endIf}
!macroend
