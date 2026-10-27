/**
 * 打包前准备 adb（可选）。
 *
 * 仓库里默认放了 platform-tools 的 adb 三件套（约 8MB），
 * 如果希望从官方源重新获取或核对，运行：node scripts/bundle-tools.mjs
 *
 * 只保留 adb 运行必需的三个文件，其余工具（fastboot、sqlite3 等）不落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const 根目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 目标目录 = path.join(根目录, 'platform-tools');
const 地址 = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const 必需文件 = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];

/** 从 zip 里只取出需要的文件 */
function 解压指定文件(压缩包, 文件名列表) {
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
    if (!文件名列表.includes(文件名)) continue;

    const 本地名长度 = 压缩包.readUInt16LE(本地头偏移 + 26);
    const 本地扩长度 = 压缩包.readUInt16LE(本地头偏移 + 28);
    const 数据起点 = 本地头偏移 + 30 + 本地名长度 + 本地扩长度;
    const 原始 = 压缩包.subarray(数据起点, 数据起点 + 压缩后大小);

    if (压缩方式 === 0) 结果.set(文件名, Buffer.from(原始));
    else if (压缩方式 === 8) 结果.set(文件名, zlib.inflateRawSync(原始));
  }
  return 结果;
}

console.log('正在下载 platform-tools…');
const 响应 = await fetch(地址, { redirect: 'follow' });
if (!响应.ok) throw new Error(`下载失败：HTTP ${响应.status}`);
const 压缩包 = Buffer.from(await 响应.arrayBuffer());
console.log(`下载完成：${(压缩包.length / 1048576).toFixed(1)} MB`);

const 文件 = 解压指定文件(压缩包, 必需文件);
fs.mkdirSync(目标目录, { recursive: true });
for (const 名 of 必需文件) {
  const 内容 = 文件.get(名);
  if (!内容) throw new Error(`压缩包里缺少 ${名}`);
  fs.writeFileSync(path.join(目标目录, 名), 内容);
  console.log(`已写入 platform-tools/${名}（${(内容.length / 1024).toFixed(0)} KB）`);
}

console.log('完成。打包时会自动带上这三个文件。');
