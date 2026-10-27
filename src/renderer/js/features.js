/**
 * 「更多功能」独立窗口的逻辑。
 *
 * 为什么单独开一个窗口而不是塞在主界面右栏：
 *   摄像头预览、麦克风这类功能是「开着就一直用」的，和主界面的操作区
 *   用途不同。独立窗口可以单独拖动/最小化/放到第二块屏，关掉它也不影响
 *   投屏本身。主窗口通过菜单开关来显示或隐藏它。
 */
'use strict';

const $ = (id) => document.getElementById(id);

const 元素 = {
  连接状态: $('连接状态'),
  摄像头选择: $('摄像头选择'),
  摄像头尺寸: $('摄像头尺寸'),
  摄像头帧率: $('摄像头帧率'),
  使用麦克风: $('使用麦克风'),
  打开摄像头: $('打开摄像头'),
  关闭摄像头: $('关闭摄像头'),
  打开麦克风: $('打开麦克风'),
  关闭麦克风: $('关闭麦克风'),
  底部提示: $('底部提示'),
};

/** 解包仓库统一返回的 { ok, data, error } 结构 */
function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || '操作失败');
  return 结果 ? 结果.data : null;
}

function 提示(文本, 类型 = '普通') {
  元素.底部提示.textContent = 文本;
  元素.底部提示.style.color = 类型 === '错误' ? 'var(--危险, #ff9aa2)' : '';
}

/* ------------------------------------------------------------------ */
/* 摄像头                                                              */
/* ------------------------------------------------------------------ */

let 摄像头运行中 = false;
let 麦克风运行中 = false;

function 更新按钮态() {
  元素.打开摄像头.disabled = 摄像头运行中;
  元素.关闭摄像头.disabled = !摄像头运行中;
  元素.打开摄像头.textContent = 摄像头运行中 ? '摄像头运行中…' : '打开摄像头预览';

  元素.打开麦克风.disabled = 麦克风运行中;
  元素.关闭麦克风.disabled = !麦克风运行中;
  元素.打开麦克风.textContent = 麦克风运行中 ? '麦克风使用中…' : '开始使用手机麦克风';
}

async function 加载摄像头列表() {
  try {
    const 数据 = 取值(await window.deck.更多.摄像头列表());
    if (!数据.可用) {
      提示('缺少 scrcpy 运行组件，摄像头功能不可用', '错误');
      return;
    }

    元素.摄像头选择.replaceChildren();
    if (!数据.列表.length) {
      提示('这台手机没有可用的摄像头', '错误');
      return;
    }

    for (const 项 of 数据.列表) {
      const 选项 = document.createElement('option');
      选项.value = 项.id;
      // 同朝向常有多个镜头（广角/长焦），带上分辨率便于区分
      选项.textContent = `#${项.id} ${项.朝向} · ${项.尺寸}`;
      元素.摄像头选择.appendChild(选项);
    }

    提示(`已找到 ${数据.列表.length} 个摄像头`);
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

async function 刷新连接状态() {
  try {
    const 设备 = 取值(await window.deck.设备.列表());
    const 已连 = 设备.some((d) => d.state === 'device');
    元素.连接状态.textContent = 已连 ? '设备已连接' : '未连接设备';
    if (已连 && 元素.摄像头选择.options.length <= 1) await 加载摄像头列表();
  } catch {
    // 忽略
  }
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

元素.打开摄像头.addEventListener('click', async () => {
  const 摄像头id = 元素.摄像头选择.value;
  if (!摄像头id) return 提示('还没有可用的摄像头', '错误');

  元素.打开摄像头.disabled = true;
  try {
    取值(
      await window.deck.更多.打开摄像头({
        摄像头id,
        尺寸: 元素.摄像头尺寸.value,
        帧率: Number(元素.摄像头帧率.value),
        要麦克风: 元素.使用麦克风.checked,
      }),
    );
    摄像头运行中 = true;
    更新按钮态();
    提示('摄像头已打开，请看弹出的预览小窗');
  } catch (错误) {
    提示(错误.message, '错误');
    元素.打开摄像头.disabled = false;
  }
});

元素.关闭摄像头.addEventListener('click', async () => {
  try {
    取值(await window.deck.更多.关闭摄像头());
    摄像头运行中 = false;
    更新按钮态();
    提示('摄像头已停止');
  } catch (错误) {
    提示(错误.message, '错误');
  }
});


/* ------------------------------------------------------------------ */
/* 麦克风：把手机麦克风变成电脑麦克风（VB-Cable）                       */
/* ------------------------------------------------------------------ */

/**
 * 关键点：不能只是「播放手机声音」，那别人在会议软件里选不到。
 * 必须把音频输出定向到虚拟声卡的播放端（CABLE Input），
 * 其他软件从它的录音端（CABLE Output）采集，才算真正的电脑麦克风。
 *
 * setSinkId 可以按设备名指定输出，Electron 里已实测支持。
 */
let 麦克风音频 = null;

/**
 * 从枚举列表里找「CABLE Input」的输出设备 ID。
 *
 * 关键：setSinkId 只认 deviceId，不认设备名。
 * 之前传名称 'CABLE Input' 会报 Requested device not found（踩过）。
 * enumerateDevices 拿 deviceId 是唯一可靠做法，且不会触发
 * Electron #40704（那个是 getUserMedia 之后 setSinkId 失效）。
 */
async function 找虚拟声卡设备id() {
  try {
    const 设备 = await navigator.mediaDevices.enumerateDevices();
    const 目标 = 设备.find(
      (d) => d.kind === 'audiooutput' && /CABLE Input/i.test(d.label || ''),
    );
    return 目标 ? 目标.deviceId : '';
  } catch {
    return '';
  }
}

async function 启动麦克风播放(文件, 播放端) {
  停止麦克风播放();

  // 用 deviceId 定向；找不到就用名称兜底（会失败但至少给出明确错误）
  const 设备id = await 找虚拟声卡设备id();
  const 目标 = 设备id || 播放端;

  麦克风音频 = new Audio();
  麦克风音频.src = 'file:///' + 文件.replace(/\\/g, '/') + '?t=' + Date.now();
  麦克风音频.loop = true;
  麦克风音频.volume = 1;

  try {
    await 麦克风音频.setSinkId(目标);
  } catch (错误) {
    提示('无法把声音送到虚拟声卡：' + 错误.message, '错误');
    麦克风音频 = null;
    return false;
  }

  try {
    await 麦克风音频.play();
  } catch (错误) {
    提示('播放失败：' + 错误.message, '错误');
    return false;
  }

  return true;
}

function 停止麦克风播放() {
  if (!麦克风音频) return;
  try {
    麦克风音频.pause();
    麦克风音频.src = '';
  } catch {
    // 忽略
  }
  麦克风音频 = null;
}

元素.打开麦克风.addEventListener('click', async () => {
  元素.打开麦克风.disabled = true;
  try {
      const 数据 = 取值(await window.deck.更多.打开麦克风());
      const 成功 = await 启动麦克风播放(数据.文件, 数据.播放端);
    麦克风运行中 = true;
    更新按钮态();
    提示('手机麦克风已接入电脑');
  } catch (错误) {
    提示(错误.message, '错误');
    元素.打开麦克风.disabled = false;
  }
});

元素.关闭麦克风.addEventListener('click', async () => {
  try {
    取值(await window.deck.更多.关闭麦克风());
    停止麦克风播放();
    麦克风运行中 = false;
    更新按钮态();
    提示('手机麦克风已停止');
  } catch (错误) {
    提示(错误.message, '错误');
  }
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function 启动() {
  更新按钮态();
  await 刷新连接状态();
  setInterval(刷新连接状态, 2000);

  // 摄像头进程意外退出时（比如被系统杀掉）把按钮状态同步回来
  setInterval(async () => {
    try {
      const 状态 = 取值(await window.deck.更多.状态());
      // 主进程说停了，界面也要跟着停（进程被系统杀掉时尤其需要）
      if (摄像头运行中 && !状态.摄像头运行中) {
        摄像头运行中 = false;
        更新按钮态();
        提示('摄像头已停止');
      }
      if (麦克风运行中 && !状态.麦克风运行中) {
        麦克风运行中 = false;
        更新按钮态();
        提示('手机麦克风已停止');
      }
    } catch {
      // 忽略
    }
  }, 2000);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', 启动);
} else {
  启动();
}