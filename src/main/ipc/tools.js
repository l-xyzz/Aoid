/**
 * 更多功能窗口的后端：应用管理、进程管理、文件管理、ADB 控制台。
 *
 * 这些功能都只是把 adb 的能力包一层，不做任何"智能化"处理：
 * 用户看到的应该和 `adb shell` 里看到的一致，这样出问题时好排查。
 */
'use strict';

const fsApi = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { BrowserWindow, dialog } = require('electron');
const { 状态, 注册, 推送, 安全文本, 根目录 } = require('../core/context');

function 取设备() {
  if (!状态.adb || !状态.设备) throw new Error('还没有连接设备');
  return 状态.设备;
}

/** 全局鼠标跟踪的定时器（拖动期间才跑） */
let 鼠标跟踪定时 = null;

function 停止跟踪鼠标() {
  if (鼠标跟踪定时) {
    clearInterval(鼠标跟踪定时);
    鼠标跟踪定时 = null;
  }
}

/** 跑一条 adb 命令，返回 stdout（控制台用） */
function 跑命令(序列号, 命令, 超时 = 30000) {
  if (!状态.adb || !状态.adb.adbPath) throw new Error('adb 还没有准备好');
  return new Promise((解析) => {
    const 开始 = Date.now();
    execFile(
      状态.adb.adbPath,
      ['-s', 序列号, 'shell', 命令],
      { timeout: 超时, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
      (错误, stdout, stderr) => {
        解析({
          输出: Buffer.concat([stdout || Buffer.alloc(0), stderr || Buffer.alloc(0)]).toString('utf8'),
          退出码: 错误 ? (错误.code || 1) : 0,
          耗时: Date.now() - 开始,
        });
      },
    );
  });
}

/**
 * 从 `cmd package list packages` 之外再补一次应用显示名。
 *
 * 难点：Android 没有「一条命令列出所有应用名」的稳定接口。
 *   - pm list packages        只有包名
 *   - dumpsys package <pkg>   有 labelRes 但没有文字（要自己解资源）
 *   - 用 aapt 读 APK         要额外二进制，且系统 APK 读不到
 *
 * 实测可行且足够的做法：读每个 APK 里的 `resources.arsc` 太复杂，
 * 退一步用 **Launcher 的活动标签** —— `cmd package query-activities`
 * 能一次拿到所有 LAUNCHER 入口及其 label，覆盖了「用户能点开的应用」，
 * 正好就是应用管理里要展示的那批。
 *
 * 拿不到就返回空表，界面用包名兜底，不影响使用。
 */
function 提取应用标签(文本) {
  const 表 = new Map();
  /*
   * query-activities 的输出形如：
   *   Activity #0:
   *     ...
   *     packageName=com.tencent.mm
   *     nonLocalizedLabel=微信
   */
  let 当前包 = '';
  for (const 行 of String(文本 || '').split(/\r?\n/)) {
    const 包匹配 = /packageName=([\w.]+)/.exec(行);
    if (包匹配) {
      当前包 = 包匹配[1];
      continue;
    }
    const 标签匹配 = /nonLocalizedLabel=(.+?)(?:\s|$)/.exec(行);
    if (标签匹配 && 当前包 && !表.has(当前包)) {
      const 标签 = 标签匹配[1].trim();
      if (标签 && 标签 !== 'null') 表.set(当前包, 标签);
    }
  }
  return 表;
}

function 注册工具接口() {
  /** 显示 / 隐藏工具窗口 */
  注册('工具:显示窗口', async ({ 显示 }) => {
    显示工具窗口(显示 !== false);
    return { ok: true };
  });

  /**
   * 开始 / 结束「全局鼠标跟踪」。
   *
   * 用途：用户按住拖手机画面时，把鼠标甩出应用窗口外，
   * 浏览器就收不到 pointermove 了，拖动会停在窗口边缘不动。
   *
   * 解法：拖动期间由主进程用 screen.getCursorScreenPoint() 读**系统级**
   * 鼠标坐标（不依赖窗口焦点和边界），定期推给渲染进程，
   * 渲染进程换算成手机坐标继续发送移动事件。
   *
   * 这样表现就和触摸屏一致：手指滑出屏幕边缘，内容继续跟着走。
   */
  注册('工具:跟踪鼠标', async ({ 开启 }) => {
    停止跟踪鼠标();
    if (开启 !== true) return { ok: true };

    const { screen } = require('electron');
    const 主窗 = 状态.窗口;
    if (!主窗 || 主窗.isDestroyed()) return { ok: false };

    /*
     * 报的是「窗口客户区内的坐标」，由主进程自己算 ——
     * getCursorScreenPoint 给的是屏幕坐标，必须减去窗口内容区的位置，
     * 否则多显示器、窗口移动后坐标全错。
     *
     * 用 16ms（约 60fps）轮询，和屏幕刷新率对齐。
     */
    鼠标跟踪定时 = setInterval(() => {
      if (!主窗 || 主窗.isDestroyed()) {
        停止跟踪鼠标();
        return;
      }
      try {
        const 点 = screen.getCursorScreenPoint();
        const 边界 = 主窗.getContentBounds();
        主窗.webContents.send('工具:鼠标位置', {
          x: 点.x - 边界.x,
          y: 点.y - 边界.y,
          // 同时带上窗口尺寸，渲染进程据此判断是否越界
          宽: 边界.width,
          高: 边界.height,
        });
      } catch {
        // 窗口正在销毁时取边界会抛，忽略
      }
    }, 16);

    return { ok: true };
  });

  /**
   * ADB 控制台独立窗口。
   *
   * 从「更多功能」里拆出来单独成一个窗口，原因：
   *   - 控制台是「常驻、边看边敲」的工具，和文件管理/应用管理那种
   *     「点进去做完就走」的用途不同
   *   - 独立窗口可以和主窗口并排摆着，一边看手机画面一边敲命令
   *   - 也避免在标签页之间来回切
   */
  注册('工具:显示控制台', async ({ 显示 }) => {
    显示控制台窗口(显示 !== false);
    return { ok: true };
  });

  /** 弹出文件选择框，返回 apk 路径 */
  注册('工具:选择apk', async () => 选择apk());

  /* ================= 应用管理 ================= */

  /** 列出已安装应用（含系统应用标记 + 应用显示名称） */
  注册('工具:应用列表', async () => {
    const 序列号 = 取设备();
    // -f 带 apk 路径，-3 只列第三方，我们两个都列然后标出来
    const { stdout } = await 状态.adb.设备shell(
      序列号,
      'pm list packages -f 2>/dev/null',
      { timeout: 20000 },
    );

    const 列表 = [];
    for (const 行 of stdout.split(/\r?\n/)) {
      const 修剪 = 行.trim();
      if (!修剪.startsWith('package:')) continue;
      // package:/data/app/xxx/base.apk=com.example.app
      const 体 = 修剪.slice('package:'.length);
      const 等号 = 体.lastIndexOf('=');
      if (等号 < 0) continue;
      const apk路径 = 体.slice(0, 等号);
      const 包名 = 体.slice(等号 + 1);
      列表.push({
        包名,
        apk路径,
        系统: apk路径.startsWith('/system') || apk路径.startsWith('/product'),
        名称: '',
      });
    }

    /*
     * 取应用显示名称。
     *
     * 用 `cmd package query-activities` 一次拿到所有 LAUNCHER 入口及其 label，
     * 覆盖了「用户能点开的应用」，正好就是应用管理要展示的那批。
     *
     * 为什么不用 dumpsys package：那里只有 labelRes（资源 ID），
     * 要拿到文字得自己解 resources.arsc，代价太大。
     */
    try {
      const { stdout: 活动文本 } = await 状态.adb.设备shell(
        序列号,
        'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER 2>/dev/null',
        { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
      );
      const 标签表 = 提取应用标签(活动文本);
      for (const 项 of 列表) {
        if (标签表.has(项.包名)) 项.名称 = 标签表.get(项.包名);
      }
    } catch {
      // 拿不到名称就用包名兜底，功能不受影响
    }

    列表.sort((a, b) => {
      // 有名称的按名称排，没有的按包名排
      const a键 = a.名称 || a.包名;
      const b键 = b.名称 || b.包名;
      return a键.localeCompare(b键, 'zh-CN');
    });
    return 列表;
  });

  /** 打开应用 */
  注册('工具:启动应用', async ({ 包名 }) => {
    const 序列号 = 取设备();
    const { stdout } = await 状态.adb.设备shell(
      序列号,
      `monkey -p ${包名} -c android.intent.category.LAUNCHER 1 2>&1`,
      { timeout: 15000 },
    );
    return { 输出: 安全文本(stdout) };
  });

  /** 强制停止 */
  注册('工具:停止应用', async ({ 包名 }) => {
    const 序列号 = 取设备();
    await 状态.adb.设备shell(序列号, `am force-stop ${包名}`, { timeout: 15000 });
    return { ok: true };
  });

  /** 卸载 */
  注册('工具:卸载应用', async ({ 包名 }) => {
    const 序列号 = 取设备();
    const { stdout } = await 状态.adb.设备shell(序列号, `pm uninstall ${包名}`, { timeout: 60000 });
    const 成功 = /Success/i.test(stdout);
    if (!成功) throw new Error('卸载失败：' + 安全文本(stdout).trim());
    return { ok: true };
  });

  /** 安装电脑上的 apk */
  注册('工具:安装应用', async ({ 本地路径 }) => {
    const 序列号 = 取设备();
    let 源文件 = String(本地路径 || '');
    let 临时文件 = null;

    /*
     * 处理 xxx.apk.1。
     *
     * 这类文件本身是完整 apk，只是被聊天软件改了名（微信/QQ/Telegram 常见），
     * 但 adb install 与 Android 的包解析器都靠扩展名判断格式，
     * 直接塞 .1 会报「无法解析包」。所以复制一份改成 .apk 再装，
     * 装完删掉临时文件，不动用户的原文件。
     */
    if (/\.apk\.\d+$/i.test(源文件)) {
      const os = require('node:os');
      临时文件 = path.join(os.tmpdir(), 'Aoid-install-' + Date.now() + '.apk');
      await fsp.copyFile(源文件, 临时文件);
      源文件 = 临时文件;
    }

    try {
      const 结果 = await 状态.adb.安装apk(序列号, 源文件);
      return { 输出: 安全文本(结果) };
    } finally {
      if (临时文件) fsp.unlink(临时文件).catch(() => {});
    }
  });

  /* ================= 进程管理 ================= */

  /** 列出进程（按内存排序） */
  注册('工具:进程列表', async () => {
    const 序列号 = 取设备();
    // ps -A 在 Android 8+ 可用；旧的用 ps。这里优先试 -A
    let { stdout } = await 状态.adb.设备shell(序列号, 'ps -A -o PID,RSS,NAME 2>/dev/null', {
      timeout: 20000,
    });
    if (!stdout.trim()) {
      ({ stdout } = await 状态.adb.设备shell(序列号, 'ps 2>/dev/null', { timeout: 20000 }));
    }

    const 列表 = [];
    const 行们 = stdout.split(/\r?\n/);
    // 找到表头，确定列位置
    const 表头行 = 行们.find((l) => /PID/i.test(l));
    if (!表头行) return [];

    for (const 行 of 行们) {
      const 修剪 = 行.trim();
      if (!修剪 || 修剪 === 表头行.trim()) continue;
      const 段 = 修剪.split(/\s+/);
      // 最后一段是进程名，前两段是 PID / 内存
      const PID = Number(段[0]);
      if (!Number.isFinite(PID)) continue;
      const RSS = Number(段[1]) || 0;
      const 名称 = 段.slice(2).join(' ');
      if (!名称) continue;
      列表.push({ PID, 内存KB: RSS, 名称 });
    }

    // 内存大的排前面
    列表.sort((a, b) => b.内存KB - a.内存KB);
    return 列表.slice(0, 300);
  });

  /** 结束进程 */
  注册('工具:结束进程', async ({ pid }) => {
    const 序列号 = 取设备();
    await 状态.adb.设备shell(序列号, `kill -9 ${Number(pid)} 2>&1`, { timeout: 10000 });
    return { ok: true };
  });

  /* ================= 文件管理 ================= */

  /** 列出手机目录 */
  注册('工具:手机目录', async ({ 目录 }) => {
    const 序列号 = 取设备();
    return 状态.adb.列出路径(序列号, 目录);
  });

  /** 删除手机文件 */
  注册('工具:手机删除', async ({ 路径: 目标, 是否目录 }) => {
    const 序列号 = 取设备();
    await 状态.adb.删除路径(序列号, 目标, 是否目录 === true);
    return { ok: true };
  });

  /* ---- 手机端文件操作：重命名 / 移动 / 复制 ---- */

  /** 重命名手机上的文件或目录 */
  注册('工具:手机重命名', async ({ 路径: 目标, 新名 }) => {
    const 名字 = String(新名 || '').trim();
    if (!名字) throw new Error('名称不能为空');
    if (/[\/]/.test(名字)) throw new Error('名称不能包含 / 或 \\');
    const 序列号 = 取设备();
    const 新路径 = await 状态.adb.重命名路径(序列号, 目标, 名字);
    return { ok: true, 路径: 新路径 };
  });

  /** 手机内部移动（剪切 → 粘贴） */
  注册('工具:手机移动', async ({ 源, 目标目录 }) => {
    const 序列号 = 取设备();
    const 目标 = await 状态.adb.移动路径(序列号, 源, 目标目录);
    return { ok: true, 路径: 目标 };
  });

  /** 手机内部复制（复制 → 粘贴） */
  注册('工具:手机复制', async ({ 源, 目标目录 }) => {
    const 序列号 = 取设备();
    const 目标 = await 状态.adb.复制路径(序列号, 源, 目标目录);
    return { ok: true, 路径: 目标 };
  });

  /** 手机 → 电脑：下载 */
  注册('工具:下载文件', async ({ 设备路径, 本地路径 }) => {
    const 序列号 = 取设备();
    await 状态.adb.拉取(序列号, 设备路径, 本地路径);
    return { ok: true };
  });

  /** 电脑 → 手机：上传 */
  注册('工具:上传文件', async ({ 本地路径, 设备路径 }) => {
    const 序列号 = 取设备();
    try {
      /*
       * 拖放进来的默认目标是 /sdcard/Aoid/——这个目录第一次用的时候还不存在，
       * 直接 push 会失败（adb 不会替你建目录），所以先 mkdir -p。
       * 设备路径也可能是具体文件名（文件管理页里上传），那种情况 mkdir 会失败，
       * catch 掉就行。
       */
      await 状态.adb.设备shell(序列号, `mkdir -p "${设备路径}"`).catch(() => {});
      await 状态.adb.推送(序列号, 本地路径, 设备路径);
    } catch (错误) {
      // 把路径和真实原因带出去，别让界面只剩一句「操作失败」
      throw new Error(`${本地路径} → ${设备路径}｜${错误?.message || 错误}`);
    }
    return { ok: true };
  });

  /** 列出电脑目录（文件管理右栏用） */
  /**
   * 列出电脑上的所有盘符（Windows）。
   *
   * 之前「上级」只能一路退到 C:\，用户就卡在 C 盘出不去——
   * 因为没地方可以选 D:、E:。这里单独给一个盘符列表，
   * 界面在上层目录时可以切到别的盘。
   */
  注册('工具:盘符列表', async () => {
    if (process.platform !== 'win32') return [{ 名称: '/', 路径: '/' }];

    /*
     * 并发探测所有盘符，并且给每个探测加超时。
     *
     * 空光驱、待机的移动硬盘、断开的网络映射盘在 fs.stat 时会卡住
     * 几十秒甚至更久。串行等待会让整个盘符列表迟迟不出现，
     * 用户看到的就是「读取失败」或者一片空白。
     * 这里并发发起，超时就当那个盘不可用。
     */
    const 探测 = 600; // 毫秒
    const 任务 = [];
    for (let i = 65; i <= 90; i += 1) {
      const 字母 = String.fromCharCode(i);
      任务.push(
        Promise.race([
          fsp
            .stat(字母 + ':/')
            .then((状态) => (状态.isDirectory() ? 字母 : null))
            .catch(() => null),
          new Promise((解析) => setTimeout(() => 解析(null), 探测)),
        ]),
      );
    }

    const 结果 = await Promise.all(任务);
    const 列表 = [];
    for (const 字母 of 结果) {
      if (!字母) continue;
      列表.push({
        名称: 字母 + ':',
        /*
         * 路径必须带冒号再跟一个反斜杠，拼成 "G:\"。
         * 原实现写成了 String.fromCharCode(i) + "\\"，少了冒号，
         * 得到的是 "G\"，readdir 会报 ENOENT —— 就是「读不了磁盘」的根因。
         */
        路径: 字母 + ':\\',
      });
    }

    return 列表;
  });

  注册('工具:电脑目录', async ({ 目录 }) => {
    /*
     * 空目录 = 回到「盘符列表」视图。
     * 界面传空字符串时表示"我要看有哪些盘"，
     * 这样用户在任意深度都能一键回到根。
     */
    if (!目录) {
      return { 目录: '', 父目录: null, 是根: true, 条目: [] };
    }

    const 目标 = 目录;

    // 读不到目录要明确报错，不能静默返回空列表——
    // 否则界面会显示"无项目"，用户以为盘是空的
    let 项们;
    try {
      项们 = await fsp.readdir(目标, { withFileTypes: true });
    } catch (错误) {
      throw new Error(
        '读不了这个目录：' + 目标 + '（' + (错误.code || 错误.message) + '）',
      );
    }

    const 条目 = [];
    for (const 项 of 项们) {
      try {
        const 信息 = await fsp.stat(path.join(目标, 项.name));
        条目.push({
          名称: 项.name,
          是否目录: 信息.isDirectory(),
          字节: 信息.size,
          修改时间: 信息.mtime.toISOString().slice(0, 16).replace('T', ' '),
        });
      } catch {
        // 无权限的项跳过
      }
    }
    条目.sort((a, b) => {
      if (a.是否目录 !== b.是否目录) return a.是否目录 ? -1 : 1;
      return a.名称.localeCompare(b.名称, 'zh');
    });
    /*
     * 算出父目录。
     *
     * 注意「是根」的语义：它表示"要显示盘符列表"，只有目录为空时才成立。
     * 盘根（C:\）虽然也没有父目录，但它**不是**盘符列表视图，
     * 否则界面会把 C 盘的内容当成盘符那一屏来渲染，一个个盘看起来就"没有项目"了。
     */
    const 父目录 = path.dirname(目标);
    const 已在盘根 = 父目录 === 目标;

    // 盘根时"上级"应该回到盘符列表（传空串），所以父目录给 null
    return { 目录: 目标, 父目录: 已在盘根 ? null : 父目录, 是根: false, 条目 };
  });

  /* ================= ADB 控制台 ================= */

  /**
   * 执行一条命令。
   *
   * 注意这里是**真正的 shell 执行**，用户自己负责写什么。
   * 不做任何过滤：这是"进阶工具"的定位，用户要的就是原生能力。
   * 为了安全，只允许通过 adb shell 执行，不会落到电脑的 shell 上。
   */
  /* ---- 电脑文件操作：打开 / 重命名 / 移动(剪切粘贴) ---- */

  /**
   * 用系统默认方式打开一个文件或文件夹。
   *
   * shell.openPath 会交给 Windows 用关联程序打开：
   *   .txt → 记事本、.png → 看图、文件夹 → 资源管理器。
   * 返回空字符串表示成功，非空字符串是错误说明。
   */
  注册('工具:电脑打开', async ({ 路径: 目标 }) => {
    const { shell } = require('electron');
    const 错误 = await shell.openPath(目标);
    if (错误) throw new Error('打不开：' + 错误);
    return { ok: true };
  });

  /** 重命名（同目录内改名，也可用于修改扩展名） */
  注册('工具:电脑重命名', async ({ 路径: 目标, 新名 }) => {
    const path = require('node:path');
    const 名字 = String(新名 || '').trim();
    if (!名字) throw new Error('名称不能为空');
    if (/[\\/:*?"<>|]/.test(名字)) {
      throw new Error('名称不能包含 \\ / : * ? " < > | 这些字符');
    }

    const 所在目录 = path.dirname(目标);
    const 新路径 = path.join(所在目录, 名字);

    if (新路径 === 目标) return { ok: true, 路径: 目标 };

    // 目标已存在时不覆盖，避免误删
    if (fsApi.existsSync(新路径)) {
      throw new Error('同一目录下已经有同名文件了');
    }

    await fsp.rename(目标, 新路径);
    return { ok: true, 路径: 新路径 };
  });

  /**
   * 移动文件或目录（剪切 → 粘贴）。
   *
   * 同盘直接 rename 是瞬时的；跨盘 rename 会报 EXDEV，
   * 这时退回「复制 + 删除」。
   */
  注册('工具:电脑移动', async ({ 源, 目标目录 }) => {
    const path = require('node:path');
    const 目标 = path.join(目标目录, path.basename(源));

    if (目标 === 源) throw new Error('源和目标在同一个位置');
    if (fsApi.existsSync(目标)) throw new Error('目标目录里已经有同名项了');

    try {
      await fsp.rename(源, 目标);
    } catch (错误) {
      if (错误.code !== 'EXDEV') throw 错误;
      // 跨盘：先复制再删原件
      await fsp.cp(源, 目标, { recursive: true });
      await fsp.rm(源, { recursive: true, force: true });
    }
    return { ok: true, 路径: 目标 };
  });

  /** 复制（复制 → 粘贴） */
  /** 删除电脑上的文件或目录 */
  注册('工具:电脑删除', async ({ 路径: 目标 }) => {
    if (!目标) throw new Error('没有指定路径');
    await fsp.rm(目标, { recursive: true, force: true });
    return { ok: true };
  });

  注册('工具:电脑复制', async ({ 源, 目标目录 }) => {
    const path = require('node:path');
    const 目标 = path.join(目标目录, path.basename(源));
    if (目标 === 源) throw new Error('源和目标在同一个位置');
    if (fsApi.existsSync(目标)) throw new Error('目标目录里已经有同名项了');
    await fsp.cp(源, 目标, { recursive: true });
    return { ok: true, 路径: 目标 };
  });

  注册('工具:执行命令', async ({ 命令 }) => {
    const 序列号 = 取设备();
    const 内容 = String(命令 || '').trim();
    if (!内容) throw new Error('命令为空');
    return 跑命令(序列号, 内容);
  });

  /**
   * 命令补全数据。
   *
   * 直接内置一份常用表：常见命令、常用包路径、常用参数。
   * 比调用 `compgen` 可靠（Android 的 shell 是 toybox，支持有限）。
   */
  注册('工具:补全表', async () => ({
    命令: [
      'ls', 'cd', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'ps', 'grep', 'find',
      'top', 'df', 'du', 'id', 'whoami', 'date', 'uptime', 'uname',
      'getprop', 'setprop', 'dumpsys', 'wm', 'input', 'am', 'pm', 'service',
      'settings', 'cmd', 'logcat', 'screenrecord', 'screencap', 'monkey',
      'pidof', 'kill', 'killall', 'pkill', 'echo', 'sleep', 'chmod', 'chown',
    ],
    常用: [
      'wm size', 'wm density', 'wm size reset',
      'settings get system screen_brightness', 'settings put system screen_brightness 128',
      'input keyevent 26', 'input keyevent 3', 'input keyevent 4',
      'dumpsys battery', 'dumpsys window | grep mCurrentFocus',
      'getprop ro.product.model', 'getprop ro.build.version.release',
      'pm list packages', 'pm list packages -3', 'am force-stop',
      'top -n 1', 'df -h /data',
    ],
    路径: [
      '/sdcard', '/sdcard/Download', '/sdcard/DCIM', '/sdcard/Pictures',
      '/data/local/tmp', '/system', '/proc', '/proc/meminfo',
    ],
  }));
}


/**
 * 显示或隐藏「更多功能」窗口。
 *
 * 做成独立窗口的理由：这是一组工具（应用、进程、文件、控制台），
 * 用户可能要一边看文件列表一边在控制台敲命令，
 * 塞进主界面会把投屏区域挤得没法看。
 */
/**
 * ADB 控制台独立窗口。
 *
 * 和「更多功能」窗口完全独立：单独的 BrowserWindow、单独的状态字段，
 * 关掉互不影响。用户可以一边看着主窗口的手机画面，一边在旁边敲 adb 命令。
 */
function 显示控制台窗口(显示) {
  if (显示 === false) {
    if (状态.控制台窗口 && !状态.控制台窗口.isDestroyed()) 状态.控制台窗口.close();
    return;
  }

  if (状态.控制台窗口 && !状态.控制台窗口.isDestroyed()) {
    状态.控制台窗口.show();
    状态.控制台窗口.focus();
    return;
  }

  状态.控制台窗口 = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 560,
    minHeight: 380,
    title: 'Aoid ADB 控制台',
    parent: 状态.窗口,
    modal: false,
    show: false,
    backgroundColor: '#0d0e12',
    autoHideMenuBar: true,
    icon: path.join(根目录, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  状态.控制台窗口.setMenuBarVisibility(false);
  状态.控制台窗口.loadFile(path.join(根目录, 'src', 'renderer', 'console.html'));

  /*
   * 三重保险把窗口拿出来（ready-to-show 依赖首帧渲染，可能迟迟不触发）。
   */
  let 已显示 = false;
  const 拿出来 = () => {
    if (已显示 || !状态.控制台窗口 || 状态.控制台窗口.isDestroyed()) return;
    已显示 = true;
    状态.控制台窗口.show();
  };

  状态.控制台窗口.once('ready-to-show', 拿出来);
  状态.控制台窗口.webContents.once('dom-ready', 拿出来);
  setTimeout(拿出来, 1200);

  状态.控制台窗口.on('closed', () => {
    状态.控制台窗口 = null;
  });
}

function 显示工具窗口(显示) {
  if (显示 === false) {
    if (状态.工具窗口 && !状态.工具窗口.isDestroyed()) 状态.工具窗口.close();
    return;
  }

  if (状态.工具窗口 && !状态.工具窗口.isDestroyed()) {
    状态.工具窗口.show();
    状态.工具窗口.focus();
    return;
  }

  状态.工具窗口 = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'Aoid 更多功能',
    parent: 状态.窗口,
    modal: false,
    show: false,
    backgroundColor: '#0d0e12',
    autoHideMenuBar: true,
    icon: path.join(根目录, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  状态.工具窗口.setMenuBarVisibility(false);

  /*
   * 显示窗口要三重保险。
   *
   * 只靠 ready-to-show 是不够的：它依赖渲染进程画出首帧，
   * 打包环境或 GPU 初始化慢的时候可能一直不触发，窗口就永远不显示
   * （主窗口早期也踩过这个坑）。
   *   - ready-to-show：正常路径
   *   - dom-ready：DOM 就绪就先显示
   *   - 1.5 秒兜底：无论如何把窗口拿出来
   */
  let 已显示 = false;
  const 显示窗口 = () => {
    if (已显示) return;
    if (!状态.工具窗口 || 状态.工具窗口.isDestroyed()) return;
    已显示 = true;
    状态.工具窗口.show();
    状态.工具窗口.focus();
  };

  状态.工具窗口.once('ready-to-show', 显示窗口);
  状态.工具窗口.webContents.once('dom-ready', 显示窗口);
  const 兜底 = setTimeout(显示窗口, 1500);
  状态.工具窗口.once('closed', () => clearTimeout(兜底));

  // 渲染进程报错要记下来，否则"按钮点不动"时完全没线索
  状态.工具窗口.webContents.on('console-message', (事件, 等级, 消息, 行, 源) => {
    if (等级 >= 2) console.error('[工具窗口] ' + 源 + ':' + 行 + ' ' + 消息);
  });
  状态.工具窗口.webContents.on('preload-error', (事件, 路径, 错误) => {
    console.error('[工具窗口] preload 出错:', 路径, 错误);
  });

  状态.工具窗口.webContents.on('did-fail-load', (事件, 码, 描述) => {
    console.error('[工具窗口] 页面加载失败：', 码, 描述);
    显示窗口();
  });

  状态.工具窗口.loadFile(path.join(根目录, 'src', 'renderer', 'tools.html'));

  状态.工具窗口.on('closed', () => {
    状态.工具窗口 = null;
  });
}

/**
 * 选一个 apk 文件。
 * 单独走主进程的 dialog，是因为渲染进程拿不到真实文件路径。
 */
function 选择apk(窗口) {
  return new Promise((解析) => {
    dialog
      .showOpenDialog(窗口 || 状态.窗口, {
        title: '选择要安装的 APK',
        properties: ['openFile'],
        filters: [
          // 必须列出 1：聊天软件会把 apk 改名成 xxx.apk.1 以躲过系统检测，
          // 这时扩展名其实是 1，只写 apk 会让文件框里看不到它
          { name: 'Android 应用', extensions: ['apk', '1', 'apks', 'xapk'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      .then((结果) => {
        if (结果.canceled || !结果.filePaths.length) 解析(null);
        else 解析(结果.filePaths[0]);
      })
      .catch(() => 解析(null));
  });
}

module.exports = { 注册工具接口, 显示工具窗口 };
