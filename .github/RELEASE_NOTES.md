# Aoid 1.0.0

**First stable release.** Control your Android phone from your Windows PC over USB — live screen, responsive touch, text input, and a full toolbox.

| | |
| --- | --- |
| 🖥 Platform | Windows 10 / 11 (64-bit) |
| 📱 Phone | Android 5.0+ |
| 📦 Size | ~115–135 MB |

---

## Download

| File | Purpose | Notes |
| --- | --- | --- |
| **`Aoid-1.0.0-Setup.exe`** | **Installer** (recommended) | Guided install, creates shortcuts, includes an uninstaller |
| `Aoid-1.0.0-Portable.exe` | Portable | Single file, runs on double-click, writes no registry keys |
| `Aoid-1.0.0-win-x64.zip` | Unpacked folder | Extract and run; handy for internal distribution |

> **Windows will warn you on first launch** — "Windows protected your PC". This is expected without a code-signing certificate. Click **More info** → **Run anyway**.

---

## What's new in 1.0.0

This release goes from a beta to something you can hand to another person.

### Auto-update

Aoid now checks GitHub Releases, shows you the current version, the new version and the full changelog, and only downloads when you confirm.

- **Portable build** — downloads the new exe, replaces itself, and restarts
- **Installer build** — downloads the setup and hands off to the installer

If GitHub is unreachable, Aoid pings Baidu to tell you which problem you actually have: *no network at all*, or *network works but GitHub is blocked*.

### More features (a whole new window)

A separate toolbox window with five pages:

- **App manager** — list, launch, stop and uninstall apps; install APKs from your PC. Handles `.apk.1` files that chat apps rename.
- **Process manager** — see every process sorted by memory, kill what you need to.
- **File manager** — phone on the left, PC on the right. Remembers your last location, and you can switch between any drive.
- **Peripherals** — use the phone as a webcam or microphone.
- **ADB console** — a real terminal: command history with ↑/↓, Tab completion, syntax highlighting, selectable output.

### Screen recording

Record the phone screen to MP4 straight from the main window.

### Keyboard and mouse passthrough

Your PC's mouse and keyboard drive the phone directly — movement, clicks, scroll wheel, and keystrokes.

### IME passthrough (experimental)

Type with your own PC input method. When you pick a candidate, the whole word goes to the phone. English typing is unaffected.

### Multi-language

English and Simplified Chinese are built in. Any other language can be loaded from a JSON file you place in the data folder — you can generate one with any LLM.

English documentation (README, privacy policy, third-party notices) is included and used automatically when the interface is not Chinese.

---

## Fixes in this release

| Issue | Root cause |
| --- | --- |
| Documents wouldn't open | Launch script wasn't copying the markdown files |
| Clicks on settings reached the phone | Touch handler didn't check whether an overlay was open |
| Clipboard sync broken three ways | Missing echo guards and a self-written clipboard polluting the user's real one |
| Dragging stalled outside the frame | Out-of-bounds coordinates were dropped instead of clamped |
| Esc/Tab hijacked by UI controls | Default browser behaviour wasn't prevented |
| Document dialog appeared bottom-right | The entrance animation overrode the centring transform |
| File manager showed empty drives | Drive root was misread as the drive-list view |
| Peripherals page threw an error | iframe can't access the preload bridge |
| Documents couldn't scroll | A later stylesheet overrode the flex scrolling properties |

---

## Requirements

- Windows 10 / 11, 64-bit
- Android 5.0 or newer
- USB debugging enabled on the phone (Settings → About phone → tap *Build number* 7× → Developer options → USB debugging)

Full instructions are inside the app: **Settings → About → User guide**.

---

## Known limitations

- Windows x64 only; macOS and Linux are not planned for now
- Wireless debugging can drop on weak networks (auto-retries 3 times)
- Camera and microphone features work but have not been tested across many devices
- Rotation takes a second or two to recover
- No code signing, so SmartScreen will warn on first run

---

## Feedback

Bug reports and feature requests are very welcome — this is still an early-stage project and device-specific issues are hard to catch alone.

When reporting, please include your **phone model, Android version, connection type (USB / wireless), and reproduction steps**.

- 🐛 [Report a bug](https://github.com/l-xyzz/Aoid/issues/new/choose)
- 💡 [Request a feature](https://github.com/l-xyzz/Aoid/issues/new/choose)

---

## Privacy

Aoid runs entirely on your machine. No telemetry, no analytics, no accounts.
See [PRIVACY.md](https://github.com/l-xyzz/Aoid/blob/main/PRIVACY.md).

## License

Source code is [MIT](https://github.com/l-xyzz/Aoid/blob/main/LICENSE).
Bundled third-party binaries (scrcpy, adb, SDL2, FFmpeg, Electron) follow their own licences —
see [THIRD-PARTY-NOTICES.md](https://github.com/l-xyzz/Aoid/blob/main/THIRD-PARTY-NOTICES.md).
