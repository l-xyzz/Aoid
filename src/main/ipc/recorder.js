/**
 * 录屏。
 *
 * 用 adb 的 `screenrecord` 在手机上录，录完（或中途停止）再把 mp4 拉回电脑。
 *
 * 为什么不录电脑上的画面窗口：
 *   -- 手机内部录屏是硬件编码，画质与帧率都稳定，也不受电脑负载影响；
 *   -- 投屏窗口的分辨率是缩放过的小图，录出来会糊。
 *
 * 限制：screenrecord 单次最长 180 秒（Android 系统限制），
 * 到时间会自动结束，这里用计时器提前停，避免拖到最后拿到被截断的文件。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { dialog } = require('electron');
const { 状态, 注册, 推送, 安全文本 } = require('../core/context');

/** 单次录制上限（秒），留 10 秒余量给拉回文件 */
const 最长秒数 = 170;

/** 当前录制任务 */
let 录制 = null;

function 是录制中() {
  return !!(录制 && 录制.进行中);
}

/** 停止录制并把文件拉回电脑 */
async function 停止录制() {
  if (!是录制中()) return { 已录制: false };

  const 任务 = 录制;
  任务.进行中 = false;
  clearTimeout(任务.定时器);

  const { 序列号, 设备路径 } = 任务;
  const 秒数 = Math.max(1, Math.round((Date.now() - 任务.开始时刻) / 1000));

  try {
    // 通知手机端停止录制（screenrecord 收到 SIGINT 会正常收尾写文件）
    状态.adb.设备shell(序列号, `pkill -INT -f screenrecord`, { timeout: 5000 }).catch(() => {});
    // 等它把文件写完
    await new Promise((解析) => setTimeout(解析, 1200));

    const 本地临时 = path.join(os.tmpdir(), `Aoid-record-${Date.now()}.mp4`);
    await 状态.adb.拉取(序列号, 设备路径, 本地临时);
    状态.adb.设备shell(序列号, `rm -f ${设备路径}`, { timeout: 5000 }).catch(() => {});

    推送('录屏:状态', { 录制中: false, 时长: 秒数 });
    录制 = null;

    return { 已录制: true, 临时文件: 本地临时, 秒数 };
  } catch (错误) {
    录制 = null;
    推送('录屏:状态', { 录制中: false, 时长: 秒数, 错误: 安全文本(错误.message) });
    throw 错误;
  }
}

function 注册录屏接口() {
  /** 开始录制 */
  注册('录屏:开始', async () => {
    if (!状态.adb || !状态.设备) throw new Error('还没有连接设备');
    if (是录制中()) throw new Error('正在录制中');

    const 序列号 = 状态.设备;
    const 设备路径 = `/sdcard/Aoid-${Date.now()}.mp4`;

    录制 = {
      进行中: true,
      序列号,
      设备路径,
      开始时刻: Date.now(),
      定时器: null,
    };

    /*
     * 后台启动 screenrecord。
     *
     * 用 `nohup ... &` 是让它在 shell 退出后继续跑；
     * 直接 `adb shell screenrecord` 会阻塞这条连接直到录完，
     * 那样就没法在录制中响应「停止」了。
     */
    const 命令 = `nohup screenrecord --bit-rate 8000000 --time-limit 180 ${设备路径} >/dev/null 2>&1 &`;
    await 状态.adb.设备shell(序列号, 命令, { timeout: 8000 });

    // 到点自动停，避免超过系统限制拿到残文件
    录制.定时器 = setTimeout(() => {
      停止录制().catch(() => {});
    }, 最长秒数 * 1000);

    推送('录屏:状态', { 录制中: true, 开始时刻: 录制.开始时刻 });
    return { 录制中: true, 设备路径 };
  });

  /** 停止录制，返回临时文件路径（界面随后弹保存框） */
  注册('录屏:停止', async () => 停止录制());

  /**
   * 把临时 mp4 存到用户选的位置。
   *
   * 单独一步而不是自动存：录屏往往是给某个具体用途的（发群里、剪辑），
   * 让用户自己选位置比事后到处找文件更舒服。
   */
  注册('录屏:保存', async ({ 临时文件, 秒数 }) => {
    if (!临时文件 || !fs.existsSync(临时文件)) throw new Error('录屏文件不存在');

    const 时间 = new Date();
    const 戳 = [
      时间.getFullYear(),
      String(时间.getMonth() + 1).padStart(2, '0'),
      String(时间.getDate()).padStart(2, '0'),
      '_',
      String(时间.getHours()).padStart(2, '0'),
      String(时间.getMinutes()).padStart(2, '0'),
      String(时间.getSeconds()).padStart(2, '0'),
    ].join('');

    const 结果 = await dialog.showSaveDialog(状态.窗口, {
      title: '保存录屏',
      defaultPath: `Aoid_录屏_${戳}.mp4`,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    });

    if (结果.canceled || !结果.filePath) {
      // 用户取消：删掉临时文件，避免堆积
      await fsp.unlink(临时文件).catch(() => {});
      return { saved: false };
    }

    await fsp.copyFile(临时文件, 结果.filePath);
    await fsp.unlink(临时文件).catch(() => {});
    const 字节 = (await fsp.stat(结果.filePath)).size;
    return { saved: true, path: 结果.filePath, 字节 };
  });

  /** 查询状态 */
  注册('录屏:状态', async () => ({
    录制中: 是录制中(),
    已录秒数: 是录制中() ? Math.round((Date.now() - 录制.开始时刻) / 1000) : 0,
  }));
}

module.exports = { 注册录屏接口, 停止录制, 是录制中 };
