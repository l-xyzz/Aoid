/**
 * 自动更新。
 *
 * 流程：
 *   1. 查 GitHub 最新 Release（/releases/latest，排除 prerelease）
 *   2. 和本地版本比较，有新的就返回版本号 + 更新说明
 *   3. 用户确认后下载对应产物：
 *        - 便携版（portable）：下载新 exe，写到临时文件，提示用户重启后生效
 *        - 安装版（nsis）：下载 Setup.exe 并直接运行，由安装器接管升级
 *
 * 网络诊断（这是用户明确要求的）：
 *   连不上 GitHub 时先 ping 百度
 *     - 也 ping 不通 → 「没有网络连接」
 *     - 能 ping 通  → 「当前无法访问 GitHub，请稍后再试或使用手段改善网络环境」
 *   这样用户能分清是自己的网断了，还是 GitHub 被墙了。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { spawn, execFile } = require('node:child_process');
const { app } = require('electron');

/** 仓库信息 */
const 仓库 = 'l-xyzz/Aoid';
/*
 * 用 /releases 列表而不是 /releases/latest。
 *
 * 原因：/releases/latest 只返回**正式版**，仓库当前只有 Pre-release，
 * 请求会直接 404，检查更新永远失败。列表接口能拿到全部（含预发布），
 * 由我们自己挑最新的那个。
 */
const GitHub接口 = `https://api.github.com/repos/${仓库}/releases?per_page=20`;

/** 网络诊断结论 */
const 诊断 = {
  正常: '正常',
  无网络: '无网络',
  GitHub不可达: 'GitHub不可达',
};

/**
 * 发一个 GET 请求，超时就中断。
 * 只用来访问 GitHub API 和下载产物，不走任何代理逻辑（用户自己用系统代理即可）。
 */
function 请求(url, { 超时 = 12000, 跟随重定向 = true, 最大字节 = 0 } = {}) {
  return new Promise((解析, 拒绝) => {
    const 发起 = (目标, 次数 = 0) => {
      if (次数 > 5) {
        拒绝(new Error('重定向次数过多'));
        return;
      }

      const 选项 = {
        headers: {
          'User-Agent': `Aoid/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
      };

      const 请求对象 = https.get(目标, 选项, (回应) => {
        // 跟随重定向（下载 GitHub Release 资源会 302 到别的主机）
        if (
          跟随重定向 &&
          回应.statusCode >= 300 &&
          回应.statusCode < 400 &&
          回应.headers.location
        ) {
          回应.resume();
          发起(new URL(回应.headers.location, 目标).toString(), 次数 + 1);
          return;
        }

        if (回应.statusCode !== 200) {
          回应.resume();
          拒绝(new Error(`HTTP ${回应.statusCode}`));
          return;
        }

        const 段们 = [];
        let 已收 = 0;
        回应.on('data', (段) => {
          已收 += 段.length;
          if (最大字节 && 已收 > 最大字节) {
            回应.destroy();
            拒绝(new Error('响应过大'));
            return;
          }
          段们.push(段);
        });
        回应.on('end', () => 解析({ 文本: Buffer.concat(段们).toString('utf8'), 回应 }));
        回应.on('error', 拒绝);
      });

      请求对象.on('error', 拒绝);
      请求对象.setTimeout(超时, () => {
        请求对象.destroy(new Error('请求超时'));
      });
    };

    发起(url);
  });
}

/**
 * ping 一下某个主机，判断本机有没有网。
 *
 * Windows 用 `ping -n 1 -w 2000`，macOS/Linux 用 `ping -c 1 -W 2`。
 * 用 execFile 而不是 exec，避免拼字符串。
 */
function ping(主机, 超时毫秒 = 2500) {
  return new Promise((解析) => {
    const 参数 =
      process.platform === 'win32'
        ? ['-n', '1', '-w', String(超时毫秒), 主机]
        : ['-c', '1', '-W', String(Math.ceil(超时毫秒 / 1000)), 主机];

    execFile('ping', 参数, { timeout: 超时毫秒 + 1500 }, (错误, stdout) => {
      解析(!错误 && /(ttl=|TTL=|time[=<])/.test(String(stdout || '')));
    });
  });
}

/**
 * 诊断网络状态。
 *
 * 先看 GitHub API 能不能通；不通再 ping 百度判断是不是本机没网。
 * 这一步只做判断，不改变任何系统设置。
 */
async function 诊断网络() {
  try {
    await 请求('https://api.github.com/rate_limit', { 超时: 8000, 最大字节: 64 * 1024 });
    return { 状态: 诊断.正常, 说明: '' };
  } catch {
    // GitHub 不通，看看是不是根本没网
    const 有外网 = await ping('www.baidu.com');
    if (!有外网) {
      return { 状态: 诊断.无网络, 说明: '没有网络连接，请检查你的网络设置后再试。' };
    }
    return {
      状态: 诊断.GitHub不可达,
      说明: '当前无法访问 GitHub，请稍后再试或使用手段改善网络环境。',
    };
  }
}

/** 把 GitHub 的 tag（v0.7.0-beta.2）解析成可比较的版本 */
function 解析版本(文本) {
  const 干净 = String(文本 || '')
    .trim()
    .replace(/^v/i, '');
  const 匹配 = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(干净);
  if (!匹配) return null;
  return {
    原文: 干净,
    主: Number(匹配[1]),
    次: Number(匹配[2]),
    修订: Number(匹配[3]),
    预发布: 匹配[4] || '',
  };
}

/**
 * 比较版本。返回 >0 表示 a 比 b 新，<0 表示更旧，0 相同。
 *
 * 预发布规则按语义化版本：正式版 > 预发布版，
 * 同为预发布时按字符串比较（beta.10 > beta.2 需要特殊处理）。
 */
function 比较版本(a, b) {
  if (!a || !b) return 0;
  for (const 键 of ['主', '次', '修订']) {
    if (a[键] !== b[键]) return a[键] - b[键];
  }
  // 正式版比预发布版新
  if (!a.预发布 && b.预发布) return 1;
  if (a.预发布 && !b.预发布) return -1;
  if (a.预发布 === b.预发布) return 0;

  // beta.2 vs beta.10：把数字段拆开逐段比较
  const 拆 = (s) => s.split(/[.-]/).map((段) => (/^\d+$/.test(段) ? Number(段) : 段));
  const 甲 = 拆(a.预发布);
  const 乙 = 拆(b.预发布);
  for (let i = 0; i < Math.max(甲.length, 乙.length); i += 1) {
    const x = 甲[i];
    const y = 乙[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y;
    } else if (String(x) !== String(y)) {
      return String(x) > String(y) ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 检查更新。
 * @returns {{有更新:boolean, 当前版本:string, 最新版本:string, 说明:string, 更新日志:string, 产物:object|null, 诊断:string}}
 */
async function 检查更新() {
  const 当前版本 = app.getVersion();

  const 网络 = await 诊断网络();
  if (网络.状态 !== 诊断.正常) {
    return {
      有更新: false,
      当前版本,
      最新版本: '',
      说明: 网络.说明,
      更新日志: '',
      产物: null,
      诊断: 网络.状态,
    };
  }

  let 数据;
  try {
    const { 文本 } = await 请求(GitHub接口, { 超时: 15000, 最大字节: 512 * 1024 });
    const 列表 = JSON.parse(文本);
    数据 = 挑最新发布(Array.isArray(列表) ? 列表 : []);
    if (!数据) throw new Error('仓库里还没有任何发布版本');
  } catch (错误) {
    // API 通了但这一步失败，多半是限流或仓库没有 Release
    return {
      有更新: false,
      当前版本,
      最新版本: '',
      说明: '检查更新失败：' + 错误.message,
      更新日志: '',
      产物: null,
      诊断: 诊断.GitHub不可达,
    };
  }

  const 最新版本 = String(数据.tag_name || '').replace(/^v/i, '') || String(数据.name || '');
  const 新 = 解析版本(最新版本);
  const 旧 = 解析版本(当前版本);

  if (!新) {
    return {
      有更新: false,
      当前版本,
      最新版本: '',
      说明: '拿到的版本号看不懂：' + 最新版本,
      更新日志: '',
      产物: null,
      诊断: 诊断.正常,
    };
  }

  const 有更新 = 比较版本(新, 旧) > 0;
  return {
    有更新,
    当前版本,
    最新版本,
    说明: 有更新 ? `发现新版本 ${最新版本}` : `已经是最新版本（${当前版本}）`,
    更新日志: String(数据.body || '').slice(0, 20000),
    产物: 有更新 ? 挑产物(数据.assets || []) : null,
    诊断: 诊断.正常,
  };
}

/**
 * 从 Release 列表里挑出「版本号最大」的那一个。
 *
 * 规则：
 *   - 草稿（draft）一律跳过，那是还没发布的
 *   - 不按时间排，而是按语义化版本号比大小，避免有人补发旧版本把顺序打乱
 *   - 预发布（prerelease）也参与比较：Aoid 目前全是预发布，
 *     排除掉就永远查不到更新
 */
function 挑最新发布(列表) {
  let 最优 = null;
  let 最优版本 = null;

  for (const 发布 of 列表) {
    if (!发布 || 发布.draft) continue;
    const 版本 = 解析版本(发布.tag_name || 发布.name || '');
    if (!版本) continue;
    if (!最优版本 || 比较版本(版本, 最优版本) > 0) {
      最优 = 发布;
      最优版本 = 版本;
    }
  }
  return 最优;
}

/**
 * 从 Release 资产里挑出本架构该用的文件。
 *
 * 安装版：Aoid-x.y.z-Setup.exe
 * 便携版：Aoid-x.y.z-Portable.exe
 * 老版本可能只有 zip，那就只能让用户去网页手动下。
 */
function 挑产物(资产们) {
  const 是安装版 = 判断安装版();

  const 找 = (正则) =>
    资产们.find((a) => 正则.test(a.name) && /x64|win/.test(a.name + 'x64')) ||
    资产们.find((a) => 正则.test(a.name)) ||
    null;

  const 主 = 是安装版 ? 找(/Setup\.exe$/i) : 找(/Portable\.exe$/i);
  const 备 = 是安装版 ? 找(/Portable\.exe$/i) : 找(/Setup\.exe$/i);
  const zip = 找(/win-x64\.zip$/i);

  const 选 = 主 || 备 || null;
  if (!选) return zip ? { 名称: zip.name, 地址: zip.browser_download_url, 类型: 'zip' } : null;

  return {
    名称: 选.name,
    地址: 选.browser_download_url,
    大小: 选.size || 0,
    类型: /Setup\.exe$/i.test(选.name) ? '安装版' : '便携版',
  };
}

/**
 * 判断当前是不是安装版。
 *
 * 依据：electron-builder 打包 NSIS 时会把安装信息写进注册表，
 * 而便携版运行时会设置环境变量 PORTABLE_EXECUTABLE_DIR（executable 包的约定）。
 * 两个都判断一下，拿不准时按便携版处理（更保守：换来的是直接替换文件）。
 */
function 判断安装版() {
  // 便携版一定有这个变量
  if (process.env.PORTABLE_EXECUTABLE_DIR) return false;

  try {
    const 注册表路径 = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
    const { execFileSync } = require('node:child_process');
    const 输出 = execFileSync(
      'reg',
      ['query', `HKCU\\${注册表路径}`, '/s', '/f', 'Aoid', '/d'],
      { encoding: 'utf8', timeout: 5000 },
    );
    return /Aoid/i.test(输出);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 下载与安装                                                          */
/* ------------------------------------------------------------------ */

/** 当前正在进行的下载（同一时刻只允许一个） */
let 进行中 = null;

/**
 * 下载文件到临时目录，边下边回报进度。
 *
 * 不用 electron 的 net 是因为它不好控制重定向和进度；
 * 直接用 https + 手动跟随重定向，逻辑都在 请求() 里复用了。
 */
async function 下载(地址, 目标路径, 上报 = () => {}) {
  return new Promise((解析, 拒绝) => {
    const 发起 = (目标, 次数 = 0) => {
      if (次数 > 6) {
        拒绝(new Error('重定向次数过多'));
        return;
      }

      const 请求对象 = https.get(
        目标,
        { headers: { 'User-Agent': `Aoid/${app.getVersion()}`, Accept: '*/*' } },
        (回应) => {
          if (回应.statusCode >= 300 && 回应.statusCode < 400 && 回应.headers.location) {
            回应.resume();
            发起(new URL(回应.headers.location, 目标).toString(), 次数 + 1);
            return;
          }
          if (回应.statusCode !== 200) {
            回应.resume();
            拒绝(new Error('下载失败：HTTP ' + 回应.statusCode));
            return;
          }

          const 总数 = Number(回应.headers['content-length'] || 0);
          let 已收 = 0;
          let 上次上报 = 0;
          const 输出 = fs.createWriteStream(目标路径);

          回应.on('data', (段) => {
            已收 += 段.length;
            // 每 200ms 报一次，避免高频 IPC 拖慢下载
            const 现在 = Date.now();
            if (现在 - 上次上报 > 200) {
              上次上报 = 现在;
              上报({ 已收, 总数 });
            }
          });

          回应.pipe(输出);

          输出.on('finish', () => {
            上报({ 已收, 总数 });
            解析(已收);
          });
          输出.on('error', 拒绝);
          回应.on('error', 拒绝);
        },
      );

      请求对象.on('error', 拒绝);
      // 下载大文件，超时给宽一点，且只看首包
      请求对象.setTimeout(30000, () => 请求对象.destroy(new Error('下载超时')));
    };

    发起(地址);
  });
}

/**
 * 执行更新。
 *
 * 分两种：
 *   便携版 —— 下载新 exe → 写一个批处理：等本进程退出 → 覆盖旧文件 → 启动新文件。
 *            之所以要批处理，是因为运行中的 exe 无法被自己覆盖。
 *   安装版 —— 下载 Setup.exe → 直接运行 → 安装器会替换程序目录。
 *            用 /S 静默安装会缺乏反馈，所以这里正常调起，让用户看到进度。
 *
 * @param {object} 产物 检查更新返回的 产物
 * @param {function} 上报 进度回调
 */
async function 执行更新(产物, 上报 = () => {}) {
  if (!产物 || !产物.地址) throw new Error('没有可用的更新文件');
  if (进行中) throw new Error('已有更新正在进行');

  进行中 = 产物.名称;
  try {
    const 临时目录 = path.join(os.tmpdir(), `Aoid-update-${Date.now()}`);
    await fsp.mkdir(临时目录, { recursive: true });
    const 目标 = path.join(临时目录, 产物.名称);

    上报({ 阶段: '下载', 已收: 0, 总数: 产物.大小 || 0 });
    const 字节数 = await 下载(产物.地址, 目标, (进度) => 上报({ 阶段: '下载', ...进度 }));
    if (!字节数) throw new Error('下载到的文件是空的');

    if (产物.类型 === '安装版') {
      上报({ 阶段: '安装' });
      // 安装器自己处理"关闭旧版本 → 覆盖 → 启动"，不需要我们插手
      const 子进程 = spawn(目标, ['/currentuser'], { detached: true, stdio: 'ignore' });
      子进程.unref();
      return { 方式: '安装版', 已启动安装器: true };
    }

    if (产物.类型 === '便携版') {
      上报({ 阶段: '替换' });
      return { 方式: '便携版', ...准备替换(目标) };
    }

    throw new Error('不支持的更新包类型：' + 产物.类型);
  } finally {
    进行中 = null;
  }
}

/**
 * 便携版替换：生成一个批处理，等当前进程退出后覆盖 exe 并启动新版本。
 *
 * 用 .bat 而不是 Node 子进程：Node 子进程会跟着父进程一起退出，
 * 而 cmd /c start 可以完全脱离。
 */
function 准备替换(新文件) {
  const 当前exe = app.getPath('exe');
  // 便携版实际跑在临时解包目录，真实文件位置由这个环境变量给出
  const 目标 = process.env.PORTABLE_EXECUTABLE_FILE || 当前exe;

  const 批处理 = path.join(path.dirname(新文件), 'do-update.bat');
  const 内容 = [
    '@echo off',
    'chcp 65001 >nul',
    'rem 等 Aoid 完全退出，否则 exe 被占用无法覆盖',
    'ping 127.0.0.1 -n 4 >nul',
    `move /y "${新文件}" "${目标}"`,
    `start "" "${目标}"`,
    'del "%~f0"',
  ].join('\r\n');

  fs.writeFileSync(批处理, 内容, 'utf8');

  const 子进程 = spawn('cmd', ['/c', 'start', '/min', '', 批处理], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  子进程.unref();

  return { 已安排替换: true, 目标, 稍后退出: true };
}

module.exports = {
  检查更新,
  执行更新,
  判断安装版,
  解析版本,
  比较版本,
  诊断网络,
  诊断,
};
