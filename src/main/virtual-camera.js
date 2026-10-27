/**
 * 虚拟摄像头（把手机画面变成电脑的摄像头）。
 *
 * 需求：启用摄像头后，其他软件（微信、腾讯会议、浏览器…）应该能直接在
 * 摄像头列表里选到「手机」这个设备。
 *
 * 现实情况：
 *   Windows 没有系统自带的「可写入的虚拟摄像头」。本机唯一可用的虚拟摄像头
 *   是 OBS 自带的那一个（OBS Virtual Camera，DirectShow 设备）。
 *   所以方案是：由 OBS 负责把画面变成摄像头设备，本应用负责用
 *   obs-websocket 把它配置好并打开「启动虚拟摄像机」。
 *
 * 与 OBS 的通信：
 *   obs-websocket 5.x 协议，需要先 op=1 Identify 才能发请求
 *   （只做 WebSocket 握手就发请求会被拒绝：You attempted to send a
 *   non-Identify message while not identified）。这是实测踩过的坑。
 */
'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const 默认端口 = 4455;

/** OBS 常见安装路径 */
const OBS候选路径 = [
  'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
  'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe',
];

/* ------------------------------------------------------------------ */
/* 极简 obs-websocket 5.x 客户端                                        */
/* ------------------------------------------------------------------ */

class OBS客户端 {
  constructor(端口 = 默认端口) {
    this.端口 = 端口;
    this.socket = null;
    this.已认证 = false;
    this.序号 = 0;
    this.待办 = new Map();
    this.缓冲 = Buffer.alloc(0);
    this.握手完成 = false;
  }

  /** 连接并完成 Identify */
  连接(超时 = 8000) {
    return new Promise((解析, 拒绝) => {
      const socket = net.connect(this.端口, '127.0.0.1');
      this.socket = socket;
      let 已完成 = false;

      const 计时器 = setTimeout(() => {
        if (已完成) return;
        已完成 = true;
        socket.destroy();
        拒绝(new Error('连接 OBS 超时，请确认 OBS 已启动并开启了 WebSocket 服务'));
      }, 超时);

      socket.on('error', (错误) => {
        if (已完成) return;
        已完成 = true;
        clearTimeout(计时器);
        拒绝(错误);
      });

      socket.on('connect', () => {
        socket.write(
          [
            'GET / HTTP/1.1',
            `Host: 127.0.0.1:${this.端口}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n'),
        );
      });

      socket.on('data', (块) => {
        this.缓冲 = Buffer.concat([this.缓冲, 块]);

        if (!this.握手完成) {
          const 位置 = this.缓冲.indexOf('\r\n\r\n');
          if (位置 < 0) return;
          this.握手完成 = true;
          this.缓冲 = this.缓冲.subarray(位置 + 4);
        }

        this.#消费帧((消息) => {
          if (process.env.DEBUG_OBS) console.log('[OBS 收到 op]', 消息.op);
          if (消息.op === 0) {
            // Hello：回 Identify 才真正连上
            this.#发送文本(JSON.stringify({ op: 1, d: { rpcVersion: 1 } }));
          } else if (消息.op === 2) {
            this.已认证 = true;
            if (!已完成) {
              已完成 = true;
              clearTimeout(计时器);
              解析();
            }
          } else if (消息.op === 7) {
            const 回调 = this.待办.get(消息.d.requestId);
            if (回调) {
              this.待办.delete(消息.d.requestId);
              回调(消息.d);
            }
          }
        });
      });
    });
  }

  /** 发一个请求，返回匹配的那条回复 */
  请求(类型, 数据 = {}, 超时 = 8000) {
    if (!this.已认证) return Promise.reject(new Error('还没有连上 OBS'));
    return new Promise((解析, 拒绝) => {
      const id = String((this.序号 += 1));
      const 计时器 = setTimeout(() => {
        this.待办.delete(id);
        拒绝(new Error(`OBS 未响应：${类型}`));
      }, 超时);

      this.待办.set(id, (回复) => {
        clearTimeout(计时器);
        解析(回复);
      });

      this.#发送文本(
        JSON.stringify({ op: 6, d: { requestType: 类型, requestId: id, requestData: 数据 } }),
      );
    });
  }

  关闭() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.已认证 = false;
    this.待办.clear();
  }

  /* ---- 内部 ---- */

  #发送文本(文本) {
    if (!this.socket) return;
    const 载荷 = Buffer.from(文本, 'utf8');
    const 掩码 = crypto.randomBytes(4);
    let 头;

    if (载荷.length < 126) {
      头 = Buffer.alloc(2);
      头[0] = 0x81;
      头[1] = 0x80 | 载荷.length;
    } else if (载荷.length < 65536) {
      头 = Buffer.alloc(4);
      头[0] = 0x81;
      头[1] = 0x80 | 126;
      头.writeUInt16BE(载荷.length, 2);
    } else {
      头 = Buffer.alloc(10);
      头[0] = 0x81;
      头[1] = 0x80 | 127;
      头.writeBigUInt64BE(BigInt(载荷.length), 2);
    }

    for (let i = 0; i < 载荷.length; i += 1) 载荷[i] ^= 掩码[i % 4];
    this.socket.write(Buffer.concat([头, 掩码, 载荷]));
  }

  #消费帧(回调) {
    while (this.缓冲.length >= 2) {
      // 第一字节低 4 位是操作码，第二字节低 7 位才是长度。
      // 这里曾经写错成用 this.缓冲[1] & 0x7f 当操作码，
      // 结果把文本帧长度（87）误判成未知操作码，整条消息被 continue 丢掉，
      // 表现为「握手成功但永远收不到 Hello」。
      const 操作码 = this.缓冲[0] & 0x0f;
      const 掩码位 = (this.缓冲[1] & 0x80) !== 0;
      const 长度码 = this.缓冲[1] & 0x7f;
      let 偏 = 2;
      let 长 = 长度码;

      if (长度码 === 126) {
        if (this.缓冲.length < 4) return;
        长 = this.缓冲.readUInt16BE(2);
        偏 = 4;
      } else if (长度码 === 127) {
        if (this.缓冲.length < 10) return;
        长 = Number(this.缓冲.readBigUInt64BE(2));
        偏 = 10;
      }

      const 头部长度 = 偏 + (掩码位 ? 4 : 0);
      if (this.缓冲.length < 头部长度 + 长) return;

      let 数据;
      if (掩码位) {
        const 掩码 = this.缓冲.subarray(偏, 偏 + 4);
        数据 = Buffer.from(this.缓冲.subarray(偏 + 4, 偏 + 4 + 长));
        for (let i = 0; i < 数据.length; i += 1) 数据[i] ^= 掩码[i % 4];
      } else {
        数据 = this.缓冲.subarray(偏, 偏 + 长);
      }
      this.缓冲 = this.缓冲.subarray(头部长度 + 长);

      if (操作码 === 0x8) {
        this.关闭();
        return;
      }
      if (操作码 !== 0x1 && 操作码 !== 0x2) continue;

      let 消息;
      try {
        消息 = JSON.parse(数据.toString('utf8'));
      } catch {
        continue;
      }
      回调(消息);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 虚拟摄像头服务                                                       */
/* ------------------------------------------------------------------ */

class 虚拟摄像头 {
  constructor({ 日志 = () => {} } = {}) {
    this.客户端 = null;
    this.已启动 = false;
    this.日志 = 日志;
  }

  /** 是否装了 OBS（这是本方案的前提） */
  可执行文件() {
    return OBS候选路径.find((路径) => fs.existsSync(路径)) || null;
  }

  可用() {
    return Boolean(this.可执行文件());
  }

  /**
   * 打开虚拟摄像头：确保 OBS 在跑 → 连上 → 放一个手机画面源 → 启动虚拟摄像机。
   *
   * @param {object} 选项
   * @param {string} 选项.图像路径 要给 OBS 显示的图片（手机画面的快照）
   */
  async 开始({ 图像路径 } = {}) {
    const 可执行文件 = this.可执行文件();
    if (!可执行文件) {
      throw new Error('没有找到 OBS。虚拟摄像头依赖 OBS 自带的「OBS Virtual Camera」。');
    }

    // 1. 确保 OBS 在运行
    if (!(await this.#OBS在运行())) {
      this.日志('正在启动 OBS…');
      spawn(可执行文件, ['--minimize-to-tray', '--disable-shutdown-check'], {
        cwd: path.dirname(可执行文件),
        detached: true,
        stdio: 'ignore',
      }).unref();

      // OBS 启动比较慢，等它把 websocket 服务拉起来
      const 起来 = await this.#等待端口(默认端口, 25000);
      if (!起来) throw new Error('OBS 已启动，但 WebSocket 服务没有响应（请在 OBS 里开启 WebSocket 服务器）');
    }

    // 2. 连上 OBS
    this.客户端 = new OBS客户端(默认端口);
    await this.客户端.连接();

    // 3. 准备一个「手机画面」输入源
    if (图像路径) await this.#准备手机画面源(图像路径);

    // 4. 启动虚拟摄像机
    const 结果 = await this.客户端.请求('StartVirtualCam');
    const 状态 = await this.客户端.请求('GetVirtualCamStatus');
    this.已启动 = Boolean(状态.responseData && 状态.responseData.outputActive);

    if (!this.已启动) {
      throw new Error('虚拟摄像头没能启动：' + JSON.stringify(结果.requestStatus || {}));
    }

    this.日志('虚拟摄像头已启动');
    return { 已启动: true };
  }

  /** 停止：把虚拟摄像机关掉（OBS 保持运行，用户可能还要用） */
  async 停止() {
    if (!this.客户端 || !this.客户端.已认证) {
      this.已启动 = false;
      return { 已启动: false };
    }
    try {
      await this.客户端.请求('StopVirtualCam');
    } catch {
      // 已经停了也无所谓
    }
    this.已启动 = false;
    return { 已启动: false };
  }

  关闭() {
    const 客户端 = this.客户端;
    this.客户端 = null;
    this.已启动 = false;
    if (客户端) 客户端.关闭();
  }

  状态() {
    return { 已启动: this.已启动, 可用: this.可用() };
  }

  /* ---- 内部 ---- */

  async #OBS在运行() {
    if (process.platform !== 'win32') return false;
    try {
      const { execFile } = require('node:child_process');
      const 输出 = await new Promise((解析) => {
        execFile('tasklist', ['/fi', 'imagename eq obs64.exe'], { windowsHide: true }, (错误, 文本) => {
          解析(错误 ? '' : String(文本));
        });
      });
      return 输出.includes('obs64.exe');
    } catch {
      return false;
    }
  }

  #等待端口(端口, 超时) {
    const 截止 = Date.now() + 超时;
    return new Promise((解析) => {
      const 试探 = () => {
        const socket = net.connect(端口, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          解析(true);
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() > 截止) 解析(false);
          else setTimeout(试探, 800);
        });
      };
      试探();
    });
  }

  /**
   * 在 OBS 里准备一个显示手机画面的输入源。
   *
   * 做法：用「图像」源指向一张由手机截图更新的文件。
   * 为什么不用浏览器源：浏览器源依赖外部页面，不如本地文件稳；
   * 图片源可以由本应用定时覆盖文件来刷新画面。
   */
  async #准备手机画面源(图像路径) {
    const 源名 = 'Aoid 手机画面';

    const 现有 = await this.客户端.请求('GetInputList');
    const 名单 = (现有.responseData?.inputs || []).map((项) => 项.inputName);

    if (!名单.includes(源名)) {
      await this.客户端.请求('CreateInput', {
        sceneName: (await this.客户端.请求('GetSceneList')).responseData?.currentProgramSceneName || '场景',
        inputName: 源名,
        inputKind: 'image_source',
        inputSettings: { file: 图像路径, unload: false },
        sceneItemEnabled: true,
      });
    } else {
      await this.客户端.请求('SetInputSettings', {
        inputName: 源名,
        inputSettings: { file: 图像路径, unload: false },
      });
    }
  }
}

module.exports = { 虚拟摄像头, OBS客户端 };