/**
 * 快捷键系统。
 *
 * 需求要点：
 *   - 每个动作可以绑定**多个**触发方式（例如返回既可以用 Esc，也可以用鼠标右键）；
 *   - 绑定生效时**覆盖**原有操作（右键本来会弹菜单、Esc 本来会退出全屏等，都要拦下来）；
 *   - 只在窗口获得焦点时生效，切到别的程序时不会被抢走按键。
 *
 * 支持两类触发：
 *   1. 键盘：用事件里的 code / key 组合描述，如 "Escape"、"Ctrl+Alt+R"；
 *   2. 鼠标：PointerEvent 的 button（0 左 1 中 2 右 3 后 4 前），存成 "Mouse:2"。
 *
 * 配置保存在主进程的 userData 里，这里是纯逻辑：不碰 DOM、不碰存储，
 * 方便单测，也方便以后换存储方式。
 */
'use strict';

/** 动作清单：id 与界面上的一致 */
const 动作表 = {
  返回: { id: '返回', 名称: '返回', 说明: '相当于手机上的返回键' },
  主页: { id: '主页', 名称: '回主页', 说明: '回到手机桌面' },
  任务: { id: '任务', 名称: '任务列表', 说明: '打开最近任务（多任务）' },
  通知: { id: '通知', 名称: '通知栏', 说明: '展开手机通知栏' },
  控制中心: { id: '控制中心', 名称: '控制中心', 说明: '展开快捷设置面板' },
  旋转: { id: '旋转', 名称: '旋转屏幕', 说明: '切换横竖屏' },
  音量加: { id: '音量加', 名称: '音量增加', 说明: '' },
  音量减: { id: '音量减', 名称: '音量减小', 说明: '' },
  截图: { id: '截图', 名称: '截图', 说明: '保存当前画面' },
  剪贴板: { id: '剪贴板', 名称: '发送剪贴板', 说明: '把电脑剪贴板发到手机' },
};

/** 默认绑定：右键/Esc 返回，中键回主页，Tab 任务列表 */
const 默认绑定 = {
  返回: ['Mouse:2', 'Escape'],
  主页: ['Mouse:1'],
  任务: ['Tab'],
  通知: [],
  控制中心: [],
  旋转: [],
  音量加: [],
  音量减: [],
  截图: [],
  剪贴板: [],
};

/** 鼠标按键编号 → 中文名 */
const 鼠标名 = { 0: '左键', 1: '中键', 2: '右键', 3: '后退键', 4: '前进键' };

/** 修饰键顺序固定，保证同一个组合只有一种文本表示 */
const 修饰键顺序 = ['Ctrl', 'Alt', 'Shift', 'Meta'];

/**
 * 把键盘事件规范化成绑定文本。
 * 例：{ code:'KeyR', key:'r', ctrlKey:true, altKey:true } → 'Ctrl+Alt+R'
 */
function 键盘绑定文本(事件) {
  const 修饰 = [];
  if (事件.ctrlKey) 修饰.push('Ctrl');
  if (事件.altKey) 修饰.push('Alt');
  if (事件.shiftKey) 修饰.push('Shift');
  if (事件.metaKey) 修饰.push('Meta');

  // 主键优先用 code（与键盘布局无关），并去掉 Key/Digit 前缀
  let 主键 = 事件.code || 事件.key;
  主键 = 主键.replace(/^Key/, '').replace(/^Digit/, '');
  // 纯修饰键按下时不产生绑定，等真正的组合键
  if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(事件.code)) {
    return '';
  }

  return [...修饰, 主键].join('+');
}

/** 鼠标绑定文本 */
function 鼠标绑定文本(按键) {
  return `Mouse:${按键}`;
}

/** 把绑定文本转成给人看的写法 */
function 绑定显示名(文本) {
  if (!文本) return '';
  if (文本.startsWith('Mouse:')) {
    const 键 = Number(文本.slice(6));
    return `鼠标${鼠标名[键] || 键}`;
  }
  // 常见键换成更好认的名字
  const 替换 = {
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: '空格',
    Enter: '回车',
    Backspace: '退格',
  };
  return 文本
    .split('+')
    .map((段) => 替换[段] || 段)
    .join(' + ');
}

/** 检查一个绑定文本是否合法（避免用户存进乱七八糟的东西） */
function 绑定合法(文本) {
  if (typeof 文本 !== 'string' || 文本.length === 0 || 文本.length > 40) return false;
  if (文本.startsWith('Mouse:')) {
    const 键 = Number(文本.slice(6));
    return Number.isInteger(键) && 键 >= 0 && 键 <= 4;
  }
  // 键盘：最多 4 个修饰键 + 1 个主键，只允许字母数字与常见符号
  const 段们 = 文本.split('+');
  if (段们.length > 5) return false;
  return 段们.every((段) => /^[A-Za-z0-9]{1,16}$/.test(段));
}

/**
 * 校验并规整整份绑定配置：
 *   - 丢掉不认识的动作、非法的绑定、重复的绑定（同一个触发只能属于一个动作）；
 *   - 统一修饰键顺序。
 */
function 规整绑定(原始) {
  const 结果 = {};
  const 已占用 = new Map(); // 绑定文本 → 动作

  for (const 动作 of Object.keys(动作表)) {
    结果[动作] = [];
  }

  for (const [动作, 绑定们] of Object.entries(原始 || {})) {
    if (!动作表[动作] || !Array.isArray(绑定们)) continue;
    for (const 原始绑定 of 绑定们) {
      const 绑定 = typeof 原始绑定 === 'string' ? 原始绑定.trim() : '';
      if (!绑定合法(绑定)) continue;
      if (已占用.has(绑定)) continue; // 同一个触发只归第一个动作
      已占用.set(绑定, 动作);
      结果[动作].push(绑定);
    }
  }

  return 结果;
}

/**
 * 把绑定表编译成查找表，供事件分发时 O(1) 命中。
 * @returns {{键盘: Map<string,string>, 鼠标: Map<number,string>}}
 */
function 编译绑定(绑定表) {
  const 键盘 = new Map();
  const 鼠标 = new Map();

  for (const [动作, 绑定们] of Object.entries(绑定表 || {})) {
    for (const 绑定 of 绑定们 || []) {
      if (绑定.startsWith('Mouse:')) {
        const 键 = Number(绑定.slice(6));
        if (!鼠标.has(键)) 鼠标.set(键, 动作);
      } else if (!键盘.has(绑定)) {
        键盘.set(绑定, 动作);
      }
    }
  }

  return { 键盘, 鼠标 };
}

module.exports = {
  动作表,
  默认绑定,
  鼠标名,
  键盘绑定文本,
  鼠标绑定文本,
  绑定显示名,
  绑定合法,
  规整绑定,
  编译绑定,
};
