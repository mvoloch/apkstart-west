# ApkStart West

<p align="center"><img src="docs/images/logo.png" alt="ApkStart West logo" width="140" /></p>

[![CI](https://github.com/mvoloch/apkstart-west/actions/workflows/ci.yml/badge.svg)](https://github.com/mvoloch/apkstart-west/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D6.svg)](#requirements)

**Run Android apps on Windows like native programs, with no connection to servers in China.**

*[Português abaixo](#português)*

ApkStart West is a fork of [ApkStart](https://github.com/RoutineMiku/apkstart) by RoutineMiku (MIT). It keeps everything that makes ApkStart useful and removes every path to a server in China:

- **Double-click an .apk to install it.** ApkStart parses the APK, installs it into its own Android runtime and creates a desktop and Start menu shortcut with the app's real icon.
- **Each app is its own window**, sized for portrait or landscape, with its own taskbar entry.
- **Google Play works.** The runtime is Google's official Android Emulator with the Android 14 Google Play system image, downloaded from `dl.google.com`.
- **Shared folder.** `%USERPROFILE%\ApkStartShared` on the PC syncs with `/sdcard/ApkStartShared` in Android.
- **English or Portuguese interface** (Settings → Basic → Interface language). Android itself starts in English (changeable) and uses the PC's time zone.

## What changed from upstream

| Upstream ApkStart | ApkStart West |
|---|---|
| Downloads and updates through Gitee (China) and GitHub proxies ghfast.top / gh-proxy.com | GitHub only; an optional mirror prefix is used only if you type one |
| Android DNS forced to 223.5.5.5 / 119.29.29.29 (Alibaba / Tencent) | Android uses your PC's DNS |
| Connectivity check pointed at Xiaomi (connect.rom.miui.com) | Android's default Google check (connectivitycheck.gstatic.com) |
| Android in Chinese, time zone Asia/Shanghai, Pinyin keyboard on | Android in English, PC time zone, Chinese keyboard optional and off |
| Updater could replace the app with upstream releases | Updater only looks at `mvoloch/apkstart-west`; separate data folder (`%APPDATA%\apkstart-west`), install id and taskbar identity, so it never touches an upstream install |
| WeChat / Douyin QR codes and links, Microsoft Store package of upstream | Removed |

The full audit, with every host the code can reach and a traffic capture of a real run, is in [docs/NO-CHINA.md](docs/NO-CHINA.md). A test (`test/no-china-test.js`, the first step of `npm test`) fails if any of the removed hosts or DNS servers comes back.

## Requirements

- Windows 10 or 11, x64, with virtualization enabled in the BIOS (Intel VT-x / AMD-V).
- Hardware acceleration: Windows "Virtual Machine Platform" (WHPX) or Google's AEHD driver. ApkStart West checks this and guides you.
- About 6 GB free disk space for the runtime and Android data.

## Download

Releases: [github.com/mvoloch/apkstart-west/releases](https://github.com/mvoloch/apkstart-west/releases). If there is no release yet, build from source (below).

On first start the app downloads the Android runtime from Google (`dl.google.com`): platform-tools (~8 MB), Android Emulator (~460 MB) and the Android 14 Google Play system image (~1.5 GB). Nothing is downloaded from anywhere else unless you set a custom address in Settings.

## Build from source

```powershell
git clone https://github.com/mvoloch/apkstart-west.git
cd apkstart-west
npm ci
npm start              # opens the app; first run deploys the runtime from dl.google.com
npm test               # unit and integration tests, no network needed
npm run pack           # portable build in dist\ApkStart-win64-portable\
npm run build:exe      # installer with the runtime bundled (needs `npm run runtime` data)
```

Node.js 20 or newer. With npm 11, if `node_modules\electron\dist\electron.exe` is missing after `npm ci`, run `node node_modules\electron\install.js`.

## Command line

```
ApkStart.exe                      open the main window
ApkStart.exe <path\to\app.apk>    install an APK
ApkStart.exe --launch <package>   start an installed app (used by the shortcuts)
```

## Credits and license

ApkStart West is based on [ApkStart](https://github.com/RoutineMiku/apkstart) by **RoutineMiku**, released under the MIT license; all the hard work on the runtime, windows, shortcuts and APK parsing is theirs. The upstream README (Chinese) is kept in [docs/upstream-README.zh-CN.md](docs/upstream-README.zh-CN.md). Developer docs in `docs/` come from upstream and are in Chinese.

[MIT](LICENSE). Releases contain only this app and Electron. The Android Emulator, system images and other Google components are downloaded by the user from Google and follow Google's licenses.

---

## Português

**Rode apps Android no Windows como programas nativos, sem nenhuma conexão com servidores na China.**

O ApkStart West é um fork do [ApkStart](https://github.com/RoutineMiku/apkstart), de RoutineMiku (licença MIT). Ele mantém o que o ApkStart tem de útil e remove todo caminho para servidores na China:

- **Dois cliques num .apk instalam o app**, com atalho na área de trabalho e no menu Iniciar usando o ícone do próprio app.
- **Cada app abre na sua própria janela**, com entrada própria na barra de tarefas.
- **A Google Play funciona.** O runtime é o emulador oficial do Android, do Google, com a imagem Android 14 com Google Play, baixada de `dl.google.com`.
- **Pasta compartilhada** entre o PC (`%USERPROFILE%\ApkStartShared`) e o Android (`/sdcard/ApkStartShared`).
- **Interface em inglês ou português** (Configurações → Básico → Idioma da interface). O Android começa em inglês (dá para mudar) e usa o fuso horário do PC.

O que mudou em relação ao original: sai o Gitee e os proxies do GitHub (ghfast.top, gh-proxy.com); sai o DNS chinês forçado (223.5.5.5 e 119.29.29.29) e o Android passa a usar o DNS do seu PC; a verificação de conexão volta para a do Google, em vez da Xiaomi; o Android deixa de vir em chinês com fuso de Xangai; o atualizador só olha para `mvoloch/apkstart-west` e o app usa pasta de dados e identidade próprias, então nunca troca nem mexe numa instalação do ApkStart original. A auditoria completa, com a captura de tráfego de uma execução real, está em [docs/NO-CHINA.md](docs/NO-CHINA.md).

**Requisitos:** Windows 10 ou 11 de 64 bits, virtualização ligada na BIOS, uns 6 GB livres. **Download:** [releases](https://github.com/mvoloch/apkstart-west/releases), ou compile a partir do código com os comandos acima. Na primeira execução o app baixa do Google (`dl.google.com`) o emulador (~460 MB), a imagem do sistema (~1,5 GB) e as ferramentas adb (~8 MB).

**Créditos:** baseado no ApkStart, de **RoutineMiku**, sob licença MIT. Licença deste fork: [MIT](LICENSE).
