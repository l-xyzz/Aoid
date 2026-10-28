# 贡献指南

感谢你愿意帮忙。这个项目很小，规则也很简单：**能读到、能验证、不糊弄**。

## 提交前

```bash
npm install
npm start          # 确认能连上手机、画面正常、点得动
npm run lint       # 主进程语法检查
```

改动涉及界面时，请附一张截图；改动涉及协议时，请说明在什么机型 / Android 版本上验证过。

## 代码约定

- **注释用中文**，写「为什么」而不是「做了什么」。看不懂的取巧之处必须解释。
- **变量与函数名用中文**，但**协议字段、第三方 API 名保持原文**
  （例如 `INJECT_TOUCH_EVENT`、`updateend`），方便对照上游文档。
- 不要为了「兼容」引入第二套实现，除非注释里写清楚为什么必须两套。
- 主进程里禁止拼接 shell 字符串；一律用 `spawn(可执行文件, [参数数组])`。
- 界面拿不到 Node API，新增能力必须经过 `preload.js` 白名单。

## 已知的坑（改代码前请先读）

| 现象 | 原因 | 处理方式 |
| --- | --- | --- |
| android 16 上服务端启动即 abort | `adb shell` 不允许设置 `ANDROID_SOCKET_*`，`tunnel_forward=true` 不可用 | 必须用 `adb reverse localabstract:scrcpy_<scid> tcp:<端口>` |
| 服务端报 `For input string under radix 16` | `scid` 需是 32 位有符号整数 | 生成时限制在 `0x10000000 ~ 0x7fffffff` |
| 画面全黑但帧率正常 | 关键帧标记没传到界面，解码器一直等关键帧 | 主进程推送 `{数据, 关键帧}`，界面据此启动解码 |
| 用 `<video>` 播不了 | 浏览器只吃容器格式，裸 H.264 会被 demuxer 拒绝 | 用 WebCodecs + canvas |
| adb 报 `cannot open adb.log: Permission denied` | 系统临时目录里同名文件被占用 | 换一个可写的临时目录，或先删掉该 log |

## 第三方组件

- `vendor/scrcpy-server-v5.0.1` 来自 scrcpy 官方 Release，请勿自行修改；
  升级时运行 `node scripts/fetch-scrcpy-server.mjs --update`，它会校验 SHA-256。
- 新增依赖前请想清楚：这个项目刻意保持「零运行时依赖」，只在开发期用 Electron 与 electron-builder。

## 打包

### 命令

```bash
npm run dist:safe   # 推荐：一次产出安装包 + 便携版 + zip
npm run dist        # 直接调 electron-builder，只有安装包 + 便携版
npm run dist:dir    # 只生成免安装目录 win-unpacked，不封装（最快，适合调试）
```

首次打包 `nsis` / `portable` 目标时，electron-builder 需要下载 NSIS 工具链（约 2MB）。
若访问 GitHub Releases 受限，可手动下载后放进缓存：

```
%LOCALAPPDATA%\electron-builder\Cache\downloads\
  nsis-3.0.4.1.7z
  nsis-resources-3.4.1.7z
```

来源：`https://github.com/electron-userland/electron-builder-binaries/releases/download/<标签>/<文件名>`

### 产物

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `Aoid-<版本>-Setup.exe` | 安装包 | NSIS 向导式，自带卸载程序，建快捷方式 |
| `Aoid-<版本>-Portable.exe` | 便携版 | 单文件，不写注册表 |
| `Aoid-<版本>-win-x64.zip` | 免安装目录 | 解压即用 |

产物默认输出到 `release/`。

### 重要：不要在网络盘上打包或运行

**Electron 无法从网络驱动器启动**。如果项目放在映射的 Z: 盘：

- 产物落在 Z 盘 → 双击 exe 毫无反应、不报错、不生成日志
- `npm run dist:safe` 正是为此写的：它先把项目复制到 `%LOCALAPPDATA%\AoidBuild`，
  用 junction 链接 `node_modules`，在本地磁盘完成构建，再把产物复制回来

手动打包时如果项目在网络盘，请自行把产物移到本地磁盘再验证。

### 打包配置要点

`electron-builder.yml` 里几个不能随便动的地方：

- `files` 必须包含 `README.md` / `CHANGELOG.md` / `LICENSE` / `PRIVACY.md` / `THIRD-PARTY-NOTICES.md`
  —— 应用内「关于」「隐私」页要在运行时读取它们，漏了就会报「文档不存在」
- `extraResources` 把 `vendor/` `scrcpy-runtime/` `platform-tools/` 放在 asar 之外，
  因为要用 `spawn` 直接执行，asar 内的文件无法被外部进程读取
- `nsis.perMachine: false` 表示装到当前用户目录，不弹 UAC
- `nsis.deleteAppDataOnUninstall: false` 表示卸载保留用户设置

### 发布流程

```bash
# 1. 改 package.json 的 version
# 2. 打包
npm run dist:safe
# 3. 提交并打标签
git add -A && git commit -m "chore: 发布 <版本>"
git tag v<版本>
git push origin main --tags
# 4. 创建 Release（预发布用 --prerelease）
gh release create v<版本> --title "Aoid <版本>" --notes-file .github/RELEASE_NOTES.md \
  --prerelease release/Aoid-<版本>-Setup.exe \
  release/Aoid-<版本>-Portable.exe \
  release/Aoid-<版本>-win-x64.zip
```

> `Aoid.exe` 有 200MB 以上，**不要提交进 Git 仓库**（GitHub 单文件上限 100MB）。
> 二进制一律走 Release 附件（上限 2GB）。

## 提交信息

用一句话说明「改了什么、为什么」，例如：

```
修复 Android 16 上服务端启动即退出：改用 adb reverse 隧道
```