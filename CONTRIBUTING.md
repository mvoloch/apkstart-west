# Contributing to ApkStart West

Issues and pull requests are welcome. Two rules come before everything else:

1. **No connection to servers in China.** Do not add hosts, mirrors, DNS servers, analytics or defaults that send traffic to China. `npm test` starts with `test/no-china-test.js`, which fails on the hosts listed there; extend that list when you find a new one. The audit is in [docs/NO-CHINA.md](docs/NO-CHINA.md).
2. **Every user-visible string goes through the i18n layer.** English is the key and the default: `tr('Installed {name}', { name })` (`src/core/i18n.js` in the main process, global `tr()` from `src/ui/i18n-dom.js` in the pages). Add the Portuguese text to `src/i18n/pt-BR/*.json`. `node tools/i18n-check.js` lists text that is still untranslated.

## Development

- Windows 10/11 x64, Node.js 20 or newer
- `npm ci && npm start`
- `npm test` before every commit (no network, no emulator needed)
- With npm 11, if Electron's binary is missing after `npm ci`: `node node_modules\electron\install.js`

## Code conventions (from upstream)

- No third-party runtime dependencies in the shell: the ZIP / AXML / ARSC / PNG / ICO parsers in `src/core/` are hand-written. Prefer Node built-ins.
- The renderer is plain HTML/CSS/JS, no framework.
- Everything that talks to Android goes through `src/core/adb.js`.
- Main and renderer talk only through the channels exposed in `preload.js`; `contextIsolation` stays on.
- Tests never reach the internet; use a local `http` server (see `test/engine-test.js`) or stub `https`.
- Many code comments are still in Chinese, from upstream; translating them is welcome.

## Commit messages

Conventional Commits, e.g. `feat(engine): ...`, `fix(axml): ...`, `docs: ...`.

## Legal

This project does not distribute Android system images, QEMU binaries or Google components; users download them from Google. Do not commit commercial APKs, cracking tools or anything that infringes third-party rights.
