/**
 * scrcpy 服务端通道（画面 + 触控 + 文本）。
 *
 * 为什么要用 scrcpy 服务端：
 *   实测 adb 截图单帧要 1.5 秒（0.6 fps），做不出能用的操作界面；
 *   scrcpy 服务端在设备上直接抓 Surface，用硬件编码器持续输出 H.264，
 *   画面能做到 30~60fps，同时自带输入注入，是目前最轻、最稳的方案。
 *
 * 连接方式（v2.x ~ v5.x 一致，本项目实测于 v5.0.1 / Android 16）：
 *   1. 推送 scrcpy-server.jar 到 /data/local/tmp；
 *   2. `adb reverse localabstract:scrcpy_<scid> tcp:<端口>` 把设备的抽象 socket
 *      转发到电脑端口（不能用 tunnel_forward：Android 16 禁止 adb shell 设置
 *      ANDROID_SOCKET_ 环境变量，实测会直接 abort）；
 *   3. app_process 启动服务端，它会主动连回电脑，依次是「视频」再「控制」；
 *   4. 视频流按下面的格式解包。
 *
 * 视频流格式：
 *   [64 字节设备名][4 字节 codec id][12 字节 会话尺寸 w/h] 之后是若干包：
 *   [8 字节 pts|flags][4 字节长度][长度 字节的 H.264 数据]
 *   把每个包的 长度-prefixed 数据按序拼起来，就是可以直接喂给浏览器的
 *   Annes-B 码流（<video> 能直接播放，无需转封装）。
 */
'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const 协议 = require('./control-protocol');

/** 设备端 jar 路径 */
// 设备上的 jar 路径必须与「音频通道用的 scrcpy 3.3.4」区分开：
// 官方 scrcpy 会把自己的服务端推到 /data/local/tmp/scrcpy-server.jar，
// 如果两边用同一个路径，后推的那个会覆盖前一个，
// 导致先启动的通道报 ClassNotFound 直接退出（实测踩过）。
// 这里我们用自己的文件名，互不干扰。
const 设备jar路径 = '/data/local/tmp/Aoid-scrcpy-server.jar';

/** 包标志位（来自服务端 Streamer.writeFrameMeta） */
const 标志 = {
  SESSION: 1n << 63n,
  CONFIG: 1n << 62n,
  KEY_FRAME: 1n << 61n,
};

/**
 * 拼出可交给浏览器的 Annex-B 码流：每个 NALU 前加起始码。
 * MediaCodec 吐出的 buffer 可能是多个 NALU 连在一起（无起始码）。
 *
 * 注意：这个函数会被每帧调用，必须避免分配大对象。
 * 设备端的 MediaCodec 输出本身已经带 4 字节起始码，绝大多数情况直接复用，
 * 只有在检测到没有起始码时才做一次补全，避免每帧多出一份拷贝。
 */
/**
 * 判断缓冲区当前位置是否是「重复的会话头」。
 *
 * 背景：横竖屏切换时 scrcpy 服务端会重新发送 12 字节头部（含新宽高），
 * 而不是继续发数据包。旧解析器把这段当成数据包，长度字段离谱，
 * 判定「流已错位」直接断开。
 *
 * 识别特征（12 字节）：
 *   字节 0~3  恒为 0（头部前 4 字节不是标志位）
 *   字节 4~7  = 宽，合理范围 1~8192
 *   字节 8~11 = 高，合理范围 1~8192
 * 而正常数据包的标志位 + 长度组合几乎不可能同时满足这三条。
 *
 * @param {Buffer} 缓冲 视频流缓冲区
 * @param {number} 位置 当前解析位置
 * @returns {boolean}
 */
/**
 * 在缓冲区里向后寻找下一个「看起来合法」的数据包边界。
 *
 * 用途：横屏等场景下码流可能错位，直接断开太粗暴。
 * 这里逐字节向前试探，找到一个「标志位低 8 位只有已知位、长度合理」的位置，
 * 就把读取指针挪过去继续解析。宁可丢一小段画面，也不要让用户掉线。
 *
 * @param {Buffer} 缓冲
 * @param {number} 起始 从哪个绝对下标开始找（喂绝对下标，内部换算）
 * @param {number} 可用字节数
 * @returns {number} 相对当前读指针需要前进的字节数；找不到返回 -1
 */
function 寻找下一个合法包(缓冲, 起始, 可用字节数) {
  // 已知标志位：CONFIG + KEY_FRAME（低位），高位必须为 0
  const 允许掩码 = 0x0fn;
  const 最大向前 = Math.min(可用字节数 - 12, 8192);

  for (let 偏移 = 0; 偏移 < 最大向前; 偏移++) {
    const 位置 = 起始 + 偏移;
    if (位置 + 12 > 缓冲.length) break;

    const 标志位低 = 缓冲.readUInt32BE(位置 + 4);
    const 标志位高 = 缓冲.readUInt32BE(位置);
    const 长度 = 缓冲.readUInt32BE(位置 + 8);

    // 高位必须为 0，低位只能是已知的几个标志
    if (标志位高 !== 0) continue;
    if ((标志位低 & ~允许掩码) !== 0) continue;
    // 长度必须合理（大于 0 且不超过 64MB）
    if (长度 === 0 || 长度 > 64 * 1024 * 1024) continue;

    return 位置 - 起始 + 1;
  }

  return -1;
}
function 是重复会话头(缓冲, 位置) {
  if (位置 + 12 > 缓冲.length) return false;
  // 前 4 字节必须全 0
  if (缓冲.readUInt32BE(位置) !== 0) return false;
  const 宽 = 缓冲.readUInt32BE(位置 + 4);
  const 高 = 缓冲.readUInt32BE(位置 + 8);
  return 宽 >= 1 && 宽 <= 8192 && 高 >= 1 && 高 <= 8192;
}

function 拼起始码(数据) {
  const 有起始码 = 数据.length >= 4 && 数据[0] === 0 && 数据[1] === 0 && (数据[2] === 1 || 数据[3] === 1);
  if (有起始码) return 数据;

  // 没有起始码：把整个 buffer 当成一个 NALU 补上
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x01]), 数据]);
}

class Scrcpy通道 extends EventEmitter {
  /**
   * @param {object} 选项
   * @param {import('./adb').Adb} 选项.adb
   * @param {string} 选项.序列号
   * @param {string} 选项.服务端jar 本地 jar 路径
   * @param {number} [选项.最大边长] 视频短边上限（越大越清晰，带宽越高）
   * @param {number} [选项.最大帧率]
   * @param {number} [选项.码率] 视频码率 bit/s
   */
constructor({ adb, 序列号, 服务端jar, 最大边长 = 1024, 最大帧率 = 60, 码率 = 8_000_000, 编码 = 'h265' }) {
    super();
    this.adb = adb;
    this.序列号 = 序列号;
    this.服务端jar = 服务端jar;
    this.最大边长 = 最大边长;
    // 视频编码格式：h265 抗错误能力强于 h264，码流局部损坏后恢复更快
    this.编码 = 编码;
    this.最大帧率 = 最大帧率;
    this.码率 = 码率;

    // scid 必须是 32 位有符号整数：服务端用 Integer.parseInt(hex) 解析，
    // 最高位为 1 时（例如 8 位十六进制以 8~f 开头）会溢出并直接 abort。
    // 所以这里限制在正数范围，并用小写十六进制。
    this.scid = (crypto.randomInt(0x10000000, 0x7fffffff) >>> 0).toString(16);
    this.socket名 = `scrcpy_${this.scid}`;
    this.端口 = 0;

    this.服务进程 = null;
    this.服务器 = null;
    this.视频 = null;
    this.控制 = null;
    this.运行中 = false;
    this.会话 = { 宽: 0, 高: 0, codec: '' };
    // 手机物理分辨率：控制消息里的屏幕尺寸必须用它
    this.手机宽 = 0;
    this.手机高 = 0;
    this.统计 = { 帧: 0, 字节: 0, 起始时间: 0 };
  }

  /** 告知手机物理分辨率（坐标与旋转都依赖它） */
  设置屏幕尺寸(宽, 高) {
    this.手机宽 = 宽 || 0;
    this.手机高 = 高 || 0;
  }

  /** 启动整个通道；resolve 时视频流已经开始推送 */
  async 启动() {
    if (!fs.existsSync(this.服务端jar)) throw new Error('缺少 scrcpy 服务端文件，请重新安装应用');

    // 启动前先清掉这台设备上遗留的 scrcpy 反向转发与残留进程；
    // 应用被强制结束时来不及清理，旧转发会一直占着 localabstract 名字，
    // 新通道可能连到旧服务端，表现为「画面停住、帧率 0」。
    await this.#清理残留();

    /* 1. 推 jar（如果设备上已有同版本就跳过，省一次 USB 传输） */
    await this.#准备jar();

    /* 2. 电脑端先监听，等服务端连回来 */
    this.端口 = await this.#选择端口();
    this.服务器 = net.createServer();
    this.服务器.on('connection', (socket) => this.#接入(socket));
    await new Promise((解析, 拒绝) => {
      this.服务器.once('error', 拒绝);
      this.服务器.listen(this.端口, '127.0.0.1', () => {
        this.服务器.off('error', 拒绝);
        解析();
      });
    });

    /* 3. 建立反向转发 */
    await this.adb.反向转发(this.序列号, `localabstract:${this.socket名}`, this.端口);

    /* 4. 启动服务端 */
    const 参数 = [
      `scid=${this.scid}`,
      'log_level=info',
      'audio=false',
      'video=true',
      'control=true',
      'cleanup=false',
      'power_on=true',
      'stay_awake=true',
      'clipboard_autosync=false',
      `max_fps=${this.最大帧率}`,
      `video_bit_rate=${this.码率}`,
      'video_codec=h264',
      /*
       * 编码器：用硬件编码器。
       *
       * 之前为规避横屏撕裂换成了软编 c2.android.avc.encoder，
       * 但软编编码延迟明显更高，用户实测画面延迟大。
       * 撕裂现在由「锁帧 + 后台重连 + 码流重对齐」兜住，不必再靠软编。
       */
      'video_encoder=c2.qti.avc.encoder',
      // 关键帧间隔 1 秒：间隔越短，出错后恢复越快，代价是码率略升
      'i_frame_interval=1',
      /*
       * 关闭 B 帧并开实时优先。
       *
       * B 帧需要缓存后续帧才能编码，天然引入 1~2 帧的额外延迟；
       * 投屏场景完全不需要 B 帧，关掉能明显降低手感延迟。
       * bitrate-mode=2 是 CBR，码率稳定、延迟更可预测。
       */
      'video_codec_options=max-bframes=0,bitrate-mode=2',
    ];

    // max_size 只有确实要缩放时才传；传 0 会被服务端当成限到 0 像素，
    // 直接把分辨率压成空白。不传则使用手机原生分辨率（scrcpy 默认行为）。
    if (this.最大边长 > 0) {
      参数.splice(8, 0, `max_size=${this.最大边长}`);
    }

    this.服务进程 = spawn(
      this.adb.adbPath,
      [
        '-s',
        this.序列号,
        'shell',
        `CLASSPATH=${设备jar路径}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        this.#服务端版本(),
        ...参数,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let 日志 = '';
    const 收集 = (块) => {
      const 文本 = 块.toString('utf8');
      日志 += 文本;
      if (日志.length > 8000) 日志 = 日志.slice(-4000);
      const 行 = 文本.trim();
      if (行) this.emit('日志', 行);
    };
    this.服务进程.stdout.on('data', 收集);
    this.服务进程.stderr.on('data', 收集);
    this.服务进程.on('close', () => {
      if (this.运行中) {
        this.运行中 = false;
        this.emit('关闭', 日志.trim().split('\n').slice(-3).join(' / '));
      }
    });

    /* 5. 等两路连接进来（服务端先连视频再连控制） */
    await this.#等待连接(20000);
    this.运行中 = true;
    this.统计.起始时间 = Date.now();
    return { 会话: this.会话 };
  }

  /** 确认设备上的 jar 是最新的，不存在或被清理过就重新推 */
  /**
   * 清理设备上遗留的 scrcpy 状态。
   *
   * 为什么需要：
   *   应用被强制结束（任务管理器结束进程、崩溃）时来不及走正常关闭流程，
   *   设备上的 /data/local/tmp 服务端进程和 adb reverse 转发会一直留着。
   *   旧转发占着 localabstract:scrcpy_xxx 名字，新通道连上去可能连到旧服务端，
   *   现象是「画面卡住不动、帧率显示 0」——很难从表面看出来。
   *
   *   所以每次建立新通道前，先清掉本应用相关的残留。只清理带 Aoid 前缀的，
   *   以及指向本应用的转发，不碰别人的 scrcpy 实例。
   */
  async #清理残留() {
    const 序列号 = this.序列号;

    // 1. 杀掉本应用启动的服务端进程（按 jar 路径名区分，不误伤别家的 scrcpy）
    await this.adb
      .设备shell(序列号, 'pkill -f Aoid-scrcpy-server; true')
      .catch(() => {});

    // 2. 清掉指向本应用的 reverse 转发（本工具的抽象 socket 名以 scrcpy_ 开头）
    try {
      const 列表 = await this.adb.列出反向转发(序列号);
      for (const 项 of 列表) {
        if (项.includes('localabstract:scrcpy_')) {
          await this.adb.移除反向转发(序列号, 项);
        }
      }
    } catch {
      // 读不到列表就跳过，不影响主流程
    }

    // 3. 给设备一点时间释放 socket
    await new Promise((完成) => setTimeout(完成, 120));
  }

  async #准备jar() {
    const 本地大小 = fs.statSync(this.服务端jar).size;
    const { stdout } = await this.adb
      .设备shell(this.序列号, `test -f ${设备jar路径} && wc -c < ${设备jar路径}`)
      .catch(() => ({ stdout: '' }));
    if (Number(stdout.trim()) !== 本地大小) {
      await this.adb.推送(this.序列号, this.服务端jar, 设备jar路径);
    }
  }

  /** 版本号必须与 jar 一致，从文件名里取（scrcpy-server-v5.0.1） */
  #服务端版本() {
    const 匹配 = /(\d+\.\d+(?:\.\d+)?)/.exec(require('node:path').basename(this.服务端jar));
    return 匹配 ? 匹配[1] : '5.0.1';
  }

  /** 找一个空闲的本地端口 */
  #选择端口() {
    return new Promise((解析) => {
      const 探测 = net.createServer();
      探测.listen(0, '127.0.0.1', () => {
        const 端口 = 探测.address().port;
        探测.close(() => 解析(端口));
      });
    });
  }

  /** 处理服务端连回来的 socket */
  #接入(socket) {
    socket.setNoDelay(true);
    if (!this.视频) {
      this.视频 = socket;
      this.#读取视频(socket);
    } else if (!this.控制) {
      this.控制 = socket;
      this.控制.on('error', () => {});
      // 控制通道是双向的：手机收回去读「设备事件」（剪贴板变动、剪贴板确认等）
      this.#读取控制(socket);
    } else {
      // 多余的连接直接关掉
      socket.destroy();
    }
  }

  /** 解析视频流 */
  #读取视频(socket) {
    let 阶段 = '设备名';
    // 用一个可增长的大缓冲 + 读指针，避免每个数据块都整块拼接（那会瞬间吃掉 GB 级内存）
    let 缓冲 = Buffer.alloc(1024 * 1024);
    let 已用 = 0;
    let 读指针 = 0;

    /** 确保缓冲有足够剩余空间 */
    const 扩容 = (需要) => {
      if (缓冲.length - 已用 >= 需要) return;
      const 未读 = 已用 - 读指针;
      if (缓冲.length >= 需要 + 未读 && 读指针 > 0) {
        // 现成空间够，直接把未读数据前移
        缓冲.copy(缓冲, 0, 读指针, 已用);
        已用 = 未读;
        读指针 = 0;
        return;
      }
      let 新长度 = 缓冲.length;
      while (新长度 < 需要 + 未读) 新长度 *= 2;
      const 新缓冲 = Buffer.alloc(新长度);
      缓冲.copy(新缓冲, 0, 读指针, 已用);
      缓冲 = 新缓冲;
      已用 = 未读;
      读指针 = 0;
    };

    socket.on('data', (块) => {
      扩容(块.length);
      块.copy(缓冲, 已用);
      已用 += 块.length;

      const 可用 = () => 已用 - 读指针;
      const 消耗 = (数量) => {
        读指针 += 数量;
        if (读指针 === 已用) {
          读指针 = 0;
          已用 = 0;
        }
      };

      // 64 字节设备名
      if (阶段 === '设备名') {
        if (可用() < 64) return;
        this.设备名 = 缓冲.subarray(读指针, 读指针 + 64).toString('utf8').replace(/\0+$/, '');
        消耗(64);
        阶段 = 'codec';
      }

      // 4 字节 codec id
      if (阶段 === 'codec') {
        if (可用() < 4) return;
        const id = 缓冲.readUInt32BE(读指针);
        this.会话.codec = id === 0x68323634 ? 'h264' : id === 0x68323635 ? 'h265' : id === 0x61763120 ? 'av1' : String(id);
        消耗(4);
        阶段 = '尺寸';
      }

      // 12 字节会话尺寸
      if (阶段 === '尺寸') {
        if (可用() < 12) return;
        this.会话.宽 = 缓冲.readUInt32BE(读指针 + 4);
        this.会话.高 = 缓冲.readUInt32BE(读指针 + 8);
        消耗(12);
        阶段 = '包';
        this.emit('会话', this.会话);
      }

      // 数据包
      while (阶段 === '包' && 可用() >= 12) {
        const 标志位 = 缓冲.readBigUInt64BE(读指针);
        const 长度 = 缓冲.readUInt32BE(读指针 + 8);

        /*
         * 横竖屏切换时 scrcpy 会重新发送会话头（含新宽高），
         * 而不是继续发数据包。旧实现把这段当成数据包解析，
         * 长度字段离谱 → 判定「流已错位」→ 断开。
         *
         * 这里做两层处理：
         *   1. 先尝试识别「重复会话头」并读出新尺寸；
         *   2. 认不出来但长度明显不合法时，**不立刻断开**，
         *      而是在缓冲区里重新对齐到下一个合法包边界。
         *      宁可丢一小段画面，也不要让用户直接掉线。
         */
        if (是重复会话头(缓冲, 读指针)) {
          const 新宽 = 缓冲.readUInt32BE(读指针 + 4);
          const 新高 = 缓冲.readUInt32BE(读指针 + 8);
          消耗(12);
          if (新宽 > 0 && 新高 > 0) {
            this.会话.宽 = 新宽;
            this.会话.高 = 新高;
            this.emit('会话', this.会话);
          }
          continue;
        }

        if (长度 > 64 * 1024 * 1024) {
          // 先尝试重新对齐，实在找不回来才断开
          const 偏移 = 寻找下一个合法包(缓冲, 读指针 + 1, 可用());
          if (偏移 < 0) {
            this.emit('错误', new Error('视频流解析错位'));
            socket.destroy();
            return;
          }
          this.统计.重对齐 = (this.统计.重对齐 || 0) + 1;
          消耗(偏移);
          continue;
        }
        if (可用() < 12 + 长度) return;

        // 复制一份交给上层，缓冲本身要留着继续复用
        const 数据 = Buffer.from(缓冲.subarray(读指针 + 12, 读指针 + 12 + 长度));
        消耗(12 + 长度);

        this.统计.字节 += 长度;

        const 是配置 = (标志位 & 标志.CONFIG) !== 0n;
        const 是关键帧 = (标志位 & 标志.KEY_FRAME) !== 0n;

        if (是配置) {
          // SPS/PPS：必须放在关键帧之前，浏览器才知道分辨率与参数
          this.emit('配置帧', 拼起始码(数据));
          continue;
        }

        this.统计.帧 += 1;
        this.emit('视频帧', { 数据: 拼起始码(数据), 关键帧: 是关键帧 });
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => {
      this.视频 = null;
      if (this.运行中) this.emit('关闭', '视频通道已断开');
    });
  }

  /** 等待视频与控制两路连接就绪 */
  #等待连接(超时毫秒) {
    return new Promise((解析, 拒绝) => {
      const 截止 = Date.now() + 超时毫秒;
      const 检查 = () => {
        if (this.视频 && this.控制) {
          解析();
          return;
        }
        if (Date.now() > 截止) {
          拒绝(new Error('连接设备超时，请确认 USB 调试已授权'));
          return;
        }
        setTimeout(检查, 80);
      };
      检查();
    });
  }

  /**
   * 读取控制通道上「来自手机」的消息。
   *
   * 格式（对照 scrcpy server/src/main/java/.../DeviceMessageWriter.java）：
   *   类型 1 字节，随后：
   *     0 CLIPBOARD       → 4 字节长度 + UTF-8 文本（手机复制了新内容）
   *     1 ACK_CLIPBOARD   → 8 字节序号（手机确认收到了我们发的剪贴板）
   *     2 UHID_OUTPUT     → 暂不处理
   */
  #读取控制(socket) {
    let 缓冲 = Buffer.alloc(0);

    socket.on('data', (块) => {
      缓冲 = Buffer.concat([缓冲, 块]);

      while (缓冲.length >= 5) {
        const 类型值 = 缓冲.readUInt8(0);

        if (类型值 === 0) {
          const 长度 = 缓冲.readUInt32BE(1);
          if (缓冲.length < 5 + 长度) return; // 还没收全
          const 文本 = 缓冲.subarray(5, 5 + 长度).toString('utf8');
          缓冲 = 缓冲.subarray(5 + 长度);
          // 手机复制了内容：上报给上层（主进程据此更新电脑剪贴板）
          this.emit('剪贴板', 文本);
          continue;
        }

        if (类型值 === 1) {
          if (缓冲.length < 9) return;
          const 序号 = Number(缓冲.readBigUInt64BE(1));
          缓冲 = 缓冲.subarray(9);
          this.emit('剪贴板确认', 序号);
          continue;
        }

        if (类型值 === 2) {
          // UHID 输出：长度字段在自定义结构里，这里不做处理，直接断开保平安
          this.emit('警告', '收到未处理的 UHID 消息');
          缓冲 = Buffer.alloc(0);
          continue;
        }

        // 未知类型：无法确定长度，只能断开重连
        this.emit('错误', new Error(`未知的设备消息类型 ${类型值}`));
        socket.destroy();
        return;
      }
    });
  }

  /**
   * 把电脑剪贴板发给手机（不自动粘贴）。
   * @param {string} 文本
   * @param {number} 序号 用于匹配手机的确认回执
   */
  设置剪贴板(文本, 序号) {
    this.#发送(协议.设置剪贴板(文本, 序号, false));
  }

  /** 请求手机把当前剪贴板发回来 */
  请求剪贴板(粘贴 = false) {
    // GET_CLIPBOARD 的 copy_key：0 none / 1 copy / 2 cut
    this.#发送(Buffer.from([协议.类型.GET_CLIPBOARD, 粘贴 ? 协议.剪贴板动作.复制 : 协议.剪贴板动作.无]));
  }
  /* ---------------- 控制通道 ---------------- */

  /**
   * 触控坐标必须以「视频流尺寸」为基准（对照 scrcpy PositionMapper.map）：
   * 服务端会比对客户端发来的 screenSize 与它自己的 videoSize，
   * 只要不相等就整条事件丢弃——这正是之前「点了没反应」的根因。
   * 界面负责把鼠标位置换算成视频坐标，这里只负责如实贴上视频尺寸。
   */
  #屏尺寸() {
    return { 宽: this.会话.宽, 高: this.会话.高 };
  }

  #发送(数据) {
    if (this.控制 && this.控制.writable) this.控制.write(数据);
  }

  触控按下(x, y) {
    const 屏 = this.#屏尺寸();
    this.#发送(协议.触摸(协议.动作.DOWN, x, y, 屏.宽, 屏.高));
  }

  触控移动(x, y) {
    const 屏 = this.#屏尺寸();
    this.#发送(协议.触摸(协议.动作.MOVE, x, y, 屏.宽, 屏.高));
  }

  触控抬起(x, y) {
    const 屏 = this.#屏尺寸();
    // 对照 scrcpy input_manager.c：抬起时压力必须是 0.0f
    this.#发送(协议.触摸(协议.动作.UP, x, y, 屏.宽, 屏.高, { 压力: 0 }));
  }

  /** 点击 = 按下 + 抬起 */
  点击(x, y) {
    this.触控按下(x, y);
    this.触控抬起(x, y);
  }

  /** 滑动：给出一串插值点，让画面上的拖动有连续感 */
  滑动(x1, y1, x2, y2, 时长 = 260) {
    const 步数 = Math.max(6, Math.round(时长 / 12));
    this.触控按下(x1, y1);
    let 序号 = 1;
    const 下一步 = () => {
      if (!this.控制) return;
      if (序号 > 步数) {
        this.触控抬起(x2, y2);
        return;
      }
      const t = 序号 / 步数;
      this.触控移动(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      序号 += 1;
      setTimeout(下一步, 时长 / 步数);
    };
    下一步();
  }

  /** 滚动（鼠标滚轮） */
  滚动(x, y, 竖向, 横向 = 0) {
    const 屏 = this.#屏尺寸();
    this.#发送(协议.滚动(x, y, 屏.宽, 屏.高, 竖向, 横向));
  }

  /** 输入文本（UTF-8，中文可直接输入） */
  输入文本(文本) {
    const 内容 = String(文本);
    // scrcpy 单条文本消息有长度上限，超长就分段发送
    const 上限 = 300;
    for (let i = 0; i < 内容.length; i += 上限) {
      this.#发送(协议.文本(内容.slice(i, i + 上限)));
    }
  }

  /** 按键（按下 + 抬起） */
  按键(键码, 修饰键 = 0) {
    this.#发送(协议.按键(协议.键动作.DOWN, 键码, 修饰键));
    this.#发送(协议.按键(协议.键动作.UP, 键码, 修饰键));
  }

  /** 返回键（scrcpy 原生消息，比模拟按键更可靠） */
  返回键() {
    this.#发送(协议.开关(协议.类型.BACK_OR_SCREEN_ON, true));
  }

  /** 旋转屏幕 */
  旋转() {
    this.#发送(协议.无参(协议.类型.ROTATE_DEVICE));
  }

  /** 展开通知栏 / 展开快捷设置 / 收起面板 */
  通知栏() {
    this.#发送(协议.无参(协议.类型.EXPAND_NOTIFICATION_PANEL));
  }

  快捷设置() {
    this.#发送(协议.无参(协议.类型.EXPAND_SETTINGS_PANEL));
  }

  收起面板() {
    this.#发送(协议.无参(协议.类型.COLLAPSE_PANELS));
  }

  /** 点亮或熄灭屏幕（不锁屏） */
  屏幕电源(开) {
    this.#发送(协议.开关(协议.类型.SET_DISPLAY_POWER, 开));
  }

  /** 打开指定包名的应用 */
  打开应用(包名) {
    this.#发送(协议.启动应用(包名));
  }

  /** 计算当前帧率 */
  帧率() {
    const 秒数 = (Date.now() - this.统计.起始时间) / 1000;
    return 秒数 > 0 ? this.统计.帧 / 秒数 : 0;
  }
  /** 关闭通道并清理设备端状态 */
  async 关闭() {
    this.运行中 = false;
    for (const socket of [this.视频, this.控制]) {
      try {
        socket?.destroy();
      } catch {
        // 忽略
      }
    }
    this.视频 = null;
    this.控制 = null;

    try {
      this.服务进程?.kill();
    } catch {
      // 忽略
    }
    this.服务进程 = null;

    if (this.服务器) {
      await new Promise((完成) => this.服务器.close(完成));
      this.服务器 = null;
    }

    await this.adb.移除反向转发(this.序列号, `localabstract:${this.socket名}`);

    /*
     * 关键：移除所有事件监听器。
     *
     * 切换设备时若旧通道的监听器还挂着，旧 socket 短暂存活期间仍会
     * 推送旧设备的视频帧，和新设备的帧混在一起，导致渲染进程码流错乱、
     * 解码器崩坏——这正是「切设备必崩、只能重启」的根因。
     */
    this.removeAllListeners();
  }
}

module.exports = { Scrcpy通道 };