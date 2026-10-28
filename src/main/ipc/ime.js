/**
 * 输入法直连（试验功能，默认关闭）。
 *
 * 想要的效果：
 *   用电脑自己的输入法打字，选完词之后这段文字直接进到手机里。
 *   英文输入不受影响；中文走电脑输入法，选词完成再发。
 *
 * 关键点：
 *   - 正在用输入法打字时（compositionstart ~ compositionend）**不能**发，
 *     否则会把「nihao」这种拼音字母一个个打到手机上；
 *   - 只有 compositionend（选词完成）才发这段文字；
 *   - 纯英文/数字直接用 keydown 走按键注入，保持低延迟；
 *   - 这样启用功能后，电脑上普通打字（比如在别的窗口聊天）不受影响，
 *     因为只有焦点在 Aoid 画面上时才接管。
 */
'use strict';

const { 状态, 注册, 推送 } = require('../core/context');

function 取通道() {
  const 通道 = 状态.通道;
  if (!通道) throw new Error('还没有连接设备');
  return 通道;
}

function 注册输入法接口() {
  /**
   * 把一段已经确定的文字发到手机。
   *
   * 和「文字输入」框走同一套逻辑：含非 ASCII 就走剪贴板粘贴，
   * 纯 ASCII 直接键入，兼容性最好。
   */
  注册('输入法:提交', async ({ 文本 }) => {
    const 内容 = String(文本 || '');
    if (!内容) return { 跳过: true };
    if (!状态.通道) return { 跳过: true };

    // 含中文等非 ASCII：走剪贴板 + 粘贴键，这是最可靠的方式
    if (/[^\x00-\x7F]/.test(内容)) {
      const 序号 = (状态.剪贴板序号 = (状态.剪贴板序号 || 0) + 1);
      状态.通道.设置剪贴板(内容, 序号);
      // 给手机一点时间把剪贴板内容收下，再触发粘贴
      await new Promise((解析) => setTimeout(解析, 200));
      取通道().按键(279); // KEYCODE_PASTE
      return { 已提交: true, 方式: '剪贴板粘贴', 长度: 内容.length };
    }

    // 纯 ASCII：直接键入
    取通道().输入文本(内容);
    return { 已提交: true, 方式: '直接键入', 长度: 内容.length };
  });

  /** 单个按键（英文、数字、符号），低延迟路径 */
  注册('输入法:按键', async ({ 键码, 修饰 = 0 }) => {
    if (!状态.通道) return { 跳过: true };
    取通道().按键(Number(键码) || 0, Number(修饰) || 0);
    return { ok: true };
  });
}

module.exports = { 注册输入法接口 };
