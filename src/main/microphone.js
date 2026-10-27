'use strict';

/**
 * 把手机麦克风变成电脑麦克风（VB-Cable 版）。
 *
 * 踩过的坑：
 *   1. scrcpy --audio-source=mic 只是把手机麦克风播放到电脑扬声器，
 *      会议软件选不到，不算电脑麦克风。
 *   2. ffmpeg 写虚拟声卡不可行：Windows 官方构建只有 dshow 采集，没有 dshow 输出，
 *      报 Requested output format 'dshow' is not known。
 *   3. 正确做法是 Electron 自己：渲染进程用音频元素播放，
 *      再用 setSinkId() 把输出定向到 CABLE Input 播放设备；
 *      其他软件从 CABLE Output 录音，就拿到了手机麦克风的声音。
 *
 * 数据来源：scrcpy 把手机麦克风录成 WAV（raw 编码才允许录 wav），
 * 渲染进程循环读取这个不断增长的文件来播放。
 *
 * 临时文件必须放在 scrcpy 目录下：系统 TEMP 权限受限时 scrcpy 会
 * Failed to open output file（实测）。
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const 虚拟声卡播放端 = 'CABLE Input';
const 虚拟声卡录音端 = 'CABLE Output';

class 麦克风桥 {
  constructor({ scrcpy目录 }) {
    this.scrcpy目录 = scrcpy目录;
    this.录制进程 = null;
    this.运行中 = false;
    this.临时文件 = '';
    this.最近日志 = '';
  }

  可执行文件() {
    return path.join(this.scrcpy目录, 'scrcpy.exe');
  }

  /** 检测系统里有没有 VB-Cable */
  检测虚拟声卡() {
    return new Promise((解析) => {
      execFile(
        'powershell',
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name'],
        { windowsHide: true },
        (错误, 输出) => {
          const 文本 = String(输出 || '');
          const 有 = /CABLE/i.test(文本);
          解析({
            可用: 有,
            播放端: 虚拟声卡播放端,
            录音端: 虚拟声卡录音端,
            原因: 有 ? '' : '没有检测到 VB-Cable 虚拟声卡',
          });
        },
      );
    });
  }

  /** 开始录制手机麦克风，返回给渲染进程播放的文件路径 */
  async 开始(序列号) {
    this.停止();

    const 缓存根 = path.join(this.scrcpy目录, 'mic-cache');
    fs.mkdirSync(缓存根, { recursive: true });
    this.临时文件 = path.join(缓存根, 'mic-' + Date.now() + '.wav');

    const 环境 = { ...process.env };
    const adb = path.join(this.scrcpy目录, 'adb.exe');
    环境.ADB = fs.existsSync(adb) ? adb : 'adb';

    const 参数 = [
      '-s', 序列号,
      '--no-video',
      '--audio-source=mic',
      '--audio-codec=raw',
      '--audio-buffer=80',
      '--no-window',
      '--no-clipboard-autosync',
      '--no-power-on',
      '--record-format=wav',
      '--record=' + this.临时文件,
    ];

    this.录制进程 = spawn(this.可执行文件(), 参数, {
      cwd: this.scrcpy目录,
      windowsHide: true,
      env: 环境,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const 收 = (块) => {
      this.最近日志 = (this.最近日志 + 块.toString('utf8')).slice(-3000);
    };
    this.录制进程.stdout.on('data', 收);
    this.录制进程.stderr.on('data', 收);
    this.录制进程.on('close', () => {
      this.运行中 = false;
    });

    const 就绪 = await this.#等待文件(this.临时文件, 6000);
    if (!就绪) {
      const 原因 = this.最近日志.includes('Failed to open output file')
        ? '写不了临时文件，请检查 scrcpy-runtime 目录的写权限'
        : '手机没有开始输出音频，请检查是否已连接';
      this.停止();
      return { ok: false, 原因 };
    }

    this.运行中 = true;
    return {
      ok: true,
      文件: this.临时文件,
      播放端: 虚拟声卡播放端,
      录音端: 虚拟声卡录音端,
    };
  }

  停止() {
    this.运行中 = false;
    if (this.录制进程) {
      try {
        this.录制进程.kill();
      } catch {
        // 忽略
      }
      this.录制进程 = null;
    }
    if (this.临时文件) {
      const 文件 = this.临时文件;
      this.临时文件 = '';
      setTimeout(() => {
        try {
          fs.unlinkSync(文件);
        } catch {
          // 可能还被占用
        }
      }, 2000);
    }
    return { ok: true };
  }

  状态() {
    return {
      运行中: this.运行中,
      文件: this.临时文件,
      播放端: 虚拟声卡播放端,
      录音端: 虚拟声卡录音端,
    };
  }

  #等待文件(路径, 超时) {
    const 截止 = Date.now() + 超时;
    return new Promise((解析) => {
      const 查 = () => {
        try {
          if (fs.existsSync(路径) && fs.statSync(路径).size > 1024) {
            解析(true);
            return;
          }
        } catch {
          // 还在创建
        }
        if (Date.now() > 截止) {
          解析(false);
          return;
        }
        setTimeout(查, 200);
      };
      查();
    });
  }
}

module.exports = { 麦克风桥, 虚拟声卡播放端, 虚拟声卡录音端 };
