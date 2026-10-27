# Aoid 0.7.0-beta.2

> ⚠️ **这是开发阶段的测试版，存在较多缺陷，不建议用于生产环境。**
> 欢迎反馈，后续会持续接受意见、修复问题、优化体验。

用数据线把手机接到电脑上，在一个窗口里看画面、点屏幕、打字。
免安装、不需要在手机里装任何应用，也不需要 root。

---

## 下载

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `Aoid-0.7.0-beta.2-Setup.exe` | **安装包**（推荐） | 向导式安装，自动创建快捷方式，自带卸载程序 |
| `Aoid-0.7.0-beta.2-Portable.exe` | 便携版 | 单文件，双击即用，不写注册表 |
| `Aoid-0.7.0-beta.2-win-x64.zip` | 免安装目录 | 解压即用 |

**系统要求**：Windows 10 / 11（64 位）· 手机 Android 5.0+

> **首次运行会被 Windows 拦截**，提示「Windows 已保护你的电脑」。
> 这是没有代码签名证书的必然结果：点「**更多信息**」→「**仍要运行**」即可。

---

## 本版功能

- **实时画面** —— USB 传输 H.264，WebCodecs 硬解，实测 30~60fps
- **跟手触控** —— 按下、拖动、长按、滚轮即时转发
- **中文输入** —— 支持中文，走剪贴板粘贴，兼容性最好
- **常用按键** —— 返回 / 主页 / 任务 / 旋转 / 通知栏 / 控制中心，可自定义快捷键
- **无线调试** —— 配对码或 IP 直连，配对后脱离数据线
- **音量与亮度** —— 实时双向同步
- **截图** —— 保存手机原始分辨率无损 PNG，或复制到剪贴板
- **更多功能** —— 手机当电脑摄像头 / 麦克风，投屏到 OBS 虚拟摄像头
- **剪贴板同步** —— 默认关闭，开启后双向实时同步

## 已知问题

| 问题 | 现状 |
| --- | --- |
| 画面偶发卡顿 / 撕裂 | 持续优化中，切换分辨率时最明显 |
| 横竖屏热切换需要几秒恢复 | 已做锁帧 + 后台重连，期间画面短暂静止 |
| 无线连接稳定性 | 弱网下容易断，断线会自动重连 3 次 |
| 麦克风 / 虚拟摄像头 | 可用但未充分测试，需 VB-Cable / OBS |
| 代码签名 | 无，首次运行有 SmartScreen 提示 |
| 平台 | 仅 Windows x64 |

## 使用条件

- 手机需开启「开发者选项 → USB 调试」，插线后授权
- 无线调试需 Android 11 以上，且手机与电脑在同一 Wi-Fi
- 麦克风功能需安装 [VB-Cable](https://vb-audio.com/Cable/) 虚拟声卡（可选）
- 虚拟摄像头需安装 [OBS Studio](https://obsproject.com/)（可选）

## 反馈

遇到问题请先看 [已知问题](https://github.com/l-xyzz/Aoid#已知问题)，
再按 [Issue 模板](https://github.com/l-xyzz/Aoid/issues/new/choose) 反馈。
**请务必写明手机型号与 Android 版本**，这对定位设备相关问题非常关键。

---

## 安装包说明

- 默认装到 `%LOCALAPPDATA%\Programs\Aoid`，当前用户安装，**不弹 UAC**
- 安装时可自选目录
- 卸载：设置 → 应用 → 已安装的应用，或开始菜单「卸载 Aoid」
- 卸载会清理安装目录、快捷方式和注册表，但**保留用户数据**（`%APPDATA%\Aoid`），重装可继续使用

## 隐私

完全在本机运行，不连任何服务器，不收集任何数据。详见 [PRIVACY.md](https://github.com/l-xyzz/Aoid/blob/main/PRIVACY.md)。

## 许可

代码以 [MIT](https://github.com/l-xyzz/Aoid/blob/main/LICENSE) 发布。
第三方组件（scrcpy / adb / SDL2 / FFmpeg / Electron）遵循各自许可，
详见 [THIRD-PARTY-NOTICES.md](https://github.com/l-xyzz/Aoid/blob/main/THIRD-PARTY-NOTICES.md)。
