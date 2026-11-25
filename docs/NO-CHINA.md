# No connection to servers in China: audit

*[Resumo em português no fim](#resumo-em-português)*

This page records what was removed from upstream ApkStart, which hosts ApkStart West can still reach, and what a real run on Windows 11 actually contacted. Audit date: 24 Nov 2026, commit `b75c786` and later.

## 1. What was removed from the code

| Upstream reference | What it did | Status in West |
|---|---|---|
| `gitee.com/daily-miku/apkstart` (Gitee, code host in China) | Second source for app updates and the prebuilt runtime pack | Removed. Only `github.com/mvoloch/apkstart-west` is queried |
| `ghfast.top`, `gh-proxy.com` (third-party GitHub proxies) | Automatic download "accelerators" (`autoMirror: true` by default) | Removed. A mirror prefix is used only if the user types one |
| `connect.rom.miui.com` (Xiaomi) | Written into Android as the captive-portal / connectivity check on every boot | Removed. Boot now deletes any saved override, so Android uses Google's default `connectivitycheck.gstatic.com` |
| `223.5.5.5`, `119.29.29.29` (Alibaba and Tencent public DNS) | Forced as Android's DNS (`-dns-server`, "fast DNS" switch) | Removed. Android uses the PC's DNS |
| `Asia/Shanghai`, `zh-CN` locale, Pinyin keyboard | Forced on Android at setup | Removed. Android starts in `en-US` with the PC's time zone |
| Douyin and WeChat QR codes and links | Promotion inside the app | Removed (assets deleted) |
| `nchc.dl.sourceforge.net` (Taiwan mirror), `fydeos.com`, npm/Electron mirrors in China | Optional ISO mirror, docs, CI | Removed |
| Prebuilt "runtime pack" built by the upstream author (`preferGithubRuntime: true`) | Downloaded the whole runtime from the author's release instead of Google | Off by default (`false`). The runtime comes from `dl.google.com` |
| Updater pointing at upstream | Could replace this fork with upstream releases | Points only at `mvoloch/apkstart-west`; separate data folder `%APPDATA%\apkstart-west` |

`test/no-china-test.js` (first step of `npm test`) fails with `file:line` if any of these hosts, DNS servers, the China time zone, or the removed settings (`giteeToken`, `sourcePreference`, `autoMirror`, `KNOWN_MIRRORS`, `fastDns`) comes back in any tracked file. The test looks for addresses, not words: Chinese code comments and two build messages inherited from upstream (in `src/core/sources.js`, `updater.js`, `download.js`, `provision.js`, `src/main.js`, `build/zip.js`) and the upstream Chinese docs in `docs/` still *mention* Gitee and the proxies by name, as history. None of them is an address the app can reach.

## 2. Hosts the code can still reach

From `git grep` over `src/`, `build/`, `.github/` and `package.json`:

| Host | Used for | When |
|---|---|---|
| `dl.google.com` | Android Emulator, platform-tools, Android 14 Google Play system image | First run, runtime repair |
| `api.github.com`, `github.com` | Update check and downloads of this fork's releases | Update check |
| `connectivitycheck.gstatic.com` | Android's own internet check (Google default) | Every boot |
| `qemu.weilnetz.de` (Germany) | QEMU installer for the optional legacy engine | Only if the user picks the legacy QEMU engine |
| `downloads.sourceforge.net`, `master.dl.sourceforge.net`, `phoenixnap.dl.sourceforge.net` | Android-x86 ISO for the optional legacy engine | Only if the user picks the legacy QEMU engine |
| `aka.ms`, `learn.microsoft.com` | Help links (Windows virtualization) | Only if the user clicks them |

Apps the user installs, and Google Play itself, talk to whatever servers they choose; that is outside this app.

## 3. Traffic seen in real runs (XPS, Windows 11, 24 Nov 2026, São Paulo time)

Two sources were used, because neither sees everything on its own:

- **Android packet capture.** `APKSTART_EMULATOR_TCPDUMP=<file>` passes `-tcpdump` to the emulator. It records the emulator's own network interface (`eth0`, which Android presents as a mobile-data network). Android also has a virtual Wi-Fi (`wlan0`), carried by the emulator's `netsimd` process; that path is **not** in the capture. In Run A, Android's default network was the mobile-data one on `eth0` (checked with `dumpsys connectivity`; Wi-Fi was connected but not validated). Run B was not checked.
- **Windows connection log.** A poller (about every 0.7 s, no admin rights) recorded each new TCP connection of `electron`, `emulator`, `qemu-system-x86_64`, `adb` and `netsimd`, so it also covers the Wi-Fi path.

### Run A, 21:41 to 21:45: capture and Windows log at the same time

Boot, launch of Binary Eye 1.76.1, then the Play Store opened (not signed in) for two minutes.

- Android capture: 2,072 packets. Every name visible in the capture, and every destination address, belongs to Google (DNS queries sent over DNS-over-TLS to 10.0.2.3:853 are encrypted, so their names are not visible; the addresses the apps connected to are): Play (`play.googleapis.com`, `play-fe.googleapis.com`, `play-lh.googleusercontent.com`, Play gateway), Google services (`android.googleapis.com`, `android.clients.google.com`, `mtalk.google.com` on port 5228, `notifications-pa`, `remoteprovisioning`, `digitalassetlinks`), `www.google.com`, `connectivitycheck.gstatic.com`, `time.google.com` / `time.android.com`, YouTube images and API used by the Play Store (`i.ytimg.com`, `youtubei.googleapis.com`), Google ads (`ad.doubleclick.net`, `www.googleadservices.com`) and Google's RCS (messaging) configuration host (`rcs-acs-tmo-us.jibe.google.com`). Plus the emulator's virtual DNS (10.0.2.3) and local multicast (mDNS).
- Windows log: 14 remote addresses, all opened by `qemu-system-x86_64`, all in Google's 142.250.0.0/15, 172.217.0.0/16, 64.233.x or 216.239.x blocks. `netsimd` (Wi-Fi) opened none. 13 of the 14 are also in the capture; the other (142.251.145.7, Google) was seen only by the poller.

### Run B, 20:29 to 21:28: capture only

Binary Eye in use, then idle. 156 packets: `connectivitycheck.gstatic.com` (142.251.150.120) and `www.google.com` (142.251.152.119), both Google, plus the emulator's virtual DNS and mDNS.

### Earlier session, 17:15 to 20:15: Windows log only

Runtime checks and several boot attempts, with Google Play services starting (port 5228). This window includes Wi-Fi traffic: `netsimd` opened connections here. 83 distinct remote addresses:

- 77 owned by Google, checked by RDAP: blocks 142.250.0.0/15, 172.217.0.0/16, 108.177.0.0/17, 173.194.0.0/16, 74.125.0.0/16, 192.178.0.0/15, plus 64.233.186.190, 216.239.36.155 and 104.154.125.27 (Google Cloud).
- 3 owned by Claro S.A. / Embratel, Brazil (189.22.186.12, 189.43.122.204, 200.255.198.15), the local internet provider. Inferred, not proven: Google content caches hosted on the provider's network.
- 3 private addresses: 10.0.2.3 and 10.0.2.4 (emulator virtual network) and 172.27.2.7 (DNS-over-TLS to a resolver on the local network).
- None in China.

**Limits.**
- The Windows log polls connection tables, so a connection that opens and closes between two polls can be missed. It does not cover UDP.
- The Android capture does not cover the virtual Wi-Fi path.
- So Wi-Fi UDP traffic (for example QUIC) is not covered by either source. In Run A, Wi-Fi was not Android's default network.
- The Play Store was opened but not signed in, so downloads from the store were not exercised.
- Addresses were attributed by RDAP owner, not by the geolocation of each address.

## How to repeat the check

```powershell
$env:APKSTART_EMULATOR_TCPDUMP = "$env:TEMP\apkstart-audit.pcap"
npm start
```

Use the app, close it, then open the `.pcap` in Wireshark and look at *Statistics → Endpoints* and *Statistics → Resolved Addresses*.

---

## Resumo em português

O que saiu do código: o servidor de código na China (Gitee), os dois proxies de terceiros do GitHub, o teste de internet num servidor da Xiaomi, o DNS forçado da Alibaba e da Tencent, o fuso da China e o Android em chinês, os QR codes de Douyin e WeChat, e o atualizador que apontava para o projeto original. Um teste automático (`test/no-china-test.js`) falha se qualquer um deles voltar.

O que o app ainda acessa: `dl.google.com` (Android do Google), o GitHub deste fork (atualizações), a verificação de internet do Google e, só se o usuário escolher o motor antigo opcional, um servidor na Alemanha e o SourceForge.

Teste real no XPS em 24/11/2026, no horário de São Paulo:

- **Das 21h41 às 21h45:** boot, Binary Eye e Play Store aberta. A captura de pacotes do Android (2.072 pacotes) e o registro de conexões do Windows (14 endereços) rodaram juntos, e todo nome visível e todo endereço de destino eram do Google. As consultas de DNS cifradas não mostram o nome, mas os endereços a que levaram aparecem.
- **Das 20h29 às 21h28:** só captura, que viu só o Google.
- **Das 17h15 às 20h15:** só o registro do Windows, que inclui o caminho do Wi-Fi virtual. Ele viu 83 endereços: 77 do Google, 3 da Claro/Embratel (provedor local) e 3 da rede interna.
- Nenhum endereço é da China.

Limites:

- A captura do Android não vê o Wi-Fi virtual.
- O registro do Windows pode perder conexões muito curtas e não vê UDP.
- A Play Store não estava logada.
