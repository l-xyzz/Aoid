/**
 * 录屏。
 *
 * 用 scrcpy 自己的 --record 功能录制，**这是唯一能同时录到画面的方案**
 * （Android 自带的 screenrecord 只录画面，help 里根本没有音频参数）。
 *
 * scrcpy 录制的好处：
 *   - 音视频一步到位，输出带 aac 音轨的 mp4，不需要额外合并
 *   - 不限制时长（不传 --time-limit 就一直录）
 *   - 编码参数和投屏一致，画质稳定
 *
 * 代价：
 *   - 录的是"投屏画面"，分辨率受 --max-size 限制（默认 1024），
 *     会比手机原生分辨率小。想要原生分辨率就把 --max-size 去掉或调大。
 *   - --no-playback 让电脑端不播放，避免重复出声。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { dialog } = require('electron');
const { 状态, 注册, 推送, 安全文本 } = require('../core/context');

/** 当前录制任务 */
let 录制 = null;

function 是录制中() {
  return !!(录制 && 录制.进行中);
}

/**
 * 停止录制并把文件拉回电脑。
 *
 * scrcpy 录制时我们只在电脑本地写文件，停止就是结束那个子进程，
 * 等它把 moov 写完即可。不需要再从手机 pull。
 */
async function 停止录制() {
  if (!是录制中()) return { 已录制: false };

  const 任务 = 录制;
  任务.进行中 = false;

  const 秒数 = Math.max(1, Math.round((Date.now() - 任务.开始时刻) / 1000));

  try {
    /*
     * 让 scrcpy 正常退出。
     *
     * 直接 kill 会丢失 moov（文件打不开），所以先发 SIGINT，
     * scrcpy 收到后会自己收尾关闭。等它退出，超时再强杀。
     */
    const 子 = 任务.子进程;
    if (子 && !子.killed) {
      try {
        子.kill('SIGINT');
      } catch {
        // Windows 上 SIGINT 可能无效，下面用 taskkill
      }

      await new Promise((解析) => {
        const 定时 = setTimeout(() => {
          // 兜底：Windows 用 taskkill 强杀
          try {
            spawnSync('taskkill', ['/PID', String(子.pid), '/T', '/F'], { timeout: 5000 });
          } catch {}
          解析();
        }, 3500);
        子.on('exit', () => {
          clearTimeout(定时);
          解析();
        });
      });
    }

    // 等文件写完
    await new Promise((解析) => setTimeout(解析, 600));

    推送('录屏:状态', { 录制中: false, 时长: 秒数 });
    录制 = null;

    if (!fs.existsSync(任务.文件路径) || fs.statSync(任务.文件路径).size < 1024) {
      throw new Error('录制文件没有生成，可能 scrcpy 启动失败');
    }

    return {
      已录制: true,
      临时文件: 任务.文件路径,
      秒数,
      有音频: 任务.有音频,
    };
  } catch (错误) {
    录制 = null;
    推送('录屏:状态', { 录制中: false, 时长: 秒数, 错误: 安全文本(错误.message) });
    throw 错误;
  }
}

  注册('录屏:开始', async () => {
    if (!状态.adb || !状态.设备) throw new Error('还没有连接设备');
    if (是录制中()) throw new Error('正在录制中');

    const { scrcpy运行目录 } = require('../core/context');
    const 运行目录 = scrcpy运行目录();
    const exe = path.join(运行目录, 'scrcpy.exe');
    if (!fs.existsSync(exe)) throw new Error('找不到 scrcpy.exe：' + exe);

    const 文件路径 = path.join(os.tmpdir(), `Aoid-record-${Date.now()}.mp4`);

    /*
     * 录制参数。
     *
     * --no-window     不弹窗口（我们只要文件）
     * --no-playback   电脑端不播声音，避免自己这边重复响
     * --audio-source=output  录手机的**内部音频**（游戏声、视频声）
     * --audio-codec=aac      统一用 aac，兼容性最好（opus 有些播放器不认）
     * --record        指定输出文件
     *
     * 不传 --time-limit，也就是不限时长。
     */
    const 参数 = [
      '--serial', 状态.设备,
      '--no-window',
      '--no-playback',
      '--audio-source=output',
      '--audio-codec=aac',
      '--audio-bit-rate=128K',
      `--record=${文件路径}`,
    ];

    录制 = {
      进行中: true,
      文件路径,
      开始时刻: Date.now(),
      子进程: null,
      有音频: true,
    };

    try {
      录制.子进程 = spawn(exe, 参数, {
        // 在 scrcpy 所在目录启动，它需要找同目录的 DLL 和 server
        cwd: 运行目录,
        stdio: 'ignore',
        windowsHide: true,
      });

      录制.子进程.on('error', () => {});

      // 等一会儿确认它真的起来了（scrcpy 启动要推 server，约 1~2 秒）
      await new Promise((解析, 拒绝) => {
        const 定时 = setTimeout(解析, 1800);
        录制.子进程.on('exit', (码) => {
          clearTimeout(定时);
          拒绝(new Error('scrcpy 启动失败（退出码 ' + 码 + '）'));
        });
      });
    } catch (错误) {
      // 音频流可能不被设备支持，退回纯视频再试一次
      try {
        const 纯视频参数 = 参数.filter((a) => !a.startsWith('--audio'));
        录制.子进程 = spawn(exe, 纯视频参数, {
          cwd: 运行目录,
          stdio: 'ignore',
          windowsHide: true,
        });
        录制.有音频 = false;
        await new Promise((解析) => setTimeout(解析, 1800));
      } catch {
        录制 = null;
        throw new Error('录屏启动失败：' + 错误.message);
      }
    }

    推送('录屏:状态', { 录制中: true, 开始时刻: 录制.开始时刻, 有音频: 录制.有音频 });
    return { 录制中: true, 有音频: 录制.有音频 };
  });


