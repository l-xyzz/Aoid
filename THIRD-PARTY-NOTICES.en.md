# Third-Party Notices

Aoid bundles and uses the following third-party components. Each follows its own license; the full texts are in the `licenses/` folder.

---

## scrcpy

- **Version**: 3.3.4 (client) / scrcpy-server v5.0.1
- **Author**: Romain Vimont (Genymobile)
- **Purpose**: Screen capture and input injection on the Android device
- **License**: Apache License 2.0
- **Source**: https://github.com/Genymobile/scrcpy

The server jar is pushed to the phone at runtime and executed there. It is not modified.

Full text: [licenses/scrcpy-APACHE-2.0.txt](licenses/scrcpy-APACHE-2.0.txt)

---

## Android Platform Tools (adb)

- **Author**: Google LLC
- **Purpose**: Communication between the PC and the Android device
- **License**: Apache License 2.0
- **Source**: https://developer.android.com/tools/releases/platform-tools

Only three files are bundled: `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`.

---

## SDL2

- **Version**: ships with the official scrcpy build
- **Author**: Sam Lantinga and contributors
- **Purpose**: Window and audio output for scrcpy
- **License**: zlib License
- **Source**: https://github.com/libsdl-org/SDL

Full text: [licenses/SDL2-zlib.txt](licenses/SDL2-zlib.txt)

---

## FFmpeg

- **Version**: ships with the official scrcpy build
- **Author**: FFmpeg team
- **Purpose**: Audio and video encoding/decoding for scrcpy
- **License**: LGPL 2.1+ (the build shipped with scrcpy is LGPL)
- **Source**: https://ffmpeg.org/

Full text: [licenses/FFmpeg-LGPL.txt](licenses/FFmpeg-LGPL.txt)

If you redistribute Aoid, keep these license texts alongside the binaries.

---

## Electron

- **Version**: 45.x
- **Author**: OpenJS Foundation and contributors
- **Purpose**: Desktop runtime
- **License**: MIT
- **Source**: https://www.electronjs.org/

Electron itself bundles Chromium (BSD-3-Clause and others) and Node.js (MIT).
Their license texts are inside `Aoid/resources/` in the packaged app.

---

## Libraries used at build time

Aoid has **zero runtime dependencies**. Only build tooling is installed via npm:

| Package | Purpose | License |
| --- | --- | --- |
| electron | Runtime and packaging | MIT |
| electron-builder | Packaging | MIT |

Their transitive dependencies are listed in `package-lock.json`.

---

## Attribution for design ideas

Aoid's architecture was informed by studying [QtScrcpy](https://github.com/barry-ran/QtScrcpy) (GPL-3.0).

**No code from QtScrcpy is used.** Only general ideas — such as using an abstract socket over `adb reverse`, and the overall separation between capture, transport, and rendering — were considered. Those ideas are not copyrightable, and the implementation here is written independently.

---

## Reporting a licensing issue

If you believe something here is misattributed or missing, please open an issue:
https://github.com/l-xyzz/Aoid/issues
