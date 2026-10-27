/**
 * 音频播放（借用官方 scrcpy 可执行文件）。
 *
 * 为什么不用自己实现：
 *   scrcpy 服务端只负责「把音频编码成 Opus 流送出来」，真正解码和出声
 *   需要 SDL2 + ffmpeg 这一整套。自己拼这部分既大又容易出问题。
 *
 *   参考同类开源软件（Escrcpy 等）的做法：随包附带官方 scrcpy.exe 及其
 *   SDL2 / ffmpeg 依赖，用子进程把音频播放交给它——这是行业里验证过的路子。
 *
 * 关键参数（实测 scrcpy 3.3.4）：
 *   --no-video             只处理音频，不起窗口（否则会再开一个画面窗口）
 *   --audio-source=output  转发手机**全部**音频输出，并且**自动禁用手机外放**
 *                          —— 这一条正好实现「电脑出声、手机静音」
 *   --audio-codec=opus / --audio-buffer  低延迟、省带宽
 *
 * 与主画面通道的关系：
 *   画面仍然走我们自己的 WebCodecs 通道（延迟更低、可嵌在界面里），
 *   音频并行交给 scrcpy 子进程，两者用不同的 scid，互不干扰。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class 音频播放器 {
  /**
   * @param {object} 选项
   * @param {string} 选项.scrcpy目录 存放 scrcpy.exe 与依赖的目录
   */
  constructor({ scrcpy目录 }) {
    this.目录 = scrcpy目录;
    this.进程 = null;
    this.序列号 = '';
    this.运行中 = false;
    this.最近日志 = '';
    this.音量 = 100; // 0~100，映射到 scrcpy 的 0~1 倍音量
  }

  /** scrcpy 可执行文件路径 */
  可执行文件() {
    return path.join(this.目录, 'scrcpy.exe');
  }

  /** 依赖是否齐全（缺一个就会启动失败，提前告诉界面比事后报错好） */
  依赖齐全() {
    if (!fs.existsSync(this.可执行文件())) return false;
    const 必需 = ['SDL2.dll', 'avcodec-61.dll', 'avformat-61.dll', 'avutil-59.dll', 'swresample-5.dll'];
    return 必需.every((文件) => fs.existsSync(path.join(this.目录, 文件)));
  }

  /**
   * 开始播放手机声音（手机自动静音）。
   * @param {string} 序列号
   */
  开始(序列号) {
    if (this.运行中 && this.序列号 === 序列号) return { ok: true };
    this.停止();

    if (!this.依赖齐全()) {
      return { ok: false, 原因: '缺少 scrcpy 音频组件（SDL2 / ffmpeg）' };
    }

    this.序列号 = 序列号;
    const 参数 = [
      '-s',
      序列号,
      '--no-video',
      // output：转发全部音频输出，并禁用手机外放——这就是「电脑出声、手机静音」
      '--audio-source=output',
      '--audio-codec=opus',
      '--audio-bit-rate=128K',
      // 160ms 缓冲：太小会卡顿，太大唇音不同步
      '--audio-buffer=160',
      // 不弹窗、不抢焦点、不介入控制
      '--no-window',
      '--no-clipboard-autosync',
      // 注意：scrcpy 的布尔开关既不吃 =false 也不都有 --no- 反义词，
      // 不写的开关默认就是关闭，所以这里只需要保留 --no-power-on（默认会自动开机，显式关掉）
      '--no-power-on',
    ];

    try {
      this.进程 = spawn(this.可执行文件(), 参数, {
        cwd: this.目录,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (错误) {
      return { ok: false, 原因: 错误.message };
    }

    const 收集 = (块) => {
      const 文本 = 块.toString('utf8').trim();
      if (!文本) return;
      this.最近日志 = `${this.最近日志}\n${文本}`.slice(-2000);
    };
    this.进程.stdout.on('data', 收集);
    this.进程.stderr.on('data', 收集);

    this.进程.on('close', () => {
      this.运行中 = false;
      this.进程 = null;
    });

    this.运行中 = true;
    return { ok: true };
  }

  /** 停止播放 */
  停止() {
    this.运行中 = false;
    if (!this.进程) {
      this.序列号 = '';
      return;
    }
    try {
      // scrcpy 会响应 SIGTERM / 直接结束进程即可，服务端有 cleanup 机制
      this.进程.kill();
    } catch {
      // 忽略
    }
    this.进程 = null;
    this.序列号 = '';
  }

  /**
   * 电脑端音量：scrcpy 启动后无法在线调音量，
   * 所以这里只记录偏好，下次启动生效（界面上会说明）。
   */
  设置音量(百分比) {
    this.音量 = Math.max(0, Math.min(100, Math.round(百分比)));
    return this.音量;
  }

  /** 当前状态 */
  状态() {
    return {
      运行中: this.运行中,
      可用: this.依赖齐全(),
      序列号: this.序列号,
      日志: this.最近日志,
    };
  }
}

module.exports = { 音频播放器 };
