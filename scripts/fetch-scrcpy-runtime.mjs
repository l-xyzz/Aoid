/**
 * 拉取官方 scrcpy 运行组件（音频播放需要）。
 *
 * 为什么需要这一套：
 *   手机声音要能在电脑上播放，需要「解码 Opus + 输出到声卡」这一整套。
 *   自己实现等于重新造 SDL2 + ffmpeg，所以直接复用官方 scrcpy 可执行文件——
 *   这也是同类开源软件（如 Escrcpy）的通行做法。
 *
 * 用法：
 *   node scripts/fetch-scrcpy-runtime.mjs           下载并解压到 scrcpy-runtime/
 *   node scripts/fetch-scrcpy-runtime.mjs --check   只检查是否齐全
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const 根目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 目标目录 = path.join(根目录, 'scrcpy-runtime');

/** 需要的 scrcpy 版本（与服务端 Java 版本对应） */
const 版本 = '3.3.4';

/** 这些文件缺一个，音频就起不来 */
const 必需文件 = [
  'scrcpy.exe',
  'SDL2.dll',
  'avcodec-61.dll',
  'avformat-61.dll',
  'avutil-59.dll',
  'swresample-5.dll',
  'scrcpy-server',
];

/** 检查是否齐全 */
function 检查() {
  if (!fs.existsSync(目标目录)) return { ok: false, 缺: ['目录 scrcpy-runtime/'] };
  const 缺 = 必需文件.filter((名) => !fs.existsSync(path.join(目标目录, 名)));
  return { ok: 缺.length === 0, 缺 };
}

/* ------------------------------------------------------------------ */
/* 极简 zip 解压（只取需要的文件）                                     */
/* ------------------------------------------------------------------ */

function 解压(压缩包, 文件名列表) {
  const 结尾 = 压缩包.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (结尾 < 0) throw new Error('不是有效的 zip 文件');

  const 条目数 = 压缩包.readUInt16LE(结尾 + 10);
  let 偏移 = 压缩包.readUInt32LE(结尾 + 16);
  const 结果 = new Map();

  for (let i = 0; i < 条目数; i += 1) {
    if (压缩包.readUInt32LE(偏移) !== 0x02014b50) break;
    const 压缩方式 = 压缩包.readUInt16LE(偏移 + 10);
    const 压缩后大小 = 压缩包.readUInt32LE(偏移 + 20);
    const 名称长度 = 压缩包.readUInt16LE(偏移 + 28);
    const 扩展长度 = 压缩包.readUInt16LE(偏移 + 30);
    const 注释长度 = 压缩包.readUInt16LE(偏移 + 32);
    const 本地头偏移 = 压缩包.readUInt32LE(偏移 + 42);
    const 名称 = 压缩包.subarray(偏移 + 46, 偏移 + 46 + 名称长度).toString('utf8');
    偏移 += 46 + 名称长度 + 扩展长度 + 注释长度;

    const 文件名 = 名称.split('/').pop();
    if (!文件名列表.includes(文件名) || 名称.includes('..')) continue;

    const 本地名长度 = 压缩包.readUInt16LE(本地头偏移 + 26);
    const 本地扩长度 = 压缩包.readUInt16LE(本地头偏移 + 28);
    const 数据起点 = 本地头偏移 + 30 + 本地名长度 + 本地扩长度;
    const 原始 = 压缩包.subarray(数据起点, 数据起点 + 压缩后大小);

    if (压缩方式 === 0) 结果.set(文件名, Buffer.from(原始));
    else if (压缩方式 === 8) 结果.set(文件名, zlib.inflateRawSync(原始));
  }

  return 结果;
}

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

const 参数 = process.argv.slice(2);

if (参数.includes('--check')) {
  const 结果 = 检查();
  if (结果.ok) {
    console.log(`scrcpy 运行组件齐全（${目标目录}）`);
  } else {
    console.error('缺少文件：\n  ' + 结果.缺.join('\n  '));
    console.error('请运行：node scripts/fetch-scrcpy-runtime.mjs');
    process.exit(1);
  }
} else {
  const 地址 = `https://github.com/Genymobile/scrcpy/releases/download/v${版本}/scrcpy-win64-v${版本}.zip`;
  console.log(`正在下载 ${地址}`);
  const 响应 = await fetch(地址, { redirect: 'follow' });
  if (!响应.ok) throw new Error(`下载失败：HTTP ${响应.status}`);

  const 压缩包 = Buffer.from(await 响应.arrayBuffer());
  console.log(`下载完成：${(压缩包.length / 1048576).toFixed(1)} MB`);

  const 文件们 = 解压(压缩包, [...必需文件, 'adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll']);
  fs.mkdirSync(目标目录, { recursive: true });

  for (const [名, 内容] of 文件们) {
    fs.writeFileSync(path.join(目标目录, 名), 内容);
    console.log(`  ${名}（${(内容.length / 1024).toFixed(0)} KB）`);
  }

  const 结果 = 检查();
  if (!结果.ok) {
    console.error('仍有文件缺失：' + 结果.缺.join('、'));
    process.exit(1);
  }
  console.log(`\n完成。音频播放所需组件已放在 ${目标目录}`);
}
