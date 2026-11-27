First release of ApkStart West: run Android apps on Windows as native programs, with no connection to servers in China. Based on [ApkStart](https://github.com/RoutineMiku/apkstart) by RoutineMiku (MIT).

## Download

| File | Size | SHA-256 |
|---|---|---|
| `ApkStart-0.7.0-Setup.exe` | 81,635,294 bytes (about 78 MiB) | `df5a84ac1e2c4774834b99c1eb7f3f15e4002827cee68140ea077ac120b9efac` |

The same line is in `SHA256SUMS.txt`. To check the file in PowerShell:

```powershell
Get-FileHash .\ApkStart-0.7.0-Setup.exe -Algorithm SHA256
```

**The installer is not code-signed.** Windows SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**.

## What the installer does

- Installs for your Windows user only, in `%LOCALAPPDATA%\Programs\ApkStart West`, with no administrator rights. It never touches an install of upstream ApkStart.
- Contains only this app and Electron. The Android runtime is downloaded from Google (`dl.google.com`) on first start: platform-tools (~8 MB), Android Emulator (~460 MB) and the Android 14 Google Play system image (~1.5 GB).
- Uninstall (Settings → Apps → ApkStart West) stops Android if it is running and removes the program, its shortcuts and the shortcuts it made for Android apps. Android data in `%APPDATA%\apkstart-west` is kept.

## Tested

On a Windows 11 PC (27 Nov 2026): install from this exact file, Android boot from the desktop shortcut, an APK installed through the app and opened in its own window, then uninstall with the app, Android and the Android app all running. The program folder, registry entry, shortcuts and processes were all gone afterwards.

## Português

Primeira versão do ApkStart West. Baixe `ApkStart-0.7.0-Setup.exe` (81.635.294 bytes, uns 78 MiB). O instalador não tem assinatura digital: se o Windows avisar, clique em **Mais informações** e depois em **Executar assim mesmo**. Para conferir o arquivo, rode `Get-FileHash .\ApkStart-0.7.0-Setup.exe -Algorithm SHA256` no PowerShell e compare com a linha do `SHA256SUMS.txt`. Na primeira execução o app baixa o Android do Google (`dl.google.com`), cerca de 2 GB.
