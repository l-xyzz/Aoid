# Aoid 下载与安装说明

> ⚠️ **开发阶段测试版**，存在较多缺陷，不建议用于生产环境。欢迎反馈问题。

---

## 下载哪个

| 文件 | 用途 | 适合谁 |
| --- | --- | --- |
| **`Aoid-<版本>-Setup.exe`** | **安装包**（推荐） | 大多数人。向导式安装，自动建快捷方式，自带卸载程序 |
| `Aoid-<版本>-Portable.exe` | 便携版 | 不想安装、想放 U 盘带着走、或用完就删 |
| `Aoid-<版本>-win-x64.zip` | 免安装目录 | 内网批量分发，解压即用 |

不确定就选 **Setup.exe（安装包）**。

---

## 安装包

1. 双击 `Aoid-<版本>-Setup.exe`
2. 如果 Windows 弹「已保护你的电脑」→ 点「**更多信息**」→「**仍要运行**」
3. 可自选安装目录（默认 `%LOCALAPPDATA%\Programs\Aoid`）
4. 装完自动启动，并建好开始菜单与桌面快捷方式

**不需要管理员权限**，不会弹 UAC。

### 卸载

任选一种：

- 设置 → 应用 → 已安装的应用 → 找到「Aoid <版本>」→ 卸载
- 开始菜单 → 右键 Aoid → 卸载
- 直接运行安装目录里的 `Uninstall Aoid.exe`

卸载会清理安装目录、快捷方式和注册表项，但**保留你的设置与历史设备**（在 `%APPDATA%\Aoid`）。
想彻底清干净，卸载后手动删掉这个目录即可。

---

## 便携版

直接双击 `Aoid-<版本>-Portable.exe` 就能用，不写注册表、不建快捷方式。
放到 U 盘里换台电脑也能跑。

---

## 免安装目录（zip）

解压到**本地磁盘**（如 D 盘），双击里面的 `Aoid.exe`。

> ⚠️ **不要解压到网络驱动器**（如映射的 Z 盘）。Electron 无法从网络驱动器启动，
> 双击会毫无反应、也不报错。这是已知限制。

---

## 首次使用

### 1. 开启手机的 USB 调试

1. 手机「设置 → 关于手机」，连点「版本号」7 次，开启开发者选项
2. 进入「开发者选项」，打开「**USB 调试**」

### 2. 连接

1. 用数据线把手机接到电脑
2. 手机弹出「允许 USB 调试吗？」时点「**允许**」
3. 启动 Aoid，左侧会立刻出现这台设备，点它即可看到画面

### 3. 无线调试（可选，Android 11 以上）

1. 手机与电脑连同一个 Wi-Fi
2. 手机「开发者选项 → 无线调试」→ 开启
3. 点「使用配对码配对设备」，记下 **IP:端口** 和 **6 位配对码**
4. Aoid 里「添加设备 → 无线连接」，填入配对信息，点「配对」

---

## 系统要求

- **电脑**：Windows 10 / 11（64 位）
- **手机**：Android 5.0 以上

---

## Windows 拦截提示

首次运行会显示「Windows 已保护你的电脑 / Windows Defender SmartScreen 阻止了无法识别的应用」。

**这不是病毒，是因为本项目没有购买代码签名证书。**

处理方法：

1. 点弹窗里的「**更多信息**」
2. 点「**仍要运行**」

如果连「更多信息」都没有，右键 exe → 属性 → 勾选「解除锁定」→ 确定，再运行。

---

## 遇到问题

1. 先看 [README 的已知问题](https://github.com/l-xyzz/Aoid#已知问题)
2. 再搜 [现有 Issues](https://github.com/l-xyzz/Aoid/issues)
3. 还没有就 [新建 Issue](https://github.com/l-xyzz/Aoid/issues/new/choose)

**提 Issue 时请务必写明**：

- 手机型号与 Android 版本
- 电脑系统版本
- 连接方式（USB / 无线）
- 复现步骤，以及界面上显示了什么

没有这些信息很难定位设备相关的问题。

---

## 隐私

完全在本机运行，不连任何服务器，不收集任何数据。
详见 [PRIVACY.md](https://github.com/l-xyzz/Aoid/blob/main/PRIVACY.md)。

## 许可

代码以 [MIT](https://github.com/l-xyzz/Aoid/blob/main/LICENSE) 发布。
第三方组件（scrcpy / adb / SDL2 / FFmpeg / Electron）遵循各自许可，
详见 [THIRD-PARTY-NOTICES.md](https://github.com/l-xyzz/Aoid/blob/main/THIRD-PARTY-NOTICES.md)。
