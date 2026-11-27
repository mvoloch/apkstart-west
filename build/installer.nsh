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

; Closing a running app before install/uninstall. electron-builder's default check gives
; the app about 5 seconds and then, in silent mode, quits without doing anything: on the
; XPS test (27 Nov 2026) a silent uninstall with the app open closed the app window,
; left the Android emulator running on its own, and removed nothing. This version asks
; once (silent mode answers OK), then keeps stopping every process that runs from the
; install folder for up to 15 seconds, and says so if it still cannot.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if (Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', [StringComparison]::OrdinalIgnoreCase) }) { exit 0 } else { exit 1 }"`
  Pop $0
  ${if} $0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
    Quit
    DetailPrint "$(appClosing)"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "for ($$i = 0; $$i -lt 15; $$i++) { $$l = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR\', [StringComparison]::OrdinalIgnoreCase) }); if ($$l.Count -eq 0) { exit 0 }; $$l | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1 }; exit 1"`
    Pop $0
    ${if} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "$(appCannotBeClosed)" /SD IDOK
      Quit
    ${endIf}
  ${endIf}
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

; Uninstall.
; 1. The Android emulator keeps running after the app closes (so the next start is fast)
;    and it locks files. Stop only processes that belong to this install: programs under
;    the install folder or under this app's runtime folder (%APPDATA%\apkstart-west).
;    Also stop whatever adb server listens on port 5044, the adb port only this app uses:
;    on the XPS test an adb from another folder (on PATH) was serving that port with the
;    install folder as its working directory, which kept the empty folder from being deleted.
;    Other copies of adb, emulator or qemu (Android Studio, upstream ApkStart) are left alone.
; 2. On a real uninstall (not an update), remove the shortcuts the app created for Android
;    apps (desktop and Start menu "ApkStart" folder) whose target is this install's
;    ApkStart.exe; otherwise they would point at a program that no longer exists.
;    Shortcuts pointing anywhere else are not touched. User data in %APPDATA%\apkstart-west
;    (Android, installed apps) is kept.
; nsExec runs PowerShell with no visible window.
!macro customUnInstall
  Delete "$DESKTOP\ApkStart West.lnk"
  Delete "$SMPROGRAMS\ApkStart West.lnk"

  DetailPrint "Stopping ApkStart West processes..."
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$roots = @('$INSTDIR\', '$APPDATA\apkstart-west\'); for ($$i = 0; $$i -lt 15; $$i++) { $$ids = @(Get-CimInstance Win32_Process | Where-Object { $$p = $$_.ExecutablePath; $$p -and ($$roots | Where-Object { $$p.StartsWith($$_, [StringComparison]::OrdinalIgnoreCase) }) } | ForEach-Object { $$_.ProcessId }) + @(Get-NetTCPConnection -LocalPort 5044 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $$_.OwningProcess }) | Where-Object { $$_ -gt 4 } | Sort-Object -Unique; if ($$ids.Count -eq 0) { exit 0 }; $$ids | ForEach-Object { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1 }; exit 1"`
  Pop $0
  ; The processes are gone; give Windows a moment to release their handles on the folder
  ; (the emulator is started with the install folder as its working directory).
  Sleep 2000

  ${ifNot} ${isUpdated}
    DetailPrint "Removing shortcuts of Android apps..."
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$exe = '$INSTDIR\ApkStart.exe'; $$ws = New-Object -ComObject WScript.Shell; foreach ($$d in @('$DESKTOP', '$SMPROGRAMS\ApkStart')) { Get-ChildItem -LiteralPath $$d -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $$ws.CreateShortcut($$_.FullName).TargetPath -eq $$exe } | Remove-Item -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    ; Removes the folder only if it is now empty.
    RMDir "$SMPROGRAMS\ApkStart"
  ${endIf}
!macroend
