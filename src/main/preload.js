/**
 * preload：界面与主进程之间唯一的桥。
 *
 * 只暴露白名单方法，界面里没有 require、拿不到 Node 对象。
 * 命名按「模块.方法」分组，方便界面侧对照阅读。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 订阅事件并返回取消订阅函数 */
function 订阅(频道, 回调) {
  const 处理器 = (事件, 载荷) => 回调(载荷);
  ipcRenderer.on(频道, 处理器);
  return () => ipcRenderer.off(频道, 处理器);
}

contextBridge.exposeInMainWorld('deck', {
  /* ---- 应用 ---- */
  应用信息: () => ipcRenderer.invoke('应用:信息'),
  打开链接: (url) => ipcRenderer.invoke('系统:打开链接', { url }),

  /* ---- 多语言 ---- */
  语言: {
    列表: () => ipcRenderer.invoke('语言:列表'),
    读取: (代码) => ipcRenderer.invoke('语言:读取', { 代码 }),
    打开目录: () => ipcRenderer.invoke('语言:打开目录'),
  },

  /* ---- adb ---- */
  adb: {
    探测: () => ipcRenderer.invoke('adb:探测'),
    准备: () => ipcRenderer.invoke('adb:准备'),
    进度: (回调) => 订阅('adb:进度', 回调),
  },

  /* ---- 设备 ---- */
  设备: {
    列表: () => ipcRenderer.invoke('设备:列表'),
    设置显示尺寸: (高度, 像素比) => ipcRenderer.invoke('设备:设置显示尺寸', { 高度, 像素比 }),
    连接: (serial) => ipcRenderer.invoke('设备:连接', { serial }),
    断开: () => ipcRenderer.invoke('设备:断开'),
    刷新分辨率: () => ipcRenderer.invoke('设备:刷新分辨率'),
    历史: () => ipcRenderer.invoke('设备:历史'),
    删除历史: (序列号) => ipcRenderer.invoke('设备:删除历史', { 序列号 }),
    刷新: () => ipcRenderer.invoke('设备:刷新'),
    状态: (回调) => 订阅('设备:状态', 回调),
    按键: (key) => ipcRenderer.invoke('设备:按键', { key }),
    输入文本: (text) => ipcRenderer.invoke('设备:输入文本', { 文本: text }),
    返回: () => ipcRenderer.invoke('设备:返回'),
    通知栏: () => ipcRenderer.invoke('设备:通知栏'),
    快捷设置: () => ipcRenderer.invoke('设备:快捷设置'),
    旋转: () => ipcRenderer.invoke('设备:旋转'),
  },

  /* ---- 触控（坐标是视频流坐标） ---- */
  触控: {
    按下: (x, y) => ipcRenderer.invoke('触控:按下', { x, y }),
    移动: (x, y) => ipcRenderer.invoke('触控:移动', { x, y }),
    抬起: (x, y) => ipcRenderer.invoke('触控:抬起', { x, y }),
    点击: (x, y) => ipcRenderer.invoke('触控:点击', { x, y }),
    滑动: (x1, y1, x2, y2, duration) => ipcRenderer.invoke('触控:滑动', { x1, y1, x2, y2, duration }),
    滚动: (x, y, v, h) => ipcRenderer.invoke('触控:滚动', { x, y, v, h }),
  },

  /* ---- 画面 ---- */
  画面: {
    片段: (回调) => 订阅('画面:片段', 回调),
    会话: (回调) => 订阅('画面:会话', 回调),
    分辨率: (回调) => 订阅('画面:分辨率', 回调),

    /** 回报已消费到的帧号，主进程据此做背压丢帧（低频，走主 IPC 即可） */
    回报消费(帧号) {
      ipcRenderer.send('画面:回报消费', 帧号);
    },
  },

  /* ---- 截图 ---- */
  截图: {
    保存: (dataUrl) => ipcRenderer.invoke('截图:保存', { dataUrl }),
    复制: (dataUrl) => ipcRenderer.invoke('截图:复制', { dataUrl }),
  },

  /* ---- 剪贴板 ---- */
  剪贴板: {
    读取: () => ipcRenderer.invoke('剪贴板:读取'),
    写入: (文本) => ipcRenderer.invoke('剪贴板:写入', { 文本 }),
    发送到手机: (文本) => ipcRenderer.invoke('剪贴板:发送到手机', { 文本 }),
    来自手机: (回调) => 订阅('剪贴板:来自手机', 回调),
  },

  /* ---- 音量 / 亮度 ---- */
  状态: {
    汇总: () => ipcRenderer.invoke('状态:汇总'),
    音量: () => ipcRenderer.invoke('状态:音量'),
    设置音量: (百分比) => ipcRenderer.invoke('状态:设置音量', { 百分比 }),
    亮度: () => ipcRenderer.invoke('状态:亮度'),
    设置亮度: (百分比) => ipcRenderer.invoke('状态:设置亮度', { 百分比 }),
  },

  /* ---- 正在播放 ---- */
  媒体: {
    读取: () => ipcRenderer.invoke('媒体:读取'),
    控制: (动作) => ipcRenderer.invoke('媒体:控制', { 动作 }),
  },

  /* ---- 键鼠直连 ---- */
  键鼠: {
    设置: (开启) => ipcRenderer.invoke('外设:键鼠直连', { 开启 }),
    状态: () => ipcRenderer.invoke('外设:键鼠状态'),
    鼠标: (参数) => ipcRenderer.invoke('外设:鼠标', 参数),
    键盘: (参数) => ipcRenderer.invoke('外设:键盘', 参数),
    打字: (内容) => ipcRenderer.invoke('外设:打字', { 内容 }),
    状态变化: (回调) => 订阅('外设:键鼠直连状态', 回调),
  },

  /* ---- 外设：手机当摄像头 / 麦克风 ---- */
  更多: {
    摄像头列表: () => ipcRenderer.invoke('更多:摄像头列表'),
    打开摄像头: (选项) => ipcRenderer.invoke('更多:打开摄像头', 选项),
    打开麦克风: () => ipcRenderer.invoke('更多:打开麦克风'),
    虚拟声卡: () => ipcRenderer.invoke('更多:虚拟声卡'),
    状态: () => ipcRenderer.invoke('更多:状态'),
    关闭摄像头: () => ipcRenderer.invoke('更多:关闭摄像头'),
    关闭麦克风: () => ipcRenderer.invoke('更多:关闭麦克风'),
    关闭: () => ipcRenderer.invoke('更多:关闭'),
    显示窗口: (显示) => ipcRenderer.invoke('更多:显示窗口', { 显示 }),
  },

  /* ---- 虚拟摄像头（把手机画面变成电脑摄像头） ---- */
  虚拟摄像头: {
    开始: () => ipcRenderer.invoke('虚拟摄像头:开始'),
    停止: () => ipcRenderer.invoke('虚拟摄像头:停止'),
    可用: () => ipcRenderer.invoke('虚拟摄像头:可用'),
  },

  /* ---- 声音输出 ---- */
  声音: {
    读取: () => ipcRenderer.invoke('声音:读取'),
    切换电脑播放: (开启) => ipcRenderer.invoke('声音:切换电脑播放', { 开启 }),
  },

  /* ---- 菜单 ---- */
  菜单: {
    打开设置: (回调) => ipcRenderer.on('菜单:打开设置', (事件, 页) => 回调(页)),
  },

  /* ---- 设置 ---- */
  设置: {
    读取: () => ipcRenderer.invoke('设置:读取'),
    保存: (片段) => ipcRenderer.invoke('设置:保存', 片段),
    切换清晰度: (流分辨率) => ipcRenderer.invoke('设置:切换清晰度', { 流分辨率 }),
    重置快捷键: () => ipcRenderer.invoke('设置:重置快捷键'),
    动作表: () => ipcRenderer.invoke('设置:动作表'),
    文档: (名称) => ipcRenderer.invoke('设置:文档', { 名称 }),
    检查更新: () => ipcRenderer.invoke('设置:检查更新'),
  执行更新: (产物) => ipcRenderer.invoke('设置:执行更新', { 产物 }),
  更新进度: (回调) => 订阅('更新:进度', 回调),
    变化: (回调) => 订阅('设置:变化', 回调),
  },

  /* ---- 无线连接 ---- */
  无线: {
    配对: (地址, 配对码) => ipcRenderer.invoke('无线:配对', { 地址, 配对码 }),
    连接: (地址) => ipcRenderer.invoke('无线:连接', { 地址 }),
    断开: (地址) => ipcRenderer.invoke('无线:断开', { 地址 }),
    扫描: () => ipcRenderer.invoke('无线:扫描'),
    转为无线: () => ipcRenderer.invoke('无线:转为无线'),
    本机信息: () => ipcRenderer.invoke('无线:本机信息'),
  },

  /* ---- 窗口 ---- */
  窗口: {
    最小化: () => ipcRenderer.invoke('窗口:最小化'),
    最大化: () => ipcRenderer.invoke('窗口:最大化'),
    关闭: () => ipcRenderer.invoke('窗口:关闭'),
    最大化变化: (回调) => 订阅('窗口:最大化', 回调),
  },
});
