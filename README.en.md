# Aoid

**Control your Android phone from your Windows PC over USB.**

Aoid is a lightweight desktop app that mirrors your phone's screen and lets you interact with it using your mouse and keyboard. No app installation on the phone. No root required.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-blue)](https://github.com/l-xyzz/Aoid/releases)
[![Version](https://img.shields.io/badge/version-1.0.0-orange)](https://github.com/l-xyzz/Aoid/releases)

> **Version 1.0.0.** Core features are ready for daily use, but the project is still iterating quickly and device compatibility is being refined. Feedback is very welcome.

![Aoid interface](docs/screenshot.en.png)

---

## Why Aoid instead of plain scrcpy?

scrcpy is excellent, but it is command-line only. Aoid wraps the same server in a **complete desktop app**:

| | scrcpy | **Aoid** |
| --- | --- | --- |
| How to use | CLI flags | **Open and go** |
| Wireless | Type adb yourself | **Pairing wizard** |
| CJK input | Configure an IME | **Just type** |
| Shortcuts | Fixed | **Customizable** |
| Distribution | Build it yourself | **Ready to install** |

One line: **Aoid puts scrcpy's power behind an interface you don't need to read docs for.**

## Features

- **Live screen mirroring** — H.264 over USB, hardware-decoded via WebCodecs, 30–60 fps
- **Responsive input** — clicks, drags, long-presses and scroll wheel forwarded instantly
- **Text input** — including CJK and emoji, via clipboard-assisted typing
- **Wireless debugging** — pair with a code or connect by IP, then drop the cable
- **Volume & brightness** — two-way sync with instant feedback
- **Screenshots & recording** — lossless PNG screenshots, MP4 screen recording
- **Peripherals** — use the phone as a webcam or microphone
- **Clipboard sync** — optional, bidirectional
- **Toolbox** — app manager, process manager, two-pane file manager, and a built-in ADB console with autocomplete
- **Multi-language** — English and Simplified Chinese built in; load your own language pack


## Install

Download from [Releases](https://github.com/l-xyzz/Aoid/releases):

| File | What it is |
| --- | --- |
| `Aoid-<version>-Setup.exe` | Installer (recommended) — creates shortcuts, includes an uninstaller |
| `Aoid-<version>-Portable.exe` | Portable single file — no registry writes |
| `Aoid-<version>-win-x64.zip` | Unpacked folder — extract and run |

**Requirements**: Windows 10/11 (64-bit), Android 5.0+

On first launch Windows SmartScreen will warn you — there is no code-signing certificate. Click **More info** → **Run anyway**.

## Quick start

1. **Enable USB debugging** — Settings → About phone → tap *Build number* 7 times, then Developer options → USB debugging
2. **Connect** — plug in the cable, tap *Allow* on the phone
3. **Launch Aoid** — your device appears on the left, click it

Full instructions are in the app under **Settings → About → User guide**.

<details>
<summary>⚠️ Known limitations & issues (click to expand)</summary>

Aoid 1.0.0 is usable, but still iterating quickly and refining device compatibility.

| Issue | Status |
| --- | --- |
| Occasional stutter / tearing | Worst on resolution changes; being optimized |
| Rotation takes a few seconds | Frame is frozen and the channel reconnects |
| Wireless drops on weak networks | Auto-retries 3 times |
| Camera / microphone | Works, not fully tested; needs VB-Cable or OBS |
| No code signing | SmartScreen warning on first run |
| Platform | Windows x64 only |

Please file issues with your **phone model, Android version, and reproduction steps**.

</details>

## Build from source

```bash
git clone https://github.com/l-xyzz/Aoid.git
cd Aoid
npm install
npm run fetch:runtime   # scrcpy runtime (~18 MB)
npm run bundle:tools    # adb (~8 MB)
npm start
```

Requires Node.js 20+. Packaging: `npm run dist:safe` produces the installer, portable build, and zip.

## How it works

Under the hood Aoid runs the official [scrcpy](https://github.com/Genymobile/scrcpy) server on the phone and speaks its protocol directly:

- Video arrives as Annex-B H.264 over an `adb reverse` abstract socket
- Frames go straight into a WebCodecs `VideoDecoder` and are drawn to a canvas
- Touch and key events are injected using scrcpy's control protocol, which is faster than `adb shell input`

**One rule drives the whole design**: never drop a video frame. H.264 P-frames reference earlier frames, so dropping one corrupts everything after it. Smoothness is handled at the display layer instead.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it documents the non-obvious pitfalls (Android 16 socket restrictions, decoder recovery, IPC channel naming).

- 🐛 [Report a bug](https://github.com/l-xyzz/Aoid/issues/new/choose)
- 💡 [Request a feature](https://github.com/l-xyzz/Aoid/issues/new/choose)
- 🔒 [Security policy](SECURITY.md)

## Privacy

Aoid runs entirely on your machine. No telemetry, no analytics, no accounts. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) for the source code. Bundled third-party binaries keep their own licenses — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

*Not affiliated with Google, Genymobile, or the scrcpy project.*
