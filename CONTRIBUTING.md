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

## 提交信息

用一句话说明「改了什么、为什么」，例如：

```
修复 Android 16 上服务端启动即退出：改用 adb reverse 隧道
```