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

`test/no-china-test.js` (first step of `npm test`) fails with `file:line` if any of these hosts, DNS servers, the China time zone, or the removed settings (`giteeToken`, `sourcePreference`, `autoMirror`, `KNOWN_MIRRORS`, `fastDns`) comes back in any tracked file. The upstream Chinese docs kept in `docs/` still *mention* Gitee by name; none of them is loaded by the app.

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

## 3. Traffic seen in a real run (XPS, Windows 11, 24 Nov 2026, São Paulo time)

**Android side (packet capture).** Run with `APKSTART_EMULATOR_TCPDUMP=<file>`, which passes `-tcpdump` to the emulator and records every packet Android sends or receives. Capture from 20:29 to 21:28: cold boot, install of Binary Eye 1.76.1, launch from its desktop shortcut, Play Store present but not signed in. 156 packets.

| Name asked or contacted | Address | Owner (RDAP) |
|---|---|---|
| `connectivitycheck.gstatic.com` (HTTP, port 80) | 142.251.150.120 | Google |
| `www.google.com` (TLS + QUIC, port 443) | 142.251.152.119 | Google |
| DNS (53, and DNS-over-TLS 853) | 10.0.2.3 | Emulator's virtual DNS, forwards to the PC's DNS |
| mDNS (5353) | 224.0.0.251, ff02::fb | Local multicast, never leaves the PC |

**Windows side (connection log).** A poller recorded every TCP connection of `electron`, `qemu-system-x86_64` and `netsimd` (the emulator's network process) from 17:15 to 20:15, covering runtime download, several boots, Google Play services start-up (port 5228) and app install. 83 distinct remote addresses:

- 77 owned by Google, checked by RDAP: blocks 142.250.0.0/15, 172.217.0.0/16, 108.177.0.0/17, 173.194.0.0/16, 74.125.0.0/16, 192.178.0.0/15, plus 64.233.186.190, 216.239.36.155 and 104.154.125.27 (Google Cloud).
- 3 owned by Claro S.A. / Embratel, Brazil (189.22.186.12, 189.43.122.204, 200.255.198.15), the local internet provider. Inferred, not proven: Google content caches hosted on the provider's network.
- 3 private addresses: 10.0.2.3 and 10.0.2.4 (emulator virtual network) and 172.27.2.7 (DNS-over-TLS to a resolver on the local network).
- None in China.

**Limits.** The Windows log polls connection tables, so a connection that opens and closes between two polls can be missed, and UDP is not covered there (the Android capture covers UDP). Play Store was not signed in, so app-store traffic itself was not exercised. Reverse lookups were done by RDAP owner, not by geolocation of each address.

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

Teste real no XPS em 24/11/2026: a captura de pacotes do Android (20h29 às 21h28, horário de São Paulo) viu só servidores do Google; o registro de conexões do Windows (17h15 às 20h15) viu 83 endereços: 77 do Google, 3 da Claro/Embratel (provedor local) e 3 da rede interna. Nenhum na China. Limites: o registro do Windows pode perder conexões muito curtas, e a Play Store não estava logada.
