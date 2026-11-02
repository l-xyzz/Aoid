/**
 * 单设备独立投屏窗口。
 *
 * 画面：自己订阅 画面:片段 并用 播放器 解码（和主窗口同一套）。
 *       主窗口那边也会同时收到同样的数据 —— 两路解码各画各的，
 *       互不影响，也不需要跨窗口传位图。
 *
 * 触控：坐标以「视频流分辨率」为基准换算（服务端会比对，不一致就丢事件）。
 *
 * 关闭窗口 = 断开这台设备（主进程的 closed 回调负责）。
 */
'use strict';

import { 播放器 } from './player.js';

const $ = (id) => document.getElementById(id);

const 画布 = $('画布');
const 触控层 = $('触控层');
const 空态 = $('空态');
const 设备名 = $('设备名');

/** 当前编码尺寸（手机画面分辨率） */
let 编码尺寸 = { 宽: 0, 高: 0 };
/** 指针是否按下 */
let 指针按下 = false;
let 上次坐标 = null;

/**
 * 本窗口对应的设备序列号。
 * 主进程打开投屏窗口时通过 URL query 传进来（?序列号=xxx）。
 */
const 窗口序列号 = new URLSearchParams(location.search).get('序列号') || '';

function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || 结果.message || '操作失败');
  return 结果 && 'data' in 结果 ? 结果.data : 结果;
}

/* ---------------- 画面 ---------------- */

let 播放器实例 = null;

function 确保播放器() {
  if (播放器实例) return 播放器实例;

  播放器实例 = new 播放器(画布, {
    就绪: () => {
      空态.hidden = true;
      自适应();
    },
    尺寸: (尺寸) => {
      if (尺寸.宽 && 尺寸.高) {
        编码尺寸 = { 宽: 尺寸.宽, 高: 尺寸.高 };
        // 窗口跟随手机比例调整高度（只按宽度算，保持窗口不被拉变形）
        校正窗口比例();
        自适应();
      }
    },
  });

  return 播放器实例;
}

/**
 * 让画布按手机比例铺满窗口，多余留黑。
 * canvas 没有 object-fit，必须用 JS 算 display 尺寸。
 */
function 自适应() {
  const 源宽 = 编码尺寸.宽 || 画布.width || 590;
  const 源高 = 编码尺寸.高 || 画布.height || 1280;
  if (!源宽 || !源高) return;

  const 容器宽 = window.innerWidth;
  const 容器高 = window.innerHeight;
  const 比例 = 源宽 / 源高;

  let 显示宽 = 容器宽;
  let 显示高 = 显示宽 / 比例;
  if (显示高 > 容器高) {
    显示高 = 容器高;
    显示宽 = 显示高 * 比例;
  }

  画布.style.width = Math.round(显示宽) + 'px';
  画布.style.height = Math.round(显示高) + 'px';

  // 触控层和画布同尺寸同位置
  const 舞台 = $('舞台').getBoundingClientRect();
  触控层.style.left = Math.round((舞台.width - 显示宽) / 2) + 'px';
  触控层.style.top = Math.round((舞台.height - 显示高) / 2) + 'px';
  触控层.style.width = Math.round(显示宽) + 'px';
  触控层.style.height = Math.round(显示高) + 'px';
}

/**
 * 窗口高度对齐手机比例。
 *
 * 打开时窗口是按固定尺寸建的，手机真实比例可能是 1280×2772，
 * 这里按宽度反算高度，让窗口边框正好贴合画面（黑边尽量少）。
 * 用户一旦手动拖过窗口，就不再强行校正 —— 尊重用户选择。
 */
let 用户改过窗口 = false;
let 校正定时 = null;

function 校正窗口比例() {
  if (用户改过窗口) return;
  const 源宽 = 编码尺寸.宽;
  const 源高 = 编码尺寸.高;
  if (!源宽 || !源高) return;

  if (校正定时) clearTimeout(校正定时);
  校正定时 = setTimeout(() => {
    校正定时 = null;
    requestAnimationFrame(async () => {
      const 当前宽 = window.innerWidth;
      const 目标高 = Math.round(当前宽 * (源高 / 源宽));
      if (Math.abs(目标高 - window.innerHeight) <= 4) return;
      try {
        await window.deck.设备.投屏校正({
          序列号: 窗口序列号,
          宽高比: 源高 / 源宽,
          当前宽,
        });
      } catch {
        // 校正失败（窗口在销毁等）忽略，画面自适应已经保证不拉伸
      }
    });
  }, 120);
}

window.addEventListener('resize', () => {
  // 用户自己拖动过窗口后就不再自动校正
  if (!校正定时) 用户改过窗口 = true;
  自适应();
});

/* ---------------- 触控 ---------------- */

/** 把鼠标事件换算成手机坐标 */
function 换算(事件, 允许越界 = false) {
  const 矩形 = 触控层.getBoundingClientRect();
  const 宽 = 编码尺寸.宽 || 画布.width;
  const 高 = 编码尺寸.高 || 画布.height;
  if (!宽 || !高 || 矩形.width === 0) return null;

  const x = ((事件.clientX - 矩形.left) / 矩形.width) * 宽;
  const y = ((事件.clientY - 矩形.top) / 矩形.height) * 高;

  const 越界 = x < 0 || y < 0 || x > 宽 || y > 高;
  if (越界 && !允许越界) return null;

  return {
    x: Math.max(0, Math.min(宽, Math.round(x))),
    y: Math.max(0, Math.min(高, Math.round(y))),
  };
}

触控层.addEventListener('pointerdown', (事件) => {
  if (事件.button !== 0) return;
  事件.preventDefault();
  const 坐标 = 换算(事件);
  if (!坐标) return;

  try {
    触控层.setPointerCapture(事件.pointerId);
  } catch {
    // 指针已失效，忽略
  }

  指针按下 = true;
  上次坐标 = 坐标;
  触控层.classList.add('按下中');
  window.deck.触控.按下(坐标.x, 坐标.y).catch(() => {});
});

window.addEventListener('pointermove', (事件) => {
  if (!指针按下) return;
  // 越界钳制到边缘，继续拖（和触摸屏一致）
  const 坐标 = 换算(事件, true);
  if (!坐标) return;
  上次坐标 = 坐标;
  window.deck.触控.移动(坐标.x, 坐标.y).catch(() => {});
});

function 抬起(事件) {
  if (!指针按下) return;
  指针按下 = false;
  触控层.classList.remove('按下中');
  const 坐标 = 换算(事件, true) || 上次坐标 || { x: 0, y: 0 };
  上次坐标 = null;
  window.deck.触控.抬起(坐标.x, 坐标.y).catch(() => {});
}

window.addEventListener('pointerup', 抬起);
window.addEventListener('pointercancel', 抬起);
window.addEventListener('blur', () => {
  if (!指针按下) return;
  指针按下 = false;
  触控层.classList.remove('按下中');
  const 坐标 = 上次坐标 || { x: 0, y: 0 };
  上次坐标 = null;
  window.deck.触控.抬起(坐标.x, 坐标.y).catch(() => {});
});

// 滚轮滚动
触控层.addEventListener(
  'wheel',
  (事件) => {
    const 坐标 = 换算(事件, true);
    if (!坐标) return;
    事件.preventDefault();
    const 竖向 = Math.max(-16, Math.min(16, Math.round(-事件.deltaY / 6)));
    if (竖向) window.deck.触控.滚动(坐标.x, 坐标.y, 竖向, 0).catch(() => {});
  },
  { passive: false },
);

/* ---------------- 工具条 ---------------- */

$('旋转').addEventListener('click', () => window.deck.设备.旋转().catch(() => {}));
$('主页').addEventListener('click', () => window.deck.设备.按键(3).catch(() => {}));
$('最小化').addEventListener('click', () => window.deck.窗口.最小化().catch(() => {}));
$('关闭').addEventListener('click', () => window.deck.窗口.关闭().catch(() => {}));

document.addEventListener('keydown', (事件) => {
  if (事件.key === 'Escape') {
    事件.preventDefault();
    window.deck.窗口.关闭().catch(() => {});
  }
});

/* ---------------- 启动 ---------------- */

function 订阅画面() {
  if (!window.deck || !window.deck.画面) {
    空态.textContent = '画面通道不可用';
    return;
  }

  window.deck.画面.片段((片段) => {
    if (!片段 || !片段.数据) return;
    const 字节 = 片段.数据 instanceof Uint8Array ? 片段.数据 : new Uint8Array(片段.数据);
    try {
      确保播放器().送数据(字节, 片段.关键帧 === true);
    } catch {
      return;
    }
    if (片段.帧号 && window.deck.画面.回报消费) {
      window.deck.画面.回报消费(片段.帧号);
    }
  });

  window.deck.画面.会话((会话) => {
    if (会话 && 会话.宽 && 会话.高) {
      编码尺寸 = { 宽: 会话.宽, 高: 会话.高 };
      校正窗口比例();
      自适应();
    }
  });

  window.deck.画面.分辨率(({ 宽, 高 }) => {
    if (!宽 || !高) return;
    编码尺寸 = { 宽, 高 };
    校正窗口比例();
    自适应();
  });
}

async function 启动() {
  // 设备名显示在工具条上
  try {
    const 列表 = 取值(await window.deck.设备.列表());
    const 在线 = (列表 || []).find((d) => d.state === 'device');
    if (在线) 设备名.textContent = 在线.市场名 || 在线.model || 在线.serial;
  } catch {
    // 拿不到就不显示
  }

  订阅画面();
  自适应();
}

启动();
