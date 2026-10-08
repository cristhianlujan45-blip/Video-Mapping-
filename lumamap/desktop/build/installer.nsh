; desktop/build/installer.nsh — personalización del instalador NSIS de LumaMap.
; Al desinstalar se conservan proyectos, medios y ajustes, salvo que el usuario
; elija borrarlos. En las actualizaciones (y en modo silencioso) nunca se borran.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también tus proyectos, medios y ajustes de LumaMap?$\r$\n$\r$\nSi eliges «No» se conservan y los recuperarás al volver a instalar." /SD IDNO IDNO keepData
      RMDir /r "$APPDATA\LumaMap"
      RMDir /r "$LOCALAPPDATA\LumaMap-backup"
      RMDir /r "$LOCALAPPDATA\LumaMap-updates"
    keepData:
  ${endIf}
!macroend
