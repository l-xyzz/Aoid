/**
 * 设置存储。
 *
 * 用一个 JSON 文件存放全部偏好，读写都很简单，便于用户直接查看/备份。
 * 文件位置：<userData>/Aoid.json（打包后即 %APPDATA%\Aoid\Aoid.json）
 *
 * 设计原则：
 *   - 读的时候永远补齐默认值，老版本文件多缺字段也不会崩；
 *   - 写的时候先校验再落盘（尤其是快捷键绑定，非法值直接丢弃）；
 *   - 坏文件不覆盖，改名留档，避免用户手改坏了之后连设置都打不开。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { 默认绑定, 规整绑定 } = require('./shortcuts');

/** 默认设置 */
const 默认设置 = {
  /** 键鼠直连：把电脑鼠标键盘当手机外设。默认关闭，强侵入功能 */
  键鼠直连: false,

  /** 文件管理上次停留的位置（关掉窗口/应用后下次打开能接上） */
  文件管理手机目录: '/sdcard/',
  文件管理电脑目录: '',

  /** 输入法直连：用电脑输入法打字直接进手机。试验功能，默认关闭 */
  输入法直连: false,

  /** 界面语言：目前只有简体中文 */
  语言: 'zh-CN',
  /** 主题：system | light | dark */
  主题: 'system',
  /** 快捷键绑定 */
  快捷键: 默认绑定,
  /** 最近使用过的无线设备（IP:端口） */
  无线设备: [],
  /** 剪贴板双向同步 */
  剪贴板同步: false,
  /** 手机是否外放（默认静音，改为在电脑上听） */
  手机发声: false,
  /** 电脑是否播放手机声音 */
  电脑发声: true,
  /** 推流短边分辨率：540 / 720 / 1080 / 1440，越低越流畅 */
  流分辨率: 1080,
  /** 连接过的设备：{ 序列号, 名称, 型号, 方式: 'usb'|'无线', 最后连接时间 } */
  历史设备: [],
  /** 交互授权（首次点通知时提示一次） */
  已提示通知授权: false,
};

class 设置存储 {
  /**
   * @param {string} 目录 存放目录（一般是 app.getPath('userData')）
   */
  constructor(目录) {
    this.文件 = path.join(目录, 'Aoid.json');
    this.数据 = { ...默认设置, 快捷键: 规整绑定(默认绑定) };
    this.载入();
  }

  /** 从磁盘载入，出错时回退默认值 */
  载入() {
    try {
      if (!fs.existsSync(this.文件)) {
        this.保存();
        return;
      }
      const 文本 = fs.readFileSync(this.文件, 'utf8');
      const 原始 = JSON.parse(文本);
      this.数据 = this.合并(原始);
    } catch (错误) {
      // 文件损坏：备份后重建，避免用户每次启动都报错
      try {
        fs.renameSync(this.文件, `${this.文件}.broken`);
      } catch {
        // 忽略
      }
      this.数据 = { ...默认设置, 快捷键: 规整绑定(默认绑定) };
      this.保存();
    }
  }

  /** 把磁盘上的内容与默认值合并（缺字段补默认，非法值丢弃） */
  合并(原始) {
    const 结果 = { ...默认设置 };
    if (!原始 || typeof 原始 !== 'object') return 结果;

    /*
     * 语言：允许任意合法的语言代码（zh-CN、en-US、ja-JP…），
     * 因为用户可能自己塞了自定义语言包。这里只做格式检查，
     * 真正的「有没有这个语言包」由 language.js 在使用时判断，
     * 找不到就回落中文，不会让应用起不来。
     */
    if (typeof 原始.语言 === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(原始.语言)) {
      结果.语言 = 原始.语言;
    }
    if (['system', 'light', 'dark'].includes(原始.主题)) 结果.主题 = 原始.主题;
    结果.快捷键 = 规整绑定(原始.快捷键 || {});
    if (Array.isArray(原始.无线设备)) {
      结果.无线设备 = 原始.无线设备.filter((项) => typeof 项 === 'string' && 项.length < 64).slice(0, 20);
    }
    结果.剪贴板同步 = 原始.剪贴板同步 === true;
    结果.键鼠直连 = 原始.键鼠直连 === true;
    结果.输入法直连 = 原始.输入法直连 === true;
    if (typeof 原始.文件管理手机目录 === 'string') 结果.文件管理手机目录 = 原始.文件管理手机目录.slice(0, 512);
    if (typeof 原始.文件管理电脑目录 === 'string') 结果.文件管理电脑目录 = 原始.文件管理电脑目录.slice(0, 512);
    结果.手机发声 = 原始.手机发声 === true;
    结果.电脑发声 = 原始.电脑发声 !== false;
    结果.流分辨率 = [540, 720, 1080, 1440].includes(原始.流分辨率) ? 原始.流分辨率 : 1080;
    结果.历史设备 = Array.isArray(原始.历史设备) ? 原始.历史设备.filter((项) => 项 && 项.序列号).slice(0, 20) : [];
    结果.已提示通知授权 = 原始.已提示通知授权 === true;

    return 结果;
  }

  /** 读取全部设置（返回副本，避免调用方意外改动内部状态） */
  获取() {
    return JSON.parse(JSON.stringify(this.数据));
  }

  /** 保存整份设置，返回规整后的结果 */
  保存(新数据 = this.数据) {
    this.数据 = this.合并(新数据);
    try {
      fs.mkdirSync(path.dirname(this.文件), { recursive: true });
      // 先写临时文件再改名，避免写入中途断电留下半个文件
      const 临时 = `${this.文件}.tmp`;
      fs.writeFileSync(临时, JSON.stringify(this.数据, null, 2), 'utf8');
      fs.renameSync(临时, this.文件);
    } catch {
      // 写不了盘（权限问题）不应影响使用，内存里仍然生效
    }
    return this.获取();
  }

  /** 局部更新 */
  更新(片段) {
    return this.保存({ ...this.数据, ...片段 });
  }
}

module.exports = { 设置存储, 默认设置 };
