Bug fix release: ApkStart West now only ever uses its own adb.

## What changed

ApkStart West runs its own adb server on port 5044, apart from any other adb on the PC. Two things could still pick up another adb found on the Windows PATH (for example Android platform-tools installed with winget or Android Studio):

- When the adb connection stalled during boot, the app restarted the adb server with a bare `adb` command, so Windows started whichever adb came first on PATH as the server on port 5044.
- The Android Emulator also looked for adb on PATH.

While both adbs have the same version this goes unnoticed, but an adb of another version kills the running server and Android shows up as "offline". Now the app's own adb calls always use the runtime's adb, and the emulator gets a PATH without other folders that contain an `adb.exe`. Commit `f710ffa`.

If you already have v0.7.0, install this file over it. Android data in `%APPDATA%\apkstart-west` is kept.

## Download

| File | Size | SHA-256 |
|---|---|---|
| `ApkStart-0.7.1-Setup.exe` | 81,635,589 bytes (about 78 MiB) | `a199e1fde3f2586218a4cf4cf14ce9fbd3a0447c903466919d51d65daff67472` |

The same line is in `SHA256SUMS.txt`. To check the file in PowerShell:

```powershell
Get-FileHash .\ApkStart-0.7.1-Setup.exe -Algorithm SHA256
```

**The installer is not code-signed.** Windows SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**.

The installer works as in v0.7.0: it installs for your Windows user only, in `%LOCALAPPDATA%\Programs\ApkStart West`, with no administrator rights, and downloads the Android runtime from Google (`dl.google.com`) on first start.

## Tested

On a Windows 11 PC with winget platform-tools on PATH (27 Nov 2026): silent install of this build (the installed `ApkStart.exe` is byte-identical to the build's). The installed app booted Android, restarted the adb server once during boot, and reported the runtime ready in 46 s. The emulator log for that run shows no call to the winget adb, only to the runtime's own adb.

## Português

Versão de correção: o ApkStart West agora só usa o adb dele. Antes, ao reiniciar o servidor adb durante o boot, o app podia pegar outro adb instalado no PC (por exemplo pelo winget), e uma versão diferente deixaria o Android "offline". Quem tem a v0.7.0 pode instalar este arquivo por cima; os dados do Android em `%APPDATA%\apkstart-west` ficam. Baixe `ApkStart-0.7.1-Setup.exe` (81.635.589 bytes, uns 78 MiB). O instalador não tem assinatura digital: se o Windows avisar, clique em **Mais informações** e depois em **Executar assim mesmo**. Para conferir o arquivo, rode `Get-FileHash .\ApkStart-0.7.1-Setup.exe -Algorithm SHA256` no PowerShell e compare com a linha do `SHA256SUMS.txt`.
