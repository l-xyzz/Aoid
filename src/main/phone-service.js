/**
 * 手机状态服务：通知、音量、亮度、正在播放。
 *
 * 全部基于 adb + 系统命令实现，不需要蓝牙、不需要装应用：
 *
 *   通知：`dumpsys notification --noredact` 能拿到每条通知的标题、正文、包名与 key。
 *         点击通知的做法是「打开通知栏 → 在界面上真实点一下」——这样效果与手指点击
 *         完全一致（会跳转到应用对应界面），比自己拼 Intent 可靠得多。
 *         为了点得准，点之前会先截图，用行投影找出通知卡片的边界。
 *
 *   音量：`cmd media_session volume` 读写 STREAM_MUSIC。
 *   亮度：`settings get/put system screen_brightness`。
 *   播放：`dumpsys media_session` 解析当前活跃会话的标题与播控状态。
 *
 * 所有方法都是「按需调用」，不做后台轮询：界面需要时才刷新。
 */
'use strict';

const { spawn } = require('node:child_process');

/** Android 媒体流编号 */
const 流 = { 通话: 0, 系统: 1, 铃声: 2, 媒体: 3, 闹钟: 4, 通知: 5 };

/** 通知 importance 到可读级别的映射 */
function 重要度文字(值) {
  if (值 >= 4) return '高';
  if (值 >= 3) return '中';
  return '低';
}

class 手机服务 {
  /**
   * @param {object} 选项
   * @param {string} 选项.adbPath
   */
  constructor({ adbPath }) {
    this.adbPath = adbPath;
  }

  /**
   * 执行一次 adb shell 并拿到**二进制**输出（用于截图）。
   * 注意：这里必须用 exec-out，不能用 shell，否则管道会被 shell 层破坏。
   */
  执行二进制(序列号, 命令, { timeout = 30000 } = {}) {
    return new Promise((解析, 拒绝) => {
      const 子进程 = spawn(this.adbPath, ['-s', 序列号, 'exec-out', 命令], { windowsHide: true });
      const 输出 = [];
      let 超时 = false;
      const 计时器 = setTimeout(() => {
        超时 = true;
        子进程.kill();
      }, timeout);

      子进程.stdout.on('data', (块) => 输出.push(块));
      子进程.stderr.on('data', () => {});
      子进程.on('error', (e) => {
        clearTimeout(计时器);
        拒绝(e);
      });
      子进程.on('close', () => {
        clearTimeout(计时器);
        if (超时) return 拒绝(new Error('截图超时'));
        const 数据 = Buffer.concat(输出);
        // PNG 头校验，避免把报错信息当图片
        if (数据.length < 8 || 数据[0] !== 0x89) return 拒绝(new Error('截图失败'));
        解析(数据);
      });
    });
  }

  /** 执行一次 adb shell，返回 stdout */
  执行(序列号, 命令, { timeout = 15000, maxBuffer = 32 * 1024 * 1024 } = {}) {
    return new Promise((解析, 拒绝) => {
      const 子进程 = spawn(this.adbPath, ['-s', 序列号, 'shell', 命令], { windowsHide: true });
      const 输出 = [];
      const 错误 = [];
      let 超时 = false;
      const 计时器 = setTimeout(() => {
        超时 = true;
        子进程.kill();
      }, timeout);

      子进程.stdout.on('data', (块) => 输出.push(块));
      子进程.stderr.on('data', (块) => 错误.push(块));
      子进程.on('error', (e) => {
        clearTimeout(计时器);
        拒绝(e);
      });
      子进程.on('close', (码) => {
        clearTimeout(计时器);
        const 文本 = Buffer.concat(输出).toString('utf8');
        if (超时) return 拒绝(new Error('操作超时'));
        if (码 !== 0 && !文本) return 拒绝(new Error(Buffer.concat(错误).toString('utf8').trim() || `退出码 ${码}`));
        解析(文本);
      });
    });
  }

  /* ---------------- 声音输出 ---------------- */

  /**
   * 声音在哪里播放。
   *
   * 需求：默认「电脑播放、手机静音」。
   * 手机侧实现：把媒体音量设为 0（档位 0 等价于静音，系统会显示 Muted: true）。
   * 电脑侧实现：把手机音频流用 scrcpy 拉到电脑播放——这一项依赖音频推流，
   * 属于后续版本（当前的 scrcpy 通道只开了 video），
   * 所以这里如实返回「未支持」，界面据此禁用开关而不是假装能用。
   */
  async 设置手机静音(序列号) {
    await this.执行(序列号, 'service call audio 15 i32 3 i32 0 i32 0', { timeout: 8000 });
    return this.读取音量(序列号);
  }

  /** 手机声音开关；关闭即静音 */
  async 设置手机声音(序列号, 开) {
    if (!开) return this.设置手机静音(序列号);
    // 打开时恢复到 50% 左右，避免一下子爆音
    const 当前 = await this.读取音量(序列号);
    if (当前.值 > 0) return 当前;
    return this.设置音量(序列号, 50);
  }
  /* ---------------- 通知 ---------------- */

  /**
   * 读取当前通知列表。
   * 返回最近的通知（按系统给出的顺序，最新的在前面）。
   */
  async 读取通知(序列号) {
    const 文本 = await this.执行(序列号, 'dumpsys notification --noredact', { timeout: 20000 });

    const 通知 = [];
    // 每条通知以 "NotificationRecord(" 开头，后面跟着若干缩进行
    const 记录们 = 文本.split(/\n(?=\s*NotificationRecord\()/);

    for (const 记录 of 记录们) {
      if (!记录.trim().startsWith('NotificationRecord')) continue;

      const 头 = 记录.match(/pkg=([\w.]+)\s+user=UserHandle\{(-?\d+)\}\s+id=(-?\d+)\s+tag=([^\s]+)/);
      if (!头) continue;
      const [, 包名, 用户, id文本, 标签] = 头;
      // 只保留属于当前用户的通知（-1 是系统聚合，也保留）
      if (用户 !== '-1' && 用户 !== '0') continue;

      const 标题 = (记录.match(/android\.title=String \((.*?)\)\s*$/m) || [])[1] || '';
      const 正文 = (记录.match(/android\.text=String \((.*?)\)\s*$/m) || [])[1] || '';
      const 副标题 = (记录.match(/android\.subText=String \((.*?)\)\s*$/m) || [])[1] || '';

      const 标志 = (记录.match(/flags=([A-Z_|]+)/) || [])[1] || '';
      const 重要度文本 = (记录.match(/importance=(\d+)/) || [])[1] || '3';
      const 时间 = (记录.match(/postTime=(\d+)/) || [])[1] || '';

      // 忽略没有任何文字的系统占位通知
      if (!标题 && !正文) continue;

      通知.push({
        key: `${包名}|${id文本}|${标签}`,
        包名,
        标题: 标题 || 正文 || '通知',
        正文: 标题 ? 正文 : '',
        副标题,
        重要度: 重要度文字(Number(重要度文本)),
        常驻: /ONGOING_EVENT/.test(标志),
        可清除: !/NO_CLEAR/.test(标志),
        时间: Number(时间) || 0,
      });
    }

    return 通知;
  }

  /**
   * 解析截图中通知卡片的位置。
   *
   * 实测（小米 HyperOS 通知栏）：背景是模糊的高亮壁纸，**通知卡片是比背景更暗的
   * 半透明圆角矩形**——所以不能找「亮块」，要找「暗块」。
   *
   * 做法：
   *   1. 逐行取中间区域的亮度，得到行亮度曲线；
   *   2. 平滑后按「低于均值 - 0.5 倍标准差」判定为卡片区段；
   *   3. 取第 N 个足够高的区段，用其中心作为点击点。
   *
   * @param {{width:number, height:number, 像素: (x:number,y:number)=>number}} 图像
   * @param {number} 序号 第几条通知（0 为最上面一条）
   * @returns {{x:number, y:number}|null}
   */
  定位通知行(图像, 序号) {
    const 段们 = this.找通知区段(图像);
    const 段 = 段们[序号];
    if (!段) return null;
    return {
      x: Math.round(图像.width / 2),
      y: Math.round((段.上 + 段.下) / 2),
      段数: 段们.length,
    };
  }

  /**
   * 找出截图里所有通知卡片的纵向区段（从上到下）。
   *
   * 通知卡片是比背景更暗的半透明圆角矩形，所以判定「低于均值」的连续行。
   * 点击定位与图标裁剪共用这套算法，保证两者对同一条通知的理解一致。
   *
   * @param {{width:number, height:number, 像素:(x:number,y:number)=>number}} 图像
   * @returns {Array<{上:number, 下:number}>}
   */
  找通知区段(图像) {
    const { width, height, 像素 } = 图像;

    const 左 = Math.round(width * 0.18);
    const 右 = Math.round(width * 0.82);
    const 步长 = Math.max(1, Math.round((右 - 左) / 48));
    const 行亮 = new Float32Array(height);

    for (let y = 0; y < height; y += 1) {
      let 和 = 0;
      let 数 = 0;
      for (let x = 左; x < 右; x += 步长) {
        和 += 像素(x, y);
        数 += 1;
      }
      行亮[y] = 数 ? 和 / 数 : 0;
    }

    // 平滑抗噪
    const 平滑 = new Float32Array(height);
    for (let y = 0; y < height; y += 1) {
      let 和 = 0;
      let 数 = 0;
      for (let k = -5; k <= 5; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) continue;
        和 += 行亮[yy];
        数 += 1;
      }
      平滑[y] = 和 / 数;
    }

    let 均值 = 0;
    for (let y = 0; y < height; y += 1) 均值 += 平滑[y];
    均值 /= height;

    let 方差 = 0;
    for (let y = 0; y < height; y += 1) 方差 += (平滑[y] - 均值) ** 2;
    方差 /= height;
    const 标准差 = Math.sqrt(方差);

    const 阈值 = 均值 - 标准差 * 0.45;
    const 起点行 = Math.round(height * 0.14);
    const 段们 = [];
    let 起点 = -1;

    for (let y = 起点行; y < height; y += 1) {
      const 暗 = 平滑[y] < 阈值;
      if (暗 && 起点 < 0) 起点 = y;
      if ((!暗 || y === height - 1) && 起点 >= 0) {
        // 卡片高度至少占 3%，避免把细线当成通知
        if (y - 起点 > height * 0.03) 段们.push({ 上: 起点, 下: y });
        起点 = -1;
      }
    }

    return 段们;
  }
  /**
   * 音量：从 dumpsys audio 里读 STREAM_MUSIC 的当前档位与最大档位。
   * （`cmd media_session volume --show` 在部分机型上不生效，dumpsys 更稳）
   */
  /**
   * 一次读回音量与亮度。
   *
   * 只用一条 adb shell 完成两件事（分号串联），往返只有一次。
   * 这样界面即使每 400ms 刷新，也不会把 adb 打满、更不会堆积请求。
   */
  async 读取状态(序列号) {
    const 命令 = "dumpsys audio | grep -A 8 \"STREAM_MUSIC:\" ; echo ---分隔--- ; settings get system screen_brightness";
    const 文本 = await this.执行(序列号, 命令, { timeout: 12000 });

    const 分段 = 文本.split("---分隔---");
    const 音频段 = 分段[0] || "";
    const 亮度段 = 分段[1] || "";

    const 块 =
      音频段.split(/\n(?=- STREAM_)/).find((段) => 段.startsWith("- STREAM_MUSIC:")) || 音频段;

    const 当前 = Number((块.match(/streamVolume:(\d+)/) || [])[1] || 0);
    const 最大 = Number((块.match(/Max:\s*(\d+)/) || [])[1] || 1);
    const 静音 = /Muted:\s*true/.test(块);
    const 亮度原值 = Number(String(亮度段).trim());

    return {
      音量: { 值: 当前, 最大, 百分比: Math.round((当前 / (最大 || 1)) * 100), 静音 },
      亮度: { 百分比: Number.isFinite(亮度原值) ? Math.round((亮度原值 / 255) * 100) : 0 },
    };
  }

  async 读取音量(序列号) {
    const 文本 = await this.执行(序列号, 'dumpsys audio', { timeout: 12000 });
    const 块 = 文本.split(/\n(?=- STREAM_)/).find((段) => 段.startsWith('- STREAM_MUSIC:'));
    if (!块) return { 值: 0, 最大: 1, 百分比: 0, 静音: false };

    const 当前 = Number((块.match(/streamVolume:(\d+)/) || [])[1] || 0);
    const 最大 = Number((块.match(/Max:\s*(\d+)/) || [])[1] || 1);
    const 静音 = /Muted:\s*true/.test(块);
    return {
      值: 当前,
      最大,
      百分比: Math.round((当前 / (最大 || 1)) * 100),
      静音,
    };
  }

  /**
   * 设置音量百分比。
   *
   * 这条路径踩了四个坑，最后才找到一步到位的写法：
   *   1. `cmd media_session volume --adj`：只打印日志，音量不变；
   *   2. 一条 shell 用分号连发多个 `input keyevent`：只有第一个生效；
   *   3. 每次单独 `input keyevent`：有效但太慢（调满整条要 10 秒）；
   *   4. 走 scrcpy 注入通道连发：快，但会弹出音量调节面板，视觉干扰大。
   *
   * 最终方案：`service call audio 15 i32 <流> i32 <档位> i32 <标志>`
   *   这是 AudioManager.setStreamVolume 的 binder 事务码（实测 Android 16 上是 15；
   *   11 走的是另一组「系统音量」，改它不会影响媒体音量，别用错）。
   *   一次调用直达目标档位，不弹面板，耗时约 0.5 秒。
   */
  async 设置音量(序列号, 百分比) {
    const 目标百分比 = Math.max(0, Math.min(100, Math.round(百分比)));

    /*
     * 只写不读，并且用 service call 而不是 media_session。
     *
     * 为什么不用 `cmd media_session volume --stream 3 --set N`：
     * 实测这台手机 Max=150，`--set 42` 被当成**索引 42**（≈28%），
     * 而不是 42%。用户拖到一半，手机给一半，越拖越偏。
     *
     * service call 需要绝对索引，所以必须知道 Max。
     * 为了不每次多跑一次 adb，这里把 Max 缓存起来（音量档位不会变），
     * 只有第一次或换设备时才读。
     */
    const 缓存键 = '音量最大';
    if (!this[缓存键]) {
      try {
        const 当前 = await this.读取音量(序列号);
        this[缓存键] = 当前.最大 || 15;
      } catch {
        this[缓存键] = 15; // 常见默认值，读不到就先用它
      }
    }

    const 目标 = Math.round((目标百分比 / 100) * this[缓存键]);
    await this.执行(序列号, `service call audio 15 i32 3 i32 ${目标} i32 0`, { timeout: 6000 });

    // 直接回报目标值：界面要的是「我拖到哪就是哪」
    return { 值: 目标, 最大: this[缓存键], 百分比: 目标百分比, 静音: 目标百分比 === 0 };
  }

  /** 亮度：0~255 */
  async 读取亮度(序列号) {
    const 文本 = await this.执行(序列号, 'settings get system screen_brightness', { timeout: 6000 });
    const 自动 = await this.执行(序列号, 'settings get system screen_brightness_mode', { timeout: 6000 });
    const 值 = Number(文本.trim()) || 0;
    return { 值, 最大: 255, 百分比: Math.round((值 / 255) * 100), 自动: 自动.trim() === '1' };
  }

  /**
   * 设置亮度百分比。
   *
   * 和音量一样只写不读。另外把「关自动亮度」和「设亮度」合并进一条命令：
   * 原来两条独立 adb 往返，拖动时每次都多花一个来回，手感明显发滞。
   */
  async 设置亮度(序列号, 百分比) {
    const 目标百分比 = Math.max(0, Math.min(100, Math.round(百分比)));
    const 值 = Math.round((目标百分比 / 100) * 255);

    await this.执行(
      序列号,
      `settings put system screen_brightness_mode 0; settings put system screen_brightness ${值}`,
      { timeout: 6000 },
    );

    return { 值, 最大: 255, 百分比: 目标百分比, 自动: false };
  }

  /** 正在播放：解析媒体会话 */
  async 读取媒体(序列号) {
    const 文本 = await this.执行(序列号, 'dumpsys media_session', { timeout: 12000 });

    // 找到第一个活跃会话块
    const 块们 = 文本.split(/\n(?=\s+MediaSessionRecord)/);
    let 目标 = null;
    for (const 块 of 块们) {
      if (!/MediaSessionRecord/.test(块)) continue;
      if (!/state=PlaybackState\{(?:state=3|state=4|state=6)/.test(块)) continue;
      目标 = 块;
      break;
    }
    if (!目标) return { 播放中: false, 标题: '', 作者: '', 包名: '', 状态: '无' };

    const 标题 = (目标.match(/metadata:.*?title=(.*?),/s) || [])[1] || '';
    const 作者 = (目标.match(/metadata:.*?artist=(.*?),/s) || [])[1] || '';
    const 包名 = (目标.match(/package=([\w.]+)/) || [])[1] || '';
    const 状态 = (目标.match(/state=PlaybackState\{state=(\d+)/) || [])[1] || '0';

    return {
      播放中: 状态 === '3',
      标题: 标题.replace(/^undefined$/, ''),
      作者: 作者.replace(/^undefined$/, ''),
      包名,
      状态,
    };
  }

  /** 媒体控制：play / pause / next / previous */
  async 媒体控制(序列号, 动作) {
    const 命令 = {
      play: 'cmd media_session dispatch play',
      pause: 'cmd media_session dispatch pause',
      toggle: 'cmd media_session dispatch play-pause',
      next: 'cmd media_session dispatch next',
      previous: 'cmd media_session dispatch previous',
    }[动作];
    if (!命令) throw new Error('不支持的播放操作');
    await this.执行(序列号, 命令, { timeout: 8000 });
    return true;
  }
}

module.exports = { 手机服务, 流 };
