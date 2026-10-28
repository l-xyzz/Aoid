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
const 语言 = require('../languages');
const 更新 = require('../updater');
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
  /**
   * 读取内置文档。
   *
   * 关键：文档可能在家放里的两个位置，必须都试一遍。
   *   - 开发态：根目录就在项目根
   *   - 打包后：根目录是 resources/app.asar，文档被塞进 asar 内部
   * 另外 Electron 对 asar 内的文件，fs.existsSync 偶尔会给错答案，
   * 所以这里**直接 try 读**，不靠 existsSync 先判断——读失败再换下一个候选。
   */
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
    const 文件名 = 白名单[名称];
    if (!文件名) throw new Error('没有这份文档：' + 名称);

    /*
     * 语言不是中文时优先用英文文档（README.en.md / PRIVACY.en.md / …）。
     * 找不到英文版就退回中文版——宁可给中文，也不要给空白。
     */
    const 当前语言 = (状态.设置 && 状态.设置.获取().语言) || 'zh-CN';
    const 要英文 = 当前语言 !== 'zh-CN';

    const 英文名 = 文件名.replace(/.md$/, '.en.md');
    const 顺序 = 要英文 && 英文名 !== 文件名 ? [英文名, 文件名] : [文件名];

    const 候选 = [];
    for (const 名 of 顺序) {
      候选.push(path.join(根目录, 名));
      候选.push(path.join(process.resourcesPath || '', 'app.asar.unpacked', 名));
      候选.push(path.join(path.dirname(app.getPath('exe')), 名));
      候选.push(path.join(process.resourcesPath || '', 名));
    }

    let 最后错误 = null;
    for (const 全路径 of 候选) {
      try {
        return await fsp.readFile(全路径, 'utf8');
      } catch (错误) {
        最后错误 = 错误;
      }
    }

    throw new Error(
      '文档读取失败：' + 文件名 + '（已尝试 ' + 候选.length + ' 个位置，最后错误：' +
        (最后错误 ? 最后错误.code || 最后错误.message : '未知') + '）',
    );
  });

  /* ---- 自动更新 ---- */

  /** 检查 GitHub 上有没有新版本；连不上会先诊断网络 */
  注册('设置:检查更新', async () => 更新.检查更新());

  /**
   * 执行更新。
   *
   * 下载可能很大（100MB+），进度通过 更新:进度 事件推给界面，
   * 这里只负责启动并把最终结果返回。
   */
  注册('设置:执行更新', async ({ 产物 }) => {
    if (!产物 || typeof 产物 !== 'object') throw new Error('缺少更新包信息');
    // 只接受 GitHub 的下载地址，防止被引导到别处
    if (!/^https:\/\/github\.com\//.test(String(产物.地址 || ''))) {
      throw new Error('更新地址不是 GitHub，已拒绝');
    }

    return 更新.执行更新(产物, (进度) => 推送('更新:进度', 进度));
  });

  /** 用系统浏览器打开链接（只允许 http/https） */
  注册('系统:打开链接', async ({ url }) => {
    if (!/^https?:\/\//.test(String(url || ''))) throw new Error('只允许打开网页链接');
    await shell.openExternal(url);
    return true;
  });

  /* ---- 多语言 ---- */

  /** 列出所有可用语言（内置 + 自定义） */
  注册('语言:列表', async () => 语言.列出语言());

  /** 取某个语言的对照表；zh-CN 不需要语言包，返回 null */
  注册('语言:读取', async ({ 代码 }) => {
    if (!代码 || 代码 === 'zh-CN') return null;
    const 包 = await 语言.取语言(String(代码));
    if (!包) throw new Error('找不到这个语言包：' + 代码);
    return 包;
  });

  /** 打开自定义语言包目录，并确保有一份模板可抄 */
  注册('语言:打开目录', async () => {
    const 目录 = await 语言.准备语言目录();
    await shell.openPath(目录);
    return { 目录 };
  });
}

module.exports = { 注册设置接口 };
