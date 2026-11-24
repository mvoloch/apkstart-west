# ApkStart West Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public fork of RoutineMiku/apkstart (MIT, base commit 7e2c550, v0.6.4) that runs APKs on Windows exactly as before but never contacts a server in mainland China, with an English UI and optional Brazilian Portuguese.

**Architecture:** Keep upstream's engine (official Android emulator + `google_apis_playstore/x86_64-34` image from dl.google.com). Delete every China-bound code path instead of only flipping defaults, rename the app identity so it never shares data or updates with upstream, and add a tiny `t()` i18n layer where English text is the key and `src/i18n/pt-BR/*.json` holds the Portuguese.

**Tech Stack:** Electron 33.4.11, Node 26 (XPS), plain JS (CommonJS), plain HTML/CSS renderer, custom test runner (`npm test`).

**Spec:** the task brief from session local_f03eaeba (2026-11-24) plus Marcus's answers in this session: UI English with Portuguese selector; Android in en-US with the PC's timezone; all downloads approved; repo `mvoloch/apkstart-west`, product name "ApkStart West".

## Global Constraints

- No reference in tracked files to: gitee.com, ghfast.top, gh-proxy.com, *.miui.com, douyin.com, qq.com, npmmirror.com, tsinghua.edu.cn, any `*.cn` host, fydeos.com, nchc.dl.sourceforge.net, 223.5.5.5, 119.29.29.29, 114.114.114.114, `Asia/Shanghai`. Only exception: `docs/NO-CHINA.md` (the audit report) and the guard test itself.
- Allowed external hosts: dl.google.com, github.com / api.github.com / objects.githubusercontent.com, qemu.weilnetz.de, *.sourceforge.net (minus nchc), registry.npmjs.org.
- Identity: package `name` = `apkstart-west`, `productName` = `ApkStart West`, appId `com.apkstart.west`, data dir `%APPDATA%\apkstart-west`, repo `https://github.com/mvoloch/apkstart-west`.
- Updater never points at RoutineMiku; no automatic update check at startup.
- Defaults: `engine.locale = 'en-US'`, no timezone override, `engine.chineseIme = false`, `display.tabletMode = false`, `runtime.preferGithubRuntime = false`, `ui.language = 'en'`.
- MIT license and upstream copyright stay; README credits RoutineMiku/apkstart.
- Code comments may stay Chinese. User-visible strings and log lines become English.

## Review Focus

1. A `settings.json` carrying upstream keys (`fastDns`, `sourcePreference: 'gitee'`, `autoMirror`, `mirrorPrefix: 'https://ghfast.top/'`) must not resurrect a Chinese host: code no longer reads these keys (`test/no-china-test.js` asserts the keys are gone from `src/`; `mirrorPrefix` stays only as a user-typed custom prefix).
2. A missing pt-BR key must fall back to English, never show a key path or `undefined` (Task 4 test).
3. An emulator AVD already configured by upstream (Xiaomi captive portal saved in `/data`) must be reset to Android defaults: the boot path runs `settings delete global captive_portal_http_url` and `_https_url` and `captive_portal_mode` (Task 2 test greps adb.js/emulator.js).
4. First run with the updater pointed at a repo with no releases must show "no update" instead of an error loop (Task 3 test on `Sources` with an empty release list).
5. Template strings with variables (`{name}`, `{n}`) must interpolate in both languages (Task 4 test).

---

### Task 1: Guard test that fails while any China link remains

**Files:**
- Create: `test/no-china-test.js`
- Modify: `package.json` (append `&& node test/no-china-test.js` to `scripts.test`)

- [ ] Step 1: write the test. It lists tracked files with `git ls-files`, skips binaries, `docs/NO-CHINA.md`, `docs/superpowers/**` and itself, and fails listing `file:line` for each match of the blocklist in Global Constraints. Second check: `src/**` contains none of `giteeToken`, `sourcePreference`, `autoMirror`, `KNOWN_MIRRORS`, `fastDns`, `ensureChineseLocale`. Third check: files `src/ui/assets/douyin-qr.jpg` and `src/ui/assets/wechat-qr.jpg` and dir `docs/promo` do not exist.
- [ ] Step 2: `node test/no-china-test.js` → FAIL with the current list (expected ~100 hits).
- [ ] Step 3: commit `test: guard against references to servers in China`.

### Task 2: Remove every China-bound path

**Files:** `src/core/{sources,provision,updater,download,store,adb,emulator}.js`, `src/main.js`, `src/ui/{index.html,app.js,manual.html}`, `src/ui/assets/{douyin-qr.jpg,wechat-qr.jpg}` (delete), `.github/workflows/{release.yml,backfill-release-notes.yml}`, `.github/release-notes-*.md` (delete), `tools/{publish-gitee.js,backfill-gitee-notes.js}` (delete), `docs/promo/` (delete), `docs/fydeos.md` (delete), `docs/DEV-ENV.md`, `test/boot-test.js`, tests that assert removed behavior.

- [ ] Sources: `SOURCES` keeps only `github`; delete `OWNER_GITEE`, `KNOWN_MIRRORS`, `mirrorList` auto mirrors (custom `mirrorPrefix` still works), Gitee token logic, `sourcePreference` branching. Export list keeps `Sources, SOURCES, measure, withMirror, mirrorList`.
- [ ] Provision: drop `giteeReleaseApi/Page`, the Gitee branch at line ~565, `nchc` ISO mirror.
- [ ] Store: delete `fastDns`, `sourcePreference`, `autoMirror`, `giteeToken`; `preferGithubRuntime: false`.
- [ ] Emulator: delete the `-dns-server` push (Android uses 10.0.2.3 → host DNS). Network probe at ~1082 uses `connectivitycheck.gstatic.com`. Replace captive-portal `settings put` lines at ~1128 and adb.js ~929 with `settings delete global captive_portal_http_url`, `..._https_url`, `captive_portal_mode`.
- [ ] main.js openExternal allowlist: `github.com` only. Delete Douyin/WeChat block in index.html (~915-933), Gitee/mirror settings block (~556-592), DNS switch (~488-494) and their bindings in app.js.
- [ ] CI: remove `ELECTRON_MIRROR`, Gitee sync steps, delete backfill workflow.
- [ ] `test/boot-test.js` ISO → `https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-virt-3.20.3-x86_64.iso`.
- [ ] Run `node test/no-china-test.js`: remaining hits only in docs handled by Task 6. `npm test` green except tests asserting removed behavior, which are updated to assert the new behavior.
- [ ] Commit `fix: remove Gitee, GitHub proxies, Chinese DNS and Xiaomi captive portal`.

### Task 3: Own identity, own updater, phone profile, Western Android defaults

**Files:** `package.json`, `electron-builder.yml`, `src/core/{store,sources,provision,updater,adb,engine,emulator}.js`, `src/main.js`, `src/ui/app.js`, tests.

- [ ] Identity values from Global Constraints. `electron-builder.yml`: remove the appx/MSIX Partner Center section (`identityName`, `publisher`, `publisherDisplayName`); `build/msix.js` script and `build:msix`/`build:appx` npm scripts removed; the version-sync test drops the MSIX check.
- [ ] Updater constants → `mvoloch/apkstart-west`; the startup call to `api.updateCheck()` in app.js (~1585) removed (manual check stays). Test: with an empty releases list, `Sources` returns `hasUpdate: false`.
- [ ] `ensureChineseLocale(locale)` → `ensureLocale(locale)` running only `settings put system system_locales <locale>`; no timezone setprop, no forced 24h. Engine calls it; IME install only when `chineseIme === true`. `_ensureSystemLocale` drops the `/^zh[-_]/` shortcut.
- [ ] Defaults per Global Constraints (`tabletMode: false` makes `tabletDensity()` return `'reset'` and engine skip the 190 override).
- [ ] `npm test` green (update the asserts in `test/auto-test.js` ~1057/1089 and `test/settings-ui-test.js` fixtures to the new defaults).
- [ ] Commit `feat: ApkStart West identity, own updater, phone profile, en-US Android`.

### Task 4: i18n layer

**Files:**
- Create: `src/core/i18n.js`, `src/i18n/pt-BR/README.md` (one line: format), `test/i18n-test.js`
- Modify: `src/core/store.js` (`ui: { language: 'en' }`), `src/preload.js`, `src/main.js`, `src/ui/index.html` (language select in Settings → General), `src/ui/app.js`

**Interfaces (produced):**
- `i18n.t(text: string, vars?: object) => string` — returns pt-BR from the merged dictionary when lang is `pt-BR` and the key exists, else `text`; then replaces `{key}` with `vars[key]`.
- `i18n.setLang(lang: 'en'|'pt-BR')`, `i18n.getLang()`.
- Dictionary: every `src/i18n/pt-BR/*.json` is a flat `{ "English text": "Texto em português" }` object, merged at require time.
- Renderer: `window.apkstart.t(text, vars)` (preload gets lang with `ipcRenderer.sendSync('i18n:lang')`) and `translateDom(root)` in app.js, which swaps text nodes and `placeholder/title/alt/aria-label` whose trimmed value is a dictionary key.
- Changing `ui.language` in settings: main calls `setLang`, reloads all windows, rebuilds tray menu.

- [ ] Tests (`test/i18n-test.js`): `t('Install')` in en → `'Install'`; with pt-BR and `{Install: 'Instalar'}` → `'Instalar'`; missing key in pt-BR → English; `t('Downloading {name}', {name:'x'})` → `'Downloading x'` and pt-BR `'Baixando x'`; all dictionary files parse and have non-empty string values.
- [ ] Implement, wire `npm test`, commit `feat: English/Portuguese i18n layer`.

### Task 5: Translate (parallel builder subagents, disjoint files, no test edits)

Groups (each writes English in place, wraps user-visible strings in `t()`, translates log lines to English without `t()`, leaves comments, writes Portuguese to its own `src/i18n/pt-BR/<group>.json`):
- `ui-html`: `src/ui/index.html`, `shell.html`, `splash.html`, `splash.js`, `shell.js`
- `ui-app`: `src/ui/app.js`
- `main`: `src/main.js`, `src/preload.js`, `src/splash-preload.js`
- `core-a`: `provision, engine, emulator, autodebug, autodebug-probe, doctor` (src/core)
- `core-b`: every other `src/core/**/*.js` plus `src/core/win/*.ps1` user-visible strings
- `manual`: `src/ui/manual.html` → English; new `src/ui/manual.pt-BR.html`; `src/core/manual.js` picks the file by language.

- [ ] After all groups: `npm test`; fix tests that asserted Chinese strings (single agent, test files only).
- [ ] Commit per group `i18n(<group>): English UI with pt-BR dictionary`.

### Task 6: Docs, README, audit report

- [ ] `README.md`: English + Portuguese section; what changed versus upstream; credits and link to RoutineMiku/apkstart; MIT kept (LICENSE untouched, add "Copyright (c) 2026 ApkStart West contributors" line below upstream's).
- [ ] `docs/NO-CHINA.md`: the audit table (file, what it contacted, what we did) and the traffic proof from Task 7.
- [ ] Remove Chinese-only promo/store docs (`docs/store-*`, `docs/ApkStart-用户手册.html`, `docs/build-manual-html.py` if it only builds that); scrub remaining hits in `docs/*.md`, `CONTRIBUTING.md`.
- [ ] `node test/no-china-test.js` → PASS. Commit `docs: README, audit report`.

### Task 7: Real run on the XPS with traffic capture

- [ ] `pktmon start --capture --pkt-size 128 -f C:\Projetos\apkstart-capture\west.etl` (elevated), then `npm start`.
- [ ] Let it download the runtime from dl.google.com, boot, open the Play Store, install `test/lib/make-apk.js` output via the UI.
- [ ] `pktmon stop`, convert to pcapng, extract all remote IPs and DNS names; check names against the blocklist and IPs against country (RDAP lookup on github/google ranges only as needed). Record in `docs/NO-CHINA.md`.

### Task 8: Publish

- [ ] `gh repo create mvoloch/apkstart-west --public --source C:\Projetos\apkstart --remote origin --push` (upstream remote renamed `upstream`). Undo: delete the repo in GitHub Settings.
