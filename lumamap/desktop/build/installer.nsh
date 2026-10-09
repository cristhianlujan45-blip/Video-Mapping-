; desktop/build/installer.nsh — personalización del instalador NSIS de LumaMap.

!include "nsDialogs.nsh"

; ---- ¿Ya está instalado? ----
; Si vuelves a abrir LumaMap-Setup.exe con la MISMA versión ya instalada, no hace
; falta reinstalar: se ofrece abrir LumaMap directamente (o reparar si lo prefieres).
; En modo silencioso (actualizaciones, reparar) no pregunta nada.
!macro customInit
  ${IfNot} ${Silent}
    StrCpy $R8 ""
    ReadRegStr $R9 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $R9 == ""
      ReadRegStr $R9 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
      ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${EndIf}
    ${If} $R9 == "${VERSION}"
    ${AndIf} $R8 != ""
    ${AndIf} ${FileExists} "$R8\${APP_EXECUTABLE_FILENAME}"
      MessageBox MB_YESNO|MB_ICONINFORMATION "LumaMap ${VERSION} ya está instalado en este equipo.$\r$\n$\r$\nNo hace falta volver a instalarlo: a partir de ahora ábrelo desde su icono del escritorio o del menú Inicio.$\r$\n$\r$\n¿Abrir LumaMap ahora?$\r$\n(«No» lo reinstala, por si quieres repararlo.)" IDNO lumaReinstall
        Exec '"$R8\${APP_EXECUTABLE_FILENAME}"'
        Quit
      lumaReinstall:
    ${EndIf}
  ${EndIf}
!macroend

; ---- Acceso directo en el escritorio (a elegir) ----
!ifndef BUILD_UNINSTALLER
  Var LumaDeskChk
  Var LumaDesk
  Function LumaShortcutPage
    ; Por defecto marcado; si ya se eligió antes, se recuerda.
    ReadRegStr $LumaDesk HKCU "Software\LumaMap" "DesktopShortcut"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 36u "LumaMap queda instalado en tu equipo de forma permanente (como cualquier programa). Después ábrelo desde su icono: no hace falta volver a usar este instalador."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 14u "Crear un acceso directo en el escritorio"
    Pop $LumaDeskChk
    ${If} $LumaDesk != "0"
      ${NSD_Check} $LumaDeskChk
    ${EndIf}
    ${NSD_CreateLabel} 0 66u 100% 24u "También aparecerá en el menú Inicio y en «Aplicaciones instaladas» de Windows."
    Pop $0
    nsDialogs::Show
  FunctionEnd
  Function LumaShortcutLeave
    ${NSD_GetState} $LumaDeskChk $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $LumaDesk "1"
    ${Else}
      StrCpy $LumaDesk "0"
    ${EndIf}
  FunctionEnd
!endif

!macro customPageAfterChangeDir
  Page custom LumaShortcutPage LumaShortcutLeave
!macroend

; Tras copiar los archivos: el acceso directo según lo elegido. En las actualizaciones
; y reparaciones (silenciosas) se respeta la elección anterior (por defecto: sí).
!macro customInstall
  ${If} ${Silent}
    ReadRegStr $LumaDesk HKCU "Software\LumaMap" "DesktopShortcut"
  ${EndIf}
  ${If} $LumaDesk == "0"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${Else}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    StrCpy $LumaDesk "1"
  ${EndIf}
  WriteRegStr HKCU "Software\LumaMap" "DesktopShortcut" "$LumaDesk"
!macroend

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
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también tus proyectos, medios y ajustes de LumaMap?$\r$\n$\r$\nSi eliges «No» se conservan y los recuperarás al volver a instalar." /SD IDNO IDNO keepData
      RMDir /r "$APPDATA\LumaMap"
      RMDir /r "$LOCALAPPDATA\LumaMap-backup"
      RMDir /r "$LOCALAPPDATA\LumaMap-updates"
    keepData:
  ${endIf}
!macroend
