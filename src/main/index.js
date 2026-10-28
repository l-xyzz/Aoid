/**
 * 主进程入口。
 *
 * 这里只做三件事：判断运行环境、创建窗口、注册各域 IPC。
 * 具体功能都在 app/ device/ session/ ipc/ 下，按域分文件——
 * 单个文件超过几百行就会「改一处牵连全局」，这是之前反复出问题的根源。
 */
'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const {
  根目录,
  状态,
  数据目录,
  内置工具目录,
  scrcpy运行目录,
} = require('./core/context');

const { Adb } = require('./adb');
const { 设置存储 } = require('./settings');
const { 音频播放器 } = require('./audio');
const { 摄像头服务 } = require('./camera');
const { 麦克风桥 } = require('./microphone');
const { 虚拟摄像头 } = require('./virtual-camera');

const { 注册设备接口 } = require('./ipc/device');
const { 注册设置接口 } = require('./ipc/settings');
const { 注册画面接口 } = require('./ipc/screen');
const { 注册外设接口, 显示更多窗口 } = require('./ipc/features');
const { 注册键鼠接口 } = require('./ipc/peripherals');
const { 注册无线接口 } = require('./ipc/wireless');
const { 初始化回报监听, 启动电脑剪贴板监听 } = require('./session/session');

/* ------------------------------------------------------------------ */
/* 启动前守门                                                          */
/* ------------------------------------------------------------------ */

/**
 * 确认真的运行在 Electron 主进程里。
 *
 * 如果环境里残留 ELECTRON_RUN_AS_NODE，Electron 会以纯 Node 模式执行本文件，
 * app 变成 undefined，随后报一个和真实原因毫无关系的错误。
 * 这里直接给出可操作的提示。
 */
if (!app || typeof app.requestSingleInstanceLock !== 'function') {
  console.error(
    [
      'Aoid 没有运行在 Electron 主进程里。',
      '',
      '通常是因为环境变量 ELECTRON_RUN_AS_NODE 被设置了：',
      '  · 在 cmd 里执行：set "ELECTRON_RUN_AS_NODE=" 之后重试',
      '  · 或者直接双击项目根目录的「启动.bat」，它会自动清理这个变量',
    ].join('\n'),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 单实例                                                              */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  // 已经有一个实例在跑：把它的窗口带到前台，然后本进程退出。
  // 用户看到的现象是「双击没反应」，所以旧实例必须主动显形，
  // 否则会以为程序坏了（这个坑踩过）。
  app.quit();
} else {
  app.on('second-instance', () => {
    显示主窗口();
  });
  app.whenReady().then(初始化);
}

/** 把主窗口显示出来并聚焦（可能还没创建，就等它创建） */
function 显示主窗口() {
  if (!状态.窗口) {
    // 窗口还没建好（启动过程中又双击了一次）：等创建完成再加一步
    app.once('browser-window-created', () => {
      setTimeout(显示主窗口, 200);
    });
    return;
  }
  if (状态.窗口.isDestroyed()) return;
  if (状态.窗口.isMinimized()) 状态.窗口.restore();
  状态.窗口.show();
  状态.窗口.focus();
  状态.窗口.moveTop();
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function 创建窗口() {
  状态.窗口 = new BrowserWindow({
    // 默认窗口给足尺寸：手机是 1280×2772 的细长比例，
    // 窗口太小会把画面压到 20% 缩放，必然发糊。
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0b0c10',
    title: 'Aoid',
    icon: path.join(根目录, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 画面解码在渲染进程，关闭节流避免最小化后卡顿
      backgroundThrottling: false,
    },
  });

  状态.窗口.loadFile(path.join(根目录, 'src', 'renderer', 'index.html'));

  /*
   * 显示策略：三重保险，避免「双击没窗口」。
   *
   *   ready-to-show 依赖渲染进程画出首帧才触发。打包版首次启动时
   *   GPU 初始化、asar 解压都可能让首帧迟迟不来，窗口就永远不显示。
   *   所以再加两个兜底：dom-ready（DOM 就绪即可先显示黑底窗口）
   *   和 2.5 秒超时（无论如何把窗口拿出来）。
   */
  let 已显示 = false;
  const 显示窗口 = (原因) => {
    if (已显示 || !状态.窗口 || 状态.窗口.isDestroyed()) return;
    已显示 = true;
    clearTimeout(兜底定时);
    状态.窗口.show();
  };

  状态.窗口.once('ready-to-show', () => 显示窗口('ready-to-show'));
  状态.窗口.webContents.once('dom-ready', () => 显示窗口('dom-ready'));
  const 兜底定时 = setTimeout(() => 显示窗口('超时'), 2500);

  // 加载失败时把原因写进窗口标题，至少用户能看到出了什么事
  状态.窗口.webContents.on('did-fail-load', (事件, 错误码, 错误描述) => {
    显示窗口('加载失败');
    console.error('[窗口] 页面加载失败：' + 错误码 + ' ' + 错误描述);
  });

  状态.窗口.on('closed', () => {
    状态.窗口 = null;
  });
}

/* ------------------------------------------------------------------ */
/* 菜单                                                                */
/* ------------------------------------------------------------------ */

function 构建菜单() {
  const 模板 = [
    {
      label: '功能',
      submenu: [
        {
          id: '外设',
          label: '外设（摄像头 / 麦克风）',
          type: 'checkbox',
          checked: false,
          accelerator: 'CmdOrCtrl+Shift+M',
          click: (菜单项) => 显示更多窗口(菜单项.checked),
        },
        { type: 'separator' },
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => 状态.窗口?.webContents.send('菜单:打开设置', '通用'),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(模板));
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

async function 初始化() {
  状态.设置 = new 设置存储(数据目录());
  状态.adb = new Adb({
    toolDir: 内置工具目录(),
    dataDir: path.join(数据目录(), 'adb'),
  });

  状态.音频 = new 音频播放器({ scrcpy目录: scrcpy运行目录() });
  状态.摄像头 = new 摄像头服务({ scrcpy目录: scrcpy运行目录() });
  状态.麦克风 = new 麦克风桥({ scrcpy目录: scrcpy运行目录() });
  状态.虚拟摄像头 = new 虚拟摄像头({ 日志: () => {} });

  /*
   * 先建窗口，再探测 adb。
   *
   * 之前是 await 探测完才创建窗口：adb server 首次启动要几秒到几十秒，
   * 这段时间窗口根本不存在，用户双击后长时间什么都看不到，
   * 会以为程序没启动（打包版首次运行尤其明显）。
   * 窗口必须第一时间出来，adb 的事放到后台做。
   */
  创建窗口();
  构建菜单();

  注册设备接口();
  注册设置接口();
  注册画面接口();
  注册外设接口();
  注册键鼠接口();
  注册无线接口();
  初始化回报监听();
  启动电脑剪贴板监听();

  // 让界面在 adb 就绪后再开始拉列表，避免首屏报「无法启动 adb」
  状态.窗口?.webContents.once('did-finish-load', () => {
    状态.窗口?.webContents.send('启动:就绪', true);
  });

   // 窗口控制：用 handle 而非 on——preload 里是 ipcRenderer.invoke，
  // invoke 需要 handle 才能正确 resolve，用 on 会让 Promise 永远挂起。
  const { ipcMain } = require('electron');
  ipcMain.handle('窗口:最小化', () => { 状态.窗口?.minimize(); return true; });
  ipcMain.handle('窗口:最大化', () => {
    if (状态.窗口) {
      if (状态.窗口.isMaximized()) 状态.窗口.unmaximize();
      else 状态.窗口.maximize();
    }
    return true;
  });
  ipcMain.handle('窗口:关闭', () => { 状态.窗口?.close(); return true; });
  ipcMain.handle('窗口:是否最大化', () => Boolean(状态.窗口 && 状态.窗口.isMaximized()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) 创建窗口();
  });

  /*
   * adb 探测放到窗口出来之后再做，不阻塞启动。
   * 探测是幂等的，界面那边的「设备:列表」也会懒探测一次兜底。
   */
  准备adb().catch(() => {});
}

/** 后台探测 adb 并启动 adb server */
async function 准备adb() {
  try {
    const 探测结果 = await 状态.adb.探测();
    if (探测结果.ok) await 状态.adb.启动服务();
  } catch {
    // 没有 adb 也允许启动，界面上会给出引导
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  状态.音频?.停止();
  状态.摄像头?.关闭();
  状态.麦克风?.停止();
});