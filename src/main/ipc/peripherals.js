/**
 * 键鼠直连：把电脑的鼠标键盘当成手机的外设。
 *
 * 做什么：
 *   开关打开后，鼠标在画面上的移动/点击/滚轮、键盘按键都会转发给手机，
 *   相当于给手机插了一套鼠标键盘。
 *
 * 和「触控层」的区别：
 *   触控层是「直接用鼠标点手机屏幕」的手感，一步一动；
 *   键鼠直连更像外设——鼠标移动即定位，键盘能直接打字、用方向键导航。
 *
 * 为什么默认关闭：
 *   开启后会接管画面区域的鼠标和键盘，用户在电脑上打字也会打到手机上。
 *   这是强侵入的功能，必须用户显式打开。
 */
'use strict';

const { 状态, 注册, 推送 } = require('../core/context');

/** 键鼠直连是否开启 */
let 已开启 = false;

/** Android KeyEvent 键码（只收录常用键，未收录的静默忽略） */
const 键码表 = {
  Enter: 66,
  NumpadEnter: 66,
  Backspace: 67,
  Tab: 61,
  Escape: 111,
  Space: 62,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Delete: 112,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  KeyA: 29, KeyB: 30, KeyC: 31, KeyD: 32, KeyE: 33, KeyF: 34, KeyG: 35,
  KeyH: 36, KeyI: 37, KeyJ: 38, KeyK: 39, KeyL: 40, KeyM: 41, KeyN: 42,
  KeyO: 43, KeyP: 44, KeyQ: 45, KeyR: 46, KeyS: 47, KeyT: 48, KeyU: 49,
  KeyV: 50, KeyW: 51, KeyX: 52, KeyY: 53, KeyZ: 54,
  Digit0: 7, Digit1: 8, Digit2: 9, Digit3: 10, Digit4: 11,
  Digit5: 12, Digit6: 13, Digit7: 14, Digit8: 15, Digit9: 16,
};

/** 修饰键位掩码（Android metaState） */
const 修饰位 = { shift: 1, alt: 2, ctrl: 4096 };

function 取通道() {
  const 通道 = 状态.通道;
  if (!通道) throw new Error('还没有连接设备');
  return 通道;
}

function 注册键鼠接口() {
  /** 开启 / 关闭键鼠直连 */
  注册('外设:键鼠直连', async ({ 开启 }) => {
    已开启 = 开启 === true;
    推送('外设:键鼠直连状态', { 开启: 已开启 });
    return { 开启: 已开启 };
  });

  /** 查询当前状态（界面初始化时用） */
  注册('外设:键鼠状态', async () => ({ 开启: 已开启 }));

  /**
   * 鼠标动作。
   * @param {object} 参数 类型: '移动'|'按下'|'抬起'|'滚轮'，x/y 是手机坐标，竖向是滚轮量
   */
  注册('外设:鼠标', async ({ 类型, x, y, 竖向 = 0 }) => {
    if (!已开启) return { 忽略: true };

    const 通道 = 取通道();
    const 横 = Math.round(Number(x) || 0);
    const 纵 = Math.round(Number(y) || 0);

    if (类型 === '滚轮') {
      通道.滚动(横, 纵, Math.round(Number(竖向) || 0), 0);
      return { ok: true };
    }
    if (类型 === '按下') {
      通道.触控按下(横, 纵);
      return { ok: true };
    }
    if (类型 === '抬起') {
      通道.触控抬起(横, 纵);
      return { ok: true };
    }
    // 移动：用 MOVE，不需要真的按下
    通道.触控移动(横, 纵);
    return { ok: true };
  });

  /**
   * 键盘动作。
   * @param {string} code KeyboardEvent.code（如 KeyA、Enter）
   * @param {boolean} 按下 true=按下 false=抬起
   */
  注册('外设:键盘', async ({ code, 按下, 修饰 = {} }) => {
    if (!已开启) return { 忽略: true };

    const 键码 = 键码表[String(code || '')];
    // 表里没有的键静默忽略：否则用户按个 F5 就弹提示
    if (!键码) return { 跳过: true };
    if (!按下) return { ok: true }; // 只处理按下，避免同一次按键注入两次

    let meta = 0;
    if (修饰.shift) meta |= 修饰位.shift;
    if (修饰.alt) meta |= 修饰位.alt;
    if (修饰.ctrl) meta |= 修饰位.ctrl;

    取通道().按键(键码, meta);
    return { ok: true };
  });

  /** 直接注入一段文本（中文、emoji 都走这条，比逐键转换可靠） */
  注册('外设:打字', async ({ 内容 }) => {
    if (!已开启) return { 忽略: true };
    const 文本 = String(内容 || '');
    if (!文本) return { 跳过: true };
    取通道().输入文本(文本);
    return { ok: true };
  });
}

module.exports = { 注册键鼠接口 };
