/**
 * 播放器：用 WebCodecs 解码 scrcpy 送来的 H.264，画到 canvas 上。
 *
 * 为什么不用 <video> + MediaSource：
 *   <video> 必须吃「容器 + 码流」，scrcpy 送来的却是裸 H.264，
 *   自己拼 fMP4 容器很容易在某个字段上出错，而且调试代价很高（实测踩过）。
 *
 * 为什么用 WebCodecs：
 *   它是浏览器原生的解码接口，直接把码流交给硬件解码器，
 *   不需要任何封装，Chromium / Electron 原生支持，开销也最小。
 *   实测 scrcpy v5.0.1 的码流可以稳定解出全部帧。
 *
 * 画到 canvas 而不是每帧生成 <img>：canvas 每帧只做一次 drawImage，
 * 不会产生大量 DOM 对象，也不会让内存随着帧数增长。
 */
'use strict';

/** 从 Annex-B 字节流切出裸 NALU */
/**
 * 从 Annex-B 字节流切出裸 NALU。
 *
 * 踩过的坑：旧实现用 字节[i+2] 直接判断，i 接近末尾时会读到 undefined，
 * 一旦误判就会把起始码当成数据、或把数据当成起始码，切出来的 NALU 错位。
 * 错位的 NALU 交给解码器，表现就是画面出现横向错位的条带（撕裂）。
 * 这里改成严格的下标检查，绝不越界。
 */
function 切成NALU(字节) {
  const 结果 = [];
  const 长 = 字节.length;
  let 起点 = -1;
  let i = 0;

  // 找第一个起始码（00 00 01 或 00 00 00 01）
  while (i + 2 < 长) {
    if (字节[i] === 0 && 字节[i + 1] === 0) {
      if (字节[i + 2] === 1) {
        起点 = i + 3;
        i = 起点;
        break;
      }
      if (i + 3 < 长 && 字节[i + 2] === 0 && 字节[i + 3] === 1) {
        起点 = i + 4;
        i = 起点;
        break;
      }
    }
    i += 1;
  }

  // 整段没有起始码：当作单个 NALU
  if (起点 < 0) return 长 > 0 ? [字节] : [];

  while (i + 2 < 长) {
    if (字节[i] === 0 && 字节[i + 1] === 0) {
      if (字节[i + 2] === 1) {
        if (i > 起点) 结果.push(字节.subarray(起点, i));
        起点 = i + 3;
        i = 起点;
        continue;
      }
      if (i + 3 < 长 && 字节[i + 2] === 0 && 字节[i + 3] === 1) {
        if (i > 起点) 结果.push(字节.subarray(起点, i));
        起点 = i + 4;
        i = 起点;
        continue;
      }
    }
    i += 1;
  }

  if (起点 >= 0 && 起点 < 长) 结果.push(字节.subarray(起点));
  return 结果.filter((nalu) => nalu.length > 0);
}

/** 拼出 avcC（AVCDecoderConfigurationRecord），WebCodecs 用它识别参数集 */
/**
 * 判断两个 NALU 是否完全相同。
 * 用来识别「SPS 有没有变」——变了就说明分辨率或编码参数改了，
 * 必须重建解码器（横竖屏切换就是这种情况）。
 */
function 相同字节(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function 构建avcC(sps, pps) {
  const 缓冲 = new Uint8Array(8 + sps.length + 3 + pps.length);
  缓冲.set([1, sps[1], sps[2], sps[3], 0xff, 0xe1], 0);
  缓冲[6] = (sps.length >> 8) & 0xff;
  缓冲[7] = sps.length & 0xff;
  缓冲.set(sps, 8);
  const 位置 = 8 + sps.length;
  缓冲[位置] = 1;
  缓冲[位置 + 1] = (pps.length >> 8) & 0xff;
  缓冲[位置 + 2] = pps.length & 0xff;
  缓冲.set(pps, 位置 + 3);
  return 缓冲;
}

export class 播放器 {
  /**
   * @param {HTMLCanvasElement} 画布
   * @param {object} 回调
   * @param {() => void} [回调.就绪] 第一帧上屏时触发
   * @param {(尺寸: {宽: number, 高: number}) => void} [回调.尺寸]
   * @param {(信息: object) => void} [回调.统计] 每秒回调一次
   */
  constructor(画布, { 就绪, 尺寸, 统计 } = {}) {
    this.画布 = 画布;
    // 只保留 alpha:false（省一次合成）。
    // 不加 desynchronized：部分 GPU 配置下它会返回 null，导致后续全部崩掉。
    this.上下文 = 画布.getContext('2d', { alpha: false });
    if (!this.上下文) throw new Error('无法获取画布上下文');
    // 高质量缩放：手机画面缩到窗口尺寸时，低质量插值会明显发糊
    this.上下文.imageSmoothingEnabled = true;
    this.上下文.imageSmoothingQuality = 'high';

    this.回调就绪 = 就绪 || (() => {});
    this.回调尺寸 = 尺寸 || (() => {});
    this.回调统计 = 统计 || (() => {});

    this.解码器 = null;
    this.sps = null;
    this.pps = null;
    this.宽 = 0;
    this.高 = 0;
    this.就绪 = false;
    this.已同步 = false;
    // 分辨率变化后需要重建解码器（横竖屏热切换）
    this.待重建 = false;
    this.出错 = '';

    // 参数集到达之前收到的帧先存着，参数集一到立刻补上
    this.待解码 = [];
    // 待上屏的最新一帧（rAF 统一绘制，只画最新）
    this.待画帧 = null;
    this.绘制中 = false;
    // 帧时间戳（微秒），用于给解码器正确的顺序信息
    this.时间戳 = 0;
    this.上一帧时间 = performance.now();

    this.最近帧时间 = [];
    this.解码帧数 = 0;
    // 最近一次成功上屏的时间（看门狗用：超过阈值无输出就自愈）
    this.最后输出时间 = 0;
    // 最近一次收到码流的时间（区分「画面静止」和「解码卡死」）
    this.最后收到时间 = 0;
    this.定时统计 = setInterval(() => this.汇报统计(), 1000);
  }

  /** 浏览器是否支持 WebCodecs */
  static 支持() {
    return typeof window !== 'undefined' && 'VideoDecoder' in window;
  }

  /** 重置（切换设备或重连时调用） */
  重置() {
    clearInterval(this.定时统计);
    this.定时统计 = setInterval(() => this.汇报统计(), 1000);

    try {
      this.解码器?.close();
    } catch {
      // 忽略
    }
    this.解码器 = null;
    this.sps = null;
    this.pps = null;
    this.宽 = 0;
    this.高 = 0;
    this.就绪 = false;
    this.已同步 = false;
    // 分辨率变化后需要重建解码器（横竖屏热切换）
    this.待重建 = false;
    this.出错 = '';
    this.待解码 = [];
    if (this.待画帧) { try { this.待画帧.close(); } catch {} this.待画帧 = null; }
    this.时间戳 = 0;
    this.最近帧时间 = [];
    this.解码帧数 = 0;
    this.最后输出时间 = 0;
    this.最后收到时间 = 0;
  }

  /** 接收一段码流（可能是参数集，也可能是图像帧） */
  送数据(数据, 关键帧) {
    if (!数据 || 数据.length < 5) return;

    // 记录收到码流的时间，看门狗据此区分「静止」与「卡死」
    this.最后收到时间 = performance.now();

    const 字节 = new Uint8Array(数据);

    /*
     * 扫描参数集，并识别「分辨率变了」。
     *
     * 横竖屏切换时，手机编码器会重新下发带新宽高的 SPS。
     * 解码器是用旧 avcC 配置出来的，不能解码新尺寸的帧，
     * 否则 WebCodecs 报参数不匹配、进入 error 状态，之后画面就定格。
     *
     * 关键：这里必须把「需要重建」记成**实例状态** this.待重建，
     * 而不是每次调用都重算的局部变量。
     * 因为 SPS 只在切换后的第一帧出现一次，第二帧起就看不到差异了，
     * 若用局部变量，第二帧会以为没变、继续用旧解码器解新尺寸帧 —— 直接花屏。
     */
    for (const nalu of 切成NALU(字节)) {
      const 类型 = nalu[0] & 0x1f;
      if (类型 === 7) {
        if (this.sps && !相同字节(this.sps, nalu)) this.待重建 = true;
        this.sps = nalu;
      } else if (类型 === 8) {
        this.pps = nalu;
      }
    }

    // 统计：收到多少段、其中几个是关键帧、跳过了多少（排查「黑屏」时极有用）
    this.调试 = this.调试 || { 收到: 0, 关键: 0, 跳过: 0 };
    this.调试.收到 += 1;
    if (关键帧) this.调试.关键 += 1;

    // 解码器必须从关键帧开始，否则会报错；之前的帧直接丢掉
    if (!this.已同步) {
      if (!关键帧) {
        this.调试.跳过 += 1;
        return;
      }
      if (!this.sps || !this.pps) return;
      if (!this.创建解码器()) return;
      this.已同步 = true;
      this.待重建 = false;
      this.待解码 = [];
    } else if (this.待重建) {
      // 分辨率变了：必须等到关键帧才能重建（关键帧自带完整参考，能独立起解）
      if (!关键帧) {
        this.调试.跳过 += 1;
        return;
      }
      if (!this.重建解码器()) return;
      this.待重建 = false;
    }

    this.解码(字节, 关键帧);
  }

  /** 分辨率变化时重建解码器（横竖屏切换走这里） */
  重建解码器() {
    try {
      this.解码器?.close();
    } catch {
      // 忽略
    }
    this.解码器 = null;
    this.已同步 = false;
    // 画布尺寸留着最后显示的画面，等新帧到了再按新尺寸改
    if (!this.创建解码器()) return false;
    this.已同步 = true;
    return true;
  }

  /**
   * 自愈：解码器出错或长时间无输出时调用。
   *
   * 这是「画面卡死」的根治点。
   *
   * WebCodecs 的 VideoDecoder 一旦触发 error 就永久关闭，之后每次
   * decode() 都会抛异常。旧代码只在 error 回调里记录错误、不重建，
   * 于是解码器坏一次，画面就永远停住——这就是用户看到的「卡死」。
   *
   * 这里把解码器关掉、标记未同步；下一个关键帧到来时，
   * 送数据() 会走「!已同步」分支，用当前最新的 SPS/PPS 重建解码器。
   * 关键帧默认每 1 秒来一个（i_frame_interval=1），所以最慢 1 秒内恢复。
   */
  请求自愈() {
    // 已经在自愈中（解码器已关闭、等待关键帧）就不要再重复触发
    if (!this.解码器 && !this.已同步) return;

    this.已同步 = false;
    this.待重建 = false;
    try {
      this.解码器?.close();
    } catch {
      // 忽略
    }
    this.解码器 = null;
    this.出错 = '';
  }

  /** 建立并配置解码器 */
  创建解码器() {
    if (!播放器.支持()) {
      this.出错 = '当前环境不支持 WebCodecs 解码';
      this.回调统计({ 帧率: 0, 延迟: 0, 出错: this.出错 });
      return false;
    }

    const 十六 = (值) => 值.toString(16).padStart(2, '0');
    const 编码 = `avc1.${十六(this.sps[1])}${十六(this.sps[2])}${十六(this.sps[3])}`;

    try {
      this.解码器 = new VideoDecoder({
        output: (帧) => this.输出帧(帧),
        error: (错误) => {
          this.出错 = `解码失败：${错误.message}`;
          this.回调统计({ 帧率: 0, 延迟: 0, 出错: this.出错 });
          // 自愈：解码器已永久失效，关掉它等下一个关键帧重建。
          // 这是解决「画面卡死」的关键，没有它画面就永远停住。
          this.请求自愈();
        },
      });

      this.解码器.configure({
        codec: 编码,
        description: 构建avcC(this.sps, this.pps),
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
      });
      return true;
    } catch (错误) {
      this.出错 = `解码器初始化失败：${错误.message}`;
      this.回调统计({ 帧率: 0, 延迟: 0, 出错: this.出错 });
      return false;
    }
  }

  /** 把一帧送进解码器 */
  解码(字节, 关键帧) {
    if (!this.解码器) return;

    // 组装成 AVCC 样本：每个 NALU 前面加 4 字节长度
    const nalu们 = 切成NALU(字节).filter((nalu) => {
      const 类型 = nalu[0] & 0x1f;
      return 类型 !== 7 && 类型 !== 8 && 类型 !== 9;
    });
    if (nalu们.length === 0) return;

    const 总长 = nalu们.reduce((和, nalu) => 和 + 4 + nalu.length, 0);
    const 样本 = new Uint8Array(总长);
    let 偏移 = 0;
    for (const nalu of nalu们) {
      const 长度 = nalu.length;
      样本[偏移] = (长度 >>> 24) & 0xff;
      样本[偏移 + 1] = (长度 >>> 16) & 0xff;
      样本[偏移 + 2] = (长度 >>> 8) & 0xff;
      样本[偏移 + 3] = 长度 & 0xff;
      偏移 += 4;
      样本.set(nalu, 偏移);
      偏移 += 长度;
    }

    // 时间戳按真实间隔递增，解码器用它排序显示
    const 现在 = performance.now();
    const 间隔 = Math.min(200, Math.max(1, 现在 - this.上一帧时间));
    this.上一帧时间 = 现在;
    this.时间戳 += Math.round(间隔 * 1000);

    try {
      this.解码器.decode(
        new EncodedVideoChunk({
          type: 关键帧 ? 'key' : 'delta',
          timestamp: this.时间戳,
          data: 样本,
        }),
      );
      this.出错 = '';
    } catch (错误) {
      // decode 抛异常 = 解码器已经失效（常见于 error 之后仍被喂帧）。
      // 同样触发自愈，等下一个关键帧重建，别让画面永久卡死。
      this.出错 = `提交失败：${错误.message}`;
      this.请求自愈();
    }
  }

  /**
   * 解码器吐出一帧。
   *
   * 关键：不在这里直接 drawImage，而是存成"待画帧"，由 requestAnimationFrame
   * 统一上屏，且**只画最新那一帧**。
   *
   * 原因：解码输出回调的触发频率可能高于屏幕刷新率（60Hz），
   * 逐帧 drawImage 会做大量无用功，拖慢主线程，反过来又拖慢解码，
   * 形成恶性循环。只画最新一帧既省 CPU，又天然丢掉"显示不过来"的中间帧——
   * 注意这是在**显示层**丢，输入码流始终完整，不会破坏参考链。
   */
  输出帧(帧) {
    /*
     * 直接画每一帧，不攒「待画帧」。
     *
     * 之前为了省 CPU 做成「只画最新一帧」，但当解码输出顺序与到来顺序
     * 不完全一致时，跳过中间帧会让画布上出现新旧画面拼接的横向条带——
     * 也就是用户看到的撕裂。drawImage 本身很便宜（一次 GPU 拷贝），
     * 每帧都画是最稳的做法。
     */
    try {
      if (this.画布.width !== 帧.displayWidth || this.画布.height !== 帧.displayHeight) {
        this.画布.width = 帧.displayWidth;
        this.画布.height = 帧.displayHeight;
        this.宽 = 帧.displayWidth;
        this.高 = 帧.displayHeight;
        检测并通知尺寸();
      }
      this.上下文.drawImage(帧, 0, 0, this.画布.width, this.画布.height);
      this.最近帧时间.push(performance.now());
      this.最后输出时间 = performance.now();
      this.解码帧数 += 1;

      if (!this.就绪) {
        this.就绪 = true;
        this.回调就绪();
      }
    } finally {
      帧.close();
    }
  }

  检测并通知尺寸() {
    if (this.回调尺寸) this.回调尺寸({ 宽: this.宽, 高: this.高 });
  }


  /** 每秒汇报帧率 */
  汇报统计() {
    const 现在 = performance.now();
    while (this.最近帧时间.length > 0 && 现在 - this.最近帧时间[0] > 1000) this.最近帧时间.shift();

    /*
     * 看门狗：精确区分「画面静止」和「解码卡死」。
     *
     *   - 画面静止：手机桌面不动，scrcpy 不产帧 → 最后收到时间 也远 → 正常，不自愈
     *   - 解码卡死：主进程持续发帧（最后收到时间很近），但解码器不再吐帧
     *     （最后输出时间很远）→ 解码器已静默失效 → 强制自愈
     *
     * 判据：解码器活着 && 最近 2 秒内持续收到码流 && 超过 2 秒没有上屏。
     */
    const 已同步且活着 = this.已同步 && this.解码器;
    const 持续收到帧 = 现在 - this.最后收到时间 < 2000;
    const 无输出 = this.最后输出时间 === 0 || 现在 - this.最后输出时间 > 2000;

    if (已同步且活着 && 持续收到帧 && 无输出) {
      // 还在收帧却不再吐帧 = 解码器卡死，强制自愈等关键帧重建
      this.出错 = this.出错 || '画面停顿，正在自动恢复…';
      this.请求自愈();
      this.回调统计({ 帧率: 0, 延迟: 0, 出错: this.出错 });
      return;
    }

    // 解码队列积压说明电脑追不上，作为「延迟」指标显示
    const 积压 = this.解码器 ? this.解码器.decodeQueueSize : 0;
    this.回调统计({
      帧率: this.最近帧时间.length,
      延迟: 积压 / 60, // 粗略折算成秒
      积压,
      写入帧: this.解码帧数,
      错误: this.出错 || undefined,
    });
  }

  /** 截图（PNG dataURL） */
  截图() {
    if (!this.画布.width || !this.画布.height) return null;
    return this.画布.toDataURL('image/png');
  }

  /** 当前画布尺寸 */
  会话尺寸() {
    return { 宽: this.画布.width, 高: this.画布.height };
  }

  /** 彻底销毁 */
  销毁() {
    clearInterval(this.定时统计);
    try {
      this.解码器?.close();
    } catch {
      // 忽略
    }
    this.解码器 = null;
  }
}