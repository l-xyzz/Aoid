/**
 * 给 phone-service.js 追加「一次读回音量+亮度」的方法。
 *
 * 为什么合并：界面每 400ms 刷新一次状态，原先要跑三条独立 adb 命令
 * （音量 244ms + 亮度 437ms + 媒体 215ms ≈ 900ms），间隔比耗时还短，
 * 请求会永久堆积，整个应用都跟着卡。
 * 合并后往返只有一次。
 */
const fs = require('node:fs');
const path = require('node:path');

const 目标 = path.join(__dirname, '..', 'src', 'main', 'phone-service.js');
const 原文 = fs.readFileSync(目标, 'utf8');

if (原文.includes('async 读取状态(序列号)')) {
  console.log('已经加过了');
  process.exit(0);
}

const 标记 = '  async 读取音量(序列号) {';
const 位置 = 原文.indexOf(标记);
if (位置 < 0) {
  console.error('没找到插入点');
  process.exit(1);
}

// 用字符串拼接，避免模板字符串里的反引号与 PowerShell 转义打架
const 分隔 = '---分隔---';
const 命令 = 'dumpsys audio | grep -A 8 "STREAM_MUSIC:" ; echo ' + 分隔 + ' ; settings get system screen_brightness';

const 代码 = [
  '  /**',
  '   * 一次读回音量与亮度。',
  '   *',
  '   * 只用一条 adb shell 完成两件事（分号串联），往返只有一次。',
  '   * 这样界面即使每 400ms 刷新，也不会把 adb 打满、更不会堆积请求。',
  '   */',
  '  async 读取状态(序列号) {',
  '    const 命令 = ' + JSON.stringify(命令) + ';',
  '    const 文本 = await this.执行(序列号, 命令, { timeout: 12000 });',
  '',
  '    const 分段 = 文本.split(' + JSON.stringify(分隔) + ');',
  '    const 音频段 = 分段[0] || "";',
  '    const 亮度段 = 分段[1] || "";',
  '',
  '    const 块 =',
  '      音频段.split(/\\n(?=- STREAM_)/).find((段) => 段.startsWith("- STREAM_MUSIC:")) || 音频段;',
  '',
  '    const 当前 = Number((块.match(/streamVolume:(\\d+)/) || [])[1] || 0);',
  '    const 最大 = Number((块.match(/Max:\\s*(\\d+)/) || [])[1] || 1);',
  '    const 静音 = /Muted:\\s*true/.test(块);',
  '    const 亮度原值 = Number(String(亮度段).trim());',
  '',
  '    return {',
  '      音量: { 值: 当前, 最大, 百分比: Math.round((当前 / (最大 || 1)) * 100), 静音 },',
  '      亮度: { 百分比: Number.isFinite(亮度原值) ? Math.round((亮度原值 / 255) * 100) : 0 },',
  '    };',
  '  }',
  '',
  '',
].join('\n');

fs.writeFileSync(目标, 原文.slice(0, 位置) + 代码 + 原文.slice(位置), 'utf8');
console.log('已追加 读取状态');
