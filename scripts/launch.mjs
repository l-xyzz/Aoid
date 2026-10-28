/**
 * 真正的启动器（由 启动.bat 调用）。
 *
 * 为什么要多这一层：
 *   Electron 直接从网络盘（Z:、映射的网络共享）运行时，会毫无提示地
 *   立刻退出（退出码 0x80000003），日志里什么都不留。实测同一份
 *   electron.exe（哈希一致）放在本地磁盘就完全正常。
 *
 *   所以这里判断项目所在磁盘：是本地盘就直接启动；是网络盘就镜像一份到
 *   本地缓存目录再启动，并让用户在本地副本上操作。这不是绕过问题，
 *   而是把「Electron 不支持从网络盘运行」这件事对用户隐藏掉。
 *
 * 另外顺带处理两件容易导致闪退的环境问题：
 *   - 清除 ELECTRON_RUN_AS_NODE（会让 Electron 变成纯 Node）
 *   - 清除 VIPSHOME（某些调试环境会把它指向别的 Electron 构建）
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// 不能用 import.meta.url 拼路径：中文目录会被 URL 编码成 %E9%A1%B9%E7%9B%AE，
// 导致后续 fs 操作找不到文件（实测复制了 0 个文件）。bat 已 cd 到项目目录，直接用 cwd。
const 项目目录 = process.cwd();

/**
 * 需要镜像到本地的内容。
 *
 * 只复制「运行时真正要用的」：源码、资源、adb、scrcpy 组件，以及 electron 自己的
 * 运行时目录（node_modules/electron 只有 83 个文件）。
 * 不要整个 node_modules——它有 7431 个文件、几百 MB，从网络盘复制要好几分钟，
 * 而除 electron 之外的其他包只在构建时用得到，运行时并不需要。
 */
/*
 * 文档必须一起复制。
 *
 * 「关于」和「隐私」页要在运行时读这些文件，漏了就会报
 * 「文档读取失败：CHANGELOG.md (ENOENT)」——明明项目根目录下就有。
 * 中英文都要，界面语言不是中文时用的是 .en.md 那几份。
 */
const 文档文件 = [
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'LICENSE',
  'PRIVACY.md',
  'PRIVACY.en.md',
  'THIRD-PARTY-NOTICES.md',
  'THIRD-PARTY-NOTICES.en.md',
];

const 镜像内容 = [
  'src',
  'vendor',
  'platform-tools',
  'scrcpy-runtime',
  'resources',
  'scripts',
  'package.json',
  ...文档文件,
];
const 额外目录 = ['node_modules/electron'];

/** 干净的环境：去掉会干扰 Electron 的变量 */
function 构造环境() {
  const 环境 = {};
  for (const [键, 值] of Object.entries(process.env)) {
    const 大写 = 键.toUpperCase();
    if (大写 === 'ELECTRON_RUN_AS_NODE' || 大写 === 'VIPSHOME') continue;
    环境[键] = 值;
  }
  return 环境;
}

/** 判断某个路径是否位于网络驱动器 */
function 是网络盘(路径) {
  const 盘符 = /^([A-Za-z]):/.exec(path.resolve(路径));
  if (盘符) {
    // 3 = DRIVE_REMOTE
    try {
      const 类型 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${盘符[1].toUpperCase()}:'").DriveType`], { encoding: 'utf8' }).trim();
      return 类型 === '3' || 类型 === '4';
    } catch {
      // 查不到就按本地处理，交给实际启动结果判断
      return false;
    }
  }
  // UNC 路径 \\server\share
  return 路径.startsWith('\\\\');
}

/** 递归复制目录（保留结构），返回复制的文件数 */
function 复制目录(源, 目标) {
  // 列表里既有目录（src）也有文件（package.json），单项也要能复制
  if (!fs.statSync(源).isDirectory()) {
    fs.mkdirSync(path.dirname(目标), { recursive: true });
    fs.copyFileSync(源, 目标);
    return 1;
  }

  let 数量 = 0;
  fs.mkdirSync(目标, { recursive: true });
  for (const 项 of fs.readdirSync(源, { withFileTypes: true })) {
    const 源路径 = path.join(源, 项.name);
    const 目标路径 = path.join(目标, 项.name);
    if (项.isDirectory()) {
      数量 += 复制目录(源路径, 目标路径);
    } else if (项.isFile()) {
      try {
        fs.copyFileSync(源路径, 目标路径);
      } catch (错误) {
        // EBUSY：上一次运行的 adb / scrcpy 还占着文件。这种情况多半是
        // 上一份副本已经在跑，跳过这个文件即可，不影响启动。
        if (错误.code !== 'EBUSY' && 错误.code !== 'EPERM') throw 错误;
      }
      数量 += 1;
    }
  }
  return 数量;
}

/** 把项目镜像到本地缓存，返回可用于运行的应用目录 */
function 准备本地副本() {
  // 用用户名 + 项目名做目录，避免多个项目互相覆盖
  const 项目名 = path.basename(项目目录);
  const 本地根 = path.join(os.homedir(), 'AppData', 'Local', 'Aoid', 项目名);

  fs.mkdirSync(本地根, { recursive: true });

  let 复制数 = 0;
  for (const 名 of [...镜像内容, ...额外目录]) {
    const 源 = path.join(项目目录, 名);
    if (!fs.existsSync(源)) continue;
    const 目标 = path.join(本地根, 名);
    复制数 += 复制目录(源, 目标);
  }

  return { 应用目录: 本地根, 复制数 };
}

/** 启动 Electron，返回子进程 */
function 启动(应用目录) {
  const 可执行文件 = path.join(应用目录, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(可执行文件)) {
    throw new Error('找不到 electron.exe，请先运行 npm install');
  }

  const 子进程 = spawn(可执行文件, [应用目录], {
    cwd: 应用目录,
    env: 构造环境(),
    detached: true,
    stdio: 'ignore',
  });
  子进程.unref();
  return 子进程;
}

/* ------------------------------------------------------------------ */

const 网络盘 = 是网络盘(项目目录);
console.log(`项目位置：${项目目录}${网络盘 ? '（网络盘）' : ''}`);

let 应用目录 = 项目目录;

if (网络盘) {
  console.log('检测到项目位于网络盘，Electron 无法从这里运行，正在准备本地副本…');
  const { 应用目录: 本地目录, 复制数 } = 准备本地副本();
  console.log(`已同步 ${复制数} 个文件到：${本地目录}`);
  应用目录 = 本地目录;
}

try {
  const 子进程 = 启动(应用目录);
  console.log(`已启动（PID ${子进程.pid}）`);
} catch (错误) {
  console.error(`启动失败：${错误.message}`);
  process.exit(1);
}