/**
 * 无线连接。
 *
 * 两条路径，界面上都要给：
 *
 *   1. 首次配对（Android 11+ 的「无线调试」）：
 *        手机上是「设置 → 开发者选项 → 无线调试」，会显示「配对码」和「IP:端口」。
 *        配对走 `adb pair <地址> <配对码>`（一次性的，配对成功后不用再配）。
 *
 *   2. 已有配对的设备直接连：`adb connect <IP>:<端口>`。
 *        最稳的做法是先用 USB 连上，执行 `adb tcpip 5555`，
 *        之后拔掉数据线用 `adb connect IP:5555` 即可。
 *
 * 这里只负责命令行交互与结果解析，连接后的画面/触控复用现有通道。
 */
'use strict';

const net = require('node:net');
const { spawn } = require('node:child_process');

/** 校验 IP:端口 形式（也接受纯 IP，默认 5555） */
function 规整地址(输入) {
  const 文本 = String(输入 || '').trim();
  if (!文本) return null;

  // 已经带端口
  const 带端口 = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(文本);
  if (带端口) {
    const 端口 = Number(带端口[2]);
    if (端口 < 1 || 端口 > 65535) return null;
    return { ip: 带端口[1], 端口 };
  }

  // 纯 IP
  const 纯 = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(文本);
  if (纯) {
    const 段们 = 纯[1].split('.').map(Number);
    if (段们.some((段) => 段 > 255)) return null;
    return { ip: 纯[1], 端口: 5555 };
  }

  return null;
}

class 无线连接 {
  /**
   * @param {object} 选项
   * @param {string} 选项.adbPath
   */
  constructor({ adbPath }) {
    this.adbPath = adbPath;
  }

  /** 执行 adb 命令 */
  执行(参数, { timeout = 30000 } = {}) {
    return new Promise((解析, 拒绝) => {
      const 子进程 = spawn(this.adbPath, 参数, { windowsHide: true });
      let 输出 = '';
      let 错误 = '';
      const 计时器 = setTimeout(() => 子进程.kill(), timeout);
      子进程.stdout.on('data', (块) => (输出 += 块.toString('utf8')));
      子进程.stderr.on('data', (块) => (错误 += 块.toString('utf8')));
      子进程.on('error', (e) => {
        clearTimeout(计时器);
        拒绝(e);
      });
      子进程.on('close', (码) => {
        clearTimeout(计时器);
        解析({ 码, 输出: 输出.trim(), 错误: 错误.trim() });
      });
    });
  }

  /**
   * 配对（Android 11 无线调试）。
   * @param {string} 地址 手机显示的「IP 地址和端口」
   * @param {string} 配对码 手机显示的 6 位配对码
   */
  async 配对(地址, 配对码) {
    const 规范 = 规整地址(地址);
    if (!规范) throw new Error('地址格式不对，应形如 192.168.1.5:37000');
    if (!/^\d{6}$/.test(String(配对码 || '').trim())) throw new Error('配对码应为 6 位数字');

    const 结果 = await this.执行(['pair', `${规范.ip}:${规范.端口}`, 配对码.trim()], { timeout: 30000 });
    const 文本 = `${结果.输出} ${结果.错误}`;

    if (/Successfully paired/i.test(文本)) return { ok: true, 消息: '配对成功' };
    if (/Failed|Unable|error/i.test(文本)) throw new Error(文本.replace(/^.*?\n/, '').slice(0, 200) || '配对失败');
    throw new Error('配对结果未知，请确认手机上显示的地址与配对码是否正确');
  }

  /** 连接已配对设备 */
  async 连接(地址) {
    const 规范 = 规整地址(地址);
    if (!规范) throw new Error('地址格式不对，应形如 192.168.1.5:5555');

    const 结果 = await this.执行(['connect', `${规范.ip}:${规范.端口}`], { timeout: 25000 });
    const 文本 = `${结果.输出} ${结果.错误}`;

    if (/connected to/i.test(文本)) return { ok: true, 序列号: `${规范.ip}:${规范.端口}`, 消息: '已连接' };
    if (/10061|refused|failed to connect|unable to connect/i.test(文本)) {
      throw new Error('连接被拒绝：请确认手机与电脑在同一网络，且已开启 wireless debugging');
    }
    throw new Error(文本 || '连接失败');
  }

  /** 断开无线设备 */
  async 断开(地址) {
    await this.执行(['disconnect', 地址], { timeout: 12000 });
    return true;
  }

  /**
   * 把 USB 设备切换到无线模式：
   *   先 `adb tcpip 5555`，再从设备上取 wlan0 的 IP，拼接成可 connect 的地址。
   */
  async 转换为无线(序列号) {
    const 置 = await this.执行(['-s', 序列号, 'tcpip', '5555'], { timeout: 20000 });
    if (!/restarting in tcp mode/i.test(`${置.输出} ${置.错误}`)) {
      throw new Error(`${置.输出} ${置.错误}`.trim() || '切换无线模式失败');
    }

    // 等一下让 adbd 重启
    await new Promise((完成) => setTimeout(完成, 2000));

    const ip结果 = await this.执行(
      ['-s', 序列号, 'shell', 'ip route | grep wlan0 | head -1'],
      { timeout: 10000 },
    );
    const 匹配 = /src\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(ip结果.输出);
    if (!匹配) throw new Error('没有取到手机 IP，请确认手机已连接 Wi-Fi');

    return { 地址: `${匹配[1]}:5555`, ip: 匹配[1] };
  }

  /**
   * 扫描局域网里开放 5555 端口的设备（最多扫 /24 的一小段，避免太慢）。
   * 扫描范围：与电脑同网段的 1~254，但并发 64 路、每个 300ms 超时。
   */
  async 扫描局域网({ 网段, 超时 = 300 } = {}) {
    const 前缀 = 网段 || (await this.本机网段());
    if (!前缀) throw new Error('无法确定本机网段，请手动输入手机 IP');

    const 候选 = [];
    for (let i = 1; i <= 254; i += 1) 候选.push(`${前缀}.${i}`);

    const 结果 = [];
    let 序号 = 0;

    const 探测一个 = (ip) =>
      new Promise((完成) => {
        const 连接 = net.connect({ host: ip, port: 5555, timeout: 超时 });
        连接.once('connect', () => {
          连接.destroy();
          完成(ip);
        });
        连接.once('error', () => 完成(null));
        连接.once('timeout', () => {
          连接.destroy();
          完成(null);
        });
      });

    // 简单的并发池
    const 工作 = async () => {
      while (序号 < 候选.length) {
        const 当前 = 候选[序号];
        序号 += 1;
        const 命中 = await 探测一个(当前);
        if (命中) 结果.push(命中);
      }
    };

    await Promise.all(new Array(64).fill(0).map(() => 工作()));
    return 结果.map((ip) => `${ip}:5555`);
  }

  /** 取本机 IPv4 的前三段，例如 192.168.1 */
  本机网段() {
    return new Promise((完成) => {
      const 结果 = spawn('powershell', ['-NoProfile', '-Command', '(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 3).IPAddress'], {
        windowsHide: true,
      });
      let 输出 = '';
      结果.stdout.on('data', (块) => (输出 += 块.toString()));
      结果.on('close', () => {
        // 优先选 192.168 / 10. / 172.16-31 这类内网地址
        const 地址们 = 输出
          .split(/\r?\n/)
          .map((行) => 行.trim())
          .filter((行) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(行));
        const 内网 = 地址们.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
        const 选中 = 内网 || 地址们[0];
        完成(选中 ? 选中.split('.').slice(0, 3).join('.') : null);
      });
      结果.on('error', () => 完成(null));
    });
  }
}

module.exports = { 无线连接, 规整地址 };
