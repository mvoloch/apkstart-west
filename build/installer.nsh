; ApkStart West custom NSIS script.

; Default install folder: %LOCALAPPDATA%\Programs\ApkStart West. Without this, the folder
; would follow the exe name and be "Programs\ApkStart", the same folder upstream ApkStart
; uses, so one install would overwrite the other. electron-builder reads InstallLocation
; from this key as the default folder; an existing value (a previous install, or a folder
; the user picked) is kept. The uninstaller deletes the key.
!macro preInit
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" 0 +2
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\ApkStart West"
!macroend

; Install: write the desktop and Start menu shortcuts a second time with NSIS's own
; CreateShortcut. On some PCs (desktop redirected to OneDrive, security software rolling
; shortcuts back) electron-builder's shortcut step fails silently. Same names as
; electron-builder's (shortcutName "ApkStart West"), so this only overwrites the same .lnk.
!macro customInstall
  DetailPrint "Creating shortcuts..."
  CreateShortcut "$DESKTOP\ApkStart West.lnk" "$INSTDIR\ApkStart.exe" "" "$INSTDIR\ApkStart.exe" 0 \
    SW_SHOWNORMAL "" "ApkStart West: run Android apps on Windows"
  CreateShortcut "$SMPROGRAMS\ApkStart West.lnk" "$INSTDIR\ApkStart.exe" "" "$INSTDIR\ApkStart.exe" 0 \
    SW_SHOWNORMAL "" "ApkStart West: run Android apps on Windows"
!macroend

; Uninstall: the Android emulator keeps running after the app window closes (so the next
; start is fast), and it locks files. Stop only processes that belong to this install:
; programs under the install folder or under this app's runtime folder
; (%APPDATA%\apkstart-west). Other copies of adb, emulator or qemu (Android Studio,
; upstream ApkStart) are left alone. nsExec runs PowerShell with no visible window.
!macro customUnInstall
  Delete "$DESKTOP\ApkStart West.lnk"
  Delete "$SMPROGRAMS\ApkStart West.lnk"

  DetailPrint "Stopping ApkStart West processes..."
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$roots = @('$INSTDIR\', '$APPDATA\apkstart-west\'); Get-CimInstance Win32_Process | Where-Object { $$p = $$_.ExecutablePath; $$p -and ($$roots | Where-Object { $$p.StartsWith($$_, [StringComparison]::OrdinalIgnoreCase) }) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Give the processes time to exit and release their file handles.
  Sleep 1500
!macroend
