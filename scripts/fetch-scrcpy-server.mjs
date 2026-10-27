/**
 * 拉取 scrcpy 服务端（可选步骤）。
 *
 * 仓库里已经带了 vendor/scrcpy-server-v5.0.1，这个脚本用于：
 *   - 升级到新版本时重新下载；
 *   - 校验仓库里的文件是否与官方一致。
 *
 * 为什么保留脚本而不是只提交文件：让每个文件都能追溯到出处，
 * 也方便审核者自行核对 SHA-256。
 *
 * 用法：
 *   node scripts/fetch-scrcpy-server.mjs            校验现有文件
 *   node scripts/fetch-scrcpy-server.mjs --update   下载最新版并替换
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const 根目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor目录 = path.join(根目录, 'vendor');
const 当前版本 = '5.0.1';

/** 官方发布信息 */
const 发布地址 = (版本) =>
  `https://github.com/Genymobile/scrcpy/releases/download/v${版本}`;

/** 计算文件 SHA-256 */
function 计算哈希(文件) {
  return crypto.createHash('sha256').update(fs.readFileSync(文件)).digest('hex');
}

/**
 * 下载并校验官方 SHA-256，避免供应链风险。
 * @param {string} 版本
 * @param {string} 目标文件
 */
async function 下载服务端(版本, 目标文件) {
  const 文件名 = `scrcpy-server-v${版本}`;
  const 下载地址 = `${发布地址(版本)}/${文件名}`;
  const 校验地址 = `${发布地址(版本)}/SHA256SUMS.txt`;

  console.log(`正在获取校验文件 ${校验地址}`);
  const 校验文本 = await (await fetch(校验地址)).text();
  const 期望哈希 = 校验文本
    .split('\n')
    .map((行) => 行.trim().split(/\s+/))
    .find((列) => 列[1] === 文件名)?.[0];

  if (!期望哈希) throw new Error('校验文件里找不到该版本的服务端');
  console.log(`官方 SHA-256: ${期望哈希}`);

  console.log(`正在下载 ${下载地址}`);
  const 响应 = await fetch(下载地址, { redirect: 'follow' });
  if (!响应.ok) throw new Error(`下载失败：HTTP ${响应.status}`);
  const 数据 = Buffer.from(await 响应.arrayBuffer());

  const 实际哈希 = crypto.createHash('sha256').update(数据).digest('hex');
  if (实际哈希 !== 期望哈希) {
    throw new Error(`校验不通过：下载得到 ${实际哈希}`);
  }
  console.log(`校验通过：${实际哈希}`);

  fs.writeFileSync(目标文件, 数据);
  console.log(`已写入 ${path.relative(根目录, 目标文件)}（${(数据.length / 1024).toFixed(0)} KB）`);
}

const 参数 = process.argv.slice(2);

if (参数.includes('--update')) {
  const 目标 = path.join(vendor目录, `scrcpy-server-v${当前版本}`);
  fs.mkdirSync(vendor目录, { recursive: true });
  await 下载服务端(当前版本, 目标);
} else {
  const 目标 = path.join(vendor目录, `scrcpy-server-v${当前版本}`);
  if (!fs.existsSync(目标)) {
    console.error(`缺少 ${path.relative(根目录, 目标)}，请加 --update 重新下载`);
    process.exit(1);
  }
  const 实际 = 计算哈希(目标);
  console.log(`本地 SHA-256: ${实际}`);
  console.log('如需与官方核对，运行 npm run fetch:server --update 会重新下载并比对。');
}
