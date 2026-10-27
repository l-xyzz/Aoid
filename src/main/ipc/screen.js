/**
 * 画面、截图、状态与媒体相关 IPC。
 */
'use strict';

const fsp = require('node:fs/promises');
const { dialog, nativeImage, clipboard, ClipboardItem } = require('electron');
const { 状态, 注册, 推送 } = require('../core/context');

function 时间戳() {
  const d = new Date();
  const 补 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${补(d.getMonth() + 1)}${补(d.getDate())}_${补(d.getHours())}${补(d.getMinutes())}${补(d.getSeconds())}`;
}

/**
 * 取手机原始分辨率的无损 PNG。
 *
 * 为什么不用画布：画布是推流分辨率（默认 720 短边）解码出来的，
 * 存它等于存缩略图。截图应该要手机屏幕本身的像素。
 */
async function 原图() {
  if (!状态.设备) throw new Error('还没有连接设备');
  return 状态.服务.执行二进制(状态.设备, 'screencap -p');
}

function 注册画面接口() {
  /* ---- 截图 ---- */
  注册('截图:保存', async () => {
    // dataUrl 参数已不再使用：截图统一取手机原图
    const 结果 = await dialog.showSaveDialog(状态.窗口, {
      title: '保存截图',
      defaultPath: `Aoid_${时间戳()}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (结果.canceled || !结果.filePath) return { saved: false };

    const png = await 原图();
    await fsp.writeFile(结果.filePath, png);
    return { saved: true, path: 结果.filePath, 字节: png.length };
  });

  注册('截图:复制', async () => {
    // dataUrl 参数已不再使用：截图统一取手机原图
    const png = await 原图();
    const 图像 = nativeImage.createFromBuffer(png);
    if (图像.isEmpty()) throw new Error('截图数据无效');

    // 这个 Electron 版本的 clipboard 是异步 Web 风格接口：
    // 没有 writeImage；write 只接受 ClipboardItem 数组，值还要包成 Blob。
    const 项 = new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) });
    await clipboard.write([项]);
    if (!clipboard.read('image/png')) {
      clipboard.write({ 'image/png': png });
    }

    const 尺寸 = 图像.getSize();
    return { 宽: 尺寸.width, 高: 尺寸.height, 字节: png.length };
  });

  /* ---- 音量与亮度：一次读回，避免三条命令堆积 ---- */
  注册('状态:汇总', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.读取状态(状态.设备);
  });

  注册('状态:音量', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.读取音量(状态.设备);
  });

  注册('状态:设置音量', async ({ 百分比 }) => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.设置音量(状态.设备, 百分比);
  });

  注册('状态:亮度', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.读取亮度(状态.设备);
  });

  注册('状态:设置亮度', async ({ 百分比 }) => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.设置亮度(状态.设备, 百分比);
  });

  /* ---- 媒体 ---- */
  注册('媒体:读取', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.读取媒体(状态.设备);
  });

  注册('媒体:控制', async ({ 动作 }) => {
    if (!状态.设备) throw new Error('还没有连接设备');
    return 状态.服务.媒体控制(状态.设备, 动作);
  });
}

module.exports = { 注册画面接口, 原图 };
