/**
 * 安全打包脚本：解决「项目在网络盘上打出来的包跑不起来」。
 *
 * 为什么需要它：
 *   Electron 打包产物里的 Aoid.exe 会从自己所在目录加载 resources，
 *   而 Electron 无法从网络驱动器（Z: 这类）正常启动，
 *   双击 exe 毫无反应、也不报错（退出码 3121 / 0x80000003 之类，静默失败）。
 *   开发时 launch.mjs 已经把项目镜像到本地磁盘绕过这个问题，
 *   但打包产物如果直接落在 Z:\...\release，用户解压运行照样起不来。
 *
 * 做法：
 *   1. 把构建需要的文件复制到本地磁盘临时目录（%LOCALAPPDATA%\AoidBuild）；
 *   2. 用 junction 链接 node_modules，避免重复复制几百 MB；
 *   3. 在本地目录里执行 electron-builder；
 *   4. 生成 zip，再复制回项目 release/ 供分发。
 *
 * 用法：npm run dist:safe
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const 项目目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 本地根 = path.join(os.homedir(), 'AppData', 'Local', 'AoidBuild');
const 本地release = path.join(本地根, 'release');

/** 需要复制到本地构建目录的内容 */
const 复制清单 = [
  'src',
  'resources',
  'docs',
  'vendor',
  'scrcpy-runtime',
  'platform-tools',
  'scripts',
  'package.json',
  'electron-builder.yml',
  'README.md',
  // 英文文档也要带上：electron-builder.yml 的 files 里列了它们，
  // 本地构建目录里没有的话，打出来的 asar 里就缺这几份，
  // 界面语言不是中文时文档会读不到。
  'README.en.md',
  'PRIVACY.en.md',
  'THIRD-PARTY-NOTICES.en.md',
  'CHANGELOG.md',
  'LICENSE',
  'PRIVACY.md',
  'THIRD-PARTY-NOTICES.md',
];

function 说(文本) {
  console.log('  ' + 文本);
}

/** 递归删除（容忍不存在） */
function 清空(路径) {
  try {
    fs.rmSync(路径, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // 忽略
  }
}

/** 递归复制目录 */
function 复制目录(源, 目标) {
  fs.mkdirSync(目标, { recursive: true });
  for (const 项 of fs.readdirSync(源, { withFileTypes: true })) {
    const 源路径 = path.join(源, 项.name);
    const 目标路径 = path.join(目标, 项.name);
    if (项.isDirectory()) 复制目录(源路径, 目标路径);
    else fs.copyFileSync(源路径, 目标路径);
  }
}

async function 主流程() {
  // 判断项目是否在网络盘上：网络盘需要走本地构建
  const 盘符 = path.parse(项目目录).root;
  const 是网络盘 = 盘符.startsWith('\\\\') || /^[A-Z]:\\$/i.test(盘符) === false;

  console.log('Aoid 打包');
  说('项目目录：' + 项目目录);
  说('构建目录：' + 本地根);

  console.log('\n[1/5] 准备本地构建目录');
  清空(本地根);
  fs.mkdirSync(本地根, { recursive: true });

  for (const 名 of 复制清单) {
    const 源 = path.join(项目目录, 名);
    if (!fs.existsSync(源)) {
      说('跳过（不存在）：' + 名);
      continue;
    }
    const 目标 = path.join(本地根, 名);
    if (fs.statSync(源).isDirectory()) 复制目录(源, 目标);
    else fs.copyFileSync(源, 目标);
  }
  说('已复制 ' + 复制清单.length + ' 项');

  console.log('\n[2/5] 链接 node_modules');
  const 模块源 = path.join(项目目录, 'node_modules');
  const 模块目标 = path.join(本地根, 'node_modules');
  const electronBuilder = path.join(模块源, 'electron-builder', 'cli.js');
  if (!fs.existsSync(electronBuilder)) {
    throw new Error('找不到 electron-builder，请先 npm install');
  }
  // Windows 用 junction，不需要管理员权限
  execFileSync('cmd', ['/c', 'mklink', '/J', 模块目标, 模块源], { stdio: 'pipe' });
  说('已链接 node_modules');

  console.log('\n[3/5] 打包安装包 + 便携版');
  // 先做 --dir 得到 win-unpacked（用于生成 zip），再据此产出安装包和便携版。
  // 注意：nsis/portable 首次运行需要下载 NSIS 工具链（约 3MB），会联网。
  const 版本 = JSON.parse(fs.readFileSync(path.join(本地根, 'package.json'), 'utf8')).version;

  execFileSync(process.execPath, [electronBuilder, '--win', '--x64', '--dir'], {
    cwd: 本地根,
    stdio: 'inherit',
  });

  const 解包目录 = path.join(本地release, 'win-unpacked');
  if (!fs.existsSync(path.join(解包目录, 'Aoid.exe'))) {
    throw new Error('打包失败：没有生成 Aoid.exe');
  }
  说('已生成 ' + path.join(解包目录, 'Aoid.exe'));

  // 安装包（含卸载程序）与便携版
  let 安装包已生成 = false;
  try {
    execFileSync(process.execPath, [electronBuilder, '--win', '--x64'], {
      cwd: 本地根,
      stdio: 'inherit',
    });
    安装包已生成 = true;
  } catch {
    console.warn('  ⚠ 安装包/便携版生成失败（通常是下载 NSIS 工具链时网络中断）');
    console.warn('    仍会生成 zip，可继续分发；稍后重跑本脚本即可补上安装包');
  }

  console.log('\n[4/5] 压缩免安装版');
  const zip名 = `Aoid-${版本}-win-x64.zip`;
  const zip路径 = path.join(本地release, zip名);
  // 用 PowerShell 的 Compress-Archive，Node 自带没有 zip 能力
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${path.join(解包目录, '*')}' -DestinationPath '${zip路径}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: 'inherit' },
  );
  说('已生成 ' + zip路径);

  console.log('\n[5/5] 复制回项目 release/');
  const 目标release = path.join(项目目录, 'release');
  fs.mkdirSync(目标release, { recursive: true });

  // 把 release 目录下所有产物（安装包 / 便携版 / zip）都复制回去
  const 产物 = fs
    .readdirSync(本地release)
    .filter((名) => /\.(exe|zip|blockmap)$/i.test(名));
  for (const 名 of 产物) {
    fs.copyFileSync(path.join(本地release, 名), path.join(目标release, 名));
  }

  console.log('\n产物：');
  for (const 名 of 产物) {
    const 大小 = Math.round(fs.statSync(path.join(本地release, 名)).size / 1024 / 1024);
    console.log('  ' + 名.padEnd(38) + 大小 + ' MB');
  }
  console.log('  可直接运行的目录：' + 解包目录);

  if (!安装包已生成) {
    console.log('\n提示：安装包未生成，检查网络后重跑 npm run dist:safe。');
  }
  if (是网络盘) {
    console.log('\n注意：项目在网络盘上，打包产物刻意放在本地磁盘生成。');
    console.log('     产物可以放回网络盘分发，但解压后必须在本地磁盘运行。');
  }
}

主流程().catch((错误) => {
  console.error('\n打包失败：' + 错误.message);
  process.exit(1);
});
