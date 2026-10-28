# Privacy Policy

## In one sentence

Aoid runs entirely on your computer. It connects to no server and collects no data.

## Details

### What we collect

Nothing. There is no analytics, no crash reporting, no telemetry, no account system.

### Where data is stored

All data stays on your machine:

| Location | Contents |
| --- | --- |
| `%APPDATA%\Aoid\` | Settings, saved devices, custom language packs |
| Your chosen folders | Screenshots and recordings you save |

Delete the app and that folder, and everything is gone.

### Network connections

Aoid always talks to your own phone over USB or your local network. It only reaches the internet when:

- **You check for updates** — it requests the public GitHub Releases API, then downloads from `github.com`
- **Aoid downloads its runtime on first run** — adb and scrcpy components from their official sources

Nothing about you is sent in either case. The update check sends only a normal HTTP request.

### Clipboard

Clipboard sync is **off by default**. When you turn it on, Aoid reads your PC clipboard and pushes it to the phone, and writes phone clipboard changes back to your PC. Turning the feature off stops it immediately.

### Permissions used

- **USB / adb access** — to display the screen and inject input
- **Local network** — only for wireless debugging
- **Clipboard** — only when clipboard sync is enabled
- **Microphone / camera** — only when you explicitly start those features

### Third parties

Aoid bundles scrcpy, adb, SDL2, and FFmpeg, and runs on Electron. None of them phone home on their own. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Changes

If this policy ever changes, the change will be recorded in [CHANGELOG.md](CHANGELOG.md).
