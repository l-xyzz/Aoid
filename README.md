# Aoid

> 用数据线把手机接到电脑上，在一个窗口里看画面、点屏幕、打字。

轻量、免安装、界面干净。不需要在手机里装任何应用，也不需要 root。

![界面预览](docs/screenshot.png)

---

## ⚠️ 开发阶段提示

**Aoid 目前处于密集开发阶段（`0.7.0-beta`），存在较多缺陷，不建议用于生产环境。**

已知问题包括但不限于：

- 画面偶发卡顿、撕裂，横竖屏热切换时可能需要几秒恢复
- 无线调试的连接稳定性不如 USB
- 麦克风、虚拟摄像头等「更多功能」尚未充分测试
- 暂无代码签名，Windows 首次运行会弹 SmartScreen 警告

**欢迎提意见。** 遇到问题请先看 [已知问题](#已知问题) 与 [Issues](https://github.com/l-xyzz/Aoid/issues)，
新问题请按 Issue 模板描述清楚**手机型号、Android 版本、复现步骤**，这对定位非常关键。
后续会持续接受反馈、修复问题、优化体验。

---

## 它是什么

Aoid 是一个基于 [scrcpy](https://github.com/Genymobile/scrcpy) 服务端的 Windows 桌面工具：

- **实时画面**：USB 传输 H.264，用浏览器原生 WebCodecs 直接硬解，实测 30~60fps
- **跟手触控**：鼠标按下、拖动、长按、滚轮都会即时转发到手机
- **中文输入**：输入框里的内容直接注入手机，支持中文（走剪贴板粘贴，兼容性最好）
- **常用按键**：返回、主页、任务、旋转、通知栏、控制中心，可自定义快捷键
- **无线调试**：配对码或直接连 IP，配对后可脱离数据线
- **音量与亮度**：实时双向同步，拖滑杆立刻生效
- **截图**：保存手机原始分辨率的无损 PNG，或复制到剪贴板
- **更多功能**：手机当电脑摄像头 / 麦克风，投屏到 OBS 虚拟摄像头
- **剪贴板同步**：默认关闭，开启后电脑与手机双向实时同步

## 下载

到 [Releases](https://github.com/l-xyzz/Aoid/releases) 下载，三种形式按需选择：

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `Aoid-<版本>-Setup.exe` | **安装包**（推荐） | 向导式安装，自动创建快捷方式，自带卸载程序 |
| `Aoid-<版本>-Portable.exe` | 便携版 | 单文件，双击即用，不写注册表，可放 U 盘 |
| `Aoid-<版本>-win-x64.zip` | 免安装目录 | 解压即用，适合内网分发 |

> **第一次运行会被 Windows 拦截**，提示「Windows 已保护你的电脑」。
> 这是没有购买代码签名证书的必然结果，点「**更多信息**」→「**仍要运行**」即可。

**系统要求**：Windows 10 / 11（64 位）。手机需 Android 5.0 以上。

## 快速开始

1. 手机打开「设置 → 关于手机」，连点「版本号」7 次开启开发者选项
2. 进入「开发者选项」，打开「**USB 调试**」
3. 用数据线连接电脑，手机上弹出授权窗口时点「**允许**」
4. 启动 Aoid，左侧会立刻出现这台设备，点它即可

不同品牌的开发者选项位置略有差异，应用内的「添加设备 → 调试教程」有说明。

<details>
<summary><b>无线调试（Android 11 以上，免数据线）</b></summary>

1. 手机与电脑连同一个 Wi-Fi
2. 手机「开发者选项 → 无线调试」→ 开启
3. 点「使用配对码配对设备」，记下 **IP:端口** 和 **6 位配对码**
4. Aoid 里「添加设备 → 无线连接」，填入配对信息，点「配对」
5. 配对成功后，用不带配对码的 IP:端口 连接

</details>

## 已知问题

| 问题 | 现状 |
| --- | --- |
| 画面偶发卡顿 / 撕裂 | 已在持续优化，切换分辨率时最明显 |
| 横竖屏热切换需要几秒恢复 | 通过锁帧 + 后台重连处理，期间画面短暂静止 |
| 无线连接稳定性 | 弱网下容易断，断线会自动重连 3 次 |
| 麦克风 / 虚拟摄像头 | 功能可用但未充分测试，需要 VB-Cable / OBS 支持 |
| 代码签名 | 无，首次运行有 SmartScreen 提示 |
| 平台 | 目前只支持 Windows x64 |

## 从源码构建

```bash
npm install
npm run fetch:runtime   # 下载 scrcpy 运行组件（scrcpy.exe / SDL2 / ffmpeg，约 18MB）
npm run bundle:tools    # 下载 adb（约 8MB）
npm start               # 启动应用
npm run dev             # 启动并打开开发者工具
```

需要 Node.js 20 以上。

> `scrcpy-runtime/` 和 `platform-tools/` 不进仓库（体积大且可重新下载），
> 所以 clone 之后**必须先跑上面两条下载命令**，否则画面和触控都无法工作。

### 打包

```bash
npm run dist:safe   # 推荐：在本地磁盘构建，产出安装包 + 便携版 + zip
npm run dist        # 直接调用 electron-builder（不生成 zip）
```

`dist:safe` 会先把项目复制到本地磁盘再打包——因为 **Electron 无法从网络驱动器（如 Z:）启动**，
产物落在网络盘上会导致双击毫无反应。

详细的打包选项、产物说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 技术路线

| 环节 | 做法 | 为什么 |
| --- | --- | --- |
| 画面采集 | scrcpy-server v5.0.1 | 设备端直接抓 Surface，硬件编码持续输出 H.264，最轻最稳 |
| 传输 | `adb reverse` 抽象 socket | Android 16 禁止 shell 设置 `ANDROID_SOCKET_*`，只能走反向转发 |
| 解码 | WebCodecs `VideoDecoder` | 浏览器原生接口，直接走硬件解码，无需封装容器 |
| 渲染 | Canvas 2D `drawImage` | 每帧一次 GPU 拷贝，不产生 DOM 对象 |
| 触控 | scrcpy 控制协议 | 直接注入，延迟低于 `adb shell input` |
| 中文输入 | 剪贴板 + 粘贴键 | `adb input text` 不支持非 ASCII，输入法注入在国产 ROM 上常失效 |

**一条铁律**：视频码流必须完整连续，一帧都不能丢。
H.264 的 P/B 帧依赖前面已解码的帧作参考，丢任意一帧都会让后续全部参考错乱、画面崩坏。
流畅度只能在显示层解决（只画最新帧），不能在输入层丢帧。

## 目录结构

```
src/
  main/           主进程
    core/         共享状态、IPC 注册封装、路径解析
    session/      连接与画面通道生命周期
    ipc/          按域拆分的 IPC：device / settings / screen / features / wireless
    scrcpy.js     scrcpy 服务端通道（视频流解析、控制协议）
    adb.js        adb 封装
    camera.js     摄像头
    microphone.js 麦克风（虚拟声卡）
    virtual-camera.js  OBS 虚拟摄像头
  renderer/       渲染进程
    js/app.js     界面主逻辑
    js/player.js  WebCodecs 解码 + 画布渲染
    js/markdown.js 文档渲染
    styles/       样式
scripts/          构建与自检脚本
resources/        图标等
vendor/           scrcpy 服务端 jar
```

## 参与

- 有 bug 或建议 → [提 Issue](https://github.com/l-xyzz/Aoid/issues/new/choose)
- 想贡献代码 → 见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题 → 见 [SECURITY.md](SECURITY.md)

## 关于第三方组件

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| [scrcpy](https://github.com/Genymobile/scrcpy) 服务端 | 手机端画面采集与输入注入 | Apache-2.0 |
| [platform-tools](https://developer.android.com/tools/releases/platform-tools) 中的 adb | 与手机通信 | Apache-2.0 |
| [SDL2](https://github.com/libsdl-org/SDL) | scrcpy 的窗口与音频输出 | zlib |
| [FFmpeg](https://ffmpeg.org/) | scrcpy 的音视频编解码 | LGPL / GPL（依构建配置） |
| [Electron](https://www.electronjs.org/) | 桌面运行时 | MIT |

完整清单与许可证全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

**本项目仅参考了 [QtScrcpy](https://github.com/barry-ran/QtScrcpy) 的架构思路（GPL-3.0），未使用其任何代码。**

## 隐私

Aoid 完全在本机运行，不连任何服务器，不收集任何数据。详见 [PRIVACY.md](PRIVACY.md)。

## 许可

本项目代码以 [MIT](LICENSE) 许可发布。随附的第三方二进制遵循各自许可。
