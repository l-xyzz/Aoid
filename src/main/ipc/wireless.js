/**
 * 无线连接相关 IPC。
 *
 * 之前 preload 里声明了 6 个无线接口，但主进程一个都没注册，
 * 用户点「配对」就报 `No handler registered for '无线:配对'`。
 * 这里把它们补齐，并统一走 注册() 包装（自动处理事件参数与错误结构）。
 */
'use strict';

const { 状态, 注册, 推送 } = require('../core/context');

function 注册无线接口() {
  /* 无线对象按需创建：adb 可能还没就绪，这里懒初始化 */
  const 取无线 = () => {
    if (!状态.adb) throw new Error('adb 还没有准备好');
    if (!状态.无线) {
      const { 无线连接 } = require('../wireless');
      状态.无线 = new 无线连接({ adbPath: 状态.adb.adbPath });
    }
    return 状态.无线;
  };

  注册('无线:配对', async ({ 地址, 配对码 }) => {
    if (!地址) throw new Error('请填写手机 IP 和端口');
    if (!配对码) throw new Error('请填写配对码');
    return 取无线().配对(String(地址), String(配对码));
  });

  注册('无线:连接', async ({ 地址 }) => {
    if (!地址) throw new Error('请填写手机 IP 和端口');
    const 结果 = await 取无线().连接(String(地址));
    // 连上之后把它记进历史，下次可以直接点
    try {
      const 设置 = 状态.设置.获取();
      const 列表 = Array.isArray(设置.无线设备) ? 设置.无线设备.slice() : [];
      const 已存在 = 列表.filter((项) => 项 !== 地址);
      已存在.unshift(String(地址));
      状态.设置.更新({ 无线设备: 已存在.slice(0, 10) });
    } catch {
      // 记历史失败不影响连接
    }
    return 结果;
  });

  注册('无线:断开', async ({ 地址 }) => {
    if (!地址) throw new Error('缺少地址');
    return 取无线().断开(String(地址));
  });

  /** 扫描局域网里的可连设备（会逐个试连，比较慢，界面要显示进度） */
  注册('无线:扫描', async () => {
    const 无线 = 取无线();
    const 找到 = [];
    const 结果 = await 无线.扫描局域网({
      超时: 300,
    });
    return 结果;
  });

  /** 把当前 USB 设备切换成无线模式 */
  注册('无线:转为无线', async () => {
    if (!状态.设备) throw new Error('请先用 USB 连接一台设备');
    const 结果 = await 取无线().转换为无线(状态.设备);
    推送('无线:已转换', 结果);
    return 结果;
  });

  /** 本机信息：当前 USB 设备的局域网地址 + 历史地址 */
  注册('无线:本机信息', async () => {
    const 设置 = 状态.设置.获取();
    const 历史 = Array.isArray(设置.无线设备) ? 设置.无线设备 : [];

    let 地址 = '';
    if (状态.设备 && 状态.服务) {
      try {
        // 取手机在 Wi-Fi 下的 IP，形如 192.168.1.8
        const 文本 = await 状态.服务.执行(状态.设备, 'ip route | grep wlan0', { timeout: 6000 });
        const 匹配 = /src\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(文本 || '');
        if (匹配) 地址 = 匹配[1] + ':5555';
      } catch {
        // 拿不到就留空
      }
    }

    return {
      可用: Boolean(状态.adb),
      地址,
      历史,
      序列号: 状态.设备 || '',
    };
  });
}

module.exports = { 注册无线接口 };
