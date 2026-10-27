/**
 * 极简 Markdown 渲染器。
 *
 * 为什么自己写而不是引入 marked / markdown-it：
 *   Aoid 追求「零运行时依赖」，打包体积越小越好；而我们需要渲染的只有
 *   README / CHANGELOG / LICENSE / PRIVACY 这几个自己写的文档，
 *   支持标题、列表、代码块、表格、链接、强调就够了。
 *
 * 安全性：所有用户可见内容都来自本地文件，但仍然做 HTML 转义，
 * 避免文档里出现 < 引起解析问题，也避免以后文档来源变化时出事故。
 */
'use strict';

/** HTML 转义，防止文档里的 < > & 被当成标签 */
function 转义(文本) {
  return String(文本)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 处理行内的「反引号代码」、双星粗体、单星斜体、方括号链接 */
function 渲染行内(文本) {
  let 结果 = 转义(文本);

  // 行内代码优先（避免里面的 * 被当成强调）
  const 代码片段 = [];
  结果 = 结果.replace(/`([^`]+)`/g, (匹配, 内容) => {
    代码片段.push(内容);
    return `\u0000CODE${代码片段.length - 1}\u0000`;
  });

  // 粗体、斜体。
  // 正则刻意写成 /[*]{2}.../ 而不是转义的星号连写，
  // 因为后者在源码里会连成注释结束符，把后面的代码吞掉（踩过）。
  结果 = 结果.replace(/[*]{2}([^*]+)[*]{2}/g, '<strong>$1</strong>');
  结果 = 结果.replace(/(^|[^*])[*]([^*]+)[*]/g, '$1<em>$2</em>');

  // 链接：只允许 http/https，其他协议按纯文本处理
  结果 = 结果.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (匹配, 文字, 地址) => {
    return `<a href="${地址}" data-md-link="${地址}">${文字}</a>`;
  });

  // 还原行内代码
  结果 = 结果.replace(/\u0000CODE(\d+)\u0000/g, (匹配, 序号) => `<code>${代码片段[Number(序号)]}</code>`);

  return 结果;
}

/**
 * 把 Markdown 转成 HTML 字符串。
 *
 * 支持的语法（够用即止）：
 *   # ~ ###### 标题、--- 分隔线、- / * / 1. 列表、> 引用、
 *   ``` 代码块、| 表格 |、段落、行内格式
 */
export function 渲染Markdown(原文) {
  const 行们 = String(原文 || '').replace(/\r\n/g, '\n').split('\n');
  const 输出 = [];

  let 在代码块 = false;
  let 代码内容 = [];
  let 列表类型 = ''; // 'ul' | 'ol' | ''
  let 表格缓冲 = [];

  const 关闭列表 = () => {
    if (列表类型) {
      输出.push(`</${列表类型}>`);
      列表类型 = '';
    }
  };

  /** 把表格缓冲刷成 <table> */
  const 刷表格 = () => {
    if (!表格缓冲.length) return;
    const 行数据 = 表格缓冲.map((行) =>
      行
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((格) => 格.trim()),
    );
    表格缓冲 = [];

    if (行数据.length < 2) return;

    // 第二行是分隔行（---），跳过
    const 表头 = 行数据[0];
    const 内容行 = 行数据.slice(2);

    const 部分 = ['<table><thead><tr>'];
    for (const 格 of 表头) 部分.push(`<th>${渲染行内(格)}</th>`);
    部分.push('</tr></thead><tbody>');
    for (const 行 of 内容行) {
      部分.push('<tr>');
      for (let i = 0; i < 表头.length; i++) 部分.push(`<td>${渲染行内(行[i] || '')}</td>`);
      部分.push('</tr>');
    }
    部分.push('</tbody></table>');
    输出.push(部分.join(''));
  };

  for (const 原行 of 行们) {
    // 代码块围栏
    if (/^```/.test(原行)) {
      if (在代码块) {
        输出.push(`<pre class="md-code"><code>${转义(代码内容.join('\n'))}</code></pre>`);
        代码内容 = [];
        在代码块 = false;
      } else {
        关闭列表();
        刷表格();
        在代码块 = true;
      }
      continue;
    }
    if (在代码块) {
      代码内容.push(原行);
      continue;
    }

    // 表格行
    if (/^\s*\|.*\|\s*$/.test(原行)) {
      关闭列表();
      表格缓冲.push(原行.trim());
      continue;
    }
    刷表格();

    // 空行
    if (!原行.trim()) {
      关闭列表();
      continue;
    }

    // 标题
    const 标题 = /^(#{1,6})\s+(.*)$/.exec(原行);
    if (标题) {
      关闭列表();
      const 级别 = 标题[1].length;
      输出.push(`<h${级别} class="md-h${级别}">${渲染行内(标题[2])}</h${级别}>`);
      continue;
    }

    // 分隔线（三个减号 / 三个星号 / 三个下划线）
    if (/^\s*(?:-{3,}|[*]{3,}|_{3,})\s*$/.test(原行)) {
      关闭列表();
      输出.push('<hr class="md-hr" />');
      continue;
    }

    // 引用
    const 引用 = /^>\s?(.*)$/.exec(原行);
    if (引用) {
      关闭列表();
      输出.push(`<blockquote class="md-quote">${渲染行内(引用[1])}</blockquote>`);
      continue;
    }

    // 无序列表
    const 无序 = /^\s*[-*+]\s+(.*)$/.exec(原行);
    if (无序) {
      if (列表类型 !== 'ul') {
        关闭列表();
        输出.push('<ul class="md-ul">');
        列表类型 = 'ul';
      }
      输出.push(`<li>${渲染行内(无序[1])}</li>`);
      continue;
    }

    // 有序列表
    const 有序 = /^\s*\d+[.)]\s+(.*)$/.exec(原行);
    if (有序) {
      if (列表类型 !== 'ol') {
        关闭列表();
        输出.push('<ol class="md-ol">');
        列表类型 = 'ol';
      }
      输出.push(`<li>${渲染行内(有序[1])}</li>`);
      continue;
    }

    // 普通段落
    关闭列表();
    输出.push(`<p class="md-p">${渲染行内(原行)}</p>`);
  }

  // 收尾
  if (在代码块 && 代码内容.length) {
    输出.push(`<pre class="md-code"><code>${转义(代码内容.join('\n'))}</code></pre>`);
  }
  关闭列表();
  刷表格();

  return 输出.join('\n');
}
