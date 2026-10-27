# 第三方组件声明

Aoid 自身以 MIT 协议开源（见 `LICENSE`）。

本文件列出 Aoid 运行、构建或分发过程中用到的第三方组件及其许可证。
分发 Aoid 的二进制版本时，请连同本文件与 `licenses/` 目录一起分发。

---

## 运行时组件（随包分发）

### scrcpy

- **用途**：设备画面推流、触控注入、音频转发、摄像头采集。Aoid 通过子进程调用它。
- **版本**：3.3.4（`scrcpy-runtime/`）与 5.0.1（`vendor/scrcpy-server-v5.0.1`）
- **许可证**：Apache License 2.0
- **版权**：Copyright (C) 2018 Genymobile；Copyright (C) 2018-2026 Romain Vimont
- **来源**：https://github.com/Genymobile/scrcpy
- **许可证全文**：`licenses/scrcpy-APACHE-2.0.txt`

> 说明：Aoid **未修改** scrcpy 的源码，仅以子进程方式调用其可执行文件。
> 按 Apache-2.0 第 4 条，分发时保留版权声明与许可证副本。

### Android SDK Platform-Tools（adb）

- **用途**：设备发现、端口转发、shell 命令。
- **许可证**：Apache License 2.0
- **版权**：Copyright (C) The Android Open Source Project
- **来源**：https://developer.android.com/tools/releases/platform-tools
- **许可证全文**：`licenses/scrcpy-APACHE-2.0.txt`（同为 Apache-2.0）

### SDL2

- **用途**：scrcpy 的窗口、输入与音频输出（随 scrcpy 二进制分发）。
- **许可证**：zlib License
- **版权**：Copyright (C) 1997-2025 Sam Lantinga
- **来源**：https://github.com/libsdl-org/SDL
- **许可证全文**：`licenses/SDL2-zlib.txt`

### FFmpeg（libav* / swresample）

- **用途**：scrcpy 的 H.264/Opus 解码与录制。
- **版本**：avcodec-61 / avformat-61 / avutil-59 / swresample-5
- **许可证**：以官方 Windows 预编译包为准。若为 LGPL 构建则为 **LGPL-2.1-or-later**；
  若启用了 GPL 组件则为 **GPL-3.0-or-later**。使用前请核对所分发 DLL 的具体构建配置。
- **版权**：Copyright (C) FFmpeg developers
- **来源**：https://ffmpeg.org/
- **许可证全文**：`licenses/FFmpeg-LGPL.txt`（LGPL 版）

> ⚠️ 若你分发的 ffmpeg 是 GPL 构建，请注意 GPL 的传染性；
> 建议使用 LGPL 构建以保持与 Aoid 的 MIT 协议兼容。

---

## 构建期依赖（不随包分发）

以下组件仅在开发/构建阶段使用，不出现在最终产物中：

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| Electron | MIT | 应用运行时 |
| electron-builder | MIT | 打包 |
| electron-updater | MIT | 更新（预留） |

Electron 内嵌 Chromium 与 Node.js，其各自的许可证在 Electron 发行包内的
`LICENSE` / `LICENSES.chromium.html` 中，分发时 Electron 会自动包含。

---

## 参考但未使用代码的项目

以下项目仅作为**架构思路参考**，Aoid 未复制其中任何代码：

- **QtScrcpy**（GPL-3.0）——参考其模块分层与「双帧缓冲」的设计思路。
  GPL-3.0 具有传染性，复制其代码会要求 Aoid 整体改为 GPL-3.0，故明确不使用。
- **Escrcpy**（Apache-2.0 派生）——参考其「以官方 scrcpy 作为显示后端」的做法。

---

## 如何更新本文件

新增依赖时：

1. 在上面「运行时组件」或「构建期依赖」中追加条目；
2. 若为新许可证类型，将其全文放入 `licenses/` 并在条目中引用；
3. 提交时一并说明来源与版本，便于后续审计。
