# Aoid 1.0.0

**首个正式版。** 用数据线把 Android 手机接到电脑上——实时画面、跟手触控、文字输入，外加一整套工具箱。

**First stable release.** Control your Android phone from your Windows PC over USB — live screen, responsive touch, text input, and a full toolbox.

| | |
| --- | --- |
| 🖥 平台 / Platform | Windows 10 / 11 (64-bit) |
| 📱 手机 / Phone | Android 5.0+ |
| 📦 体积 / Size | ~115–135 MB |

---

## 下载 / Download

| 文件 / File | 用途 / Purpose | 说明 / Notes |
| --- | --- | --- |
| **`Aoid-1.0.0-Setup.exe`** | **安装包（推荐）** / **Installer** (recommended) | 向导式安装，建快捷方式，自带卸载程序 / Guided install, creates shortcuts, includes an uninstaller |
| `Aoid-1.0.0-Portable.exe` | 便携版 / Portable | 单文件，双击即用，不写注册表 / Single file, no registry writes |
| `Aoid-1.0.0-win-x64.zip` | 免安装目录 / Unpacked folder | 解压即用 / Extract and run |

> **Windows 首次运行会拦截**，提示「Windows 已保护你的电脑」。这是没有代码签名证书的正常现象，点「**更多信息**」→「**仍要运行**」。
>
> **Windows will warn you on first launch** — "Windows protected your PC". Expected without a code-signing certificate. Click **More info** → **Run anyway**.

---

## 1.0.0 新增 / What's new

### 自动更新 / Auto-update

检查 GitHub Releases，显示当前版本、新版本和完整更新说明，确认后才下载。
便携版自动替换并重启；安装版下载安装程序并交给它升级。
连不上 GitHub 时会 ping 百度，区分「完全没有网络」和「网络正常但 GitHub 被墙」。

Checks GitHub Releases, shows current and new version plus the full changelog, and only downloads after you confirm.
Portable replaces itself and restarts; installer hands off to the setup. If GitHub is unreachable, Aoid pings Baidu to distinguish *no network* from *GitHub blocked*.

### 更多功能窗口 / Toolbox window

独立的工具窗口，五个页面 / A separate toolbox window with five pages:

- **应用管理 / App manager** — 列出、启动、停止、卸载应用，安装电脑上的 APK（支持被聊天软件改名成 `.apk.1` 的文件）/ list, launch, stop, uninstall apps; install APKs from your PC, including `.apk.1` files
- **进程管理 / Process manager** — 按内存排序，可结束进程 / processes sorted by memory, kill what you need
- **文件管理 / File manager** — 左手机右电脑双栏，记住上次位置，可切换任意磁盘 / phone on the left, PC on the right; remembers location, switchable drives
- **外设 / Peripherals** — 手机当摄像头或麦克风 / use the phone as webcam or microphone
- **ADB 控制台 / ADB console** — 命令历史、Tab 补全、语法高亮、输出可选中复制 / history, Tab completion, syntax highlighting, selectable output

### 录屏 / Screen recording

把手机画面录成 MP4，主窗口一键操作。 / Record the phone screen to MP4 from the main window.

### 键鼠直连 / Keyboard and mouse passthrough

电脑的鼠标键盘直接控制手机——移动、点击、滚轮、按键全部转发。
Your PC's mouse and keyboard drive the phone directly — movement, clicks, scroll, keystrokes.

### 输入法直连（试验）/ IME passthrough (experimental)

用电脑自己的输入法打字，选完词整段送到手机，英文输入不受影响。
Type with your own PC input method; the chosen word goes to the phone. English typing is unaffected.

### 多语言 / Multi-language

内置简体中文与英文界面，支持加载第三方语言包（把 JSON 放进数据目录即可，可用 AI 生成任意语言）。
English and Simplified Chinese built in; third-party language packs loaded from a JSON file you drop into the data folder — generate one with any LLM.

---

## 1.0.0 修复 / Fixes

| 问题 / Issue | 根因 / Root cause |
| --- | --- |
| 文档打不开 / Documents wouldn't open | 启动脚本没复制 md 文件 / Launch script wasn't copying markdown files |
| 设置点击穿透到手机 / Settings clicks reached the phone | 触控没有检查浮层 / Touch handler didn't check overlays |
| 剪贴板同步三处问题 / Clipboard sync broken three ways | 缺回声防护 + 自写内容污染 / Missing echo guards; self-written clipboard polluted the real one |
| 鼠标拖出画面后停顿 / Dragging stalled outside the frame | 越界坐标被丢弃 / Out-of-bounds coordinates dropped instead of clamped |
| Tab 和 Esc 键被界面抢走 / Tab and Esc hijacked by UI | 没有阻止浏览器默认行为 / Default browser behaviour not prevented |
| 文档窗口跑到右下角 / Dialog appeared bottom-right | 动画覆盖了居中 transform / Entrance animation overrode the centring transform |
| 文件管理盘根显示为空 / File manager showed empty drives | 盘根被误判成盘符列表 / Drive root misread as drive-list view |
| 外设页报错 / Peripherals page errored | iframe 拿不到 preload / iframe can't access the preload bridge |
| 文档无法滚动 / Documents couldn't scroll | 后加载样式覆盖了 flex 滚动属性 / Later stylesheet overrode flex scrolling |

---

## 要求 / Requirements

- Windows 10 / 11，64 位
- Android 5.0 或更新
- 手机需开启 USB 调试：设置 → 关于手机 → 连点「版本号」7 次 → 开发者选项 → USB 调试

完整说明在应用内：**设置 → 关于 → 使用说明**。
Full instructions inside the app: **Settings → About → User guide**.

---

## 已知限制 / Known limitations

- 仅支持 Windows x64，暂不打算做 macOS / Linux
- 无线调试在弱网下可能断开（自动重试 3 次）
- 摄像头与麦克风功能可用，但未在多机型上充分测试
- 横竖屏切换需要一两秒恢复
- 无代码签名，首次运行会弹 SmartScreen

---

## 反馈 / Feedback

Bug 与功能建议都非常欢迎——这仍是早期项目，设备相关的兼容问题很难一个人覆盖全。

**提 Issue 请务必写明**：手机型号、Android 版本、连接方式（USB / 无线）、复现步骤。

- 🐛 [报告问题 / Report a bug](https://github.com/l-xyzz/Aoid/issues/new/choose)
- 💡 [功能建议 / Request a feature](https://github.com/l-xyzz/Aoid/issues/new/choose)

---

## 隐私 / Privacy

完全在本机运行，不连服务器，不收集数据。/ Runs entirely on your machine. No telemetry, no accounts.
详见 / See [PRIVACY.md](https://github.com/l-xyzz/Aoid/blob/main/PRIVACY.md).

## 许可 / License

代码以 [MIT](https://github.com/l-xyzz/Aoid/blob/main/LICENSE) 发布。
第三方二进制（scrcpy / adb / SDL2 / FFmpeg / Electron）遵循各自许可，详见 [THIRD-PARTY-NOTICES.md](https://github.com/l-xyzz/Aoid/blob/main/THIRD-PARTY-NOTICES.md)。
