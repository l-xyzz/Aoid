/**
 * 语言包加载。
 *
 * 两个来源：
 *   1. 内置：src/renderer/languages 下的 json 文件（随包发布，改不了）
 *   2. 自定义：<应用数据目录>/languages 下的 json 文件
 *      用户可以让 AI 把 zh-CN.json 翻成任意语言丢进去
 *
 * 为什么要支持自定义：Aoid 自己不可能覆盖所有语言，
 * 但语言包只是「中文原文 → 译文」的纯文本对照表，
 * 让用户用 AI 生成一份放进去，比等作者翻译现实得多。
 *
 * 安全：只读 JSON，不做任何求值；文件大小限制 2MB，防止误放巨大文件卡住界面。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { 根目录, 数据目录 } = require('./core/context');

/** 单个语言包大小上限 */
const 最大字节 = 2 * 1024 * 1024;

/** 自定义语言包目录：%APPDATA%\Aoid\languages */
function 自定义语言目录() {
  return path.join(数据目录(), 'languages');
}

/** 内置语言包目录 */
function 内置语言目录() {
  const 候选 = [
    path.join(process.resourcesPath || 根目录, 'src', 'renderer', 'languages'),
    path.join(根目录, 'src', 'renderer', 'languages'),
  ];
  return 候选.find((目录) => fs.existsSync(目录)) || 候选[0];
}

/**
 * 读一个语言包文件。
 * @returns {{代码:string, 名称:string, 作者:string, 词典:object, 来源:string}|null}
 */
async function 读语言包(文件, 来源) {
  try {
    const 信息 = await fsp.stat(文件);
    if (信息.size > 最大字节) return null;
    const 文本 = await fsp.readFile(文件, 'utf8');
    const 数据 = JSON.parse(文本);
    if (!数据 || typeof 数据 !== 'object') return null;

    // 兼容两种写法：
    //   { 名称, 代码, 词典: {...} }
    //   直接就是扁平的对照表（给 AI 生成用的最简形式）
    const 是完整包 = 数据.词典 && typeof 数据.词典 === 'object';
    const 词典 = 是完整包 ? 数据.词典 : 数据;
    const 代码 = 是完整包 && 数据.代码 ? String(数据.代码) : path.basename(文件, '.json');
    const 名称 = 是完整包 && 数据.名称 ? String(数据.名称) : 代码;

    // 只保留字符串对字符串的条目
    const 干净 = {};
    for (const [键, 值] of Object.entries(词典)) {
      if (typeof 键 === 'string' && typeof 值 === 'string' && 键 && 值) 干净[键] = 值;
    }
    if (Object.keys(干净).length === 0) return null;

    return {
      代码,
      名称,
      作者: 是完整包 && 数据.作者 ? String(数据.作者) : '',
      说明: 是完整包 && 数据.说明 ? String(数据.说明) : '',
      来源,
      条目数: Object.keys(干净).length,
      词典: 干净,
    };
  } catch {
    return null;
  }
}

/** 扫描一个目录下的所有 .json */
async function 扫目录(目录, 来源) {
  let 文件们 = [];
  try {
    文件们 = await fsp.readdir(目录);
  } catch {
    return [];
  }

  const 结果 = [];
  for (const 名 of 文件们) {
    if (!名.toLowerCase().endsWith('.json')) continue;
    const 包 = await 读语言包(path.join(目录, 名), 来源);
    if (包) 结果.push(包);
  }
  return 结果;
}

/**
 * 列出所有可用语言。
 * 自定义语言与内置同名（代码相同）时，自定义优先，方便用户覆盖内置翻译。
 */
async function 列出语言() {
  const 内置 = await 扫目录(内置语言目录(), '内置');
  const 自定义 = await 扫目录(自定义语言目录(), '自定义');

  const 表 = new Map();
  for (const 包 of 内置) 表.set(包.代码, 包);
  for (const 包 of 自定义) 表.set(包.代码, 包);

  // 简体中文永远排第一（源语言，不需要语言包）
  const 列表 = [
    { 代码: 'zh-CN', 名称: '简体中文', 作者: 'Aoid', 来源: '内置', 条目数: 0 },
    ...[...表.values()].sort((a, b) => a.名称.localeCompare(b.名称)),
  ];
  return 列表;
}

/** 取某个语言的完整语言包（不含 zh-CN） */
async function 取语言(代码) {
  if (!代码 || 代码 === 'zh-CN') return null;

  // 自定义优先
  const 自定义 = path.join(自定义语言目录(), `${代码}.json`);
  if (fs.existsSync(自定义)) {
    const 包 = await 读语言包(自定义, '自定义');
    if (包 && 包.代码 === 代码) return 包;
    // 文件名与内部代码不一致时也接受，按文件名兜底
    if (包) return { ...包, 代码 };
  }

  const 内置 = path.join(内置语言目录(), `${代码}.json`);
  if (fs.existsSync(内置)) {
    const 包 = await 读语言包(内置, '内置');
    if (包) return { ...包, 代码 };
  }

  return null;
}

/** 确保自定义语言目录存在，并写入一份模板方便用户照抄 */
async function 准备语言目录() {
  const 目录 = 自定义语言目录();
  await fsp.mkdir(目录, { recursive: true }).catch(() => {});

  const 模板 = path.join(目录, '_模板.json');
  if (fs.existsSync(模板)) return 目录;

  // 模板内容：取内置中文作为键，值留空，让用户（或 AI）填
  const 内置 = await 读语言包(path.join(内置语言目录(), 'en-US.json'), '内置');
  const 键们 = 内置 ? Object.keys(内置.词典) : [];
  const 骨架 = {
    名称: 'My Language',
    代码: 'xx-XX',
    作者: 'your name',
    说明: '把下面的译文替换成你的语言，然后重命名为 xx-XX.json（xx-XX 要改成你的语言代码）',
    词典: Object.fromEntries(键们.map((键) => [键, ''])),
  };

  try {
    await fsp.writeFile(模板, JSON.stringify(骨架, null, 2) + '\n', 'utf8');
  } catch {
    // 写不了模板不影响使用
  }
  return 目录;
}

module.exports = {
  列出语言,
  取语言,
  准备语言目录,
  自定义语言目录,
  内置语言目录,
};
