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
const { 注册输入法接口 } = require('./ipc/ime');
const { 注册工具接口 } = require('./ipc/tools');
const { 注册录屏接口 } = require('./ipc/recorder');
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
/*
 * 全局异常兜底。
 *
 * 打包版出现过「启动后进程静默退出、没有任何输出」的情况——
 * GUI 程序没有控制台，异常信息直接就没了，根本没法排查。
 * 这里把未捕获异常写进用户数据目录的 boot-error.log，至少留下现场。
 */
function 记录启动错误(类型, 错误) {
  try {
    const 日志目录 = app.getPath('userData');
    const 路径 = require('node:path').join(日志目录, 'boot-error.log');
    const 时间 = new Date().toISOString();
    const 文本 =
      '[' + 时间 + '] ' + 类型 + '\n' +
      (错误 && (错误.stack || 错误.message || String(错误))) + '\n\n';
    require('node:fs').appendFileSync(路径, 文本, 'utf8');
  } catch {
    // 连日志都写不了就没办法了
  }
}

process.on('uncaughtException', (错误) => {
  记录启动错误('uncaughtException', 错误);
});

process.on('unhandledRejection', (错误) => {
  记录启动错误('unhandledRejection', 错误);
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
/* 窗口类 IPC                                                          */
/* ------------------------------------------------------------------ */

/**
 * 注册窗口控制相关的 IPC。
 *
 * 单独抽成函数、并在初始化流程最前面调用，原因：
 *
 *   之前这些 handle 混在 初始化() 中段，前面任何一步抛错
 *   （某个模块构造失败、require 报错等）就会导致后面全部不执行，
 *   界面看到的是「No handler registered for 窗口:打开沉浸」，
 *   真正的原因被吞掉了，极难排查。
 *
 *   现在无论后面发生什么，窗口控制一定可用。
 */
function 注册窗口接口() {
  const { ipcMain, BrowserWindow } = require('electron');

  ipcMain.handle('窗口:最小化', () => {
    try { 状态.窗口?.minimize(); } catch {}
    return true;
  });

  ipcMain.handle('窗口:最大化', () => {
    try {
      if (状态.窗口) {
        if (状态.窗口.isMaximized()) 状态.窗口.unmaximize();
        else 状态.窗口.maximize();
      }
    } catch {}
    return true;
  });

  ipcMain.handle('窗口:关闭', () => {
    try { 状态.窗口?.close(); } catch {}
    return true;
  });

  ipcMain.handle('窗口:是否最大化', () => {
    try { return Boolean(状态.窗口 && 状态.窗口.isMaximized()); } catch { return false; }
  });

  /**
   * 渲染进程错误落盘。
   *
   * 排查「点击/拖动全失灵」这类问题时，CDP 经常不可用（连接卡 CloseWait），
   * 界面上也看不到异常。这条通道把渲染进程的错误写到
   * %TEMP%\aoid-render-errors.log，直接读文件就能定位。
   */
  ipcMain.handle('日志:渲染错误', (事件, 选项) => {
    try {
      const 列表 = (选项 && 选项.列表) || [];
      if (!Array.isArray(列表) || 列表.length === 0) return { ok: true };
      const os = require('node:os');
      const 路径 = path.join(os.tmpdir(), 'aoid-render-errors.log');
      const 内容 =
        '[' + new Date().toISOString() + ']\n' + 列表.map((x) => '  ' + x).join('\n') + '\n\n';
      fs.appendFileSync(路径, 内容, 'utf8');
      return { ok: true, 路径 };
    } catch {
      return { ok: false };
    }
  });

  /* ---------------- 沉浸模式（主窗口自身变形态） ---------------- */

  /**
   * 进入 / 退出沉浸模式。
   *
   * **不再创建第二个窗口。** 之前试过独立窗口 + capturePage 镜像、
   * 独立窗口 + 重新解码，都要么黑屏要么等待很久，根因是第二个窗口
   * 拿不到主窗口已经解好的画面。
   *
   * 现在直接让主窗口自己变形态：
   *   - 渲染进程切 body.沉浸中（隐藏侧栏、状态栏，保留悬浮标题栏）
   *   - 主进程把窗口缩到手机比例，允许自由缩放
   *   - 画面就是主窗口自己的 canvas，天然同步、零延迟、操作天然可用
   *
   * 关闭时还原原来的窗口尺寸与位置。
   */
  ipcMain.handle('窗口:沉浸模式', (事件, 选项) => {
    const 窗 = 状态.窗口;
    if (!窗 || 窗.isDestroyed()) return { ok: false };
    const 参数 = 选项 || {};

    if (参数.开启 === true) {
      // 记录进入前的状态，退出时还原
      if (!状态.沉浸前尺寸) {
        状态.沉浸前尺寸 = {
          最大化: 窗.isMaximized(),
          边界: 窗.getBounds(),
        };
      }
      if (窗.isMaximized()) 窗.unmaximize();

      const 比例 = Number(参数.宽高比) || 1280 / 590; // 高 / 宽
      const 屏高 = Number(参数.限高) || 900;
      const 屏宽 = Number(参数.限宽) || 1200;

      // 顶栏在沉浸模式下是悬浮的，不占布局高度，所以窗口高 = 画面高
      let 高 = Math.max(320, Math.round(屏高));
      let 宽 = Math.round(高 / 比例);
      if (宽 > 屏宽) {
        宽 = Math.max(180, Math.round(屏宽));
        高 = Math.round(宽 * 比例);
      }

      窗.setResizable(true);
      窗.setMinimumSize(160, 240);
      窗.setContentSize(宽, 高, false);
      窗.center();

      /*
       * 通知渲染进程切布局。
       * 必须显式发一条，而不是靠渲染进程自己判断 ——
       * 尺寸变化事件在渲染进程里分不清「用户拖窗口」和「进入沉浸」。
       */
      窗.webContents.send('窗口:沉浸已切换', { 开启: true, 宽, 高 });
      return { ok: true, 宽, 高 };
    }

    // 退出沉浸：还原窗口
    const 旧 = 状态.沉浸前尺寸;
    状态.沉浸前尺寸 = null;
    窗.setMinimumSize(900, 600);
    if (旧 && 旧.边界) {
      窗.setBounds(旧.边界, false);
      if (旧.最大化) 窗.maximize();
    }
    窗.webContents.send('窗口:沉浸已切换', { 开启: false });
    return { ok: true };
  });

  /** 兼容旧接口：关闭沉浸 = 退出沉浸模式 */
  ipcMain.handle('窗口:关闭沉浸', () => {
    const 窗 = 状态.窗口;
    if (!窗 || 窗.isDestroyed()) return { ok: true };
    const 旧 = 状态.沉浸前尺寸;
    状态.沉浸前尺寸 = null;
    窗.setMinimumSize(900, 600);
    if (旧 && 旧.边界) {
      窗.setBounds(旧.边界, false);
      if (旧.最大化) 窗.maximize();
    }
    窗.webContents.send('窗口:沉浸已切换', { 开启: false });
    return { ok: true };
  });

  /*
   * 注意：不再有 窗口:沉浸校正 / 窗口:沉浸控制 这两个 IPC。
   *
   * 沉浸模式现在是主窗口自己变形态，缩放窗口就是缩放主窗口，
   * 画面由渲染进程按窗口尺寸自动适配，不需要主进程去校正比例，
   * 也没有「另一个窗口」需要最小化/最大化/关闭。
   */
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

async function 初始化() {
  // 窗口类 IPC 最先注册：即使后面某个模块初始化失败，
  // 用户至少还能关窗口、能开沉浸，不会因为一个异常全废。
  注册窗口接口();

  状态.设置 = new 设置存储(数据目录());

  /*
   * 启动计数。
   *
   * 必须放在 状态.设置 创建之后 —— 之前放在 whenReady 外层，
   * 那时 状态.设置 还是 null，计数永远是 0。
   *
   * 第 3 次启动时弹一次开源项目提示：让用户先真正用过两次再开口，
   * 一上来就求 Star 会让人反感。弹过就打个标记，之后不再打扰。
   */
  try {
    const 次数 = (Number(状态.设置.数据?.启动次数) || 0) + 1;
    状态.设置.更新({ 启动次数: 次数 });
    if (次数 === 3 && 状态.设置.数据?.已提示开源 !== true) {
      状态.该提示开源 = true;
    }
  } catch {
    // 计数失败不影响启动
  }
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
  注册输入法接口();
  注册工具接口();
  注册录屏接口();
  注册无线接口();
  初始化回报监听();
  启动电脑剪贴板监听();

  // 让界面在 adb 就绪后再开始拉列表，避免首屏报「无法启动 adb」
  状态.窗口?.webContents.once('did-finish-load', () => {
    状态.窗口?.webContents.send('启动:就绪', true);
  });

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

/*
 * 退出前彻底释放所有资源。
 *
 * 之前只停了音频/摄像头/麦克风，没管投屏通道和 adb 转发。
 * 结果安装新版本时，NSIS 要覆盖 Aoid.exe，而残留的进程与文件句柄
 * 让它写不进去 —— 用户看到的就是「进度条一直闪、提示无法关闭、
 * 点取消直接退出、点重试才能装成功」。
 */
/*
 * 退出前清理资源。
 *
 * 之前的写法是 preventDefault + 异步清理 + app.exit(0)，
 * 这套组合很脆弱：一旦 preventDefault 生效而 app.exit 没走到
 * （异步清理里某一步卡住、Promise 链断掉），窗口就再也关不掉，
 * 用户只能去任务管理器强杀。
 *
 * 改成最简单可靠的同步清理：
 *   - before-quit 里同步关掉摄像头/麦克风/音频的子进程
 *   - 不 preventDefault，让 Electron 走正常退出流程
 *
 * 同步 kill 子进程不会阻塞（kill 是异步信号，立即返回），
 * 所以这里不需要 async。
 */
app.on('before-quit', () => {
  try { 状态.沉浸窗口?.destroy?.(); } catch {}
  try { 状态.音频?.停止(); } catch {}
  try { 状态.摄像头?.关闭(); } catch {}
  try { 状态.麦克风?.停止(); } catch {}
  try { 状态.虚拟摄像头?.关闭?.(); } catch {}
});
