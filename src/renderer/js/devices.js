/**
 * 设备管理独立窗口的渲染逻辑。
 *
 * 分两个列表：在线设备、已保存的离线设备。
 * 每台设备带一个「操作」下拉：重命名 / 重连 / 删除 / 查看详情。
 * 顶部有「全部重连」。
 */
'use strict';

const $ = (id) => document.getElementById(id);

const 元素 = {
  在线列表: $('在线列表'),
  离线列表: $('离线列表'),
  在线数量: $('在线数量'),
  离线数量: $('离线数量'),
  统计: $('统计'),
  底部提示: $('底部提示'),
  全部重连: $('全部重连'),
  刷新: $('刷新'),
};

function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || 结果.message || '操作失败');
  return 结果 && 'data' in 结果 ? 结果.data : 结果;
}

function 提示(文字, 类型 = '') {
  元素.底部提示.textContent = 文字;
  元素.底部提示.className = '底部提示' + (类型 === '错误' ? ' 错误' : '');
}

/* ---------------- 加载 ---------------- */

let 在线们 = [];
let 历史们 = [];

async function 刷新() {
  try {
    const [设备列表, 历史] = await Promise.all([
      window.deck.设备.列表().then(取值).catch(() => []),
      window.deck.设备.历史().then(取值).catch(() => []),
    ]);

    在线们 = (设备列表 || []).filter((d) => d.state === 'device');
    历史们 = Array.isArray(历史) ? 历史 : [];

    // 离线 = 历史里有、但当前不在线的
    const 在线序列 = new Set(在线们.map((d) => d.serial));
    离线们 = 历史们.filter((h) => !在线序列.has(h.序列号));

    元素.在线数量.textContent = String(在线们.length);
    元素.离线数量.textContent = String(离线们.length);
    元素.统计.textContent = `共 ${在线们.length + 离线们.length} 台`;

    渲染在线();
    渲染离线();
    元素.全部重连.disabled = 离线们.length === 0;
  } catch (错误) {
    提示('读取设备失败：' + 错误.message, '错误');
  }
}

let 离线们 = [];

/* ---------------- 渲染 ---------------- */

function 造行(选项) {
  const { 名称, 副标题, 在线, 序列号 } = 选项;

  const 行 = document.createElement('div');
  行.className = '设备行' + (在线 ? ' 在线' : '');

  const 点 = document.createElement('span');
  点.className = '状态点';
  行.appendChild(点);

  const 主体 = document.createElement('div');
  主体.className = '设备主体';
  const 名 = document.createElement('div');
  名.className = '设备名';
  名.textContent = 名称;
  const 副 = document.createElement('div');
  副.className = '设备副';
  副.textContent = 副标题;
  主体.appendChild(名);
  主体.appendChild(副);
  行.appendChild(主体);

  const 操作 = document.createElement('div');
  操作.className = '行操作';

  // 在线设备：直接给「投屏」按钮（打开独立投屏窗口）
  if (在线) {
    const 投屏钮 = document.createElement('button');
    投屏钮.className = '小按钮 主';
    投屏钮.textContent = '投屏';
    投屏钮.addEventListener('click', async () => {
      try {
        await window.deck.设备.打开投屏窗口({ 序列号 });
        提示('已打开 ' + 名称 + ' 的投屏窗口');
      } catch (错误) {
        提示('打开投屏窗口失败：' + 错误.message, '错误');
      }
    });
    操作.appendChild(投屏钮);
  }

  // 每台设备都有「操作」下拉
  const 容器 = document.createElement('div');
  容器.className = '下拉容器';

  const 下拉钮 = document.createElement('button');
  下拉钮.className = '小按钮';
  下拉钮.textContent = '操作 ▾';
  容器.appendChild(下拉钮);

  const 菜单 = document.createElement('div');
  菜单.className = '下拉菜单';
  菜单.hidden = true;

  const 加项 = (文字, 处理, 危险) => {
    const 项 = document.createElement('div');
    项.className = '下拉项' + (危险 ? ' 危险' : '');
    项.textContent = 文字;
    项.addEventListener('click', async () => {
      菜单.hidden = true;
      try {
        await 处理();
      } catch (错误) {
        提示(错误.message, '错误');
      }
    });
    菜单.appendChild(项);
  };

  加项('重命名', () => 重命名设备(序列号, 名称));
  加项('重连', async () => {
    提示('正在连接 ' + 名称 + '…');
    await window.deck.设备.连接(序列号);
    提示(名称 + ' 已连接');
    await 刷新();
  });
  加项('查看详情', () => 查看详情(序列号));
  加项('删除记录', () => 删除设备(序列号, 名称), true);

  容器.appendChild(菜单);

  下拉钮.addEventListener('click', (事件) => {
    事件.stopPropagation();
    // 先全部收起，再切换自己
    document.querySelectorAll('.下拉菜单').forEach((m) => {
      if (m !== 菜单) m.hidden = true;
    });
    菜单.hidden = !菜单.hidden;
  });

  操作.appendChild(容器);
  行.appendChild(操作);

  return 行;
}

function 渲染在线() {
  元素.在线列表.replaceChildren();
  if (在线们.length === 0) {
    const 空 = document.createElement('div');
    空.className = '空态';
    空.textContent = '没有在线的设备，插上数据线或点下面的离线设备重连';
    元素.在线列表.appendChild(空);
    return;
  }

  for (const d of 在线们) {
    const 名 = d.市场名 || d.model || d.serial;
    元素.在线列表.appendChild(
      造行({
        名称: 名,
        副标题: [d.serial, d.连接方式文本 || 'USB'].filter(Boolean).join(' · '),
        在线: true,
        序列号: d.serial,
      }),
    );
  }
}

function 渲染离线() {
  元素.离线列表.replaceChildren();
  if (离线们.length === 0) {
    const 空 = document.createElement('div');
    空.className = '空态';
    空.textContent = '还没有保存过的设备记录';
    元素.离线列表.appendChild(空);
    return;
  }

  for (const h of 离线们) {
    const 名 = h.名称 || h.型号 || h.序列号;
    const 时间 = h.最后连接 ? new Date(h.最后连接).toLocaleString('zh-CN') : '';
    元素.离线列表.appendChild(
      造行({
        名称: 名,
        副标题: [h.序列号, 时间 ? '上次 ' + 时间 : ''].filter(Boolean).join(' · '),
        在线: false,
        序列号: h.序列号,
      }),
    );
  }
}

/* ---------------- 操作 ---------------- */

async function 重命名设备(序列号, 当前名) {
  // 用一个内嵌输入行代替 prompt（Electron 里 prompt 不可用）
  const 新名 = await 询问文字('重命名设备', '给这台设备起个名字', 当前名);
  if (新名 === null) return;
  await window.deck.设备.重命名(序列号, 新名);
  提示('已重命名为「' + 新名 + '」');
  await 刷新();
}

async function 删除设备(序列号, 名称) {
  const 确定 = await 确认('删除设备', '确定要删除「' + 名称 + '」的记录吗？删除后需要重新连接才会再出现。');
  if (!确定) return;
  await window.deck.设备.删除历史(序列号);
  提示('已删除「' + 名称 + '」');
  await 刷新();
}

async function 查看详情(序列号) {
  const 信息 = 取值(await window.deck.设备.详情(序列号));
  const 行们 = [
    ['名称', 信息.名称 || '—'],
    ['序列号', 信息.序列号 || '—'],
    ['状态', 信息.在线 ? '在线' : '离线'],
    ['品牌', 信息.品牌 || '—'],
    ['型号', 信息.型号 || '—'],
    ['系统', 信息.系统版本 ? 'Android ' + 信息.系统版本 : '—'],
    ['分辨率', 信息.分辨率 || '—'],
    ['电量', 信息.电量 != null ? 信息.电量 + '%' : '—'],
    ['上次连接', 信息.上次连接 ? new Date(信息.上次连接).toLocaleString('zh-CN') : '—'],
  ];

  const 内容 = document.createElement('div');
  内容.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:12.5px;';
  for (const [键, 值] of 行们) {
    const k = document.createElement('div');
    k.style.color = 'var(--字-弱)';
    k.textContent = 键;
    const v = document.createElement('div');
    v.textContent = String(值);
    内容.appendChild(k);
    内容.appendChild(v);
  }

  await 弹出面板('设备详情', 内容);
}

async function 全部重连() {
  元素.全部重连.disabled = true;
  let 成功 = 0;
  let 失败 = 0;
  for (const h of 离线们) {
    提示('正在重连 ' + (h.名称 || h.序列号) + '…');
    try {
      await window.deck.设备.连接(h.序列号);
      成功 += 1;
    } catch {
      失败 += 1;
    }
  }
  提示(`全部重连完成：成功 ${成功} 台${失败 ? '，失败 ' + 失败 + ' 台' : ''}`, 失败 ? '错误' : '');
  元素.全部重连.disabled = false;
  await 刷新();
}

/* ---------------- 内嵌对话框 ---------------- */

/**
 * 自己画一个轻量对话框。
 *
 * Electron 渲染进程里 window.prompt / confirm 是不可用的（会返回 null），
 * 所以这两个交互必须自己实现。
 */
function 弹出面板(标题, 内容节点, 按钮们 = [{ 文字: '关闭', 主: false, 值: null }]) {
  return new Promise((解析) => {
    const 遮罩 = document.createElement('div');
    遮罩.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:grid;place-items:center;';

    const 框 = document.createElement('div');
    框.style.cssText =
      'min-width:320px;max-width:80vw;max-height:80vh;overflow:auto;padding:18px;border-radius:12px;' +
      'background:var(--底-1);border:1px solid var(--线);box-shadow:0 20px 60px -20px rgba(0,0,0,0.85);';

    const 标题节点 = document.createElement('div');
    标题节点.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:14px;';
    标题节点.textContent = 标题;
    框.appendChild(标题节点);
    框.appendChild(内容节点);

    const 按钮行 = document.createElement('div');
    按钮行.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';

    for (const b of 按钮们) {
      const 钮 = document.createElement('button');
      钮.className = '按钮' + (b.主 ? ' 主' : '');
      钮.textContent = b.文字;
      钮.addEventListener('click', () => {
        遮罩.remove();
        解析(b.值);
      });
      按钮行.appendChild(钮);
    }
    框.appendChild(按钮行);
    遮罩.appendChild(框);
    document.body.appendChild(遮罩);
  });
}

async function 询问文字(标题, 说明, 默认值) {
  const 内容 = document.createElement('div');
  const 提示节点 = document.createElement('div');
  提示节点.style.cssText = 'font-size:11.5px;color:var(--字-弱);margin-bottom:8px;';
  提示节点.textContent = 说明;
  const 输入 = document.createElement('input');
  输入.type = 'text';
  输入.value = 默认值 || '';
  输入.style.cssText =
    'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--线);' +
    'background:var(--底-2);color:var(--字-主);font:inherit;outline:none;';
  内容.appendChild(提示节点);
  内容.appendChild(输入);

  // 回车直接确认
  const 结果 = await new Promise((解析) => {
    const 遮罩 = document.createElement('div');
    遮罩.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);display:grid;place-items:center;';
    const 框 = document.createElement('div');
    框.style.cssText =
      'min-width:320px;padding:18px;border-radius:12px;background:var(--底-1);border:1px solid var(--线);';
    const 标 = document.createElement('div');
    标.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:14px;';
    标.textContent = 标题;
    框.appendChild(标);
    框.appendChild(内容);

    const 行 = document.createElement('div');
    行.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';
    const 取消 = document.createElement('button');
    取消.className = '按钮';
    取消.textContent = '取消';
    取消.addEventListener('click', () => {
      遮罩.remove();
      解析(null);
    });
    const 确定 = document.createElement('button');
    确定.className = '按钮 主';
    确定.textContent = '确定';
    确定.addEventListener('click', () => {
      const 值 = 输入.value.trim();
      遮罩.remove();
      解析(值 || null);
    });
    行.appendChild(取消);
    行.appendChild(确定);
    框.appendChild(行);
    遮罩.appendChild(框);
    document.body.appendChild(遮罩);

    输入.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        确定.click();
      } else if (e.key === 'Escape') {
        遮罩.remove();
        解析(null);
      }
    });
    输入.focus();
    输入.select();
  });

  return 结果;
}

function 确认(标题, 说明) {
  const 内容 = document.createElement('div');
  内容.style.cssText = 'font-size:12.5px;color:var(--字-次);line-height:1.7;';
  内容.textContent = 说明;
  return 弹出面板(标题, 内容, [
    { 文字: '取消', 主: false, 值: false },
    { 文字: '确定', 主: true, 值: true },
  ]);
}

/* ---------------- 事件 ---------------- */

元素.刷新.addEventListener('click', 刷新);
元素.全部重连.addEventListener('click', () => 全部重连().catch((e) => 提示(e.message, '错误')));

// 点空白处收起所有下拉
document.addEventListener('click', () => {
  document.querySelectorAll('.下拉菜单').forEach((m) => {
    m.hidden = true;
  });
});

/* ---------------- 启动 ---------------- */

刷新();
setInterval(刷新, 3000);
