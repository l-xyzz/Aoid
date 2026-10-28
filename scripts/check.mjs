/**
 * 启动前自检（也可单独运行：npm run lint）。
 *
 * 只做三件事，都是实际踩过坑的地方：
 *   1. 依赖与资源是否齐全；
 *   2. 脚本文件头是否健康（BOM、编码乱码、ES module 里多余的 'use strict'）；
 *   3. 每个脚本的语法是否合法。
 *
 * 全部通过退出码 0，否则 1，方便启动脚本和 CI 判断。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const 根目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 错误列表 = [];
const 提示列表 = [];

/** 必需资源 */
const 必需资源 = [
  ['node_modules/electron/dist/electron.exe', 'Electron 运行时，请先 npm install'],
  ['platform-tools/adb.exe', 'adb，请运行 npm run bundle:tools'],
  ['platform-tools/AdbWinApi.dll', 'adb 依赖文件'],
  ['platform-tools/AdbWinUsbApi.dll', 'adb 依赖文件'],
  ['vendor/scrcpy-server-v5.0.1', '画面服务端，请运行 npm run fetch:server'],
];

for (const [相对, 说明] of 必需资源) {
  if (!fs.existsSync(path.join(根目录, 相对))) {
    错误列表.push('缺少 ' + 相对 + '（' + 说明 + '）');
  }
}

/**
 * Electron 的二进制经常单独下载失败：npm install 只装了壳，
 * 真正的 electron.exe 由它的 postinstall 脚本另外拉取，网络不稳时很容易缺。
 * 这里明确给出补救命令，避免用户只看到「缺少文件」却不知道怎么办。
 */
if (!fs.existsSync(path.join(根目录, 'node_modules/electron/dist/electron.exe'))) {
  if (fs.existsSync(path.join(根目录, 'node_modules/electron/package.json'))) {
    错误列表.push('Electron 二进制未下载完成，请执行：node node_modules/electron/install.js');
  }
}

/** 可选：音频组件缺了只影响声音 */
const 音频文件 = ['scrcpy-runtime/scrcpy.exe', 'scrcpy-runtime/SDL2.dll'];
if (!音频文件.every((相对) => fs.existsSync(path.join(根目录, 相对)))) {
  提示列表.push('缺少 scrcpy-runtime/ 音频组件，声音无法在电脑播放（npm run fetch:runtime）');
}

/** 需要检查的脚本 */
const 脚本列表 = [
  'src/main/index.js',
  'src/main/core/context.js',
  'src/main/session/session.js',
  'src/main/ipc/device.js',
  'src/main/ipc/settings.js',
  'src/main/ipc/screen.js',
  'src/main/ipc/features.js',
  'src/main/preload.js',
  'src/main/adb.js',
  'src/main/scrcpy.js',
  'src/main/audio.js',
  'src/main/camera.js',
  'src/main/microphone.js',
  'src/main/virtual-camera.js',
  'src/main/control-protocol.js',
  'src/main/phone-service.js',
  'src/main/settings.js',
  'src/main/shortcuts.js',
  'src/main/wireless.js',
  'src/main/languages.js',
  'src/main/updater.js',
  'src/main/ipc/ime.js',
  'src/main/ipc/tools.js',
  'src/main/ipc/recorder.js',
  'src/main/ipc/peripherals.js',
  'src/renderer/js/app.js',
  'src/renderer/js/markdown.js',
  'src/renderer/js/i18n.js',
  'src/renderer/js/tools.js',
  'src/renderer/js/player.js',
  'src/renderer/js/shortcuts-ui.js',
  'src/renderer/js/features.js',
  'scripts/notify.mjs',
  'scripts/build-local.mjs',
];

/** 内置文档：不能在脚本列表里做语法检查（它们是 Markdown），单独查存在性和非空 */
const 文档列表 = [
  'README.md',
  'README.en.md',
  'PRIVACY.md',
  'PRIVACY.en.md',
  'THIRD-PARTY-NOTICES.md',
  'THIRD-PARTY-NOTICES.en.md',
  'LICENSE',
  'CHANGELOG.md',
];

for (const 相对 of 文档列表) {
  const 全路径 = path.join(根目录, 相对);
  if (!fs.existsSync(全路径)) {
    错误列表.push('缺少文档 ' + 相对);
    continue;
  }
  if (fs.statSync(全路径).size < 20) {
    错误列表.push('文档内容过短 ' + 相对);
  }
}

/** 乱码特征串（UTF-8 被按 GBK 解码后的典型产物） */
const 乱码特征 = ['锟斤拷', '鍣', '宸叉墦', '鎾斁', '鐨'];

for (const 相对 of 脚本列表) {
  const 全路径 = path.join(根目录, 相对);
  if (!fs.existsSync(全路径)) {
    错误列表.push('缺少文件 ' + 相对);
    continue;
  }

  const 字节 = fs.readFileSync(全路径);

  // BOM
  if (字节[0] === 0xef && 字节[1] === 0xbb && 字节[2] === 0xbf) {
    错误列表.push(相对 + ' 带 BOM，请去掉');
  }

  const 文本 = 字节.toString('utf8');

  // 乱码
  const 命中 = 乱码特征.find((特征) => 文本.indexOf(特征) >= 0);
  if (命中) {
    错误列表.push(相对 + ' 含乱码字符「' + 命中 + '」，请用 UTF-8 重新保存');
  }

  // 空注释块 /** 紧跟 /** 会把后面的代码整段吞进注释里，
  // 表现为「函数明明写了却报 is not defined」，极难排查（踩过一次）。
  if (/^\/\*\*\s*$[\s\S]{0,40}?^\/\*\*\s*$/m.test(文本)) {
    错误列表.push(相对 + ' 有连续的空注释块 /**，可能把后续代码包进注释');
  }

  // 注释块未闭合：/* 开头却一直没有 */，会把后面成片的代码吞进注释。
  // 表现是「接口/函数明明写了却报 No handler registered / is not defined」，
  // 语法检查也发现不了（注释掉的东西本来就不算语法错误）。踩过两次。
  //
  // 注意：必须把字符串字面量里的 /* */ 剔掉再统计，否则像 markdown.js 里
  // 正则中的 ** 会被误算成注释符号，产生假警报（踩过）。
  // 这里逐行处理，只替换「同一行内成对」的引号内容，避免正则跨行误伤。
  const 去字符串后 = 文本
    .split('\n')
    .map((行) =>
      行
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""'),
    )
    .join('\n');
  const 注释开始数 = (去字符串后.match(/\/\*(?!\*\/)/g) || []).length;
  const 注释结束数 = (去字符串后.match(/\*\//g) || []).length;
  if (注释开始数 !== 注释结束数) {
    错误列表.push(相对 + ' 注释块数量不匹配（/* 有 ' + 注释开始数 + ' 个，*/ 有 ' + 注释结束数 + ' 个），可能有代码被注释吞掉');
  }

  // ES module 里不该有 'use strict'
  const 是模块 = 文本.indexOf('import ') >= 0 && /^\s*import\s/m.test(文本);
  if (是模块 && 文本.indexOf("'use strict';") >= 0) {
    错误列表.push(相对 + ' 是 ES module，不需要（也不能有）use strict');
  }

  // 语法校验：
  //   .mjs 文件直接交给 node --check（Node 原生认识 ESM，能正确处理 import.meta）
  //   渲染进程的 .js 是浏览器 ESM，node --check 会误判，所以剥掉 import/export 再解析
  try {
    if (相对.endsWith('.mjs')) {
      execFileSync(process.execPath, ['--check', 全路径], { stdio: 'pipe' });
    } else if (是模块) {
      const 精简 = 文本
        .replace(/^import\s[\s\S]*?from\s*'[^']*';$/gm, '')
        .replace(/^export\s+/gm, '');
      new Function(精简);
    } else {
      execFileSync(process.execPath, ['--check', 全路径], { stdio: 'pipe' });
    }
  } catch (异常) {
    const 原始 = String((异常 && (异常.message || 异常)) || '未知错误');
    const 首行 = 原始.split(String.fromCharCode(10))[0];
    错误列表.push(相对 + ' 语法错误：' + 首行);
  }
}

/* 输出 */
if (提示列表.length > 0) {
  console.log('提示：');
  for (const 项 of 提示列表) console.log('  · ' + 项);
  console.log('');
}

if (错误列表.length > 0) {
  console.log('发现问题：');
  for (const 项 of 错误列表) console.log('  × ' + 项);
  console.log('');
  console.log('自检未通过。');
  process.exit(1);
}

console.log('自检通过，可以启动。');