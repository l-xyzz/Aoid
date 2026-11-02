/**
 * 「更多功能」窗口的前端逻辑。
 *
 * 四个页面：应用管理 / 进程管理 / 文件管理 / ADB 控制台。
 * 每个页面独立加载、独立刷新，切页时才按需拉数据，避免一打开就发一堆请求。
 */

/* ---------------- 全局错误捕获 ----------------
 * 工具窗口里任何未捕获的异常都显示在页面顶部，
 * 否则出问题时用户只看到"点不动"，开发者完全没线索。
 */
window.addEventListener('error', (事件) => {
  const 条 = document.createElement('div');
  条.style.cssText =
    'position:fixed;left:0;right:0;top:0;z-index:9999;background:#7a1c1c;color:#fff;' +
    'padding:8px 12px;font-size:12px;font-family:Consolas,monospace;white-space:pre-wrap;' +
    'border-bottom:2px solid #f26d6d;';
  条.textContent =
    '[启动错误] ' + 事件.message + '\n  ' + (事件.filename || '') + ':' + 事件.lineno;
  条.onclick = () => 条.remove();
  document.body.appendChild(条);
  console.error('[Aoid] 未捕获错误:', 事件.message, 事件.filename, 事件.lineno);
});

window.addEventListener('unhandledrejection', (事件) => {
  const 条 = document.createElement('div');
  条.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#7a4a1c;color:#fff;' +
    'padding:8px 12px;font-size:12px;font-family:Consolas,monospace;white-space:pre-wrap;' +
    'border-top:2px solid #f5a524;';
  条.textContent = '[未处理的 Promise] ' + (事件.reason?.message || 事件.reason);
  条.onclick = () => 条.remove();
  document.body.appendChild(条);
});

const $ = (id) => document.getElementById(id);

const 元素 = {
  页标题: $('页标题'),
  刷新页: $('刷新页'),
  菜单项: [...document.querySelectorAll('.工具菜单项')],
  体们: [...document.querySelectorAll('.工具体')],

  应用搜索: $('应用搜索'),
  安装apk: $('安装apk'),
  应用列表: $('应用列表'),

  进程搜索: $('进程搜索'),
  进程列表: $('进程列表'),

  手机路径: $('手机路径'),
  手机文件: $('手机文件'),
  手机上级: $('手机上级'),
  电脑路径: $('电脑路径'),
  电脑文件: $('电脑文件'),
  电脑上级: $('电脑上级'),
  连接状态: $('连接状态'),
  摄像头选择: $('摄像头选择'),
  摄像头尺寸: $('摄像头尺寸'),
  摄像头帧率: $('摄像头帧率'),
  使用麦克风: $('使用麦克风'),
  打开摄像头: $('打开摄像头'),
  关闭摄像头: $('关闭摄像头'),
  打开麦克风: $('打开麦克风'),
  关闭麦克风: $('关闭麦克风'),
  外设提示: $('外设提示'),

  控制台输出: $('控制台输出'),
  控制台输入: $('控制台输入'),
  补全框: $('补全框'),
};

/** 当前页 */
let 当前页 = '应用';
/** 各页数据缓存 */
const 数据 = {
  应用: [],
  进程: [],
  手机目录: '/sdcard',
  电脑目录: '',
};

/** 取值封装：主进程统一返回 { ok, data } 或 { ok:false, error } */
function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || 结果.message || '操作失败');
  return 结果 && 'data' in 结果 ? 结果.data : 结果;
}

function 提示(文字, 类型) {
  console.log(文字);
  // 外设页的提示显示到 外设提示 元素（没有该元素时静默跳过）
  if (元素.外设提示) {
    元素.外设提示.textContent = 文字;
    元素.外设提示.style.color = 类型 === '错误' ? 'var(--危险, #ff9aa2)' : '';
  }
}

/**
 * 拼接文件路径。
 *
 * 电脑（Windows）用反斜杠：C:\ + Users + LXY，盘根只保留一个反斜杠。
 * 手机（Android）用正斜杠：/sdcard + DCIM。
 *
 * 两边的分隔符不同，混用会得到 "C:\/welkin" 这种读不了的路径。
 */
function 拼接路径(来源, 当前目录, 名称) {
  if (来源 === '电脑') {
    // 防御：传了显示名「此电脑」当目录时忽略它，否则拼出「此电脑\\C:\\」会 ENOENT
    const 原文 = String(当前目录 || '');
    const 基 = (原文 === '此电脑' ? '' : 原文).replace(/[\\/]+$/, '');
    return 基 ? 基 + '\\' + 名称 : 名称;
  }
  const 基 = (当前目录 || '').replace(/\/+$/, '');
  return 基 ? 基 + '/' + 名称 : 名称;
}

/** 把字节数变成人看得懂的 */
function 大小(字节) {
  const 数 = Number(字节) || 0;
  if (数 < 1024) return 数 + ' B';
  if (数 < 1024 * 1024) return (数 / 1024).toFixed(0) + ' KB';
  if (数 < 1024 * 1024 * 1024) return (数 / 1024 / 1024).toFixed(1) + ' MB';
  return (数 / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/* ------------------------------------------------------------------ */
/* 页切换                                                              */
/* ------------------------------------------------------------------ */

function 切页(名) {
  当前页 = 名;
  元素.菜单项.forEach((项) => 项.classList.toggle('选中', 项.dataset.页 === 名));
  元素.体们.forEach((体) => {
    体.hidden = 体.dataset.体 !== 名;
  });
  元素.页标题.textContent =
    { 应用: '应用管理', 进程: '进程管理', 文件: '文件管理', 外设: '外设（摄像头 / 麦克风）', 控制台: 'ADB 控制台' }[名] || 名;

  if (名 === '应用' && 数据.应用.length === 0) 刷新应用();
  if (名 === '进程' && 数据.进程.length === 0) 刷新进程();
  if (名 === '文件' && !数据.电脑目录) 刷新文件();
  if (名 === '控制台') 元素.控制台输入.focus();
}

/* ------------------------------------------------------------------ */
/* 应用管理                                                            */
/* ------------------------------------------------------------------ */

async function 刷新应用() {
  元素.应用列表.replaceChildren();
  const 空 = document.createElement('div');
  空.className = '空提示';
  空.textContent = '正在读取应用列表…';
  元素.应用列表.appendChild(空);

  try {
    数据.应用 = 取值(await window.deck.工具.应用列表()) || [];
    渲染应用();
  } catch (错误) {
    空.textContent = '读取失败：' + 错误.message;
  }
}

function 渲染应用() {
  const 关键词 = 元素.应用搜索.value.trim().toLowerCase();
  /*
   * 搜索同时匹配应用名和包名：
   * 用户按「微信」能找到，按「tencent」也能找到。
   */
  const 过滤 = 数据.应用.filter(
    (项) =>
      !关键词 ||
      项.包名.toLowerCase().includes(关键词) ||
      String(项.名称 || '').toLowerCase().includes(关键词),
  );

  元素.应用列表.replaceChildren();
  if (过滤.length === 0) {
    const 空 = document.createElement('div');
    空.className = '空提示';
    空.textContent = 关键词 ? '没有匹配的应用' : '没有已安装的应用';
    元素.应用列表.appendChild(空);
    return;
  }

  for (const 项 of 过滤) {
    const 行 = document.createElement('div');
    行.className = '工具行';

    const 主 = document.createElement('span');
    主.className = '主文';
    /*
     * 优先显示应用名（微信、相册…），包名作为副标题。
     * 拿不到名称的应用（没有 LAUNCHER 入口的纯服务类）退化成显示包名，
     * 不留一个空白行。
     */
    if (项.名称) {
      主.textContent = 项.名称;
      主.title = 项.包名 + '\n' + 项.apk路径;
    } else {
      主.textContent = 项.包名;
      主.title = 项.apk路径;
    }

    if (项.系统) {
      const 标 = document.createElement('span');
      标.className = '次文';
      标.textContent = '系统';
      行.appendChild(标);
    }

    /*
     * 有应用名时补一行包名，方便确认是哪个应用
     * （同名应用不少，「相册」在不同厂商机器上包名完全不同）。
     */
    let 包名标 = null;
    if (项.名称) {
      包名标 = document.createElement('span');
      包名标.className = '次文';
      包名标.textContent = 项.包名;
      包名标.style.opacity = '0.55';
    }

    const 开 = document.createElement('button');
    开.className = '文字按钮';
    开.textContent = '打开';
    开.addEventListener('click', async () => {
      try {
        取值(await window.deck.工具.启动应用(项.包名));
        提示('已启动 ' + 项.包名);
      } catch (错误) {
        提示('启动失败：' + 错误.message);
      }
    });

    const 停 = document.createElement('button');
    停.className = '文字按钮';
    停.textContent = '停止';
    停.addEventListener('click', async () => {
      try {
        取值(await window.deck.工具.停止应用(项.包名));
        提示('已停止 ' + 项.包名);
      } catch (错误) {
        提示('停止失败：' + 错误.message);
      }
    });

    const 卸 = document.createElement('button');
    卸.className = '文字按钮';
    卸.textContent = '卸载';
    卸.addEventListener('click', async () => {
      if (!confirm('确定卸载 ' + 项.包名 + ' 吗？')) return;
      try {
        取值(await window.deck.工具.卸载应用(项.包名));
        提示('已卸载 ' + 项.包名);
        刷新应用();
      } catch (错误) {
        提示('卸载失败：' + 错误.message);
      }
    });

    // 主文（应用名）在最前，包名/系统标记跟在后面，最后是操作按钮
    if (包名标) 行.append(主, 包名标, 开, 停, 卸);
    else 行.append(主, 开, 停, 卸);
    元素.应用列表.appendChild(行);
  }
}

/** 安装 apk */
async function 安装apk() {
  try {
    const 本地路径 = 取值(await window.deck.工具.选择apk());
    if (!本地路径) return;
    提示('正在安装 ' + 本地路径 + ' …');
    const 结果 = 取值(await window.deck.工具.安装应用(本地路径));
    提示(结果.输出 || '安装完成');
    刷新应用();
  } catch (错误) {
    提示('安装失败：' + 错误.message);
  }
}

/* ------------------------------------------------------------------ */
/* 进程管理                                                            */
/* ------------------------------------------------------------------ */

async function 刷新进程() {
  元素.进程列表.replaceChildren();
  const 空 = document.createElement('div');
  空.className = '空提示';
  空.textContent = '正在读取进程…';
  元素.进程列表.appendChild(空);

  try {
    数据.进程 = 取值(await window.deck.工具.进程列表()) || [];
    渲染进程();
  } catch (错误) {
    空.textContent = '读取失败：' + 错误.message;
  }
}

function 渲染进程() {
  const 关键词 = 元素.进程搜索.value.trim().toLowerCase();
  const 过滤 = 数据.进程.filter((项) => !关键词 || 项.名称.toLowerCase().includes(关键词));

  元素.进程列表.replaceChildren();
  if (过滤.length === 0) {
    const 空 = document.createElement('div');
    空.className = '空提示';
    空.textContent = '没有匹配的进程';
    元素.进程列表.appendChild(空);
    return;
  }

  for (const 项 of 过滤) {
    const 行 = document.createElement('div');
    行.className = '工具行';

    const PID = document.createElement('span');
    PID.className = '次文';
    PID.textContent = 'PID ' + 项.PID;

    const 主 = document.createElement('span');
    主.className = '主文';
    主.textContent = 项.名称;

    const 内存 = document.createElement('span');
    内存.className = '次文';
    内存.textContent = 大小(项.内存KB * 1024);

    const 杀 = document.createElement('button');
    杀.className = '文字按钮';
    杀.textContent = '结束';
    杀.addEventListener('click', async () => {
      if (!confirm('结束进程 ' + 项.名称 + '（PID ' + 项.PID + '）？')) return;
      try {
        取值(await window.deck.工具.结束进程(项.PID));
        提示('已结束 ' + 项.名称);
        刷新进程();
      } catch (错误) {
        提示('结束失败：' + 错误.message);
      }
    });

    行.append(PID, 主, 内存, 杀);
    元素.进程列表.appendChild(行);
  }
}

/* ------------------------------------------------------------------ */
/* 文件管理                                                            */
/* ------------------------------------------------------------------ */

async function 刷新文件() {
  await Promise.all([读手机目录(数据.手机目录), 读电脑目录(数据.电脑目录)]);
}

async function 读手机目录(目录) {
  const 目标 = 目录 === undefined ? 数据.手机目录 : 目录;
  try {
    const 结果 = 取值(await window.deck.工具.手机目录(目标 || '/sdcard'));
    数据.手机目录 = 结果.目录;
    渲染文件栏('手机', 结果.条目 || [], 结果.目录);
    保存文件位置();
  } catch (错误) {
    提示('读取手机目录失败：' + 错误.message);
    const 容器 = document.getElementById('手机文件');
    if (容器) {
      容器.textContent = '';
      const 空 = document.createElement('div');
      空.className = '空提示';
      空.textContent = '读取失败：' + 错误.message;
      容器.appendChild(空);
    }
  }
}

/**
 * 读电脑目录。
 *
 * 传空字符串表示「回到盘符列表」——Windows 上光靠「上级」只能退到 C:\，
 * 没有入口切到 D:、E:，所以单独做了这一层。
 */
async function 读电脑目录(目录) {
  const 目标 = 目录 === undefined ? 数据.电脑目录 : 目录;

  // 空目录 = 盘符列表视图
  if (!目标) {
    try {
      const 盘们 = 取值(await window.deck.工具.盘符列表()) || [];
      数据.电脑目录 = '';
      数据.电脑父目录 = '';
      渲染文件栏(
        '电脑',
        盘们.map((盘) => ({ 名称: 盘.名称 + '\\', 是否目录: true, 字节: 0, 是盘: true, 盘路径: 盘.路径 })),
        // 这里必须传 ''（真实的"当前目录"是空），显示成「此电脑」由 渲染文件栏 负责。
        // 之前传的是 '此电脑'，点击盘符时 拼接路径('电脑', '此电脑', 'C:\')
        // 拼出「此电脑\C:\」，readdir 必然 ENOENT。
        '',
      );
      保存文件位置();
    } catch (错误) {
      提示('读取磁盘列表失败：' + 错误.message);
    }
    return;
  }

  try {
    const 结果 = 取值(await window.deck.工具.电脑目录(目标));
    数据.电脑目录 = 结果.目录;
    数据.电脑父目录 = 结果.父目录 || '';
    渲染文件栏('电脑', 结果.条目 || [], 结果.目录);
    保存文件位置();
  } catch (错误) {
    提示('读取失败：' + 错误.message);
    const 容器 = document.getElementById('电脑文件');
    if (容器) {
      容器.textContent = '';
      const 空 = document.createElement('div');
      空.className = '空提示';
      空.textContent = '读取失败：' + 错误.message;
      容器.appendChild(空);
    }
  }
}

/**
 * 保存当前两侧的位置。
 *
 * 防抖 400ms：用户在目录里连续点击时不至于每次都写盘。
 */
/* 文件剪贴板：记住"剪切/复制"的来源，粘贴时用 */
/*
 * 文件剪贴板。
 * 侧别（来源）决定用哪套接口：
 *   电脑 → 工具.电脑移动 / 电脑复制
 *   手机 → 工具.手机移动 / 手机复制
 * 跨侧的"粘贴"走上传/下载，由 粘贴到() 分流。
 */
let 剪贴板状态 = null; // { 侧别: '电脑' | '手机', 源, 名称, 是否目录, 模式: '剪切' | '复制' }

let 存位置定时 = null;
function 保存文件位置() {
  clearTimeout(存位置定时);
  存位置定时 = setTimeout(() => {
    window.deck.设置
      .保存({
        文件管理手机目录: 数据.手机目录,
        文件管理电脑目录: 数据.电脑目录,
      })
      .catch(() => {});
  }, 400);
}

/* ================= 文件管理（双栏 + 多选 + 传输队列） ================= */

/**
 * 每一栏的选择状态。
 *
 * 用 Set 存全路径，勾选就是增删，全选/反选都很快。
 * 两栏各自独立，互不影响。
 */
const 选择 = {
  手机: new Set(),
  电脑: new Set(),
};

/** 剪贴板：记住"复制/剪切"的来源，粘贴时按侧别分流 */

/** 取文件名（两侧通用） */
function 取文件名(路径) {
  return String(路径).split(/[\\/]/).pop() || 路径;
}

/** 取父目录（电脑） */
function 电脑父目录(目录) {
  const 去尾 = (目录 || '').replace(/[\\/]+$/, '');
  const 序 = Math.max(去尾.lastIndexOf('\\'), 去尾.lastIndexOf('/'));
  if (序 <= 0) return '';
  return 去尾.slice(0, 序);
}

/* ---------------- 传输队列 ---------------- */

const 传输记录 = [];

/** 往传输列表加一条，返回它的 DOM，调用方可后续更新状态 */
function 加传输项(名, 方向) {
  const 列表 = document.getElementById('传输列表');
  if (!列表) return null;

  const 行 = document.createElement('div');
  行.className = '传输项';

  const 名节点 = document.createElement('span');
  名节点.className = '名';
  名节点.textContent = (方向 === 'up' ? '↑ ' : '↓ ') + 名;

  const 态 = document.createElement('span');
  态.className = '态';
  态.textContent = '准备中…';

  行.append(名节点, 态);
  列表.appendChild(行);
  列表.scrollTop = 列表.scrollHeight;

  传输记录.push(行);
  // 只保留最近 50 条，免得越堆越多
  while (传输记录.length > 50) {
    const 老 = 传输记录.shift();
    老.remove();
  }
  return 态;
}

function 设置传输状态(态节点, 文字, 结果) {
  if (!态节点) return;
  态节点.textContent = 文字;
  态节点.className = '态' + (结果 ? ' ' + 结果 : '');
}

/* ---------------- 渲染一栏 ---------------- */

/**
 * 渲染文件栏。
 *
 * @param {string} 侧别 '手机' | '电脑'
 * @param {Array} 条目们 [{名称, 是否目录, 字节, ...}]
 * @param {string} 当前目录
 */
function 渲染文件栏(侧别, 条目们, 当前目录) {
  const 容器 = document.getElementById(侧别 === '手机' ? '手机文件' : '电脑文件');
  const 统计 = document.getElementById(侧别 === '手机' ? '手机统计' : '电脑统计');
  const 路径显示 = document.getElementById(侧别 === '手机' ? '手机路径' : '电脑路径');
  if (!容器) return;

  容器.textContent = '';
  if (路径显示) 路径显示.textContent = 当前目录 || (侧别 === '电脑' ? '此电脑' : '/sdcard');

  const 已选 = 选择[侧别];
  // 目录换了以后，原来选中的项可能已经不在当前目录，清掉
  for (const p of [...已选]) {
    if (!条目们.some((项) => 拼接路径(侧别, 当前目录, 项.名称) === p)) 已选.delete(p);
  }

  for (const 项 of 条目们) {
    const 全路径 = 拼接路径(侧别, 当前目录, 项.名称);

    const 行 = document.createElement('div');
    行.className = '文件行';
    if (已选.has(全路径)) 行.classList.add('已选');

    const 勾 = document.createElement('input');
    勾.type = 'checkbox';
    勾.checked = 已选.has(全路径);
    勾.addEventListener('click', (事件) => {
      事件.stopPropagation();
      if (勾.checked) 已选.add(全路径);
      else 已选.delete(全路径);
      行.classList.toggle('已选', 勾.checked);
      更新统计(侧别);
    });

    const 名字 = document.createElement('span');
    名字.className = '名字';
    名字.textContent = (项.是否目录 ? '📁 ' : '📄 ') + 项.名称;
    名字.title = 全路径;

    const 类型 = document.createElement('span');
    类型.className = '类型';
    类型.textContent = 项.是否目录 ? '文件夹' : 取扩展名(项.名称);

    const 尺寸 = document.createElement('span');
    尺寸.className = '尺寸';
    尺寸.textContent = 项.是否目录 ? '--' : 大小(项.字节);

    行.append(勾, 名字, 类型, 尺寸);

    // 双击：目录进下一层，文件用默认程序打开
    行.addEventListener('dblclick', () => {
      if (项.是否目录) {
        if (侧别 === '手机') 读手机目录(全路径);
        else 读电脑目录(项.盘路径 || 全路径);
      } else if (侧别 === '电脑') {
        window.deck.工具.电脑打开(全路径).catch(() => {});
      }
    });

    // 单击：切换勾选（比"先点再勾"顺手）
    行.addEventListener('click', () => {
      勾.checked = !勾.checked;
      if (勾.checked) 已选.add(全路径);
      else 已选.delete(全路径);
      行.classList.toggle('已选', 勾.checked);
      更新统计(侧别);
    });

    容器.appendChild(行);
  }

  if (条目们.length === 0) {
    const 空 = document.createElement('div');
    空.className = '空提示';
    空.textContent = '这个文件夹是空的';
    容器.appendChild(空);
  }

  更新统计(侧别);
}

function 取扩展名(名) {
  const 序 = 名.lastIndexOf('.');
  if (序 < 0) return '文件';
  const 扩展 = 名.slice(序 + 1).toLowerCase();
  const 表 = {
    mp4: '视频', mkv: '视频', avi: '视频', mov: '视频',
    png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', webp: '图片',
    mp3: '音频', wav: '音频', flac: '音频', m4a: '音频', ogg: '音频',
    apk: '安装包', zip: '压缩包', rar: '压缩包', '7z': '压缩包',
    txt: '文本', md: '文本', json: '配置', log: '日志',
    exe: '程序', dll: '程序', js: '脚本', py: '脚本', bat: '脚本',
  };
  return 表[扩展] || 扩展.toUpperCase().slice(0, 5);
}

function 更新统计(侧别) {
  const 统计 = document.getElementById(侧别 === '手机' ? '手机统计' : '电脑统计');
  if (!统计) return;
  const 数 = 选择[侧别].size;
  const 总 = document.getElementById(侧别 === '手机' ? '手机文件' : '电脑文件')?.children.length || 0;
  统计.textContent = 数 > 0 ? '已选 ' + 数 + ' 项 / 共 ' + 总 + ' 项' : '共 ' + 总 + ' 项';
}

/**
 * 粘贴到指定目录。
 *
 * 同侧：直接调设备自己的移动/复制。
 * 跨侧：电脑→手机走上传，手机→电脑走下载（左右互通的关键）。
 */
async function 粘贴到(目标目录, 目标侧别) {
  if (!剪贴板状态) {
    提示('剪贴板是空的，先复制或剪切文件');
    return;
  }

  const { 侧别: 源侧, 源们, 模式 } = 剪贴板状态;
  if (!Array.isArray(源们) || 源们.length === 0) {
    提示('剪贴板是空的');
    return;
  }

  let 成功 = 0;

  for (const 源 of 源们) {
    const 名 = 取文件名(源);
    try {
      if (源侧 === 目标侧别) {
        // ---- 同侧 ----
        if (目标侧别 === '手机') {
          if (模式 === '剪切') await window.deck.工具.手机移动(源, 目标目录);
          else await window.deck.工具.手机复制(源, 目标目录);
        } else {
          if (模式 === '剪切') await window.deck.工具.电脑移动(源, 目标目录);
          else await window.deck.工具.电脑复制(源, 目标目录);
        }
      } else if (源侧 === '电脑' && 目标侧别 === '手机') {
        // ---- 电脑 → 手机：上传 ----
        const 设备路径 = 目标目录.replace(/\/+$/, '') + '/' + 名;
        const 态 = 加传输项(名, 'up');
        await window.deck.工具.上传文件(源, 设备路径);
        设置传输状态(态, '完成', '成功');
      } else {
        // ---- 手机 → 电脑：下载 ----
        const 本地路径 = 目标目录.replace(/[\\/]+$/, '') + '\\' + 名;
        const 态 = 加传输项(名, 'down');
        await window.deck.工具.下载文件(源, 本地路径);
        设置传输状态(态, '完成', '成功');
      }
      成功 += 1;
    } catch (错误) {
      提示('「' + 名 + '」失败：' + 错误.message);
    }
  }

  if (成功 > 0) {
    if (模式 === '剪切') 剪贴板状态 = null;
    选择[目标侧别]?.clear();
    if (目标侧别 === '手机') 读手机目录(数据.手机目录);
    else 读电脑目录(数据.电脑目录);
    提示('粘贴完成，成功 ' + 成功 + ' / ' + 源们.length);
  }
}

/** 全选 / 取消全选 */
function 切换全选(侧别) {
  const 容器 = document.getElementById(侧别 === '手机' ? '手机文件' : '电脑文件');
  if (!容器) return;
  const 勾们 = [...容器.querySelectorAll('.文件行')];
  const 已全选 = 勾们.length > 0 && 勾们.every((行) => 行.querySelector('input').checked);

  勾们.forEach((行) => {
    const 勾 = 行.querySelector('input');
    勾.checked = !已全选;
    行.classList.toggle('已选', !已全选);
  });

  选择[侧别].clear();
  if (!已全选) {
    const 当前目录 = 侧别 === '手机' ? 数据.手机目录 : 数据.电脑目录;
    for (const 行 of 勾们) {
      const 名 = 行.querySelector('.名字').title;
      选择[侧别].add(名);
    }
  }
  更新统计(侧别);
}

/* ---------------- 各种操作 ---------------- */

/** 复制 / 剪切 */
function 设剪贴(侧别, 模式) {
  const 源们 = [...选择[侧别]];
  if (源们.length === 0) {
    提示('先勾选要' + (模式 === '复制' ? '复制' : '剪切') + '的文件');
    return;
  }
  剪贴板状态 = { 侧别, 源们, 模式 };
  提示('已' + 模式 + ' ' + 源们.length + ' 项，切到目标文件夹点「粘贴」');
}

/** 粘贴到本栏的当前目录 */
async function 粘贴(侧别) {
  if (!剪贴板状态) {
    提示('剪贴板是空的，先复制或剪切文件');
    return;
  }

  const 目标目录 = 侧别 === '手机' ? 数据.手机目录 : 数据.电脑目录;
  if (!目标目录) {
    提示(侧别 === '电脑' ? '请先进入一个磁盘' : '手机目录还没加载好');
    return;
  }

  const { 侧别: 源侧, 源们, 模式 } = 剪贴板状态;
  let 成功 = 0;

  for (const 源 of 源们) {
    const 名 = 取文件名(源);
    try {
      if (源侧 === 侧别) {
        // 同侧
        if (侧别 === '手机') {
          if (模式 === '剪切') await window.deck.工具.手机移动(源, 目标目录);
          else await window.deck.工具.手机复制(源, 目标目录);
        } else {
          if (模式 === '剪切') await window.deck.工具.电脑移动(源, 目标目录);
          else await window.deck.工具.电脑复制(源, 目标目录);
        }
      } else if (源侧 === '电脑' && 侧别 === '手机') {
        const 设备路径 = 目标目录.replace(/\/+$/, '') + '/' + 名;
        const 态 = 加传输项(名, 'up');
        await window.deck.工具.上传文件(源, 设备路径);
        设置传输状态(态, '完成', '成功');
      } else {
        const 本地路径 = 目标目录.replace(/[\\/]+$/, '') + '\\' + 名;
        const 态 = 加传输项(名, 'down');
        await window.deck.工具.下载文件(源, 本地路径);
        设置传输状态(态, '完成', '成功');
      }
      成功 += 1;
    } catch (错误) {
      const 态 = 加传输项(名, 源侧 === '电脑' ? 'up' : 'down');
      设置传输状态(态, '失败', '失败');
      提示('「' + 名 + '」失败：' + 错误.message);
    }
  }

  if (成功 > 0) {
    if (模式 === '剪切') 剪贴板状态 = null;
    选择[侧别].clear();
    if (侧别 === '手机') 读手机目录(数据.手机目录);
    else 读电脑目录(数据.电脑目录);
    提示('粘贴完成，成功 ' + 成功 + ' / ' + 源们.length);
  }
}

/** 重命名（只支持单选） */
async function 重命名(侧别) {
  const 源们 = [...选择[侧别]];
  if (源们.length !== 1) {
    提示('重命名只能选一个文件');
    return;
  }
  const 源 = 源们[0];
  const 原名 = 取文件名(源);
  const 新名 = prompt('新名称：', 原名);
  if (新名 === null || 新名.trim() === '' || 新名 === 原名) return;

  try {
    if (侧别 === '手机') await window.deck.工具.手机重命名(源, 新名.trim());
    else await window.deck.工具.电脑重命名(源, 新名.trim());
    选择[侧别].clear();
    if (侧别 === '手机') 读手机目录(数据.手机目录);
    else 读电脑目录(数据.电脑目录);
  } catch (错误) {
    提示('重命名失败：' + 错误.message);
  }
}

/** 删除选中项 */
async function 删除选中(侧别) {
  const 源们 = [...选择[侧别]];
  if (源们.length === 0) {
    提示('先勾选要删除的文件');
    return;
  }
  if (!confirm('确定删除选中的 ' + 源们.length + ' 项？'))

  {
    return;
  }

  let 成功 = 0;
  for (const 源 of 源们) {
    try {
      if (侧别 === '手机') {
        // 目录删除需要知道类型，从当前列表里找
        const 容器 = document.getElementById('手机文件');
        const 行 = [...容器.querySelectorAll('.文件行')].find(
          (r) => r.querySelector('.名字').title === 源,
        );
        const 是目录 = 行?.querySelector('.类型')?.textContent === '文件夹';
        await window.deck.工具.手机删除(源, !!是目录);
      } else {
        await window.deck.工具.电脑删除?.(源);
      }
      成功 += 1;
    } catch (错误) {
      提示('删除「' + 取文件名(源) + '」失败：' + 错误.message);
    }
  }

  选择[侧别].clear();
  if (侧别 === '手机') 读手机目录(数据.手机目录);
  else 读电脑目录(数据.电脑目录);
  if (成功) 提示('已删除 ' + 成功 + ' 项');
}

/** 一键发送到对面 */
async function 发送到对面(从) {
  const 源们 = [...选择[从]];
  if (源们.length === 0) {
    提示('先勾选要发送的文件');
    return;
  }
  剪贴板状态 = { 侧别: 从, 源们, 模式: '复制' };
  await 粘贴(从 === '手机' ? '电脑' : '手机');
}



/* ---------------- ADB 控制台（补全 + 执行） ---------------- */

/*
 * 这一段是整体重写的。
 *
 * 之前这里同时存在两套重复的补全实现（历史改动叠加导致），
 * 「取候选」声明了两次、结构还各自假设不同的补全表格式，
 * 结果 Tab 补全时有时无、报 undefined。
 *
 * 现在只保留一套，且明确约定：
 *   补全表 = { 命令: [], 常用: [], 路径: [] }（主进程 工具:补全表 返回）
 *   候选来源 = 命令 + 常用 + 路径，全部转成字符串后按前缀过滤
 */

/** 补全表：主进程 工具:补全表 返回的三个分组 */
let 补全表 = { 命令: [], 常用: [], 路径: [] };

/** 当前候选列表 */
let 补全候选 = [];
/** 当前选中项的索引 */
let 补全选中 = 0;

/**
 * 把补全表摊平成字符串数组。
 *
 * 三个分组都是字符串数组，直接拼起来即可。
 * 加一层去重和空值过滤，防止主进程返回脏数据时整段崩掉。
 */
function 摊平补全表(表) {
   const 源 = 表 && typeof 表 === 'object' ? 表 : {};
   const 结果 = [];
   const 见过 = new Set();

   for (const 分组 of [源.命令, 源.常用, 源.路径]) {
     if (!Array.isArray(分组)) continue;
     for (const 项 of 分组) {
       if (typeof 项 !== 'string') continue;
       const 文字 = 项.trim();
       if (!文字 || 见过.has(文字)) continue;
       见过.add(文字);
       结果.push(文字);
     }
   }

   return 结果;
}

/**
 * 取候选。
 *
 * 前缀匹配规则：
 *   - 正在输入的部分为空 → 返回全部（方便先看有什么）
 *   - 否则以该前缀开头的才匹配
 *
 * 命令类（不含空格）排在前面，带空格的常用命令排后面，
 * 这样用户敲 "wm" 时先看到 "wm"，而不是一堆 "wm size"。
 *
 * @param {string} 前缀
 * @returns {string[]}
 */
function 取候选(前缀) {
   const 词 = String(前缀 || '').trim();
   const 全部 = 摊平补全表(补全表);

   const 匹配 = 全部.filter((文字) => !词 || 文字.toLowerCase().startsWith(词.toLowerCase()));

   // 不含空格的（纯命令）优先
   匹配.sort((a, b) => {
     const a空 = a.includes(' ');
     const b空 = b.includes(' ');
     if (a空 !== b空) return a空 ? 1 : -1;
     return a.localeCompare(b);
   });

   return 匹配.slice(0, 30);
}

/**
 * 直接把候选填进输入框（只有一个候选时）。
 *
 * 保留命令前面已输入的部分，只替换最后一段。
 */
function 应用补全(候选) {
   if (!候选) return;
   const 值 = 元素.控制台输入.value;
   const 位置 = 值.lastIndexOf(' ');
   const 前缀 = 位置 >= 0 ? 值.slice(0, 位置 + 1) : '';
   元素.控制台输入.value = 前缀 + 候选 + ' ';
   const 尾 = 元素.控制台输入.value.length;
   元素.控制台输入.selectionStart = 尾;
   元素.控制台输入.selectionEnd = 尾;
   隐藏补全();
}

/** 隐藏候选框 */
function 隐藏补全() {
   补全候选 = [];
   补全选中 = 0;
   if (元素.补全框) {
     元素.补全框.hidden = true;
     元素.补全框.replaceChildren();
   }
}

/**
 * 显示候选框。
 *
 * 候选为空时直接隐藏，不留一个空框在屏幕上。
 */
function 显示补全(候选们, 输入框) {
   const 列表 = Array.isArray(候选们) ? 候选们 : [];
   if (列表.length === 0) {
     隐藏补全();
     return;
   }

   补全候选 = 列表;
   补全选中 = 0;

   /*
    * 定位补全框到输入框正下方。
    *
    * 之前 .补全框 是 position:fixed 但没设 left/top，
    * 而它的 HTML 在页面最末尾，所以一直显示在页面底部看不见的地方，
    * 用户误以为 Tab 补全没反应。这里按输入框位置实时定位。
    */
   const 矩形 = 输入框.getBoundingClientRect();
   元素.补全框.style.left = Math.round(矩形.left) + 'px';
   元素.补全框.style.width = Math.max(220, Math.round(矩形.width)) + 'px';

   /*
    * 定位方向：输入框在窗口底部时，下方空间不足，
    * 补全框会弹到视口外看不见。这里先按下方定位，
    * 等渲染出高度后，如果超界就翻到输入框上方。
    */
   元素.补全框.style.top = Math.round(矩形.bottom + 4) + 'px';
   // 先移除可能影响测量的限制，稍后重新判断
   const 框高上限 = 240;
   元素.补全框.style.maxHeight = 框高上限 + 'px';

   元素.补全框.replaceChildren();
   for (let i = 0; i < 列表.length; i += 1) {
     const 项 = document.createElement('div');
     项.className = '补全项' + (i === 0 ? ' 选中' : '');
     项.textContent = 列表[i];
     // 用 mousedown 而不是 click：click 会先触发输入框的 blur，导致选中丢失
     项.addEventListener('mousedown', (事件) => {
       事件.preventDefault();
       应用补全(列表[i]);
       if (输入框) 输入框.focus();
     });
     元素.补全框.appendChild(项);
   }

   // 先显示（hidden=false）才能测到真实高度
   元素.补全框.hidden = false;

   // 若下方放不下，翻到输入框上方
   const 框矩形 = 元素.补全框.getBoundingClientRect();
   if (框矩形.bottom > window.innerHeight && 矩形.top - 框矩形.height > 0) {
     元素.补全框.style.top = Math.round(矩形.top - 框矩形.height - 4) + 'px';
   }
}

/** 在候选里上下移动 */
function 移动补全(方向) {
   if (补全候选.length === 0) return;
   const 项们 = [...元素.补全框.querySelectorAll('.补全项')];
   if (项们.length === 0) return;
   补全选中 = (补全选中 + 方向 + 项们.length) % 项们.length;
   项们.forEach((el, i) => el.classList.toggle('选中', i === 补全选中));
   项们[补全选中]?.scrollIntoView({ block: 'nearest' });
}

/** 取当前高亮的候选 */
function 当前补全() {
   return 补全候选[补全选中] || null;
}

/* ---------------- 控制台执行 ---------------- */

/** 命令历史 */
const 历史 = [];
/** 当前浏览到的历史位置，-1 = 末尾 */
let 历史位置 = -1;

/** 往控制台追加一行纯文本 */
function 输出文字(文字, 类名) {
   const 行 = document.createElement('div');
   if (类名) 行.className = 类名;
   行.textContent = 文字;
   元素.控制台输出.appendChild(行);
   元素.控制台输出.scrollTop = 元素.控制台输出.scrollHeight;
}

/** 往控制台追加一段 HTML（用于带高亮的回显） */
function 输出HTML(html) {
   const 行 = document.createElement('div');
   行.innerHTML = html;
   元素.控制台输出.appendChild(行);
   元素.控制台输出.scrollTop = 元素.控制台输出.scrollHeight;
}

/** 简易语法高亮 */
function 高亮(命令) {
   const 词们 = String(命令).split(/\s+/).filter(Boolean);
   return 词们
     .map((词, 序) => {
       let 类 = '';
       if (序 === 0) 类 = '高亮-命令';
       else if (/^['"]/.test(词)) 类 = '高亮-字符串';
       else if (/^-/.test(词)) 类 = '高亮-参数';
       else if (/^\//.test(词)) 类 = '高亮-路径';
       const 转 = String(词).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
       return 类 ? '<span class="' + 类 + '">' + 转 + '</span>' : 转;
     })
     .join(' ');
}

/** 执行命令 */
async function 执行命令() {
   const 命令 = 元素.控制台输入.value.trim();
   if (!命令) return;

   if (历史[历史.length - 1] !== 命令) 历史.push(命令);
   if (历史.length > 100) 历史.shift();
   历史位置 = -1;

   元素.控制台输入.value = '';
   隐藏补全();

   输出HTML('<span class="高亮-提示">$</span> ' + 高亮(命令));

   try {
     const 结果 = 取值(await window.deck.工具.执行命令(命令));
     const 文本 = (结果 && (结果.输出 || 结果.stdout)) || '';
     if (文本) 输出文字(String(文本).replace(/\s+$/, ''));
     if (结果 && 结果.退出码 && 结果.退出码 !== 0) {
       输出文字('[退出码 ' + 结果.退出码 + ']', '高亮-错误');
     }
   } catch (错误) {
     输出文字('执行失败：' + 错误.message, '高亮-错误');
   }
}

/**
 * 拉取补全表。
 *
 * 单独一个函数，启动时调一次；拿不到就用空的，不影响执行命令。
 */
async function 加载补全表() {
   try {
     const 表 = 取值(await window.deck.工具.补全表());
     if (表 && typeof 表 === 'object') 补全表 = 表;
     console.log('[Aoid] 补全表已加载，共 ' + 摊平补全表(补全表).length + ' 条');
   } catch (错误) {
     console.warn('[Aoid] 补全表加载失败:', 错误.message);
   }
}

/* ---------------- 外设（摄像头 / 麦克风，原独立窗口并入） ---------------- */

let 摄像头运行中 = false;
let 麦克风运行中 = false;
let 麦克风音频 = null;

function 更新外设按钮态() {
  元素.打开摄像头.disabled = 摄像头运行中;
  元素.关闭摄像头.disabled = !摄像头运行中;
  元素.打开摄像头.textContent = 摄像头运行中 ? '摄像头运行中…' : '打开摄像头预览';

  元素.打开麦克风.disabled = 麦克风运行中;
  元素.关闭麦克风.disabled = !麦克风运行中;
  元素.打开麦克风.textContent = 麦克风运行中 ? '麦克风使用中…' : '开始使用手机麦克风';
}

async function 加载摄像头列表() {
  try {
    const 数据 = 取值(await window.deck.更多.摄像头列表());
    if (!数据.可用) { 提示('缺少 scrcpy 运行组件，摄像头功能不可用', '错误'); return; }
    元素.摄像头选择.replaceChildren();
    if (!数据.列表.length) { 提示('这台手机没有可用的摄像头', '错误'); return; }
    for (const 项 of 数据.列表) {
      const 选项 = document.createElement('option');
      选项.value = 项.id;
      选项.textContent = `#${项.id} ${项.朝向} · ${项.尺寸}`;
      元素.摄像头选择.appendChild(选项);
    }
    提示(`已找到 ${数据.列表.length} 个摄像头`);
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

async function 刷新外设连接状态() {
  try {
    const 设备 = 取值(await window.deck.设备.列表());
    const 已连 = 设备.some((d) => d.state === 'device');
    元素.连接状态.textContent = 已连 ? '设备已连接' : '未连接设备';
    if (已连 && 元素.摄像头选择.options.length <= 1) await 加载摄像头列表();
  } catch {}
}

async function 找虚拟声卡设备id() {
  try {
    const 设备 = await navigator.mediaDevices.enumerateDevices();
    const 目标 = 设备.find((d) => d.kind === 'audiooutput' && /CABLE Input/i.test(d.label || ''));
    return 目标 ? 目标.deviceId : '';
  } catch {
    return '';
  }
}

async function 启动麦克风播放(文件, 播放端) {
  停止麦克风播放();
  const 设备id = await 找虚拟声卡设备id();
  const 目标 = 设备id || 播放端;
  麦克风音频 = new Audio();
  麦克风音频.src = 'file:///' + 文件.replace(/\\/g, '/') + '?t=' + Date.now();
  麦克风音频.loop = true;
  麦克风音频.volume = 1;
  try {
    await 麦克风音频.setSinkId(目标);
  } catch (错误) {
    提示('无法把声音送到虚拟声卡：' + 错误.message, '错误');
    麦克风音频 = null;
    return false;
  }
  try {
    await 麦克风音频.play();
  } catch (错误) {
    提示('播放失败：' + 错误.message, '错误');
    return false;
  }
  return true;
}

function 停止麦克风播放() {
  if (!麦克风音频) return;
  try { 麦克风音频.pause(); 麦克风音频.src = ''; } catch {}
  麦克风音频 = null;
}

function 绑定外设() {
  if (!元素.打开摄像头) return;

  元素.打开摄像头.addEventListener('click', async () => {
    const 摄像头id = 元素.摄像头选择.value;
    if (!摄像头id) return 提示('还没有可用的摄像头', '错误');
    元素.打开摄像头.disabled = true;
    try {
      取值(await window.deck.更多.打开摄像头({ 摄像头id, 尺寸: 元素.摄像头尺寸.value, 帧率: Number(元素.摄像头帧率.value), 要麦克风: 元素.使用麦克风.checked }));
      摄像头运行中 = true;
      更新外设按钮态();
      提示('摄像头已打开，请看弹出的预览小窗');
    } catch (错误) {
      提示(错误.message, '错误');
      元素.打开摄像头.disabled = false;
    }
  });

  元素.关闭摄像头.addEventListener('click', async () => {
    try {
      取值(await window.deck.更多.关闭摄像头());
      摄像头运行中 = false;
      更新外设按钮态();
      提示('摄像头已停止');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  元素.打开麦克风.addEventListener('click', async () => {
    元素.打开麦克风.disabled = true;
    try {
      const 数据 = 取值(await window.deck.更多.打开麦克风());
      await 启动麦克风播放(数据.文件, 数据.播放端);
      麦克风运行中 = true;
      更新外设按钮态();
      提示('手机麦克风已接入电脑');
    } catch (错误) {
      提示(错误.message, '错误');
      元素.打开麦克风.disabled = false;
    }
  });

  元素.关闭麦克风.addEventListener('click', async () => {
    try {
      取值(await window.deck.更多.关闭麦克风());
      停止麦克风播放();
      麦克风运行中 = false;
      更新外设按钮态();
      提示('手机麦克风已停止');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });
}

async function 初始化外设() {
  if (!元素.打开摄像头) return;
  更新外设按钮态();
  await 刷新外设连接状态();
  setInterval(刷新外设连接状态, 2000);

  // 摄像头/麦克风进程意外退出时，把按钮状态同步回来
  setInterval(async () => {
    try {
      const 状态 = 取值(await window.deck.更多.状态());
      if (摄像头运行中 && !状态.摄像头运行中) { 摄像头运行中 = false; 更新外设按钮态(); 提示('摄像头已停止'); }
      if (麦克风运行中 && !状态.麦克风运行中) { 麦克风运行中 = false; 更新外设按钮态(); 提示('手机麦克风已停止'); }
    } catch {}
  }, 2000);
}

function 绑定控制台() {
  元素.控制台输入.addEventListener('keydown', (事件) => {
    // 回车执行
    if (事件.key === 'Enter' && !事件.shiftKey) {
      事件.preventDefault();
      元素.补全框.hidden = true;
      执行命令();
      return;
    }

    // Tab 补全
    if (事件.key === 'Tab') {
      事件.preventDefault();
      const 候选 = 取候选(元素.控制台输入.value.trim().split(/\s+/).pop() || '');
      if (候选.length === 1) 应用补全(候选[0]);
      else 显示补全(候选, 元素.控制台输入);
      return;
    }

    // 上下翻历史
    if (事件.key === 'ArrowUp') {
      事件.preventDefault();
      if (历史.length === 0) return;
      if (历史位置 < 0) 历史位置 = 历史.length - 1;
      else if (历史位置 > 0) 历史位置 -= 1;
      元素.控制台输入.value = 历史[历史位置] || '';
      元素.控制台输入.selectionStart = 元素.控制台输入.selectionEnd = 元素.控制台输入.value.length;
      return;
    }
    if (事件.key === 'ArrowDown') {
      事件.preventDefault();
      if (历史位置 < 0) return;
      历史位置 += 1;
      if (历史位置 >= 历史.length) {
        历史位置 = -1;
        元素.控制台输入.value = '';
        return;
      }
      元素.控制台输入.value = 历史[历史位置] || '';
      元素.控制台输入.selectionStart = 元素.控制台输入.selectionEnd = 元素.控制台输入.value.length;
      return;
    }

    // Ctrl+L 清屏
    if (事件.key.toLowerCase() === 'l' && 事件.ctrlKey) {
      事件.preventDefault();
      元素.控制台输出.replaceChildren();
      return;
    }

    // Ctrl+C 清空当前行
    if (事件.key.toLowerCase() === 'c' && 事件.ctrlKey && !事件.shiftKey) {
      const 有选中 = 元素.控制台输入.selectionStart !== 元素.控制台输入.selectionEnd;
      if (!有选中) {
        事件.preventDefault();
        元素.控制台输入.value = '';
        输出('^C', '高亮-提示');
      }
      return;
    }

    // Esc 收起补全
    if (事件.key === 'Escape') {
      元素.补全框.hidden = true;
      return;
    }

    // 输入时收起补全框
    if (事件.key.length === 1) 元素.补全框.hidden = true;
  });
}

/* ------------------------------------------------------------------ */
/* 绑定                                                                */
/* ------------------------------------------------------------------ */

function 绑定() {
  /*
   * 这里每一步都可能因为元素缺失或数据没初始化而抛错。
   * 之前 数据.电脑父目录 是 undefined，读到 .replace 就抛，
   * 导致后面所有绑定都没执行，整个窗口点不动。
   * 现在每一步单独 try/catch，坏一个不影响其它的。
   */
  const 试 = (说明, 做) => {
    try {
      做();
    } catch (错误) {
      console.error('[Aoid] 绑定「' + 说明 + '」失败:', 错误);
    }
  };

  试('菜单', () => {
    元素.菜单项.forEach((项) => {
      项.addEventListener('click', () => 切页(项.dataset.页));
    });
  });

  试('刷新', () => {
    元素.刷新页.addEventListener('click', () => {
      if (当前页 === '应用') 刷新应用();
      else if (当前页 === '进程') 刷新进程();
      else if (当前页 === '文件') 刷新文件();
      else 提示('控制台不用刷新');
    });
  });

  试('应用页', () => {
    元素.应用搜索.addEventListener('input', 渲染应用);
    元素.安装apk.addEventListener('click', 安装apk);
  });

  试('进程页', () => {
    元素.进程搜索.addEventListener('input', 渲染进程);
  });

  试('外设', () => 绑定外设());

  // 手机/电脑的「上级」按钮统一交给 绑定文件栏按钮() 处理，这里不再重复绑定

  /* 控制台 */
  试('控制台', () => 绑定控制台());

  // 点别处收起补全框
  document.addEventListener('pointerdown', (事件) => {
    if (!元素.补全框.contains(事件.target) && 事件.target !== 元素.控制台输入) {
      元素.补全框.hidden = true;
    }
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function 启动() {
  绑定();
  初始化外设();
  // 文件栏那堆按钮和别处的绑定分开，出错也不影响主流程
  try {
    绑定文件栏按钮();
  } catch (错误) {
    console.error('[Aoid] 文件栏按钮绑定失败:', 错误);
  }

  try {
    元素.控制台输出.appendChild(
      (() => {
        const 行 = document.createElement('div');
        行.className = '高亮-提示';
        行.textContent = 'Aoid ADB 控制台 —— 输入 adb shell 命令，Tab 补全，↑↓ 暂不支持历史';
        return 行;
      })(),
    );
  } catch (错误) {
    console.error('[Aoid] 控制台欢迎语失败:', 错误);
  }

  // 拉补全表
  try {
    补全表 = 取值(await window.deck.工具.补全表()) || 补全表;
  } catch {
    // 拿不到就用空表，不影响执行
  }

  /*
   * 恢复上次停留的位置。
   * 用户关掉窗口或应用后再打开，应该停在原来的目录，而不是每次回到 /sdcard 和「我的文档」。
   */
  try {
    const 设置 = 取值(await window.deck.设置.读取()) || {};
    if (设置.文件管理手机目录) 数据.手机目录 = 设置.文件管理手机目录;
    if (设置.文件管理电脑目录) 数据.电脑目录 = 设置.文件管理电脑目录;
  } catch {
    // 读不到就用默认值
  }

  // 无论如何都要切到首页，否则界面一片空白
  try {
    切页('应用');
  } catch (错误) {
    console.error('[Aoid] 切页失败:', 错误);
  }
}

/**
 * 启动自检。
 *
 * 页面加载后立刻检查关键函数是否存在 —— 缺函数时在顶部显示红条。
 * 之前每次「点了没反应」都要等用户点到具体按钮才暴露，
 * 而且错误位置看不出来，所以加这个主动检查。
 */
function 自检() {
  /*
   * 注意：不能用 eval(名) 检查。
   *
   * tools.js 是 type="module"，eval 在模块作用域里执行，
   * 看不到模块内部声明的函数/变量，所以会全部报"缺失"（踩过）。
   * 这里改成直接引用 —— 函数不存在会抛 ReferenceError，
   * 用 try/catch 兜住就能准确判断。
   */
  const 检查表 = {
    摊平补全表, 取候选, 应用补全, 显示补全, 移动补全, 当前补全,
    输出文字, 输出HTML, 高亮, 执行命令, 绑定控制台,
    拼接路径, 渲染文件栏, 绑定文件栏按钮, 切换全选, 设剪贴, 粘贴到,
    删除选中, 发送到对面, 读手机目录, 读电脑目录, 电脑父目录,
    切页, 刷新应用, 渲染应用, 刷新进程, 渲染进程,
  };

  const 缺失 = [];
  for (const [名, 值] of Object.entries(检查表)) {
    if (typeof 值 !== 'function') 缺失.push(名);
  }

  if (缺失.length > 0) {
    const 条 = document.createElement('div');
    条.style.cssText =
      'position:fixed;left:0;right:0;top:0;z-index:99999;background:#7a1c1c;color:#fff;' +
      'padding:10px 14px;font-size:12px;font-family:Consolas,monospace;white-space:pre-wrap;';
    条.textContent = '[自检] 缺少 ' + 缺失.length + ' 个函数：' + 缺失.join('、');
    条.onclick = () => 条.remove();
    document.body.appendChild(条);
    console.error('[Aoid 自检] 缺失: ' + 缺失.join(', '));
  } else {
    console.log('[Aoid 自检] 全部 ' + Object.keys(检查表).length + ' 个函数都在');
  }
}

自检();
启动();


/* ---------------- 绑定文件栏按钮 ---------------- */

function 绑定文件栏按钮() {
  const 绑 = function (id, 处理) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn('[Aoid] 找不到按钮:', id);
      return;
    }
    el.addEventListener('click', function (事件) {
      try {
        处理(事件);
      } catch (错误) {
        console.error('[Aoid] 按钮 ' + id + ' 出错:', 错误);
        提示('操作失败：' + 错误.message);
      }
    });
  };

  // 手机栏
  绑('手机上级', function () {
    const 当前 = 数据.手机目录 || '/sdcard';
    const 父 = 当前.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || '/';
    读手机目录(父);
  });
  绑('手机刷新', function () { 读手机目录(数据.手机目录); });
  绑('手机全选', function () { 切换全选('手机'); });
  绑('手机复制', function () { 设剪贴('手机', '复制'); });
  绑('手机粘贴', function () { 粘贴('手机'); });
  绑('手机重命名', function () { 重命名('手机'); });
  绑('手机删除', function () { 删除选中('手机'); });
  绑('手机发送', function () { 发送到对面('手机'); });

  // 电脑栏
  绑('电脑上级', function () {
    const 当前 = 数据.电脑目录;
    if (!当前) { 读电脑目录(''); return; }
    读电脑目录(电脑父目录(当前));
  });
  绑('电脑刷新', function () { 读电脑目录(数据.电脑目录); });
  绑('电脑盘符', function () { 读电脑目录(''); });
  绑('电脑全选', function () { 切换全选('电脑'); });
  绑('电脑复制', function () { 设剪贴('电脑', '复制'); });
  绑('电脑粘贴', function () { 粘贴('电脑'); });
  绑('电脑重命名', function () { 重命名('电脑'); });
  绑('电脑删除', function () { 删除选中('电脑'); });
  绑('电脑接收', function () { 发送到对面('电脑'); });
}

