/**
 * 多语言支持。
 *
 * 设计取舍：
 *   Aoid 的界面文本分散在 index.html（约 313 行含中文）和 app.js
 *   （约 439 个中文字符串）里，还夹着大量动态拼接的提示语。
 *   如果按常规做法把它们全部改成 t('key') 调用，改动面极大、
 *   极易漏改，而且以后每加一句话都要同步改两份文件。
 *
 *   这里采用「运行时文本替换」：
 *     1. 界面仍然用中文写死，作为源语言；
 *     2. 语言包里提供「中文原文 → 目标语言」的对照表；
 *     3. DOM 变化时扫描文本节点，命中就替换，属性（placeholder/title 等）同理。
 *
 *   好处：加一种语言只要写一份对照表，不用动任何业务代码。
 *   代价：中文改字后需要同步更新语言包，所以内置语言包和界面文本要一起改。
 *
 * 自定义语言：
 *   用户可以让 AI 把 zh-CN.json 翻译成任意语言，放进
 *   `<应用数据目录>/languages/<代码>.json`，重启后在设置里就能选到。
 */
'use strict';

/** 当前生效的对照表：中文原文 → 译文 */
let 对照表 = new Map();
/** 当前语言代码 */
let 当前语言 = 'zh-CN';
/** DOM 观察器 */
let 观察器 = null;
/** 防止「替换文本 → 触发观察器 → 再替换」的死循环 */
let 正在替换 = false;

/** 需要翻译的属性 */
const 文本属性 = ['placeholder', 'title', 'aria-label', 'data-tip'];

/**
 * 设置当前语言。
 * @param {string} 代码 语言代码，zh-CN 表示不翻译
 * @param {object} 词典 中文原文 → 译文的对照表
 */
export function 设置语言(代码, 词典) {
  当前语言 = 代码 || 'zh-CN';
  对照表 = new Map();

  if (当前语言 !== 'zh-CN' && 词典 && typeof 词典 === 'object') {
    for (const [中文, 译文] of Object.entries(词典)) {
      if (typeof 译文 === 'string' && 译文 && 译文 !== 中文) {
        对照表.set(中文, 译文);
      }
    }
  }

  // 切回中文时不用扫描，界面本来就是中文
  if (当前语言 === 'zh-CN') return;

  应用全页();
  启动观察器();
}

/** 当前语言代码 */
export function 取当前语言() {
  return 当前语言;
}

/** 翻译一个字符串（用于 JS 里动态生成、不经过 DOM 扫描的文本） */
export function 翻译(文本) {
  if (!文本 || 对照表.size === 0) return 文本;
  const 直接 = 对照表.get(文本);
  if (直接 !== undefined) return 直接;
  return 文本;
}

/** 扫描并替换整个页面 */
export function 应用全页(根节点) {
  if (对照表.size === 0) return;
  if (正在替换) return;
  正在替换 = true;
  try {
    遍历(document.body || 根节点);
  } finally {
    // 观察器是异步触发的，这里同步放开即可
    setTimeout(() => {
      正在替换 = false;
    }, 0);
  }
}

/** 递归处理一个节点 */
function 遍历(节点) {
  if (!节点) return;

  // 文本节点：整体替换（保留首尾空白）
  if (节点.nodeType === Node.TEXT_NODE) {
    const 原文 = 节点.nodeValue;
    if (!原文) return;
    const 修剪 = 原文.trim();
    if (!修剪) return;
    const 译文 = 对照表.get(修剪);
    if (译文 === undefined) return;
    节点.nodeValue = 原文.replace(修剪, 译文);
    return;
  }

  if (节点.nodeType !== Node.ELEMENT_NODE) return;

  // 元素自带的文本属性
  for (const 属性 of 文本属性) {
    const 值 = 节点.getAttribute && 节点.getAttribute(属性);
    if (!值) continue;
    const 译文 = 对照表.get(值.trim());
    if (译文 !== undefined && 译文 !== 值) 节点.setAttribute(属性, 译文);
  }

  // option 的 value 不能动（程序靠它判断），只改显示文本，走文本节点即可

  for (const 子 of Array.from(节点.childNodes)) 遍历(子);
}

/** 监听 DOM 变化：新插入的节点、改动的文本都补翻一次 */
function 启动观察器() {
  if (观察器) return;
  if (typeof MutationObserver === 'undefined') return;

  观察器 = new MutationObserver((变化们) => {
    if (正在替换) return;
    for (const 变化 of 变化们) {
      if (变化.type === 'characterData') {
        遍历(变化.target);
      } else {
        for (const 节点 of 变化.addedNodes) 遍历(节点);
      }
    }
  });

  观察器.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * 给动态生成的提示语用：包裹一层翻译。
 * 用法：提示(翻译(`已连接 ${名}`))  —— 若语言包里没有对应句子，自动回落中文。
 */
export function 翻译模板(模板, 参数) {
  let 结果 = 模板;
  if (参数) {
    for (const [键, 值] of Object.entries(参数)) {
      结果 = 结果.split('{' + 键 + '}').join(String(值));
    }
  }
  return 翻译(结果);
}
