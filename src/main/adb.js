/**
 * adb 命令行封装。
 *
 * 设计要点：
 * 1. 一律使用 [可执行文件, ...参数] 数组调用，从不拼接字符串交给外壳执行，
 *    因此界面传进来的任何文本都不会被当作命令。
 * 2. 设备端命令需要 shell 语法（分号、管道）时，整个命令作为**单个参数**传给
 *    `adb shell`；实测 adb 会直接执行这个参数，且不会展开 $ 变量，因此可以放心
 *    在里面写 shell 脚本。
 * 3. 首次连接若系统没有 adb，会自动从 Google 官方源下载 platform-tools，
 *    只保留 adb 三件套（约 8MB），并全程上报进度。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

/** adb 官方下载地址 */
const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';

/** 运行 adb 必需的文件 */
const ADB_FILES = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];

class AdbError extends Error {
  constructor(消息, { 退出码 = null, 标准错误 = '' } = {}) {
    super(消息);
    this.name = 'AdbError';
    this.exitCode = 退出码;
    this.stderr = 标准错误;
  }
}

class Adb {
  /**
   * @param {object} 选项
   * @param {string} 选项.toolDir 随应用附带的 platform-tools 目录
   * @param {string} 选项.dataDir 应用数据目录（下载的 adb 放这里）
   * @param {string} [选项.指定路径] 用户在设置里手动指定的 adb 路径
   */
  constructor({ toolDir, dataDir, 指定路径 = '' }) {
    this.toolDir = toolDir;
    this.dataDir = dataDir;
    this.指定路径 = 指定路径;
    this.adbPath = '';
    this.version = '';
    this.服务已启动 = false;
  }

  /** 依次探测候选路径，返回可用的 adb */
  async 探测() {
    const 候选 = [];
    if (this.指定路径) 候选.push(this.指定路径);
    候选.push(path.join(this.toolDir, 'adb.exe'));
    候选.push(path.join(this.dataDir, 'platform-tools', 'adb.exe'));

    // 记录每个候选失败的原因，界面上能直接看到（比只显示「找不到 adb」有用得多）
    const 失败记录 = [];

    for (const 路径 of 候选) {
      if (!路径) continue;
      if (!fs.existsSync(路径)) {
        失败记录.push(`${路径} 不存在`);
        continue;
      }
      const 目录 = path.dirname(路径);
      const 缺失 = ADB_FILES.filter((文件) => !fs.existsSync(path.join(目录, 文件)));
      if (缺失.length > 0) {
        失败记录.push(`${目录} 缺少 ${缺失.join('、')}`);
        continue;
      }
      if (await this.#验证(路径)) {
        this.adbPath = 路径;
        return { ok: true, path: 路径, version: this.version, source: 'bundled' };
      }
      失败记录.push(`${路径} 无法运行（可能被杀毒软件拦截，或需要管理员权限）`);
    }

    // 系统 PATH 里可能已经有 adb
    if (await this.#验证('adb')) {
      this.adbPath = 'adb';
      return { ok: true, path: 'adb', version: this.version, source: 'system' };
    }
    失败记录.push('系统 PATH 中没有 adb');

    this.adbPath = '';
    return { ok: false, path: '', version: '', detail: 失败记录 };
  }

  async #验证(可执行文件) {
    try {
      const { stdout } = await this.#执行(可执行文件, ['version'], { timeout: 8000 });
      this.version = (stdout.match(/Version\s+([\d.]+)/) || [])[1] || '未知';
      return true;
    } catch {
      return false;
    }
  }

  /** 启动 adb 服务端 */
  async 启动服务() {
    if (this.服务已启动) return;
    await this.#执行(this.adbPath, ['start-server'], { timeout: 25000 });
    this.服务已启动 = true;
  }

  /**
   * 下载 adb：从 Google 官方源取 platform-tools 压缩包，
   * 只解出 adb 三件套，其余工具不落盘。
   * @param {(进度: {stage: string, percent: number, message: string}) => void} 上报
   */
  async 下载(上报 = () => {}) {
    const 目标目录 = path.join(this.dataDir, 'platform-tools');
    await fsp.mkdir(目标目录, { recursive: true });

    上报({ stage: 'connect', percent: 0, message: '正在连接 Google 官方源' });

    const 响应 = await fetch(PLATFORM_TOOLS_URL, { redirect: 'follow' });
    if (!响应.ok) throw new AdbError(`下载失败（HTTP ${响应.status}）`);

    const 总长度 = Number(响应.headers.get('content-length') || 0);
    const 数据块 = [];
    let 已接收 = 0;
    let 上次上报 = 0;

    for await (const 块 of 响应.body) {
      数据块.push(块);
      已接收 += 块.length;
      const 现在 = Date.now();
      if (现在 - 上次上报 > 100) {
        上次上报 = 现在;
        const 百分比 = 总长度 ? Math.min(99, Math.round((已接收 / 总长度) * 100)) : 0;
        上报({
          stage: 'download',
          percent: 百分比,
          message: `下载中 ${(已接收 / 1048576).toFixed(1)} MB${总长度 ? ` / ${(总长度 / 1048576).toFixed(1)} MB` : ''}`,
        });
      }
    }

    上报({ stage: 'extract', percent: 100, message: '正在解压' });
    await this.#解压三件套(Buffer.concat(数据块), 目标目录);

    上报({ stage: 'done', percent: 100, message: '准备完成' });
    const 结果 = await this.探测();
    if (!结果.ok) throw new AdbError('下载完成但 adb 无法运行');
    this.adbPath = path.join(目标目录, 'adb.exe');
    await this.启动服务();
    return { ...结果, path: this.adbPath };
  }

  /** 从 zip 里只取出需要的三个文件 */
  async #解压三件套(压缩包, 目标目录) {
    const 结尾位置 = 压缩包.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (结尾位置 < 0) throw new AdbError('下载内容不是有效的压缩包');

    const 条目数 = 压缩包.readUInt16LE(结尾位置 + 10);
    let 偏移 = 压缩包.readUInt32LE(结尾位置 + 16);
    const 待写入 = new Map();

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
      if (!ADB_FILES.includes(文件名) || 名称.includes('..')) continue;

      const 本地名长度 = 压缩包.readUInt16LE(本地头偏移 + 26);
      const 本地扩长度 = 压缩包.readUInt16LE(本地头偏移 + 28);
      const 数据起点 = 本地头偏移 + 30 + 本地名长度 + 本地扩长度;
      const 原始 = 压缩包.subarray(数据起点, 数据起点 + 压缩后大小);

      if (压缩方式 === 0) 待写入.set(文件名, Buffer.from(原始));
      else if (压缩方式 === 8) 待写入.set(文件名, zlib.inflateRawSync(原始));
    }

    for (const 文件名 of ADB_FILES) {
      const 内容 = 待写入.get(文件名);
      if (!内容) throw new AdbError(`压缩包中缺少 ${文件名}`);
      await fsp.writeFile(path.join(目标目录, 文件名), 内容);
    }
  }

  /** 列出设备 */
  async 列出设备() {
    const { stdout } = await this.#执行(this.adbPath, ['devices', '-l'], { timeout: 15000 });
    const 列表 = [];

    for (const 行 of stdout.split(/\r?\n/).slice(1)) {
      if (!行.trim()) continue;
      const [序列号, 状态, ...其余] = 行.trim().split(/\s+/);
      const 属性 = {};
      for (const 片段 of 其余) {
        const 位置 = 片段.indexOf(':');
        if (位置 > 0) 属性[片段.slice(0, 位置)] = 片段.slice(位置 + 1);
      }
      列表.push({
        serial: 序列号,
        state: 状态,
        model: (属性.model || '').replace(/_/g, ' '),
        product: 属性.product || '',
        device: 属性.device || '',
      });
    }
    return 列表;
  }

  /** 读取设备详情 */
  async 设备信息(序列号) {
    // 一次性取回全部属性，避免多次往返
    const 脚本 = [
      'echo "BRAND=$(getprop ro.product.brand)"',
      'echo "MODEL=$(getprop ro.product.model)"',
      'echo "MARKET=$(getprop ro.product.marketname)"',
      'echo "RELEASE=$(getprop ro.build.version.release)"',
      'echo "SDK=$(getprop ro.build.version.sdk)"',
      'echo "DENSITY=$(getprop ro.sf.lcd_density)"',
      'echo "ABI=$(getprop ro.product.cpu.abi)"',
      'echo "SIZE=$(wm size | tr \'\\n\' \' \')"',
      'echo "BATTERY=$(dumpsys battery | tr \'\\n\' \' \')"',
    ].join('; ');

    const { stdout } = await this.设备shell(序列号, 脚本, { timeout: 20000 });
    const 取值 = (键) => (stdout.match(new RegExp(`${键}=(.*)`)) || [])[1]?.trim() || '';

    const 尺寸文本 = 取值('SIZE');
    const 物理 = 尺寸文本.match(/Physical size:\s*(\d+)x(\d+)/) || [];
    const 覆盖 = 尺寸文本.match(/Override size:\s*(\d+)x(\d+)/) || [];
    const 宽 = Number(覆盖[1] || 物理[1] || 0);
    const 高 = Number(覆盖[2] || 物理[2] || 0);

    const 电池文本 = 取值('BATTERY');
    const 电量 = Number((电池文本.match(/level:\s*(\d+)/) || [])[1] || 0);
    const 状态码 = Number((电池文本.match(/status:\s*(\d+)/) || [])[1] || 0);
    const 温度 = Number((电池文本.match(/temperature:\s*(\d+)/) || [])[1] || 0) / 10;

    return {
      serial: 序列号,
      brand: 取值('BRAND'),
      model: 取值('MARKET') || 取值('MODEL'),
      android: 取值('RELEASE'),
      sdk: Number(取值('SDK')) || 0,
      density: Number(取值('DENSITY')) || 0,
      abi: 取值('ABI'),
      width: 宽,
      height: 高,
      battery: 电量,
      charging: 状态码 === 2 || 状态码 === 5,
      temperature: 温度,
      ratio: 宽 && 高 ? 高 / 宽 : 0,
    };
  }

  /** 在设备上执行 shell 命令 */
  设备shell(序列号, 命令, 选项 = {}) {
    return this.#执行(this.adbPath, ['-s', 序列号, 'shell', 命令], { timeout: 15000, ...选项 });
  }

  /** 推送文件到设备 */
  async 推送(序列号, 本地路径, 设备路径) {
    return this.#执行(this.adbPath, ['-s', 序列号, 'push', 本地路径, 设备路径], {
      timeout: 60000,
    });
  }

  /** 启动端口反向转发：设备 socket → 电脑端口 */
  async 反向转发(序列号, 设备socket, 端口) {
    return this.#执行(this.adbPath, ['-s', 序列号, 'reverse', 设备socket, `tcp:${端口}`], {
      timeout: 15000,
    });
  }

  /**
   * 列出当前设备的反向转发。
   * 输出形如：UsbFfs localabstract:scrcpy_abc123 tcp:12345
   * @returns {Promise<string[]>} 只返回设备侧的名字（localabstract:...）
   */
  async 列出反向转发(序列号) {
    const { stdout } = await this.#执行(this.adbPath, ['-s', 序列号, 'reverse', '--list'], {
      timeout: 10000,
    });
    return stdout
      .split(/\r?\n/)
      .map((行) => 行.trim())
      .filter(Boolean)
      .map((行) => 行.split(/\s+/)[1])
      .filter((名) => typeof 名 === 'string' && 名.startsWith('localabstract:'));
  }

  /** 移除反向转发 */
  async 移除反向转发(序列号, 设备socket) {
    return this.#执行(this.adbPath, ['-s', 序列号, 'reverse', '--remove', 设备socket], {
      timeout: 10000,
    }).catch(() => {});
  }

  /** 截一张完整截图（兼容模式兜底用） */
  async 截图(序列号) {
    const { stdout } = await this.设备shell(序列号, 'screencap -p', {
      timeout: 20000,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (stdout.length < 8 || stdout[0] !== 0x89) throw new AdbError('截图失败');
    return stdout;
  }

  /** 通用进程执行 */
  #执行(可执行文件, 参数, { timeout = 15000, encoding = 'utf8', maxBuffer = 16 * 1024 * 1024 } = {}) {
    return new Promise((解析, 拒绝) => {
      let 子进程;
      try {
        子进程 = spawn(可执行文件, 参数, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (错误) {
        拒绝(new AdbError(`无法启动 adb：${错误.message}`));
        return;
      }

      const 输出块 = [];
      const 错误块 = [];
      let 已超时 = false;
      let 已超出 = false;

      const 计时器 = setTimeout(() => {
        已超时 = true;
        子进程.kill();
      }, timeout);

      子进程.stdout.on('data', (块) => {
        输出块.push(块);
        const 长度 = 输出块.reduce((和, b) => 和 + b.length, 0);
        if (长度 > maxBuffer) {
          已超出 = true;
          子进程.kill();
        }
      });
      子进程.stderr.on('data', (块) => 错误块.push(块));

      子进程.on('error', (错误) => {
        clearTimeout(计时器);
        拒绝(new AdbError(`无法启动 ${可执行文件}：${错误.message}`));
      });

      子进程.on('close', (退出码) => {
        clearTimeout(计时器);
        const 原始 = Buffer.concat(输出块);
        const 标准错误 = Buffer.concat(错误块).toString('utf8');

        if (已超时) {
          拒绝(new AdbError('操作超时，请检查设备连接', { 退出码: 'TIMEOUT' }));
          return;
        }
        if (已超出) {
          拒绝(new AdbError('返回数据过大'));
          return;
        }
        if (退出码 !== 0) {
          拒绝(new AdbError(标准错误.trim() || `命令失败（退出码 ${退出码}）`, { 退出码, 标准错误 }));
          return;
        }
        解析({
          stdout: encoding === 'buffer' ? 原始 : 原始.toString('utf8'),
          stderr: 标准错误,
        });
      });
    });
  }
}

module.exports = { Adb, AdbError };
