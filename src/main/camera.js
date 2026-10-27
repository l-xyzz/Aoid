/**
 * 手机摄像头 / 麦克风（「更多功能」里的设备复用）。
 *
 * 为什么用官方 scrcpy 的外部进程：
 *   摄像头推流需要服务端以 camera 源采集视频，麦克风走 audio-source=mic。
 *   这套参数与能力已经在官方 scrcpy 里成熟实现（3.3.4 起摄像头是正式功能），
 *   直接复用比自己做 MediaCodec 采集稳定得多。
 *
 * 关键参数（都实测过）：
 *   摄像头：--video-source=camera --camera-id=N --camera-size=WxH --camera-fps=N
 *           —— 不加 --video-source=camera 会报 "Camera options are only available with"
 *   麦克风：--audio-source=mic --audio-codec=raw（raw 才能直接录 WAV）
 *
 * 这里只负责「起进程 / 停进程 / 列设备」，画面渲染在渲染进程用 scrcpy 的窗口完成。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class 摄像头服务 {
  constructor({ scrcpy目录 }) {
    this.目录 = scrcpy目录;
    this.摄像头进程 = null;
    this.麦克风进程 = null;
    /** 摄像头列表缓存 */
    this.摄像头缓存 = null;
    /** 试开失败的镜头（列得出来但第三方用不了） */
    this.不可用清单 = new Map();
    this.最近日志 = '';
  }

  可执行文件() {
    return path.join(this.目录, 'scrcpy.exe');
  }

  可用() {
    return fs.existsSync(this.可执行文件());
  }

  /** 构造子进程环境：scrcpy 需要能找到 adb */
  环境() {
    const 环境 = { ...process.env };
    const adb = path.join(this.目录, 'adb.exe');
    环境.ADB = fs.existsSync(adb) ? adb : 'adb';
    // scrcpy 会在临时目录写日志，指到可写位置避免权限问题
    环境.TMP = process.env.TEMP || process.env.TMP || this.目录;
    return 环境;
  }

  /**
   * 列出手机摄像头。
   *
   * 返回分两步，避免界面卡在「加载中」：
   *   1. 立刻返回 scrcpy --list-cameras 的结果（约 1 秒），界面马上有下拉项；
   *   2. 在后台逐个试开，把打不开的镜头标记为不可用（实测这步要 18 秒，
   *      5 个镜头 × 约 4 秒；不能让它挡住界面）。
   *
   * @param {string} 序列号
   * @param {(列表: Array) => void} [可用后回调] 后台筛选完成时通知调用方
   */
  async 列出摄像头(序列号, 可用后回调) {
    if (this.摄像头缓存) return this.摄像头缓存;
    if (this.列表进行中) return this.列表进行中;

    this.列表进行中 = (async () => {
      const 输出 = await this.#执行(['-s', 序列号, '--list-cameras'], 20000);
      const 全部 = [];
      for (const 行 of 输出.split(/\r?\n/)) {
        // 形如：--camera-id=0    (back, 4096x3072, fps=[15, 24, 25, 29, 30, 60])
        const 匹配 = /--camera-id=(\S+)\s+\((\w+),\s*([0-9x]+),\s*fps=\[([^\]]+)\]/.exec(行);
        if (!匹配) continue;
        全部.push({
          id: 匹配[1],
          朝向: 匹配[2] === 'back' ? '后置' : 匹配[2] === 'front' ? '前置' : 匹配[2],
          尺寸: 匹配[3],
          帧率: 匹配[4],
          待检测: true,
        });
      }

      if (!全部.length) {
        this.列表进行中 = null;
        return [];
      }

      // 先给出完整列表，让界面立刻可用
      this.摄像头缓存 = 全部;

      // 后台逐个试开，完成后回调通知（不阻塞上面的返回）
      this.#后台筛选(序列号, 全部, 可用后回调).catch(() => {});

      return 全部;
    })();

    return this.列表进行中;
  }

  /** 后台逐个试开，把打不开的镜头剔掉 */
  async #后台筛选(序列号, 全部, 可用后回调) {
    const 可用 = [];
    for (const 项 of 全部) {
      const 能开 = await this.#试开(序列号, 项.id);
      if (能开) {
        可用.push({ ...项, 待检测: false });
      } else {
        this.不可用清单.set(项.id, true);
      }
    }

    // 一个都开不了就别把列表清空（可能是别的问题），全部保留
    this.摄像头缓存 = 可用.length ? 可用 : 全部.map((项) => ({ ...项, 待检测: false }));
    this.列表进行中 = null;
    if (typeof 可用后回调 === 'function') {
      try { 可用后回调(this.摄像头缓存); } catch { /* 忽略 */ }
    }
  }

  /**
   * 试开某个镜头，判断第三方能不能用。
   *
   * 为什么必须带窗口：用 --no-window 时 scrcpy 根本不会去初始化摄像头，
   * 所有镜头都会「成功」，起不到筛选作用（实测所有 id 都返回连接失败）。
   * 所以这里开一个真正的窗口，放到屏幕外并置顶，几秒后看日志里有没有
   * 「Texture: WxH」和 ERROR：有纹理且无错才算可用。
   */
  #试开(序列号, 摄像头id) {
    return new Promise((解析) => {
      const 子进程 = spawn(
        this.可执行文件(),
        [
          '-s', 序列号,
          '--video-source=camera',
          '--camera-id=' + 摄像头id,
          '--camera-size=640x480',
          '--no-audio',
          '--window-title=__Aoid_probe__',
          '--window-x=-3000',
          '--window-y=-3000',
        ],
        { cwd: this.目录, windowsHide: true, env: this.环境(), stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let 输出 = '';
      let 有结论 = false;
      const 收尾 = (结果) => {
        if (有结论) return;
        有结论 = true;
        clearTimeout(计时器);
        try { 子进程.kill(); } catch { /* 忽略 */ }
        解析(结果);
      };

      const 计时器 = setTimeout(() => {
        收尾(/Texture: \d+x\d+/.test(输出) && !/ERROR:/.test(输出));
      }, 4500);

      子进程.stdout.on('data', (块) => { 输出 += 块.toString('utf8'); });
      子进程.stderr.on('data', (块) => { 输出 += 块.toString('utf8'); });
      子进程.on('error', () => 收尾(false));
      子进程.on('close', () => 收尾(/Texture: \d+x\d+/.test(输出) && !/ERROR:/.test(输出)));
    });
  }

  /**
   * 打开摄像头预览（独立窗口，由 scrcpy 自己渲染，避免再实现一套解码）。
   * @param {object} 选项
   * @param {string} 选项.序列号
   * @param {string} 选项.摄像头id
   * @param {string} 选项.尺寸 例如 1280x720
   * @param {number} 选项.帧率
   * @param {boolean} 选项.要麦克风 是否同时把手机麦克风接到电脑
   */
  打开(选项) {
    this.关闭摄像头();

    const 参数 = [
      '-s', 选项.序列号,
      '--video-source=camera',
      `--camera-id=${选项.摄像头id || '0'}`,
      `--camera-size=${选项.尺寸 || '1280x720'}`,
      `--camera-fps=${选项.帧率 || 30}`,
      // 摄像头模式下不接受鼠标事件，显式关掉避免警告
      '--no-control',
      // 独立小窗口，标题便于辨认
      '--window-title=Aoid 摄像头',
      '--window-x=120',
      '--window-y=120',
      '--window-width=960',
      '--window-height=540',
      '--no-clipboard-autosync',
      '--no-power-on',
    ];

    // 音频：官方文档明确「--video-source=camera 会自动把音频源切到 mic」，
    // 所以「要麦克风」时什么都不加（走默认 mic）；不要时才显式 --no-audio。
    // 之前手动加 --audio-source=mic 反而可能与默认行为冲突。
    if (!选项.要麦克风) {
      参数.push('--no-audio');
    }

    return this.#启动('摄像头', 参数);
  }

  /** 只开麦克风（电脑端当麦克风用；window 显示电平） */
  打开麦克风(序列号) {
    this.关闭麦克风();
    const 参数 = [
      '-s', 序列号,
      '--no-video',
      '--audio-source=mic',
      '--audio-codec=opus',
      '--audio-buffer=120',
      '--no-window',
      '--no-clipboard-autosync',
      '--no-power-on',
    ];
    return this.#启动('麦克风', 参数);
  }

  #启动(类型, 参数) {
    if (!this.可用()) return { ok: false, 原因: '缺少 scrcpy 运行组件' };

    this.最近日志 = '';
    const 子进程 = spawn(this.可执行文件(), 参数, {
      cwd: this.目录,
      windowsHide: false,
      env: this.环境(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const 收集 = (块) => {
      const 文本 = 块.toString('utf8');
      this.最近日志 = (this.最近日志 + 文本).slice(-4000);
    };
    子进程.stdout.on('data', 收集);
    子进程.stderr.on('data', 收集);

    子进程.on('close', () => {
      if (类型 === '摄像头') this.摄像头进程 = null;
      else this.麦克风进程 = null;
    });

    if (类型 === '摄像头') this.摄像头进程 = 子进程;
    else this.麦克风进程 = 子进程;

    return { ok: true, pid: 子进程.pid };
  }

  /** 关闭摄像头进程 */
  关闭摄像头() {
    if (!this.摄像头进程) return;
    try {
      this.摄像头进程.kill();
    } catch {
      // 忽略
    }
    this.摄像头进程 = null;
  }

  /** 关闭麦克风进程 */
  关闭麦克风() {
    if (!this.麦克风进程) return;
    try {
      this.麦克风进程.kill();
    } catch {
      // 忽略
    }
    this.麦克风进程 = null;
  }

  /** 全部关闭 */
  关闭() {
    this.关闭摄像头();
    this.关闭麦克风();
  }

  摄像头运行中() {
    return Boolean(this.摄像头进程);
  }

  麦克风运行中() {
    return Boolean(this.麦克风进程);
  }

  运行中() {
    return this.摄像头运行中() || this.麦克风运行中();
  }

  /** 同步执行并收集输出（用于 --list-cameras） */
  #执行(参数, 超时) {
    return new Promise((解析, 拒绝) => {
      const 子进程 = spawn(this.可执行文件(), 参数, {
        cwd: this.目录,
        windowsHide: true,
        env: this.环境(),
      });
      let 输出 = '';
      const 计时器 = setTimeout(() => {
        子进程.kill();
        拒绝(new Error('列摄像头超时'));
      }, 超时);

      子进程.stdout.on('data', (块) => {
        输出 += 块.toString('utf8');
      });
      子进程.stderr.on('data', (块) => {
        输出 += 块.toString('utf8');
      });
      子进程.on('error', (错误) => {
        clearTimeout(计时器);
        拒绝(错误);
      });
      子进程.on('close', () => {
        clearTimeout(计时器);
        解析(输出);
      });
    });
  }
}

module.exports = { 摄像头服务 };