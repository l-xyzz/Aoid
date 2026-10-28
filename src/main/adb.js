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
  /**
   * 补全设备的好看名字。
   *
   * `adb devices -l` 给出的 model 是**内部代号**（例如 M332BF），
   * 用户根本认不出这是哪台机器。真正的市场名要读
   * `ro.product.marketname`（REDMI K90 Ultra）。
   *
   * 这个属性只能通过 shell 拿，不能对每台设备都实时跑
   * （每台多一次 adb 往返，设备一多列表就慢）。所以：
   *   - 只对状态是 device 的（能执行 shell 的）去查
   *   - 结果按序列号缓存，同一台设备只查一次
   */
  async 补全型号(设备列表) {
    if (!this.型号缓存) this.型号缓存 = new Map();

    const 可用 = 设备列表.filter((d) => d.state === 'device');
    for (const 设备 of 可用) {
      // 已缓存就复用
      if (this.型号缓存.has(设备.serial)) {
        const 缓存 = this.型号缓存.get(设备.serial);
        设备.市场名 = 缓存.市场名;
        设备.品牌 = 缓存.品牌;
        continue;
      }

      try {
        const { stdout } = await this.设备shell(
          设备.serial,
          'getprop ro.product.marketname; getprop ro.product.brand',
          { timeout: 6000 },
        );
        const 行 = stdout.split(/\r?\n/).map((s) => s.trim());
        const 市场名 = 行[0] || '';
        const 品牌 = 行[1] || '';
        this.型号缓存.set(设备.serial, { 市场名, 品牌 });
        设备.市场名 = 市场名;
        设备.品牌 = 品牌;
      } catch {
        // 查不到就用代号兜底，不能因为这一台失败影响整张列表
        设备.市场名 = '';
        设备.品牌 = '';
      }
    }

    return 设备列表;
  }

  async 列出设备() {
    const { stdout } = await this.#执行(this.adbPath, ['devices', '-l'], { timeout: 15000 });
    const 原始列表 = [];

    for (const 行 of stdout.split(/\r?\n/).slice(1)) {
      if (!行.trim()) continue;
      const [序列号, 状态, ...其余] = 行.trim().split(/\s+/);
      if (!序列号 || 序列号 === '*') continue;

      const 属性 = {};
      for (const 片段 of 其余) {
         const 位置 = 片段.indexOf(':');
         if (位置 > 0) 属性[片段.slice(0, 位置)] = 片段.slice(位置 + 1);
      }

      原始列表.push({
        serial: 序列号,
        state: 状态,
        model: (属性.model || '').replace(/_/g, ' '),
        product: 属性.product || '',
        device: 属性.device || '',
        连接: 判断连接方式(序列号),
        唯一标识: 提取设备标识(序列号),
      });
    }

    return 合并重复设备(原始列表);
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

  /** 从设备拉文件到电脑 */
  async 拉取(序列号, 设备路径, 本地路径) {
    return this.#执行(this.adbPath, ['-s', 序列号, 'pull', 设备路径, 本地路径], {
      timeout: 120000,
    });
  }

  /**
   * 列目录。
   *
   * 输出统一成 { 名称, 是否目录, 字节, 修改时间 }，
   * 界面不用关心 Android 上 ls 输出的各种差异。
   * 用 ls -la 一次拿全部条目，比逐个 stat 快得多。
   */
  async 列出路径(序列号, 目录) {
    const 目标 = 目录 || '/sdcard';
    const { stdout } = await this.设备shell(序列号, `ls -la "${目标}" 2>/dev/null`, {
      timeout: 15000,
    });

    const 条目 = [];
    for (const 行 of stdout.split(/\r?\n/)) {
      const 修剪 = 行.trim();
      if (!修剪 || 修剪.startsWith('total ')) continue;

      // -rw-rw---- 1 u0_a123 media_rw 1234 2024-05-01 12:00 文件名
      const 匹配 = /^([dl-])[rwxsStT-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/.exec(修剪);
      if (!匹配) continue;

      const 原始名 = 匹配[4];
      if (原始名 === '.' || 原始名 === '..') continue;
      // 符号链接形如 name -> target，只取名字
      const 名称 = 原始名.includes(' -> ') ? 原始名.split(' -> ')[0] : 原始名;

      条目.push({
        名称,
        是否目录: 匹配[1] === 'd',
        字节: Number(匹配[2]) || 0,
        修改时间: 匹配[3],
      });
    }

    // 目录在前，同类按名称排序
    条目.sort((a, b) => {
      if (a.是否目录 !== b.是否目录) return a.是否目录 ? -1 : 1;
      return a.名称.localeCompare(b.名称, 'zh');
    });

    return { 目录: 目标, 条目 };
  }

  /** 删除设备上的文件（支持递归） */
  async 删除路径(序列号, 目标, 是否目录) {
    const 命令 = 是否目录 ? `rm -rf "${目标}"` : `rm -f "${目标}"`;
    return this.设备shell(序列号, 命令, { timeout: 20000 });
  }

  /** 在设备上建目录 */
  async 建目录(序列号, 目标) {
    return this.设备shell(序列号, `mkdir -p "${目标}"`, { timeout: 15000 });
  }

  /** 安装 apk：-r 覆盖安装，-d 允许降级 */
  async 安装apk(序列号, 本地路径) {
    const 结果 = await this.#执行(
      this.adbPath,
      ['-s', 序列号, 'install', '-r', '-d', 本地路径],
      { timeout: 180000 },
    );
    return String(结果.stdout || '') + String(结果.stderr || '');
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

/**
 * 判断这条 adb 连接是 USB 还是无线。
 *
 * adb 不会直接告诉你，只能从序列号格式推断：
 *   USB：一串十六进制（如 80204e16），部分厂商是型号+序号
 *   无线：IP:端口（被动连上）或 adb-xxx._adb-tls-connect._tcp（配对连上）
 *
 * 注意 mDNS 那条长这样：adb-80204e16-j0nUEo._adb-tls-connect._tcp
 * 里面夹着 USB 序列号，所以不能用"包含冒号"来判断。
 */
function 判断连接方式(序列号) {
  if (!序列号) return '未知';
  if (/_adb-tls-(connect|pairing)\._tcp/.test(序列号)) return '无线';
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(序列号)) return '无线';
  // emulator-5554 这类也算本地，但归到 USB 更让人看得懂
  return 'USB';
}

/**
 * 提取「同一台物理设备」的标识，用于合并 USB / 无线的两条连接。
 *
 * - 无线 mDNS 名 adb-80204e16-j0nUEo._adb-tls-connect._tcp → 80204e16
 * - IP:端口 无法反推序列号，只能原样作为标识
 * - USB 序列号本身就是标识
 */
function 提取设备标识(序列号) {
  if (!序列号) return '';
  const m = /^adb-(.+?)-[^-]+_adb-tls-\w+\._tcp$/.exec(序列号);
  if (m) return m[1];
  return 序列号;
}

/**
 * 合并同一台设备的重复连接。
 *
 * 同一台手机同时插着 USB 又开着无线调试时，adb 会列出两条。
 * 界面上应该只出现一条，并把连接方式标成「USB + 无线」，
 * 实际使用时优先走 USB（更稳、延迟更低）。
 */
function 合并重复设备(列表) {
  const 表 = new Map();

  for (const 设备 of 列表) {
    const 键 = 设备.唯一标识 || 设备.serial;
    const 已有 = 表.get(键);

    if (!已有) {
      表.set(键, {
        ...设备,
        连接方式: [设备.连接],
        // 实际用来连接的序列号：优先 USB
        serial: 设备.serial,
      });
      continue;
    }

    if (!已有.连接方式.includes(设备.连接)) 已有.连接方式.push(设备.连接);

    // 优先保留 USB 那条作为实际序列号，USB 更稳
    if (设备.连接 === 'USB' && 已有.连接 !== 'USB') {
      已有.serial = 设备.serial;
      已有.连接 = 'USB';
      已有.state = 设备.state;
    }
    // 状态取「更好的那个」：device > unauthorized > offline
    const 权重 = { device: 3, unauthorized: 2, recovery: 1, offline: 0 };
    if ((权重[设备.state] || 0) > (权重[已有.state] || 0)) 已有.state = 设备.state;
  }

  return [...表.values()].map((设备) => ({
    ...设备,
    // 给界面直接用的展示文案
    连接方式文本: 设备.连接方式.sort((a, b) => (a === 'USB' ? -1 : 1)).join(' + '),
  }));
}

module.exports = { Adb, AdbError, 判断连接方式, 提取设备标识 };
