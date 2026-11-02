/**
 * ADB 控制台独立窗口的渲染逻辑。
 *
 * 和「更多功能」窗口里的那个控制台是同一套逻辑，但这里是独立页面，
 * 所以需要自己带一份完整实现（不再和 tools.js 共享状态）。
 *
 * 功能：命令执行、历史（上下键）、Tab 补全、Ctrl+L 清屏、Ctrl+C 清空输入。
 */
'use strict';

const $ = (id) => document.getElementById(id);

const 元素 = {
  输出: $('控制台输出'),
  输入: $('控制台输入'),
  补全框: $('补全框'),
  连接点: $('连接点'),
  设备文字: $('设备文字'),
  命令计数: $('命令计数'),
};

/* ---------------- 工具 ---------------- */

function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || 结果.message || '操作失败');
  return 结果 && 'data' in 结果 ? 结果.data : 结果;
}

/* ---------------- 输出 ---------------- */

function 输出文字(文字, 类名) {
  const 行 = document.createElement('div');
  if (类名) 行.className = 类名;
  行.textContent = 文字;
  元素.输出.appendChild(行);
  元素.输出.scrollTop = 元素.输出.scrollHeight;
}

function 输出HTML(html) {
  const 行 = document.createElement('div');
  行.innerHTML = html;
  元素.输出.appendChild(行);
  元素.输出.scrollTop = 元素.输出.scrollHeight;
}

/** 简易语法高亮：命令 / 参数 / 字符串 / 路径 */
function 高亮(命令) {
  const 词们 = String(命令).split(/\s+/).filter(Boolean);
  return 词们
    .map((词, 序) => {
      let 类 = '';
      if (序 === 0) 类 = '高亮-命令';
      else if (/^['"]/.test(词)) 类 = '高亮-字符串';
      else if (/^-/.test(词)) 类 = '高亮-参数';
      else if (/^\//.test(词)) 类 = '高亮-路径';
      const 转 = String(词).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      return 类 ? '<span class="' + 类 + '">' + 转 + '</span>' : 转;
    })
    .join(' ');
}

/* ---------------- 补全 ---------------- */

let 补全表 = { 命令: [], 常用: [], 路径: [] };
let 补全候选 = [];
let 补全选中 = 0;

function 摊平补全表(表) {
  const 源 = 表 && typeof 表 === 'object' ? 表 : {};
  const 结果 = [];
  const 见过 = new Set();
  for (const 分组 of [源.命令, 源.常用, 源.路径]) {
    if (!Array.isArray(分组)) continue;
    for (const 项 of 分组) {
      if (typeof 项 !== 'string') continue;
      const 文字 = 项.trim();
      if (!文字 || 见过.has(文字)) continue;
      见过.add(文字);
      结果.push(文字);
    }
  }
  return 结果;
}

function 取候选(前缀) {
  const 词 = String(前缀 || '').trim();
  const 全部 = 摊平补全表(补全表);
  const 匹配 = 全部.filter((t) => !词 || t.toLowerCase().startsWith(词.toLowerCase()));
  // 不含空格的纯命令优先，"wm" 排在 "wm size" 前面
  匹配.sort((a, b) => {
    const a空 = a.includes(' ');
    const b空 = b.includes(' ');
    if (a空 !== b空) return a空 ? 1 : -1;
    return a.localeCompare(b);
  });
  return 匹配.slice(0, 30);
}

function 隐藏补全() {
  补全候选 = [];
  补全选中 = 0;
  元素.补全框.hidden = true;
  元素.补全框.replaceChildren();
}

function 应用补全(候选) {
  if (!候选) return;
  const 值 = 元素.输入.value;
  const 位置 = 值.lastIndexOf(' ');
  const 前缀 = 位置 >= 0 ? 值.slice(0, 位置 + 1) : '';
  元素.输入.value = 前缀 + 候选 + ' ';
  const 尾 = 元素.输入.value.length;
  元素.输入.selectionStart = 尾;
  元素.输入.selectionEnd = 尾;
  隐藏补全();
}

function 显示补全(候选们) {
  const 列表 = Array.isArray(候选们) ? 候选们 : [];
  if (列表.length === 0) {
    隐藏补全();
    return;
  }
  补全候选 = 列表;
  补全选中 = 0;

  // 定位到输入框上方
  const 矩形 = 元素.输入.getBoundingClientRect();
  元素.补全框.style.left = Math.round(矩形.left) + 'px';
  元素.补全框.style.width = Math.max(200, Math.round(矩形.width)) + 'px';
  元素.补全框.style.top = Math.round(矩形.top - 4) + 'px';
  元素.补全框.style.transform = 'translateY(-100%)';

  元素.补全框.replaceChildren();
  for (let i = 0; i < 列表.length; i += 1) {
    const 项 = document.createElement('div');
    项.className = '补全项' + (i === 0 ? ' 选中' : '');
    项.textContent = 列表[i];
    // 用 mousedown：click 会先触发输入框 blur，导致选中丢失
    项.addEventListener('mousedown', (事件) => {
      事件.preventDefault();
      应用补全(列表[i]);
      元素.输入.focus();
    });
    元素.补全框.appendChild(项);
  }
  元素.补全框.hidden = false;
}

function 移动补全(方向) {
  if (补全候选.length === 0) return;
  const 项们 = [...元素.补全框.querySelectorAll('.补全项')];
  if (项们.length === 0) return;
  补全选中 = (补全选中 + 方向 + 项们.length) % 项们.length;
  项们.forEach((el, i) => el.classList.toggle('选中', i === 补全选中));
  项们[补全选中]?.scrollIntoView({ block: 'nearest' });
}

/* ---------------- 执行 ---------------- */

const 历史 = [];
let 历史位置 = -1;
let 命令计数 = 0;

async function 执行命令() {
  const 命令 = 元素.输入.value.trim();
  if (!命令) return;

  if (历史[历史.length - 1] !== 命令) 历史.push(命令);
  if (历史.length > 100) 历史.shift();
  历史位置 = -1;

  元素.输入.value = '';
  隐藏补全();

  输出HTML('<span class="高亮-提示">$</span> ' + 高亮(命令));

  try {
    const 结果 = 取值(await window.deck.工具.执行命令(命令));
    const 文本 = (结果 && (结果.输出 || 结果.stdout)) || '';
    if (文本) 输出文字(String(文本).replace(/\s+$/, ''));
    if (结果 && 结果.退出码 && 结果.退出码 !== 0) {
      输出文字('[退出码 ' + 结果.退出码 + ']', '高亮-错误');
    }
  } catch (错误) {
    输出文字('执行失败：' + 错误.message, '高亮-错误');
  }

  命令计数 += 1;
  元素.命令计数.textContent = '· 已执行 ' + 命令计数 + ' 条';
}

/* ---------------- 事件 ---------------- */

元素.输入.addEventListener('keydown', (事件) => {
  // 回车执行
  if (事件.key === 'Enter' && !事件.shiftKey) {
    事件.preventDefault();
    执行命令();
    return;
  }

  // Tab 补全
  if (事件.key === 'Tab') {
    事件.preventDefault();
    const 前缀 = 元素.输入.value.trim().split(/\s+/).pop() || '';
    const 候选 = 取候选(前缀);
    if (候选.length === 1) 应用补全(候选[0]);
    else 显示补全(候选);
    return;
  }

  // 上下翻历史；补全框开着时上下键先在候选里移动
  if (事件.key === 'ArrowUp') {
    if (!元素.补全框.hidden) {
      事件.preventDefault();
      移动补全(-1);
      return;
    }
    事件.preventDefault();
    if (历史.length === 0) return;
    if (历史位置 < 0) 历史位置 = 历史.length - 1;
    else if (历史位置 > 0) 历史位置 -= 1;
    元素.输入.value = 历史[历史位置] || '';
    const 尾 = 元素.输入.value.length;
    元素.输入.selectionStart = 尾;
    元素.输入.selectionEnd = 尾;
    return;
  }

  if (事件.key === 'ArrowDown') {
    if (!元素.补全框.hidden) {
      事件.preventDefault();
      移动补全(1);
      return;
    }
    事件.preventDefault();
    if (历史位置 < 0) return;
    历史位置 += 1;
    if (历史位置 >= 历史.length) {
      历史位置 = -1;
      元素.输入.value = '';
      return;
    }
    元素.输入.value = 历史[历史位置] || '';
    const 尾 = 元素.输入.value.length;
    元素.输入.selectionStart = 尾;
    元素.输入.selectionEnd = 尾;
    return;
  }

  // Ctrl+L 清屏
  if (事件.key.toLowerCase() === 'l' && 事件.ctrlKey) {
    事件.preventDefault();
    元素.输出.replaceChildren();
    return;
  }

  // Ctrl+C 清空当前行（没有选中时）
  if (事件.key.toLowerCase() === 'c' && 事件.ctrlKey && !事件.shiftKey) {
    const 有选中 = 元素.输入.selectionStart !== 元素.输入.selectionEnd;
    if (!有选中) {
      事件.preventDefault();
      元素.输入.value = '';
      输出文字('^C', '高亮-提示');
    }
    return;
  }

  // Esc 收起补全
  if (事件.key === 'Escape') {
    元素.补全框.hidden = true;
    return;
  }

  // 输入时收起补全框
  if (事件.key.length === 1) 元素.补全框.hidden = true;
});

// 点别处收起补全框
document.addEventListener('pointerdown', (事件) => {
  if (!元素.补全框.contains(事件.target) && 事件.target !== 元素.输入) {
    元素.补全框.hidden = true;
  }
});

$('清屏').addEventListener('click', () => {
  元素.输出.replaceChildren();
  元素.输入.focus();
});

/* ---------------- 启动 ---------------- */

async function 刷新连接状态() {
  try {
    const 列表 = 取值(await window.deck.设备.列表());
    const 在线 = (列表 || []).filter((d) => d.state === 'device');
    元素.连接点.classList.toggle('在线', 在线.length > 0);
    元素.设备文字.textContent = 在线.length
      ? 在线.map((d) => d.model || d.serial).join(', ')
      : '未连接设备';
  } catch {
    // 拿不到就保持原样
  }
}

async function 启动() {
  // 拉补全表
  try {
    补全表 = 取值(await window.deck.工具.补全表()) || 补全表;
  } catch {
    // 用空表也要能执行命令
  }

  输出文字('Aoid ADB 控制台 —— 输入 adb shell 命令，Tab 补全，↑↓ 翻历史', '高亮-提示');

  await 刷新连接状态();
  setInterval(刷新连接状态, 3000);

  元素.输入.focus();
}

启动();
