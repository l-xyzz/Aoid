/**
 * 快捷键设置界面。
 *
 * 与主进程的 src/main/shortcuts.js 保持一致的规则：
 *   - 键盘绑定写成 "Ctrl+Alt+R" 这样的文本；
 *   - 鼠标绑定写成 "Mouse:2"（0 左键 1 中键 2 右键 3 后退 4 前进）。
 *
 * 交互：点「添加」进入录制态 → 直接按键或用鼠标点一下 → 写入设置。
 * 录制期间由 app.js 的键盘监听把事件转给这里，因此不会触发其他快捷键。
 */
'use strict';

const 动作清单 = [
  { id: '返回', 名称: '返回' },
  { id: '主页', 名称: '回主页' },
  { id: '任务', 名称: '任务列表' },
  { id: '通知', 名称: '通知栏' },
  { id: '控制中心', 名称: '控制中心' },
  { id: '旋转', 名称: '旋转屏幕' },
  { id: '音量加', 名称: '音量增加' },
  { id: '音量减', 名称: '音量减小' },
  { id: '截图', 名称: '截图' },
  { id: '剪贴板', 名称: '发送剪贴板' },
];

const 鼠标名 = { 0: '左键', 1: '中键', 2: '右键', 3: '后退键', 4: '前进键' };

const 键名替换 = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: '空格',
  Enter: '回车',
  Backspace: '退格',
  Tab: 'Tab',
};

/** 把键盘事件转成绑定文本，与主进程规则一致 */
export function 键盘绑定文本(事件) {
  const 修饰键代码 = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];
  if (修饰键代码.includes(事件.code)) return '';

  const 修饰 = [];
  if (事件.ctrlKey) 修饰.push('Ctrl');
  if (事件.altKey) 修饰.push('Alt');
  if (事件.shiftKey) 修饰.push('Shift');
  if (事件.metaKey) 修饰.push('Meta');

  let 主键 = 事件.code || 事件.key;
  主键 = 主键.replace(/^Key/, '').replace(/^Digit/, '');
  return [...修饰, 主键].join('+');
}

/** 绑定文本 → 显示名 */
export function 绑定显示名(文本) {
  if (!文本) return '';
  if (文本.startsWith('Mouse:')) {
    const 键 = Number(文本.slice(6));
    return `鼠标${鼠标名[键] || 键}`;
  }
  return 文本
    .split('+')
    .map((段) => 键名替换[段] || 段)
    .join(' + ');
}

/** 把绑定表编译成查找表 */
export function 编译绑定(绑定表) {
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

/* ------------------------------------------------------------------ */
/* 录制状态                                                            */
/* ------------------------------------------------------------------ */

let 上下文 = null;
let 正在录制 = null; // 正在录制的动作 id

export function 初始化(参数) {
  上下文 = 参数;
  参数.取消按钮.addEventListener('click', () => 重置录制());
  // 录制时用鼠标点一下也能绑定（左键除外，左键留给正常点击）
  window.addEventListener(
    'pointerdown',
    (事件) => {
      if (!正在录制) return;
      // 左键不绑：它是「点击」的默认动作，绑上会让界面无法正常操作
      if (事件.button === 0) return;
      事件.preventDefault();
      事件.stopPropagation();
      完成录制(`Mouse:${事件.button}`);
    },
    true,
  );
}

/** app.js 的键盘监听会问：现在是不是在录制 */
export function 是否在录制() {
  return 正在录制 !== null;
}

/** app.js 把键盘事件交进来 */
export function 接收按键(事件) {
  if (!正在录制) return;

  // Esc 单独按：当作取消录制（避免用户被卡住）
  if (事件.key === 'Escape' && !事件.ctrlKey && !事件.altKey && !事件.shiftKey) {
    重置录制();
    return;
  }

  const 文本 = 键盘绑定文本(事件);
  if (!文本) return; // 只按了修饰键，继续等主键
  完成录制(文本);
}

export function 重置录制() {
  正在录制 = null;
  if (上下文?.捕获提示) 上下文.捕获提示.hidden = true;
}

async function 完成录制(绑定文本) {
  const 动作 = 正在录制;
  重置录制();
  if (!动作 || !上下文) return;

  const 当前 = JSON.parse(JSON.stringify(上下文.获取当前() || {}));
  // 同一个绑定只允许属于一个动作：先从别处移除
  for (const 键 of Object.keys(当前)) {
    当前[键] = (当前[键] || []).filter((项) => 项 !== 绑定文本);
  }
  当前[动作] = [...(当前[动作] || []), 绑定文本];

  await 上下文.保存(当前);
}

function 开始录制(动作) {
  正在录制 = 动作;
  if (上下文?.捕获提示) 上下文.捕获提示.hidden = false;
}

/** 渲染快捷键列表 */
export function 渲染快捷键列表(绑定表) {
  if (!上下文) return;
  const 容器 = 上下文.列表容器;
  容器.replaceChildren();

  for (const 动作 of 动作清单) {
    const 行 = document.createElement('div');
    行.className = '快捷键行';

    const 名 = document.createElement('div');
    名.className = '快捷键名';
    名.textContent = 动作.名称;

    const 组 = document.createElement('div');
    组.className = '绑定组';

    const 绑定们 = 绑定表[动作.id] || [];
    if (绑定们.length === 0) {
      const 空 = document.createElement('span');
      空.className = '绑定空';
      空.textContent = '未绑定';
      组.appendChild(空);
    }

    for (const 绑定 of 绑定们) {
      const 标签 = document.createElement('span');
      标签.className = '绑定标签';
      标签.textContent = 绑定显示名(绑定);

      const 删除 = document.createElement('button');
      删除.className = '绑定删除';
      删除.type = 'button';
      删除.title = '移除这个绑定';
      删除.textContent = '×';
      删除.addEventListener('click', async () => {
        const 当前 = JSON.parse(JSON.stringify(上下文.获取当前() || {}));
        当前[动作.id] = (当前[动作.id] || []).filter((项) => 项 !== 绑定);
        await 上下文.保存(当前);
      });

      标签.appendChild(删除);
      组.appendChild(标签);
    }

    const 添加 = document.createElement('button');
    添加.className = '添加绑定';
    添加.type = 'button';
    添加.textContent = '添加';
    添加.addEventListener('click', () => 开始录制(动作.id));

    行.append(名, 组, 添加);
    容器.appendChild(行);
  }
}
