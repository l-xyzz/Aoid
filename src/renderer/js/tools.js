/**
 * 「更多功能」窗口的前端逻辑。
 *
 * 四个页面：应用管理 / 进程管理 / 文件管理 / ADB 控制台。
 * 每个页面独立加载、独立刷新，切页时才按需拉数据，避免一打开就发一堆请求。
 */

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
  打开外设窗口: $('打开外设窗口'),

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
/** 补全表 */
let 补全表 = { 命令: [], 常用: [], 路径: [] };

/** 取值封装：主进程统一返回 { ok, data } 或 { ok:false, error } */
function 取值(结果) {
  if (结果 && 结果.ok === false) throw new Error(结果.error || 结果.message || '操作失败');
  return 结果 && 'data' in 结果 ? 结果.data : 结果;
}

function 提示(文字) {
  console.log(文字);
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
  const 过滤 = 数据.应用.filter((项) => !关键词 || 项.包名.toLowerCase().includes(关键词));

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
    主.textContent = 项.包名;
    主.title = 项.apk路径;

    if (项.系统) {
      const 标 = document.createElement('span');
      标.className = '次文';
      标.textContent = '系统';
      行.appendChild(标);
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

    行.append(主, 开, 停, 卸);
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
  try {
    const 结果 = 取值(await window.deck.工具.手机目录(目录));
    数据.手机目录 = 结果.目录;
    元素.手机路径.textContent = 结果.目录;
    元素.手机路径.title = 结果.目录;
    // 记住位置（和电脑栏共用一个防抖器，两侧一起存）
    保存文件位置();

    元素.手机文件.replaceChildren();
    for (const 项 of 结果.条目) {
      元素.手机文件.appendChild(
        造文件行(项, 结果.目录, '手机'),
      );
    }
    if (结果.条目.length === 0) {
      const 空 = document.createElement('div');
      空.className = '空提示';
      空.textContent = '空目录';
      元素.手机文件.appendChild(空);
    }
  } catch (错误) {
    元素.手机文件.replaceChildren();
    const 空 = document.createElement('div');
    空.className = '空提示';
    空.textContent = '读取失败：' + 错误.message;
    元素.手机文件.appendChild(空);
  }
}

/**
 * 读电脑目录。
 *
 * 传空字符串表示「回到盘符列表」——Windows 上光靠「上级」只能退到 C:\，
 * 没有入口切到 D:、E:，所以单独做了这一层。
 */
async function 读电脑目录(目录) {
  try {
    const 结果 = 取值(await window.deck.工具.电脑目录(目录 || ''));
    数据.电脑目录 = 结果.目录;
    数据.电脑父目录 = 结果.父目录;
    元素.电脑路径.textContent = 结果.目录 || '（选择磁盘）';
    元素.电脑路径.title = 结果.目录 || '';

    元素.电脑文件.replaceChildren();

    // 回到根视图时列出所有盘符
    if (结果.是根) {
      const 盘们 = 取值(await window.deck.工具.盘符列表()) || [];
      if (盘们.length === 0) {
        const 空 = document.createElement('div');
        空.className = '空提示';
        空.textContent = '没有可用的磁盘';
        元素.电脑文件.appendChild(空);
        return;
      }
      for (const 盘 of 盘们) {
        const 行 = document.createElement('div');
        行.className = '工具行';
        行.style.cursor = 'pointer';
        行.innerHTML =
          '<span>💽</span><span class="主文">' + 盘.名称 + '</span>';
        行.addEventListener('click', () => 读电脑目录(盘.路径));
        元素.电脑文件.appendChild(行);
      }
      return;
    }

    for (const 项 of 结果.条目) {
      元素.电脑文件.appendChild(造文件行(项, 结果.目录, '电脑'));
    }
    if (结果.条目.length === 0) {
      const 空 = document.createElement('div');
      空.className = '空提示';
      空.textContent = '空目录';
      元素.电脑文件.appendChild(空);
    }

    // 记下位置，下次打开接上
    保存文件位置();
  } catch (错误) {
    元素.电脑文件.replaceChildren();
    const 空 = document.createElement('div');
    空.className = '空提示';
    空.textContent = '读取失败：' + 错误.message;
    元素.电脑文件.appendChild(空);
  }
}

/**
 * 保存当前两侧的位置。
 *
 * 防抖 400ms：用户在目录里连续点击时不至于每次都写盘。
 */
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

/** 造一行文件条目 */
function 造文件行(项, 当前目录, 来源) {
  const 行 = document.createElement('div');
  行.className = '工具行';
  行.style.cursor = 'pointer';

  const 图标 = document.createElement('span');
  图标.textContent = 项.是否目录 ? '📁' : '📄';

  const 主 = document.createElement('span');
  主.className = '主文';
  主.textContent = 项.名称;

  const 大小文字 = document.createElement('span');
  大小文字.className = '次文';
  大小文字.textContent = 项.是否目录 ? '' : 大小(项.字节);

  行.append(图标, 主, 大小文字);

  行.addEventListener('click', () => {
    const 全路径 = 来源 === '电脑' ? 项.名称 : 当前目录.replace(/\/$/, '') + '/' + 项.名称;
    if (项.是否目录) {
      if (来源 === '手机') 读手机目录(全路径);
      else 读电脑目录(全路径);
    }
  });

  // 手机侧提供删除；两侧都提供"传到对面"
  if (来源 === '手机') {
    const 删 = document.createElement('button');
    删.className = '文字按钮';
    删.textContent = '删除';
    删.addEventListener('click', async (事件) => {
      事件.stopPropagation();
      const 全路径 = 当前目录.replace(/\/$/, '') + '/' + 项.名称;
      if (!confirm('删除 ' + 项.名称 + ' ？')) return;
      try {
        取值(await window.deck.工具.手机删除(全路径, 项.是否目录));
        读手机目录(当前目录);
      } catch (错误) {
        提示('删除失败：' + 错误.message);
      }
    });

    const 下 = document.createElement('button');
    下.className = '文字按钮';
    下.textContent = '↓';
    下.title = '下载到电脑当前目录';
    下.addEventListener('click', async (事件) => {
      事件.stopPropagation();
      if (项.是否目录) return;
      const 设备路径 = 当前目录.replace(/\/$/, '') + '/' + 项.名称;
      try {
        取值(await window.deck.工具.下载文件(设备路径, 项.名称));
        提示('已下载到 ' + 数据.电脑目录);
        读电脑目录(数据.电脑目录);
      } catch (错误) {
        提示('下载失败：' + 错误.message);
      }
    });

    行.append(下, 删);
  }

  return 行;
}

/* ------------------------------------------------------------------ */
/* ADB 控制台（终端式）                                                */
/* ------------------------------------------------------------------ */

/** 命令历史 */
const 历史 = [];
let 历史位置 = -1;

/** 往输出区追加一段（可选中复制） */
function 输出(文字, 类名 = '') {
  const 行 = document.createElement('div');
  if (类名) 行.className = 类名;
  行.textContent = 文字;
  元素.控制台输出.appendChild(行);
  元素.控制台输出.scrollTop = 元素.控制台输出.scrollHeight;
}

/** 追加一段 HTML（用于带高亮的回显） */
function 输出HTML(html) {
  const 行 = document.createElement('div');
  行.innerHTML = html;
  元素.控制台输出.appendChild(行);
  元素.控制台输出.scrollTop = 元素.控制台输出.scrollHeight;
}

/** 简易语法高亮：命令 / 参数 / 字符串 / 路径 */
function 高亮(命令) {
  const 词们 = 命令.split(/\s+/).filter(Boolean);
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

async function 执行命令() {
  const 命令 = 元素.控制台输入.value.trim();
  if (!命令) return;

  // 记入历史（去重，最新的放最后）
  if (历史[历史.length - 1] !== 命令) 历史.push(命令);
  if (历史.length > 200) 历史.shift();
  历史位置 = -1;

  输出HTML('<span class="高亮-提示">$ </span>' + 高亮(命令));

  元素.控制台输入.value = '';
  元素.控制台输入.disabled = true;

  try {
    const 结果 = 取值(await window.deck.工具.执行命令(命令));
    const 文本 = String(结果.输出 || '').replace(/\s+$/, '');
    if (文本) 输出(文本);
    if (结果.退出码 !== 0) 输出('（退出码 ' + 结果.退出码 + '）', '高亮-错误');
    输出('  ' + 结果.耗时 + ' ms', '高亮-提示');
  } catch (错误) {
    输出('错误：' + 错误.message, '高亮-错误');
  } finally {
    元素.控制台输入.disabled = false;
    元素.控制台输入.focus();
  }
}

/** 取补全候选 */
function 取候选(前缀) {
  const 全部 = [...补全表.常用, ...补全表.命令, ...补全表.路径];
  const 去重 = [...new Set(全部)];
  if (!前缀) return 去重.slice(0, 40);
  return 去重.filter((项) => 项.startsWith(前缀)).slice(0, 40);
}

function 显示补全(候选, 输入框) {
  if (候选.length === 0) {
    元素.补全框.hidden = true;
    return;
  }
  const 矩形 = 输入框.getBoundingClientRect();
  元素.补全框.style.left = 矩形.left + 'px';
  元素.补全框.style.top = Math.max(8, 矩形.top - Math.min(240, 候选.length * 28) - 6) + 'px';
  元素.补全框.style.width = Math.max(220, 矩形.width) + 'px';

  元素.补全框.replaceChildren();
  候选.forEach((项, 序) => {
    const 行 = document.createElement('div');
    行.className = '补全项' + (序 === 0 ? ' 选中' : '');
    行.textContent = 项;
    行.addEventListener('mousedown', (事件) => {
      事件.preventDefault();
      应用补全(项);
    });
    元素.补全框.appendChild(行);
  });
  元素.补全框.hidden = false;
}

function 应用补全(项) {
  const 输入 = 元素.控制台输入;
  const 光标 = 输入.selectionStart;
  const 前 = 输入.value.slice(0, 光标);
  const 后 = 输入.value.slice(光标);
  const 空格位 = 前.lastIndexOf(' ');
  const 前缀 = 空格位 >= 0 ? 前.slice(0, 空格位 + 1) : '';
  输入.value = 前缀 + 项 + 后;
  输入.selectionStart = 输入.selectionEnd = (前缀 + 项).length;
  元素.补全框.hidden = true;
  输入.focus();
}

/**
 * 控制台输入框的按键处理。
 *
 * 目标是让它像终端：回车执行、Tab 补全、上下翻历史、Ctrl+L 清屏、Ctrl+C 清空当前行。
 * 注意不要拦截左右方向键和 Home/End——那是编辑器自己的光标移动，用户需要。
 */
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
  元素.菜单项.forEach((项) => {
    项.addEventListener('click', () => 切页(项.dataset.页));
  });

  元素.刷新页.addEventListener('click', () => {
    if (当前页 === '应用') 刷新应用();
    else if (当前页 === '进程') 刷新进程();
    else if (当前页 === '文件') 刷新文件();
    else 提示('控制台不用刷新');
  });

  元素.应用搜索.addEventListener('input', 渲染应用);
  元素.安装apk.addEventListener('click', 安装apk);

  元素.进程搜索.addEventListener('input', 渲染进程);

  元素.打开外设窗口?.addEventListener('click', () => {
    window.deck.更多.显示窗口(true).catch((错误) => 提示('打不开外设窗口：' + 错误.message));
  });

  元素.手机上级.addEventListener('click', () => {
    const 父 = 数据.手机目录.replace(/\/[^/]*$/, '') || '/';
    读手机目录(父);
  });
  元素.电脑上级.addEventListener('click', () => {
    // 有真实父目录就退一层；否则（已经在盘根）回到盘符列表
    const 父 = 数据.电脑父目录;
    读电脑目录(父 || '');
  });

  /* 控制台 */
  绑定控制台();

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

  元素.控制台输出.appendChild(
    (() => {
      const 行 = document.createElement('div');
      行.className = '高亮-提示';
      行.textContent = 'Aoid ADB 控制台 —— 输入 adb shell 命令，Tab 补全，↑↓ 暂不支持历史';
      return 行;
    })(),
  );

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

  切页('应用');
}

启动();
