# ApkStart West privacy policy / Política de privacidade

Last updated: 2026-11-24

## English

ApkStart West runs Android apps locally on your PC. It does not collect, upload or share your personal data.

- No account system, no identity data, no device identifiers, no advertising ID, no location.
- No analytics, telemetry, crash reporting or advertising SDKs.
- No server is operated for this project; nothing is sent to one.

Local data (stays on your PC):

| Path | Content |
|---|---|
| `%APPDATA%\apkstart-west` | Settings, logs, the Android runtime, installed apps, app data, snapshots |
| `%USERPROFILE%\ApkStartShared` | Shared folder synced with `/sdcard/ApkStartShared` inside Android |

What the app itself connects to:

- `api.github.com` / `github.com` (repository `mvoloch/apkstart-west`): a version check about 8 seconds after start and when you press "Check for updates"; downloads only if you choose to update. Requests carry the app version and standard HTTP headers.
- `dl.google.com` (Google): first-run download of the Android Emulator, system image, platform-tools and the optional AEHD driver.
- Any address you type yourself in Settings (mirror prefix, custom runtime URLs).

Android inside the emulator behaves like a normal Android phone: it uses your PC's DNS and network (NAT), checks connectivity against Google, and Google Play and the apps you install talk to their own servers under their own privacy policies. ApkStart West does not inspect or keep that traffic. The full network audit is in [NO-CHINA.md](NO-CHINA.md).

Contact: open an issue at https://github.com/mvoloch/apkstart-west/issues

## Português

O ApkStart West roda apps Android no seu PC. Ele não coleta, não envia e não compartilha seus dados pessoais: não há conta, identificador de aparelho, ID de publicidade, localização, estatística, telemetria nem relatório de falhas, e o projeto não tem servidor próprio.

Os dados ficam no seu PC, em `%APPDATA%\apkstart-west` (configurações, logs, runtime, apps e dados) e na pasta compartilhada `%USERPROFILE%\ApkStartShared`.

O app em si só se conecta a: `api.github.com` e `github.com` (repositório `mvoloch/apkstart-west`), para ver se há versão nova uns 8 segundos depois de abrir e quando você pede, e para baixar a atualização se você aceitar; `dl.google.com` (Google), para baixar o emulador e a imagem do Android na primeira vez; e qualquer endereço que você mesmo digitar nas Configurações.

O Android dentro do emulador se comporta como um celular comum: usa o DNS e a rede do seu PC, verifica a conexão com o Google, e a Google Play e os apps que você instalar falam com os servidores deles, sob as políticas de privacidade deles. A auditoria de rede completa está em [NO-CHINA.md](NO-CHINA.md).
