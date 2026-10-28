/**
 * 设备相关 IPC：连接、断开、历史记录、按键与触控。
 *
 * 拆成独立文件的意义：这些接口以前和设置、音频、摄像头全挤在一个
 * 1200 行的函数里，改一处容易碰坏别的域。现在一个域一个文件，
 * 依赖显式、边界清楚。
 */
'use strict';

const { 状态, 注册, 推送, 安全文本, 数据目录 } = require('../core/context');
const { 连接设备, 断开连接 } = require('../session/session');

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
    return 状态.adb.列出设备();
  });

  /* 与「设备:列表」等价，兼容 preload 里声明过的「设备:刷新」 */
  注册('设备:刷新', async () => {
    if (!状态.adb) throw new Error('adb 还没有准备好');
    if (!状态.adb.adbPath) {
      const 结果 = await 状态.adb.探测();
      if (!结果.ok) throw new Error('没有找到 adb，请先准备运行环境');
      await 状态.adb.启动服务().catch(() => {});
    }
    return 状态.adb.列出设备();
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
