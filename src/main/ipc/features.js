/**
 * 「更多功能」相关 IPC：摄像头、麦克风、虚拟摄像头、独立窗口。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const { 状态, 注册, 推送, 安全文本, 根目录 } = require('../core/context');

/**
 * 显示或隐藏「更多功能」窗口。
 *
 * 做成独立窗口而不是主界面的一块：摄像头预览、麦克风属于「开着一直用」
 * 的功能，可以单独拖动、最小化、放到第二块屏，关掉它也不影响投屏。
 */
function 显示更多窗口(显示) {
  if (显示 === false) {
    if (状态.更多窗口 && !状态.更多窗口.isDestroyed()) 状态.更多窗口.close();
    return;
  }

  if (状态.更多窗口 && !状态.更多窗口.isDestroyed()) {
    状态.更多窗口.show();
    状态.更多窗口.focus();
    return;
  }

  状态.更多窗口 = new BrowserWindow({
    width: 520,
    height: 700,
    minWidth: 420,
    minHeight: 520,
    title: 'Aoid 更多功能',
    parent: 状态.窗口,
    modal: false,
    show: false,
    backgroundColor: '#0d0e12',
    autoHideMenuBar: true,
    icon: path.join(根目录, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  状态.更多窗口.setMenuBarVisibility(false);
  状态.更多窗口.loadFile(path.join(根目录, 'src', 'renderer', 'features.html'));
  状态.更多窗口.once('ready-to-show', () => 状态.更多窗口.show());
  状态.更多窗口.on('closed', () => {
    状态.更多窗口 = null;
    // 窗口关了就把摄像头和麦克风一起停掉，不留后台进程
    if (状态.摄像头) 状态.摄像头.关闭();
    if (状态.麦克风) 状态.麦克风.停止();
  });
}

function 注册更多功能接口() {
  注册('更多:显示窗口', async ({ 显示 }) => {
    显示更多窗口(显示 !== false);
    return { 显示: 显示 !== false };
  });

  /* 与「更多:显示窗口 false」等价，兼容 preload 里声明过的「更多:关闭」 */
  注册('更多:关闭', async () => {
    显示更多窗口(false);
    return { 显示: false };
  });

  /* ---- 摄像头 ---- */
  注册('更多:摄像头列表', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    if (!状态.摄像头) throw new Error('摄像头模块未就绪');
    return {
      可用: 状态.摄像头.可用(),
      列表: await 状态.摄像头.列出摄像头(状态.设备, (新列表) => {
        推送('更多:摄像头列表更新', 新列表);
      }),
    };
  });

  注册('更多:打开摄像头', async ({ 摄像头id, 尺寸, 帧率, 要麦克风 }) => {
    if (!状态.设备) throw new Error('还没有连接设备');
    if (!状态.摄像头) throw new Error('摄像头模块未就绪');
    const 结果 = 状态.摄像头.打开({
      序列号: 状态.设备,
      摄像头id,
      尺寸,
      帧率,
      要麦克风: 要麦克风 === true,
    });
    if (!结果.ok) throw new Error(结果.原因 || '打开摄像头失败');
    return { 运行中: true };
  });

  注册('更多:关闭摄像头', async () => {
    if (状态.摄像头) 状态.摄像头.关闭摄像头();
    return { 运行中: false };
  });

  /* ---- 麦克风：把手机麦克风送进虚拟声卡 ---- */
  注册('更多:虚拟声卡', async () => {
    if (!状态.麦克风) return { 可用: false, 原因: '麦克风模块未就绪' };
    return 状态.麦克风.检测虚拟声卡();
  });

  注册('更多:打开麦克风', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    if (!状态.麦克风) throw new Error('麦克风模块未就绪');

    const 检测 = await 状态.麦克风.检测虚拟声卡();
    if (!检测.可用) throw new Error(检测.原因 || '没有找到虚拟声卡');

    const 结果 = await 状态.麦克风.开始(状态.设备);
    if (!结果.ok) throw new Error(结果.原因 || '打开麦克风失败');
    return {
      运行中: true,
      文件: 结果.文件,
      播放端: 结果.播放端,
      录音端: 结果.录音端,
    };
  });

  注册('更多:关闭麦克风', async () => {
    if (状态.麦克风) 状态.麦克风.停止();
    return { 运行中: false };
  });

  /* ---- 虚拟摄像头 ---- */
  注册('虚拟摄像头:可用', async () => ({
    可用: 状态.虚拟摄像头 ? 状态.虚拟摄像头.可用() : false,
    已启动: 状态.虚拟摄像头 ? 状态.虚拟摄像头.状态().已启动 : false,
    设备名: 'OBS Virtual Camera',
  }));

  注册('虚拟摄像头:开始', async () => {
    if (!状态.设备) throw new Error('还没有连接设备');
    if (!状态.虚拟摄像头) throw new Error('虚拟摄像头模块未就绪');

    // 抓一张手机原始截图作为 OBS 图片源的画面来源
    const 图像目录 = path.join(require('../core/context').数据目录(), 'vcam');
    await fs.promises.mkdir(图像目录, { recursive: true });
    const 图像路径 = path.join(图像目录, 'phone.png');
    const png = await 状态.服务.执行二进制(状态.设备, 'screencap -p');
    await fs.promises.writeFile(图像路径, png);

    const 结果 = await 状态.虚拟摄像头.开始({ 图像路径 });
    return { ...结果, 设备名: 'OBS Virtual Camera' };
  });

  注册('虚拟摄像头:停止', async () => {
    if (!状态.虚拟摄像头) return { 已启动: false };
    return 状态.虚拟摄像头.停止();
  });

  /* ---- 状态汇总 ---- */
  注册('更多:状态', async () => ({
    摄像头运行中: 状态.摄像头 ? 状态.摄像头.摄像头运行中() : false,
    麦克风运行中: 状态.麦克风 ? 状态.麦克风.状态().运行中 : false,
    可用: 状态.摄像头 ? 状态.摄像头.可用() : false,
  }));

  /* ---- 声音输出（scrcpy 音频） ---- */
  注册('声音:读取', async () => {
    const 状态1 = 状态.音频 ? 状态.音频.状态() : { 运行中: false, 可用: false };
    return {
      电脑发声: 状态1.运行中,
      电脑发声可用: 状态1.可用,
      说明: 状态1.可用
        ? 状态1.运行中
          ? '手机声音正在电脑上播放，手机已自动静音'
          : '手机声音在手机上外放'
        : '缺少音频组件，无法在电脑播放',
    };
  });

  注册('声音:切换电脑播放', async ({ 开启 }) => {
    if (!状态.设备) throw new Error('还没有连接设备');
    if (!状态.音频) throw new Error('音频模块未就绪');

    if (开启) {
      const 结果 = 状态.音频.开始(状态.设备);
      if (!结果.ok) throw new Error(结果.原因 || '启动音频失败');
    } else {
      状态.音频.停止();
    }

    const 状态2 = 状态.音频.状态();
    return { 电脑发声: 状态2.运行中, 电脑发声可用: 状态2.可用 };
  });

  /* ---- 剪贴板 ---- */
  注册('剪贴板:读取', async () => {
    const { clipboard } = require('electron');
    return { 文本: clipboard.readText(), 手机: 状态.手机剪贴板 };
  });

  注册('剪贴板:写入', async ({ 文本 }) => {
    require('electron').clipboard.writeText(String(文本 ?? ''));
    return true;
  });

  注册('剪贴板:发送到手机', async ({ 文本 }) => {
    if (!状态.通道) throw new Error('还没有连接设备');
    const 内容 = String(文本 ?? '');
    if (!内容) throw new Error('没有可发送的内容');
    状态.剪贴板序号 += 1;
    状态.通道.设置剪贴板(内容, 状态.剪贴板序号);
    return { 长度: 内容.length };
  });
}

module.exports = { 注册更多功能接口, 显示更多窗口 };
