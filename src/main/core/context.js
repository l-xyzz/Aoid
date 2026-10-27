/**
 * 主进程共享上下文。
 *
 * 为什么要有这一层：
 *   之前所有状态都塞在主文件顶层的 `状态` 对象里，任何模块想用都得
 *   通过全局变量，导致文件之间隐式耦合、改动牵连极广。
 *   现在把「跨模块共享的东西」集中在这里，各模块显式 require 它，
 *   依赖关系一眼可见。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

/**
 * 应用根目录（打包后是 resources/app.asar）。
 *
 * 注意层级：本文件在 src/main/core/ 下，要向上**三级**才到项目根。
 * 写成两级会落到 src/ 里，导致所有资源路径都找不到（踩过）。
 */
const 根目录 = path.join(__dirname, '..', '..', '..');

/**
 * 运行期共享状态。
 *
 * 约定：
 *   - 主窗口用 窗口，独立窗口用 更多窗口，都只在这里持有引用
 *   - 设备相关的对象（通道/服务/音频/摄像头/麦克风）由 session 模块负责创建
 *   - settings 由 app 模块初始化后放进来
 */
const 状态 = {
  窗口: null,
  更多窗口: null,
  设置: null,
  adb: null,
  服务: null,
  通道: null,
  音频: null,
  摄像头: null,
  麦克风: null,
  虚拟摄像头: null,
  设备: '',
  设备信息: {},
  连接中: false,
  剪贴板序号: 1,
  最近剪贴板: '',
  手机剪贴板: '',
  剪贴板定时: null,
  状态定时: null,
  帧序号: 0,
  关键帧数: 0,
  最近帧时间: [],
  /** 界面上报的投屏显示尺寸，用于决定编码分辨率 */
  显示高度: 0,
  设备像素比: 1,
};

/** 主窗口的 webContents，用来推送事件 */
function 界面() {
  return 状态.窗口 && !状态.窗口.isDestroyed() ? 状态.窗口.webContents : null;
}

/**
 * 向界面推送事件。
 *
 * 注意：载荷必须是可结构化克隆的纯数据。
 * Node 的 Buffer 不能直接发（会报 An object could not be cloned），
 * 需要先转成 Uint8Array —— 这一点在视频帧那里踩过坑。
 */
function 推送(频道, 载荷) {
  const 目标 = 界面();
  if (!目标 || 目标.isDestroyed()) return;
  try {
    目标.send(频道, 载荷);
  } catch {
    // 界面正在销毁时发送会抛错，忽略即可
  }
}

/** 把任意值变成能安全传输的纯文本 */
function 安全文本(值) {
  if (值 == null) return '';
  if (typeof 值 === 'string') return 值;
  if (Buffer.isBuffer(值)) return 值.toString('utf8');
  if (值 instanceof Error) return 值.message;
  try {
    return JSON.stringify(值);
  } catch {
    return String(值);
  }
}

/** 把处理函数包成 IPC 的 { ok, data, error } 结构 */
function 包装(处理函数) {
  return async (...参数) => {
    try {
      return { ok: true, data: await 处理函数(...参数) };
    } catch (错误) {
      return { ok: false, error: (错误 && 错误.message) || String(错误) };
    }
  };
}

/** ipcMain.handle 的薄封装，统一错误结构 */
function 注册(频道, 处理函数) {
  // 关键：Electron 的 handler 第一个参数是 IpcMainInvokeEvent，业务数据在第二个。
  // 直接把全部参数展开传给业务函数，业务函数解构到的会是 event 对象，
  // 表现为「参数永远是空对象」——这个坑很隐蔽。
  ipcMain.handle(频道, async (事件, ...业务参数) => {
    try {
      return { ok: true, data: await 处理函数(...业务参数) };
    } catch (错误) {
      return { ok: false, error: (错误 && 错误.message) || String(错误) };
    }
  });
}

/**
 * 应用数据目录：便携版与开发态分开，避免互相污染。
 *
 * 函数而非常量：`app.isPackaged` / `app.getPath()` 只有主进程上下文才有值，
 * 顶层求值会在错误环境里抛一个与真实原因无关的错。
 */
function 数据目录() {
  const 已打包 = Boolean(app && app.isPackaged);
  let 用户目录 = path.join(根目录, '_data');
  try {
    if (app && typeof app.getPath === 'function') 用户目录 = app.getPath('userData');
  } catch {
    // 拿不到就退回项目内目录
  }
  return 已打包 ? 用户目录 : path.join(根目录, '_data');
}

/** 随应用附带的 adb 目录 */
function 内置工具目录() {
  const 候选 = [
    path.join(process.resourcesPath || 根目录, 'platform-tools'),
    path.join(根目录, 'platform-tools'),
  ];
  return 候选.find((目录) => require('node:fs').existsSync(path.join(目录, 'adb.exe'))) || 候选[0];
}

/** 官方 scrcpy 运行组件目录（scrcpy.exe + SDL2 + ffmpeg） */
function scrcpy运行目录() {
  const fs = require('node:fs');
  const 候选 = [
    path.join(process.resourcesPath || 根目录, 'scrcpy-runtime'),
    path.join(根目录, 'scrcpy-runtime'),
  ];
  return 候选.find((目录) => fs.existsSync(path.join(目录, 'scrcpy.exe'))) || 候选[0];
}

/** 画面服务端 jar */
function 服务端jar路径() {
  const fs = require('node:fs');
  const 候选 = [
    path.join(process.resourcesPath || 根目录, 'vendor', 'scrcpy-server-v5.0.1'),
    path.join(根目录, 'vendor', 'scrcpy-server-v5.0.1'),
  ];
  return 候选.find((文件) => fs.existsSync(文件)) || 候选[0];
}

module.exports = {
  根目录,
  状态,
  界面,
  推送,
  安全文本,
  包装,
  注册,
  数据目录,
  内置工具目录,
  scrcpy运行目录,
  服务端jar路径,
  BrowserWindow,
};