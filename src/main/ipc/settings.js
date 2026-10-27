/**
 * 设置相关 IPC：读写设置、快捷键、文档、检查更新、清晰度切换。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, shell } = require('electron');
const { 状态, 注册, 推送, 根目录, 安全文本, 内置工具目录 } = require('../core/context');
const 快捷键 = require('../shortcuts');
const { 连接设备 } = require('../session/session');

function 注册设置接口() {
  /* ---- adb ---- */
  注册('adb:探测', async () => ({ ...(await 状态.adb.探测()), toolDir: 内置工具目录() }));

  注册('adb:准备', async () => {
    const 探测结果 = await 状态.adb.探测();
    if (!探测结果.ok) throw new Error(探测结果.原因 || '没有找到 adb');
    await 状态.adb.启动服务();
    return 探测结果;
  });

  /* ---- 应用信息：版本号、Electron 版本、adb 版本 ---- */
  注册('应用:信息', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    adbVersion: 状态.adb ? 状态.adb.版本 || '' : '',
  }));

  注册('设置:读取', async () => 状态.设置.获取());

  注册('设置:保存', async (片段) => {
    const 新设置 = 状态.设置.更新(片段 || {});
    推送('设置:变化', 新设置);
    return 新设置;
  });

  注册('设置:重置快捷键', async () => {
    const 新设置 = 状态.设置.更新({ 快捷键: 快捷键.默认绑定 });
    推送('设置:变化', 新设置);
    return 新设置;
  });

  注册('设置:动作表', async () => 快捷键.动作表);

  /**
   * 切换推流清晰度，立刻重连画面通道。
   *
   * 分辨率与码率是 scrcpy 服务端的启动参数，服务端起来后无法在线修改，
   * 只能重启这条通道。重连只影响画面，音频与其它功能不受影响。
   */
  注册('设置:切换清晰度', async ({ 流分辨率 }) => {
    const 合法 = [540, 720, 1080, 1440];
    const 目标 = 合法.includes(Number(流分辨率)) ? Number(流分辨率) : 720;
    状态.设置.更新({ 流分辨率: 目标 });

    if (!状态.设备 || !状态.通道) return { 流分辨率: 目标, 已重连: false };

    const 序列号 = 状态.设备;
    try {
      await 状态.通道.关闭();
    } catch {
      // 忽略
    }
    状态.通道 = null;

    await 连接设备(序列号);
    return { 流分辨率: 目标, 已重连: true };
  });

  /** 读取项目内的文档（README / LICENSE / PRIVACY 等） */
  注册('设置:文档', async ({ 名称 }) => {
    const 白名单 = {
      README: 'README.md',
      LICENSE: 'LICENSE',
      PRIVACY: 'PRIVACY.md',
      CHANGELOG: 'CHANGELOG.md',
      THIRDPARTY: 'THIRD-PARTY-NOTICES.md',
      // 兼容旧键名
      第三方声明: 'THIRD-PARTY-NOTICES.md',
    };
    const 文件 = 白名单[名称];
    if (!文件) throw new Error('没有这份文档');
    const 全路径 = path.join(根目录, 文件);
    if (!fs.existsSync(全路径)) throw new Error('文档不存在：' + 文件);
    return fsp.readFile(全路径, 'utf8');
  });

  /** 检查更新：目前只做占位说明，不做任何网络请求 */
  注册('设置:检查更新', async () => ({
    有更新: false,
    说明: `当前版本 ${app.getVersion()}，这是开发版本，暂未接入自动更新。`,
  }));

  /** 用系统浏览器打开链接（只允许 http/https） */
  注册('系统:打开链接', async ({ url }) => {
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('只允许打开网页链接');
    await shell.openExternal(url);
    return true;
  });
}

module.exports = { 注册设置接口 };
