/**
 * scrcpy 控制协议（对照 scrcpy v5.0.1 源码 app/src/control_msg.c 实现）。
 *
 * 消息类型编号就是枚举顺序，从 0 开始：
 *   0 INJECT_KEYCODE   1 INJECT_TEXT   2 INJECT_TOUCH_EVENT   3 INJECT_SCROLL_EVENT
 *   4 BACK_OR_SCREEN_ON  5 EXPAND_NOTIFICATION_PANEL  6 EXPAND_SETTINGS_PANEL
 *   7 COLLAPSE_PANELS  8 GET_CLIPBOARD  9 SET_CLIPBOARD  10 SET_DISPLAY_POWER
 *   11 ROTATE_DEVICE   12 UHID_CREATE  13 UHID_INPUT   14 UHID_DESTROY
 *   15 OPEN_HARD_KEYBOARD_SETTINGS  16 START_APP  17 RESET_VIDEO
 *   18 CAMERA_SET_TORCH  19 CAMERA_ZOOM_IN  20 CAMERA_ZOOM_OUT
 *   21 RESIZE_DISPLAY  22 SCAN_FILE
 *
 * 坐标约定：touch / scroll 消息里的 position 包含「点坐标 + 屏幕尺寸」四段，
 * 屏幕尺寸必须是**手机物理分辨率**，否则服务端在旋转屏幕时会算错坐标。
 */
'use strict';

const 类型 = {
  INJECT_KEYCODE: 0,
  INJECT_TEXT: 1,
  INJECT_TOUCH_EVENT: 2,
  INJECT_SCROLL_EVENT: 3,
  BACK_OR_SCREEN_ON: 4,
  EXPAND_NOTIFICATION_PANEL: 5,
  EXPAND_SETTINGS_PANEL: 6,
  COLLAPSE_PANELS: 7,
  GET_CLIPBOARD: 8,
  SET_CLIPBOARD: 9,
  SET_DISPLAY_POWER: 10,
  ROTATE_DEVICE: 11,
  UHID_CREATE: 12,
  UHID_INPUT: 13,
  UHID_DESTROY: 14,
  OPEN_HARD_KEYBOARD_SETTINGS: 15,
  START_APP: 16,
  RESET_VIDEO: 17,
  CAMERA_SET_TORCH: 18,
  CAMERA_ZOOM_IN: 19,
  CAMERA_ZOOM_OUT: 20,
  RESIZE_DISPLAY: 21,
  SCAN_FILE: 22,
};

/** MotionEvent 动作码 */
const 动作 = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
  CANCEL: 3,
  OUTSIDE: 4,
  POINTER_DOWN: 5,
  POINTER_UP: 6,
};

/** KeyEvent 动作码 */
const 键动作 = { DOWN: 0, UP: 1 };

/** 通用指针 id：scrcpy 用 64 位整数区分鼠标与手指 */
const 指针 = {
  鼠标: 0xffffffffffffffffn, // -1
  手指: 0xfffffffffffffffen, // -2
  虚拟手指: 0xfffffffffffffffcn,
};

/** 浮点转 16 位定点（服务端用 u16 表示 0~1 的压力/滚动量） */
function 转定点16(值) {
  const 限制 = Math.max(-1, Math.min(1, 值));
  return Math.round(限制 * 0x7fff) & 0xffff;
}

/** 构造触摸消息（32 字节） */
/**
 * 触控压力编码（对照 scrcpy app/src/util/binary.h 的 sc_float_to_u16fp）：
 *   压力 = round(f * 65536)，1.0 封顶为 0xffff，抬起时必须传 0。
 *   之前误用 32767 上限，1.0 会变成 0x7fff 而非 0xffff，部分系统据此判定
 *   「非法压力」并丢弃整个事件——这正是点击失灵的原因。
 */
function 触摸(action, x, y, 屏宽, 屏高, { 压力 = 1, 指针id = 指针.手指 } = {}) {
  const 缓冲 = Buffer.alloc(32);
  let 位 = 0;
  缓冲.writeUInt8(类型.INJECT_TOUCH_EVENT, 位); 位 += 1;
  缓冲.writeUInt8(action, 位); 位 += 1;
  缓冲.writeBigUInt64BE(指针id, 位); 位 += 8;
  缓冲.writeInt32BE(Math.round(x), 位); 位 += 4;
  缓冲.writeInt32BE(Math.round(y), 位); 位 += 4;
  缓冲.writeUInt16BE(屏宽, 位); 位 += 2;
  缓冲.writeUInt16BE(屏高, 位); 位 += 2;

  let 定点 = Math.round(Math.min(1, Math.max(0, 压力)) * 65536);
  if (定点 >= 0xffff) 定点 = 0xffff;
  缓冲.writeUInt16BE(定点, 位); 位 += 2;

  缓冲.writeUInt32BE(0, 位); 位 += 4; // action_button
  缓冲.writeUInt32BE(0, 位); 位 += 4; // buttons
  return 缓冲;
}

/** 构造滚动消息（21 字节） */
function 滚动(x, y, 屏宽, 屏高, 竖向, 横向) {
  const 缓冲 = Buffer.alloc(21);
  let 位 = 0;
  缓冲.writeUInt8(类型.INJECT_SCROLL_EVENT, 位); 位 += 1;
  缓冲.writeInt32BE(Math.round(x), 位); 位 += 4;
  缓冲.writeInt32BE(Math.round(y), 位); 位 += 4;
  缓冲.writeUInt16BE(屏宽, 位); 位 += 2;
  缓冲.writeUInt16BE(屏高, 位); 位 += 2;
  缓冲.writeUInt16BE(转定点16(横向 / 16), 位); 位 += 2;
  缓冲.writeUInt16BE(转定点16(竖向 / 16), 位); 位 += 2;
  缓冲.writeUInt32BE(0, 位); 位 += 4; // buttons
  return 缓冲.subarray(0, 位);
}

/**
 * 构造按键消息（14 字节）。
 * repeat 字段在 v5 里是 "键码重复次数"，普通一次性按键填 0。
 */
function 按键(action, 键码, 修饰键 = 0) {
  const 缓冲 = Buffer.alloc(14);
  缓冲.writeUInt8(类型.INJECT_KEYCODE, 0);
  缓冲.writeUInt8(action, 1);
  缓冲.writeUInt32BE(键码, 2);
  缓冲.writeUInt32BE(0, 6); // repeat
  缓冲.writeUInt32BE(修饰键, 10);
  return 缓冲;
}

/** 构造文本消息（1 + 4 + 内容） */
function 文本(内容) {
  const 数据 = Buffer.from(String(内容), 'utf8');
  const 头 = Buffer.alloc(5);
  头.writeUInt8(类型.INJECT_TEXT, 0);
  头.writeUInt32BE(数据.length, 1);
  return Buffer.concat([头, 数据]);
}

/** 单字节消息（无参数） */
function 无参(类型值) {
  return Buffer.from([类型值]);
}

/** 双字节消息（带一个开关） */
function 开关(类型值, 值) {
  return Buffer.from([类型值, 值 ? 1 : 0]);
}

/** 启动应用：包名长度（1 字节）+ 包名 */
function 启动应用(包名) {
  const 数据 = Buffer.from(String(包名), 'utf8');
  const 头 = Buffer.alloc(2);
  头.writeUInt8(类型.START_APP, 0);
  头.writeUInt8(Math.min(255, 数据.length), 1);
  return Buffer.concat([头, 数据.subarray(0, 255)]);
}

/** 设置剪贴板：sequence(8) + paste(1) + 长度(4) + 文本 */
function 设置剪贴板(内容, 序号, 粘贴) {
  const 数据 = Buffer.from(String(内容), 'utf8');
  const 头 = Buffer.alloc(14);
  头.writeUInt8(类型.SET_CLIPBOARD, 0);
  头.writeBigUInt64BE(BigInt(序号), 1);
  头.writeUInt8(粘贴 ? 1 : 0, 9);
  头.writeUInt32BE(数据.length, 10);
  return Buffer.concat([头, 数据]);
}

/** 设备回复消息类型：0 CLIPBOARD 1 ACK_CLIPBOARD 2 UHID_OUTPUT */
const 回复类型 = { CLIPBOARD: 0, ACK_CLIPBOARD: 1, UHID_OUTPUT: 2 };

/** GET_CLIPBOARD 的 copy_key：0 none 1 copy 2 cut */
const 剪贴板动作 = { 无: 0, 复制: 1, 剪切: 2 };

module.exports = {
  类型,
  剪贴板动作,
  动作,
  键动作,
  指针,
  回复类型,
  触摸,
  滚动,
  按键,
  文本,
  无参,
  开关,
  启动应用,
  设置剪贴板,
};
