/**
 * 设备相关 IPC：连接、断开、历史记录、按键与触控。
 *
 * 拆成独立文件的意义：这些接口以前和设置、音频、摄像头全挤在一个
 * 1200 行的函数里，改一处容易碰坏别的域。现在一个域一个文件，
 * 依赖显式、边界清楚。
 */
'use strict';

const { 状态, 注册, 推送, 安全文本, 数据目录, 根目录 } = require('../core/context');
const { 连接设备, 断开连接 } = require('../session/session');

/**
 * 设备管理独立窗口。
 *
 * 主界面左栏只有 268px 宽，设备多的时候塞不下重命名、详情这些操作，
 * 所以单独开一个窗口：在线/离线分两个列表，每台设备带一个操作下拉。
 */
function 显示设备窗口(显示) {
  const { BrowserWindow } = require('electron');
  const path = require('node:path');

  if (显示 === false) {
    if (状态.设备窗口 && !状态.设备窗口.isDestroyed()) 状态.设备窗口.close();
    return;
  }

  if (状态.设备窗口 && !状态.设备窗口.isDestroyed()) {
    状态.设备窗口.show();
    状态.设备窗口.focus();
    return;
  }

  状态.设备窗口 = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 520,
    minHeight: 420,
    title: 'Aoid 设备管理',
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

  状态.设备窗口.setMenuBarVisibility(false);
  状态.设备窗口.loadFile(path.join(根目录, 'src', 'renderer', 'devices.html'));

  let 已显示 = false;
  const 拿出来 = () => {
    if (已显示 || !状态.设备窗口 || 状态.设备窗口.isDestroyed()) return;
    已显示 = true;
    状态.设备窗口.show();
  };
  状态.设备窗口.once('ready-to-show', 拿出来);
  状态.设备窗口.webContents.once('dom-ready', 拿出来);
  setTimeout(拿出来, 1200);

  状态.设备窗口.on('closed', () => {
    状态.设备窗口 = null;
  });
}

/** 记住一台设备（连接成功时调用，同一台只留一条） */
function 记住设备(序列号, 信息) {
  const 设置 = 状态.设置.获取();
  const 列表 = Array.isArray(设置.历史设备) ? 设置.历史设备.slice() : [];
  const 无线 = /:\d+$/.test(序列号);

  const 新项 = {
    序列号,
    名称: (信息 && 信息.model) || 序列号,
    型号: (信息 && 信息.product) || '',
    方式: 无线 ? '无线' : 'USB',
    最后连接: Date.now(),
  };

  const 过滤后 = 列表.filter((项) => 项.序列号 !== 序列号);
  过滤后.unshift(新项);
  状态.设置.更新({ 历史设备: 过滤后.slice(0, 20) });
}

/** 检查手机当前是否有聚焦的输入框 */
async function 检查输入焦点() {
  try {
    const 文本 = await 状态.服务.执行(状态.设备, 'dumpsys input_method', { timeout: 8000 });
    if (/mInputShown=true/.test(文本)) return true;
    const 连接 = 文本.match(/mServedInputConnection[=:]?\s*(\S+)/);
    if (连接 && !/^null$/.test(连接[1])) return true;
    return false;
  } catch {
    // 查不到时不拦着用户，宁可多打一次也不要让人以为坏了
    return true;
  }
}

/**
 * 用「剪贴板 + 粘贴键」把文本送进手机输入框。
 *
 * 中文不能走 adb input text（非 ASCII 直接抛异常），
 * 也不能靠 scrcpy 的 INJECT_TEXT（依赖输入法，国产 ROM 常失效）。
 * 剪贴板粘贴是所有 Android 版本、所有输入法都支持的路子。
 */
function 剪贴板粘贴输入(文本) {
  return new Promise((解析) => {
    try {
      const 序号 = (状态.剪贴板序号 = (状态.剪贴板序号 || 0) + 1);
      状态.通道.设置剪贴板(文本, 序号);
      setTimeout(() => {
        try {
          状态.通道.按键(279); // KEYCODE_PASTE
          解析(true);
        } catch {
          解析(false);
        }
      }, 220);
    } catch {
      解析(false);
    }
  });
}

function 注册设备接口() {
  /* ---- 连接与设备列表 ---- */
  注册('设备:列表', async () => {    if (!状态.adb) throw new Error('adb 还没有准备好');
    // 懒探测：首次调用时若 adbPath 为空，先探测一次。
    // 初始化是异步的，界面可能比它先调用到这里。
    if (!状态.adb.adbPath) {
      const 结果 = await 状态.adb.探测();
      if (!结果.ok) throw new Error('没有找到 adb，请先准备运行环境');
      await 状态.adb.启动服务().catch(() => {});
    }
    const 列表 = await 状态.adb.列出设备();
    /*
     * 补一次市场名。
     * devices -l 给的 model 是内部代号（例如 M332BF），用户根本认不出是哪台机器；
     * 真正的名字在 ro.product.marketname 里（REDMI K90 Ultra）。
     * 结果在 Adb 内部按序列号缓存，同一台设备只会多查一次。
     */
    await 状态.adb.补全型号(列表);
    return 列表;
  });

  /* 与「设备:列表」等价，兼容 preload 里声明过的「设备:刷新」 */
  注册('设备:刷新', async () => {
    if (!状态.adb) throw new Error('adb 还没有准备好');
    if (!状态.adb.adbPath) {
      const 结果 = await 状态.adb.探测();
      if (!结果.ok) throw new Error('没有找到 adb，请先准备运行环境');
      await 状态.adb.启动服务().catch(() => {});
    }
    const 列表 = await 状态.adb.列出设备();
    /*
     * 补一次市场名。
     * devices -l 给的 model 是内部代号（例如 M332BF），用户根本认不出是哪台机器；
     * 真正的名字在 ro.product.marketname 里（REDMI K90 Ultra）。
     * 结果在 Adb 内部按序列号缓存，同一台设备只会多查一次。
     */
    await 状态.adb.补全型号(列表);
    return 列表;
  });

  /* 界面在连接前上报投屏区域的实际高度，主进程据此决定编码分辨率 */
  注册('设备:设置显示尺寸', async ({ 高度, 像素比 }) => {
    状态.显示高度 = Number(高度) || 0;
    状态.设备像素比 = Number(像素比) || 1;
    return { 高度: 状态.显示高度, 像素比: 状态.设备像素比 };
  });

  注册('设备:连接', async ({ serial, 序列号 }) => {
    // preload 传的是 { serial }，这里两种写法都兼容，避免以后再踩
    const 目标 = serial || 序列号;
    if (!目标) throw new Error('缺少设备序列号');
    const 信息 = await 连接设备(目标);
    记住设备(目标, 状态.设备信息);
    return 信息;
  });

  注册('设备:断开', async () => {
    await 断开连接();
    return true;
  });

  /*
   * 只重新读取分辨率，不重建通道。
   *
   * 横竖屏切换后比例不对时用它：重连整条通道要好几秒，
   * 而这里只跑一次 `wm size`，几十毫秒就能拿到新尺寸。
   */
  注册('设备:刷新分辨率', async () => {
    const { 刷新分辨率 } = require('../session/session');
    return 刷新分辨率();
  });

  /* ---- 历史设备 ---- */
  注册('设备:历史', async () => {
    const 设置 = 状态.设置.获取();
    const 列表 = Array.isArray(设置.历史设备) ? 设置.历史设备 : [];
    return 列表.map((项) => ({ ...项, 在线: Boolean(状态.设备 && 状态.设备 === 项.序列号) }));
  });

  注册('设备:删除历史', async ({ 序列号 }) => {
    const 设置 = 状态.设置.获取();
    const 列表 = Array.isArray(设置.历史设备) ? 设置.历史设备 : [];
    const 剩余 = 列表.filter((项) => 项.序列号 !== 序列号);
    状态.设置.更新({ 历史设备: 剩余 });
    return 剩余.length;
  });

  /**
   * 重命名设备。
   *
   * 只改「历史设备」里的显示名，不动 adb 侧任何东西。
   * 在线设备如果还没进历史列表，会先补一条再改名，
   * 这样「刚插上就改名」也能存下来。
   */
  注册('设备:重命名', async ({ 序列号, 名称 }) => {
    const 新名 = String(名称 || '').trim();
    if (!序列号) throw new Error('缺少序列号');
    if (!新名) throw new Error('名称不能为空');
    if (新名.length > 40) throw new Error('名称太长了（最多 40 个字）');

    const 设置 = 状态.设置.获取();
    const 列表 = Array.isArray(设置.历史设备) ? [...设置.历史设备] : [];
    const 序号 = 列表.findIndex((项) => 项.序列号 === 序列号);

    if (序号 >= 0) {
      列表[序号] = { ...列表[序号], 名称: 新名 };
    } else {
      const 在线 = 状态.设备 === 序列号;
      列表.push({
        序列号,
        名称: 新名,
        型号: 在线 ? 状态.设备信息?.model || '' : '',
        最后连接: Date.now(),
      });
    }

    状态.设置.更新({ 历史设备: 列表 });
    return 列表;
  });

  /** 设备详情：型号、系统、分辨率、电量等（离线也能看到历史信息） */
  注册('设备:详情', async ({ 序列号 }) => {
    const 目标 = 序列号 || 状态.设备;
    if (!目标) throw new Error('缺少序列号');
    if (!状态.adb) throw new Error('adb 还没有准备好');

    const 信息 = { 序列号: 目标 };

    // 历史记录先垫底（离线设备也有名字和型号可看）
    try {
      const 设置 = 状态.设置.获取();
      const 历史 = Array.isArray(设置.历史设备) ? 设置.历史设备 : [];
      const 记录 = 历史.find((项) => 项.序列号 === 目标);
      if (记录) {
        信息.名称 = 记录.名称 || '';
        信息.上次连接 = 记录.最后连接 || 0;
      }
    } catch {
      // 读不到历史就算了
    }

    if (状态.设备 !== 目标) return { ...信息, 在线: false };

    // 在线设备补一批实况数据，每条单独 try，缺哪个都不影响其它
    const 读 = async (命令) => {
      try {
        const { stdout } = await 状态.adb.设备shell(目标, 命令, { timeout: 8000 });
        return String(stdout || '').trim();
      } catch {
        return '';
      }
    };

    信息.在线 = true;
    信息.型号 = (await 读('getprop ro.product.model')) || 状态.设备信息?.model || '';
    信息.品牌 = (await 读('getprop ro.product.brand')) || 状态.设备信息?.brand || '';
    信息.系统版本 = (await 读('getprop ro.build.version.release')) || '';
    信息.分辨率 = (await 读('wm size')).replace(/^Physical size:\s*/i, '');
    const 电量文本 = await 读('dumpsys battery');
    const 百分比 = /level:\s*(\d+)/.exec(电量文本);
    if (百分比) 信息.电量 = Number(百分比[1]);

    return 信息;
  });

  /** 打开 / 关闭设备管理窗口 */
  注册('设备:显示窗口', async ({ 显示 }) => {
    显示设备窗口(显示 !== false);
    return { ok: true };
  });

  /**
   * 打开某台设备的独立投屏窗口。
   *
   * **语义：这是个「一次性投屏」，关掉窗口就断开该设备。**
   * 所以窗口的生命周期直接和设备连接绑在一起：
   *   - 打开时：先连上这台设备（内部会重建 scrcpy 通道）
   *   - 关闭时：断开连接
   *
   * 为什么不做成「多个窗口同时投多台设备」：
   *   当前会话层是单设备的（状态.通道 / 状态.设备 各只有一个），
   *   要支持并发投屏得把整条会话链路改成按序列号索引的多实例，
   *   改动面很大、也容易引入新的时序问题。
   *   先把「独立窗口 + 关闭即断开」这个实用形态做稳，
   *   真正的并发多投留到会话层重构时再上。
   */
  注册('设备:打开投屏窗口', async (参数) => {
    const { BrowserWindow } = require('electron');
    const path = require('node:path');
    const 序列号 = String((参数 && 参数.序列号) || '').trim();
    if (!序列号) throw new Error('缺少设备序列号');

    if (!状态.投屏窗口们) 状态.投屏窗口们 = {};

    // 已经开着就直接聚焦
    const 已有 = 状态.投屏窗口们[序列号];
    if (已有 && !已有.isDestroyed()) {
      已有.show();
      已有.focus();
      return { ok: true, 已存在: true };
    }

    // 先连上这台设备（失败就直接抛给界面，不建空窗口）
    if (状态.设备 !== 序列号 || !状态.通道) {
      await 连接设备(序列号);
    }

    const 窗 = new BrowserWindow({
      width: 420,
      height: 880,
      minWidth: 240,
      minHeight: 400,
      title: 'Aoid · ' + 序列号,
      parent: 状态.窗口,
      modal: false,
      show: false,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      icon: path.join(根目录, 'resources', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 隐藏/最小化时也要继续解码，否则画面会停
        backgroundThrottling: false,
      },
    });

    状态.投屏窗口们[序列号] = 窗;
    窗.setMenuBarVisibility(false);
    窗.loadFile(path.join(根目录, 'src', 'renderer', 'cast.html'), {
      query: { 序列号 },
    });

    let 已显示 = false;
    const 拿出来 = () => {
      if (已显示 || !窗 || 窗.isDestroyed()) return;
      已显示 = true;
      窗.show();
    };
    窗.once('ready-to-show', 拿出来);
    窗.webContents.once('dom-ready', 拿出来);
    setTimeout(拿出来, 1500);

    /*
     * 窗口关闭 = 断开这台设备。
     * 这是需求明确要求的语义（「一个关闭后直接断开的沉浸窗口」）。
     */
    窗.on('closed', () => {
      if (状态.投屏窗口们) delete 状态.投屏窗口们[序列号];
      // 只断开当前连接的就是这台的情况，避免误断别的设备
      if (状态.设备 === 序列号) {
        try {
          断开连接().catch(() => {});
        } catch {
          // 已经断了就算了
        }
      }
    });

    return { ok: true };
  });

  /**
   * 投屏窗口按手机比例校正自身高度。
   *
   * 渲染进程不能直接改窗口尺寸，必须请主进程代劳。
   * 刻意不复用「窗口:沉浸校正」—— 那个改的是**主窗口**，
   * 在投屏窗口里调用会把主窗口尺寸也一起改掉。
   */
  注册('设备:投屏校正', async (参数) => {
    const 序列号 = String((参数 && 参数.序列号) || '').trim();
    const 窗 = 状态.投屏窗口们 && 状态.投屏窗口们[序列号];
    if (!窗 || 窗.isDestroyed()) return { ok: false };

    const 比例 = Number(参数.宽高比) || 0;
    if (!比例) return { ok: false };

    try {
      const 尺寸 = 窗.getContentSize();
      const 当前的宽 = 尺寸[0];
      const 当前的高 = 尺寸[1];
      const 宽 = Math.max(200, Math.round(参数.当前宽 || 当前的宽));
      const 高 = Math.max(300, Math.round(宽 * 比例));
      if (Math.abs(高 - 当前的高) > 4) 窗.setContentSize(宽, 高, false);
      return { ok: true, 宽, 高 };
    } catch {
      return { ok: false };
    }
  });

  /* ---- 按键 ---- */
  注册('设备:按键', async ({ key, 键码, 修饰键 }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.按键(key ?? 键码, 修饰键 || 0);
    return true;
  });

  注册('设备:返回', async () => {
    if (!状态.通道) throw new Error('还没有连接设备');
    // 用 adb 发返回键：scrcpy 的 BACK_OR_SCREEN_ON 在屏幕已亮时行为依赖
    // 服务端状态，实测「返回成功但手机不动」，adb keyevent 4 是确定的。
    await 状态.服务.执行(状态.设备, 'input keyevent 4', { timeout: 8000 });
    return true;
  });

  注册('设备:通知栏', async () => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.通知栏();
    return true;
  });

  注册('设备:快捷设置', async () => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.快捷设置();
    return true;
  });

  注册('设备:旋转', async () => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.旋转();
    return true;
  });

  /* ---- 文本输入 ---- */
  注册('设备:输入文本', async ({ 文本 }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    const 内容 = String(文本 ?? '');
    if (!内容) throw new Error('内容为空');

    const 有输入框 = await 检查输入焦点();
    if (!有输入框) {
      // 标记成自写：剪贴板同步循环会跳过它，不会把用户真正的剪贴板顶掉
      状态.自写剪贴板 = 内容;
      require('electron').clipboard.writeText(内容);
      return { 已输入: false, 原因: '手机当前没有聚焦的输入框', 已复制: true, 长度: 内容.length };
    }

    // 含非 ASCII 时走剪贴板粘贴，成功率最高
    if (/[^\x00-\x7F]/.test(内容)) {
      const 成功 = await 剪贴板粘贴输入(内容);
      if (成功) return { 已输入: true, 方式: '剪贴板粘贴', 长度: 内容.length };
    }

    状态.通道.输入文本(内容);
    return { 已输入: true, 长度: 内容.length };
  });

  /* ---- 触控 ---- */
  注册('触控:按下', async ({ x, y }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.触控按下(x, y);
    return true;
  });
  注册('触控:移动', async ({ x, y }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.触控移动(x, y);
    return true;
  });
  注册('触控:抬起', async ({ x, y }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.触控抬起(x, y);
    return true;
  });
  注册('触控:点击', async ({ x, y }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.点击(x, y);
    return true;
  });
  注册('触控:滑动', async ({ x1, y1, x2, y2, duration, 时长 }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.滑动(x1, y1, x2, y2, duration || 时长 || 300);
    return true;
  });
  注册('触控:滚动', async ({ x, y, v, h, 竖向, 横向 }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    状态.通道.滚动(x, y, v ?? 竖向 ?? 0, h ?? 横向 ?? 0);
    return true;
  });
}

module.exports = { 注册设备接口, 记住设备, 检查输入焦点 };
