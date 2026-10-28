/**
 * 界面入口。
 *
 * 职责：
 *   设备列表与连接、快捷键分发、右侧面板（音量/亮度/播放/声音）、设置抽屉、添加设备。
 *   解码细节在 player.js，快捷键设置的交互在 shortcuts-ui.js。
 *
 * 两条关键约定：
 *   1. 触控坐标必须以「视频流尺寸」为基准（服务端会比对，不一致就丢弃事件）；
 *   2. 快捷键只在窗口有焦点时拦截，命中即拦下原本操作。
 */

window.__开始加载 = true;
import { 播放器 } from './player.js';
import * as 快捷键界面 from './shortcuts-ui.js';
import { 渲染Markdown } from './markdown.js';
import { 设置语言 } from './i18n.js';

const $ = (id) => document.getElementById(id);

const 元素 = {
  版本号: $('版本号'),
  设备列表: $('设备列表'),
  刷新设备: $('刷新设备'),
  空态引导: $('空态引导'),
  空态标题: $('空态标题'),
  空态正文: $('空态正文'),
  教程链接: $('教程链接'),
  环境提示: $('环境提示'),
  下载adb: $('下载adb'),
  下载进度: $('下载进度'),
  进度填充: $('进度填充'),
  进度文字: $('进度文字'),

  信息面板: $('信息面板'),
  连接标记: $('连接标记'),
  手动重连: $('手动重连'),
  设备名称: $('设备名称'),
  设备副标: $('设备副标'),
  指标电量: $('指标电量'),
  指标帧率: $('指标帧率'),
  指标分辨率: $('指标分辨率'),
  指标延迟: $('指标延迟'),

  画面区: document.querySelector('.画面区'),
  画布: $('画布'),
  触控层: $('触控层'),
  手机壳: $('手机壳'),
  舞台: $('舞台'),
  连接中: $('连接中'),
  连接中文字: $('连接中文字'),
  状态点: $('状态点'),
  状态文字: $('状态文字'),
  提示文字: $('提示文字'),

  文字表单: $('文字表单'),
  文字输入: $('文字输入'),

  播放面板: $('播放面板'),
  播放来源: $('播放来源'),
  播放标题: $('播放标题'),
  播放作者: $('播放作者'),
  播放图标: $('播放图标'),
  音量滑杆: $('音量滑杆'),
  音量值: $('音量值'),
  亮度滑杆: $('亮度滑杆'),
  亮度值: $('亮度值'),
  刷新状态: $('刷新状态'),
  保存截图: $('保存截图'),
  复制截图: $('复制截图'),

  打开更多窗口: $('打开更多窗口'),

  电脑发声开关: $('电脑发声开关'),
  电脑发声项: $('电脑发声项'),
  声音说明: $('声音说明'),

  设置按钮: $('设置按钮'),
  添加设备按钮: $('添加设备按钮'),
  最小化: $('最小化'),
  最大化: $('最大化'),
  关闭: $('关闭'),
  提示层: $('提示层'),

  设置遮罩: $('设置遮罩'),
  设置抽屉: $('设置抽屉'),
  关闭设置: $('关闭设置'),
  语言选择: $('语言选择'),
  打开语言目录: $('打开语言目录'),
  刷新语言列表: $('刷新语言列表'),
  语言目录提示: $('语言目录提示'),
  主题选择: $('主题选择'),
  剪贴板同步开关: $('剪贴板同步开关'),
  快捷键列表: $('快捷键列表'),
  快捷键恢复默认: $('快捷键恢复默认'),
  捕获提示: $('捕获提示'),
  取消捕获: $('取消捕获'),
  关于版本: $('关于版本'),
  检查更新: $('检查更新'),
  更新结果: $('更新结果'),

  添加设备遮罩: $('添加设备遮罩'),
  添加设备对话框: $('添加设备对话框'),
  关闭添加设备: $('关闭添加设备'),
  配对地址: $('配对地址'),
  配对码: $('配对码'),
  执行配对: $('执行配对'),
  连接地址: $('连接地址'),
  执行连接: $('执行连接'),
  扫描局域网: $('扫描局域网'),
  转为无线: $('转为无线'),
  扫描结果: $('扫描结果'),
  历史设备: $('历史设备'),
  usb状态: $('usb状态'),

  文档遮罩: $('文档遮罩'),
  文档对话框: $('文档对话框'),
  文档标题: $('文档标题'),
  文档内容: $('文档内容'),
  关闭文档: $('关闭文档'),
};

/* ------------------------------------------------------------------ */
/* 状态                                                               */
/* ------------------------------------------------------------------ */

const 状态 = {
  设备: [],
  历史设备: [],
  当前设备: '',
  // 视频通道断开后的自动重连计数，连接成功即清零
  自动重连次数: 0,
  // 是否正在后台恢复画面（防止重复触发）
  正在恢复: false,
  // 最近一次断开原因，失败提示时用
  断开原因: '',
  设备信息: null,
  已连接: false,
  编码尺寸: { 宽: 0, 高: 0 },
  帧率: 0,
  延迟: 0,
  播放器: null,
  指针按下: false,
  上次坐标: null,
  设置: null,
  快捷键表: { 键盘: new Map(), 鼠标: new Map() },
  轮询定时: null,
  状态定时: null,
  音量值: 0,
  亮度值: 100,
  正在拖动: '',
 最近提示: '',
  上次提示时间: 0,
};

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

function 提示(文字, 类型 = '普通') {
  const 现在 = Date.now();
  if (文字 === 状态.最近提示 && 现在 - 状态.上次提示时间 < 1200) return;
  状态.最近提示 = 文字;
  状态.上次提示时间 = 现在;

  const 节点 = document.createElement('div');
  节点.className = `提示 ${类型 === '普通' ? '' : 类型}`.trim();
  节点.textContent = 文字;
  元素.提示层.appendChild(节点);

  setTimeout(() => {
    节点.classList.add('离开');
    setTimeout(() => 节点.remove(), 220);
  }, 2000);
}

function 取值(结果) {
  if (!结果) throw new Error('没有收到响应');
  if (!结果.ok) throw new Error(结果.error || '操作失败');
  return 结果.data;
}

function 设置状态(文字, 形态 = '') {
  元素.状态文字.textContent = 文字;
  元素.状态点.className = `状态点 ${形态}`.trim();
}

function 空节点(文字) {
  const 节点 = document.createElement('div');
  节点.className = '通知空态';
  节点.textContent = 文字;
  return 节点;
}

/* ------------------------------------------------------------------ */
/* 主题                                                               */
/* ------------------------------------------------------------------ */

const 系统浅色 = window.matchMedia('(prefers-color-scheme: light)');

function 应用主题(选择) {
  const 浅色 = 选择 === 'light' || (选择 === 'system' && 系统浅色.matches);
  document.body.dataset.theme = 浅色 ? 'light' : 'dark';
}

系统浅色.addEventListener('change', () => {
  if (状态.设置?.主题 === 'system') 应用主题('system');
});

/* ------------------------------------------------------------------ */
/* 设备列表                                                            */
/* ------------------------------------------------------------------ */

const 手机图标 = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
    <path d="M10.5 5.3h3" />
  </svg>`;

const 无线图标 = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <path d="M3 9a13 13 0 0 1 18 0M6.5 12.5a8 8 0 0 1 11 0M10 16a3 3 0 0 1 4 0" stroke-linecap="round" />
    <circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>`;

/**
 * 渲染设备列表：在线设备与「连接过的设备」合成一张表。
 *
 * 合并规则：
 *   - 在线设备排在最前，显示「使用中 / 可用」；
 *   - 历史设备补在后面，已在线的不重复显示；离线显示连接方式与上次时间，
 *     并提供「重连」和「删除」；
 *   - 两张表合并后，用户在一个地方就能完成「看看有什么设备 / 连哪台 / 忘掉哪台」。
 */
function 渲染设备列表() {
  元素.设备列表.replaceChildren();

  // 在线设备
  const 在线 = 状态.设备 || [];
  // 历史设备：去掉已在线的那台，避免同一台出现两行
  const 在线序列 = new Set(在线.map((d) => d.serial));
  const 历史 = (状态.历史设备 || []).filter((项) => !在线序列.has(项.序列号));

  if (在线.length === 0 && 历史.length === 0) {
    元素.空态引导.hidden = false;
    return;
  }
  元素.空态引导.hidden = true;

  for (const 设备 of 在线) {
    const 项 = document.createElement('button');
    项.className = '设备项';
    项.type = 'button';
    if (设备.serial === 状态.当前设备) 项.classList.add('选中');

    const 图标 = document.createElement('span');
    图标.className = '设备图标';
    图标.innerHTML = 设备.serial.includes(':') ? 无线图标 : 手机图标;

    const 文字 = document.createElement('span');
    文字.className = '设备文字';
    const 型号 = document.createElement('div');
    型号.className = '设备型号';
    型号.textContent = 设备.model || 设备.device || '安卓设备';
    const 序列 = document.createElement('div');
    序列.className = '设备序列号';
    序列.textContent = 设备.serial;
    文字.append(型号, 序列);

    const 标记 = document.createElement('span');
    if (设备.state === 'device') {
      标记.className = '设备状态标记';
      标记.textContent = 设备.serial === 状态.当前设备 ? '使用中' : '可用';
    } else {
      标记.className = '设备状态标记 未授权';
      标记.textContent = 设备.state === 'unauthorized' ? '待授权' : '离线';
    }

    项.append(图标, 文字, 标记);
    项.addEventListener('click', () => 选择设备(设备));
    元素.设备列表.appendChild(项);
  }

  for (const 项数据 of 历史) {
    const 项 = document.createElement('div');
    项.className = '设备项 历史';

    const 图标 = document.createElement('span');
    图标.className = '设备图标';
    图标.innerHTML = 项数据.方式 === '无线' ? 无线图标 : 手机图标;

    const 文字 = document.createElement('span');
    文字.className = '设备文字';
    const 型号 = document.createElement('div');
    型号.className = '设备型号';
    型号.textContent = 项数据.名称 || 项数据.序列号;
    const 备注 = document.createElement('div');
    备注.className = '设备序列号';
    备注.textContent = 项数据.方式 + ' · ' + 相对时间(项数据.最后连接);
    文字.append(型号, 备注);

    // 离线设备点「重连」，右侧小按钮删除
    const 操作 = document.createElement('span');
    操作.className = '设备操作';

    const 重连 = document.createElement('button');
    重连.className = '小按钮';
    重连.type = 'button';
    重连.textContent = '重连';
    重连.addEventListener('click', (事件) => {
      事件.stopPropagation();
      重连设备(项数据.序列号);
    });

    const 删除 = document.createElement('button');
    删除.className = '小按钮 危险';
    删除.type = 'button';
    删除.textContent = '删除';
    删除.addEventListener('click', (事件) => {
      事件.stopPropagation();
      删除历史设备(项数据.序列号);
    });

    操作.append(重连, 删除);
    项.append(图标, 文字, 操作);
    元素.设备列表.appendChild(项);
  }
}

async function 选择设备(设备) {
  if (设备.state === 'unauthorized') return 提示('请先在手机上点「允许 USB 调试」', '错误');
  if (设备.state !== 'device') return 提示('这台设备当前不可用', '错误');
  if (设备.serial === 状态.当前设备 && 状态.已连接) return;
  状态.当前设备 = 设备.serial;
  渲染设备列表();
  await 连接(设备.serial);
}

/* ------------------------------------------------------------------ */
/* 连接                                                                */
/* ------------------------------------------------------------------ */

async function 连接(序列号, 静默 = false) {
  静默 = 静默 || 状态.正在恢复;
  界面_连接中(!静默);
  try {
    const 信息 = 取值(await window.deck.设备.连接(序列号));
    应用设备信息(信息);
    状态.已连接 = true;
    界面_连接中(false);
    界面_显示画面();
    设置状态('画面同步中', '在线');
    if (!静默) 提示('已连接', '成功');
    状态.自动重连次数 = 0;
    await 刷新右侧();
    刷新声音();
       clearInterval(状态.状态定时);
    // 400ms 一次：手机上调音量/亮度能几乎实时反映到电脑上。
    // 轮询本身是几条 dumpsys，开销很小，且拖动时会被 状态.正在拖动 跳过。
    状态.状态定时 = setInterval(刷新右侧, 800);
  } catch (错误) {
    状态.已连接 = false;
    界面_连接中(false);
    设置状态('连接失败', '异常');
    if (!静默) 提示(错误.message, '错误');
  }
}

async function 断开() {
  await window.deck.设备.断开().catch(() => {});
  状态.已连接 = false;
  状态.当前设备 = '';
  状态.设备信息 = null;
  界面_连接中(false);
  界面_显示空画面();
  设置状态('未连接设备', '');
  元素.连接标记.classList.add('断开');
  元素.连接标记.lastChild.textContent = '未连接';
  元素.提示文字.textContent = '';
  元素.指标帧率.textContent = '—';
  元素.指标延迟.textContent = '—';
  元素.播放面板.hidden = true;
  
 clearInterval(状态.状态定时);
  状态.状态定时 = null;
  if (状态.播放器) 状态.播放器.重置();
  渲染设备列表();
}

function 应用设备信息(信息) {
  元素.信息面板.hidden = false;
  元素.连接标记.classList.remove('断开');
  元素.连接标记.lastChild.textContent = '已连接';
  元素.设备名称.textContent = [信息.brand, 信息.model].filter(Boolean).join(' ') || '安卓设备';
  元素.设备副标.textContent = `Android ${信息.android || '?'} · ${信息.serial}`;
  元素.指标电量.textContent = 信息.battery ? `${信息.battery}%${信息.charging ? ' ⚡' : ''}` : '—';
  元素.指标分辨率.textContent = 信息.width ? `${信息.width}×${信息.height}` : '—';
}

/* ------------------------------------------------------------------ */
/* 画面                                                                */
/* ------------------------------------------------------------------ */

function 创建播放器() {
  if (状态.播放器) return;
  状态.播放器 = new 播放器(元素.画布, {
    就绪: () => {
      设置状态('画面同步中', '在线');
      元素.手机壳.classList.add('已连接');
      元素.手机壳.classList.remove('等待中');
      元素.画面区.classList.add('在线');
    },
    尺寸: (尺寸) => {
      if (尺寸.宽 && 尺寸.高) {
        状态.编码尺寸 = { 宽: 尺寸.宽, 高: 尺寸.高 };
        调整画面尺寸();
      }
    },
    统计: (信息) => {
      if (信息.出错) {
        元素.提示文字.textContent = 信息.出错;
        return;
      }
      状态.帧率 = 信息.帧率;
      状态.延迟 = 信息.延迟;
      元素.指标帧率.textContent = `${信息.帧率} fps`;
      元素.指标延迟.textContent = `${Math.round(信息.延迟 * 1000)} ms`;
      元素.提示文字.textContent = `${信息.帧率} fps · ${Math.round(信息.延迟 * 1000)} ms`;
    },
  });
}

/** 按 1:1 像素摆放画面，窗口放不下才缩小（绝不放大小图，否则发糊） */
/**
 * 让手机画面随窗口自适应。
 *
 * 关键点：
 *   1. 长宽比以「视频流分辨率」为准，不要用画布当前像素尺寸——
 *      旋转、换分辨率后画布尺寸会变，用旧的会算出错误比例。
 *   2. 手机壳的宽高按可用空间等比缩放，填满舞台但不溢出；
 *      窗口拉大时画面跟着变大，窗口缩小时跟着变小。
 *   3. 画布本身在 CSS 里是 100% 宽高，由手机壳的尺寸驱动，
 *      这样只需改一个地方，不用同时维护画布和外壳两套尺寸。
 */
function 调整画面尺寸() {
  const 舞台 = 元素.手机壳.parentElement;
  if (!舞台) return;

  // 舞台的内边距在 CSS 里是 20px，这里留出同样的余量
  const 可用宽 = 舞台.clientWidth - 40;
  const 可用高 = 舞台.clientHeight - 40;
  if (可用宽 <= 40 || 可用高 <= 40) return;

  // 优先用视频流真实分辨率算比例。
  // 横竖屏切换时视频流会给出宽高互换的新尺寸，这里必须每次重算，
  // 不能缓存上一次的比例——否则横屏后会按竖屏比例布局，
  // 画面被压成一条，看起来就像「崩了」。
  const 源宽 = Number(状态.编码尺寸?.宽) || 元素.画布.width || 590;
  const 源高 = Number(状态.编码尺寸?.高) || 元素.画布.height || 1280;
  if (!源宽 || !源高) return;
  const 比例 = 源高 / 源宽;

  // 手机壳有 8px 内边距（四周各 8），内容区要扣掉
  const 内边距 = 16;
  const 最大宽 = Math.max(40, 可用宽 - 内边距);
  const 最大高 = Math.max(40, 可用高 - 内边距);

  // 先按宽度铺满，再检查高度是否超；超了就以高度为准
  let 宽 = 最大宽;
  let 高 = 宽 * 比例;
  if (高 > 最大高) {
    高 = 最大高;
    宽 = 高 / 比例;
  }

  // 不放大超过原始像素（避免糊），但允许缩小到任意小。
  // 下界给得很小：横屏时可用高度有限，硬撑到 120px 会溢出舞台。
  宽 = Math.max(40, Math.min(Math.floor(宽), 源宽));
  高 = Math.max(40, Math.min(Math.floor(高), 源高));

  元素.手机壳.style.width = 宽 + 内边距 + 'px';
  元素.手机壳.style.height = 高 + 内边距 + 'px';
}
function 界面_显示画面() {
  元素.触控层.classList.remove('禁用');
  // 离开空闲态：收起引导卡片，让手机壳正常显示
  元素.舞台?.classList.remove('空闲');
  元素.手机壳.classList.remove('未连接', '等待中');
  if (!状态.播放器) 创建播放器();
  else 状态.播放器.重置();
  调整画面尺寸();
}

/**
 * 未连接时的舞台。
 *
 * 原来是留一个 300x640 的半透明空手机壳，中间一大片黑，看着像界面坏了。
 * 现在直接收起手机壳，改由舞台上的引导卡片承担指引（纯 CSS，见 app.css）。
 *
 * 附带好处：连接成功后手机壳"从无到有"出现，比原来"空壳突然变实"自然得多。
 */
function 界面_显示空画面() {
  元素.触控层.classList.add('禁用');
  元素.手机壳.classList.remove('已连接');
  元素.手机壳.classList.add('等待中', '未连接');
  元素.画面区.classList.remove('在线');
  // 尺寸交还 CSS，不再写死
  元素.手机壳.style.width = '';
  元素.手机壳.style.height = '';
  元素.舞台?.classList.add('空闲');
}

function 界面_连接中(显示, 文字 = '正在建立通道') {
  元素.连接中.hidden = !显示;
  元素.连接中文字.textContent = 文字;
}

/* ------------------------------------------------------------------ */
/* 触控                                                                */
/* ------------------------------------------------------------------ */

function 换算坐标(事件) {
  const 矩形 = 元素.触控层.getBoundingClientRect();
  const 宽 = 元素.画布.width;
  const 高 = 元素.画布.height;
  if (!宽 || !高 || 矩形.width === 0 || 矩形.height === 0) return null;

  const 缩放 = Math.min(矩形.width / 宽, 矩形.height / 高);
  const 实宽 = 宽 * 缩放;
  const 实高 = 高 * 缩放;
  const 左 = 矩形.left + (矩形.width - 实宽) / 2;
  const 上 = 矩形.top + (矩形.height - 实高) / 2;

  const x = (事件.clientX - 左) / 缩放;
  const y = (事件.clientY - 上) / 缩放;
  if (x < 0 || y < 0 || x > 宽 || y > 高) return null;
  return { x: Math.min(宽, Math.round(x)), y: Math.min(高, Math.round(y)) };
}

/* ------------------------------------------------------------------ */
/* 触控与点击动效                                                      */
/* ------------------------------------------------------------------ */

/**
 * 单击脉冲：和原来一样，一个圆点散开。
 * 用 CSS 动画，不占用主线程。
 */
function 画脉冲(事件) {
  const 矩形 = 元素.触控层.getBoundingClientRect();
  const 点 = document.createElement('span');
  点.className = '触控脉冲';
  点.style.left = (事件.clientX - 矩形.left) + 'px';
  点.style.top = (事件.clientY - 矩形.top) + 'px';
  元素.触控层.appendChild(点);
  setTimeout(() => 点.remove(), 460);
}

/**
 * 长按进度环：按住超过 300ms 开始显示，一圈转完表示正在长按。
 * 用手指按住手机屏幕时，用户需要一个「确实按住了」的视觉确认。
 */
function 画长按(事件) {
  const 矩形 = 元素.触控层.getBoundingClientRect();
  const 环 = document.createElement('span');
  环.className = '触控长按';
  环.style.left = (事件.clientX - 矩形.left) + 'px';
  环.style.top = (事件.clientY - 矩形.top) + 'px';
  元素.触控层.appendChild(环);
  return 环;
}

/**
 * 拖动轨迹：拖的时候在起点和当前位置之间画一条淡淡的线，
 * 让「拖了多远」有直观反馈（原来拖动完全没有视觉提示）。
 */
/**
 * 拖动时的跟随光晕（替代之前的轨迹线）。
 *
 * 仿 Windows 触控的视觉：一个柔和的圆形光斑跟着指针走，
 * 拖动距离越远光斑微微变淡变大，手感像「手指按在屏幕上滑动」。
 * 不再画那条从起点到当前位置的直线——它显得生硬，也挡住画面。
 */
function 画拖动态(起) {
  const 矩形 = 元素.触控层.getBoundingClientRect();
  const 光晕 = document.createElement('span');
  光晕.className = '触控光晕';
  光晕.style.left = (起.clientX - 矩形.left) + 'px';
  光晕.style.top = (起.clientY - 矩形.top) + 'px';
  元素.触控层.appendChild(光晕);
  return 光晕;
}

function 更新轨迹(光晕, 起, 事件) {
  if (!光晕) return;
  const 矩形 = 元素.触控层.getBoundingClientRect();
  光晕.style.left = (事件.clientX - 矩形.left) + 'px';
  光晕.style.top = (事件.clientY - 矩形.top) + 'px';

  // 拖得越远，光斑略微变大变淡，给出「拖了多远」的轻微提示
  const 距离 = Math.hypot(事件.clientX - 起.clientX, 事件.clientY - 起.clientY);
  const 缩放 = Math.min(1.6, 1 + 距离 / 400);
  光晕.style.transform = `translate(-50%, -50%) scale(${缩放.toFixed(2)})`;
  光晕.style.opacity = String(Math.max(0.35, 0.75 - 距离 / 1200));
}

function 绑定触控() {
  const 层 = 元素.触控层;
  层.addEventListener('contextmenu', (e) => e.preventDefault());
  层.addEventListener('auxclick', (e) => e.preventDefault());
  层.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  层.addEventListener('pointerdown', (事件) => {
    if (!状态.已连接) return;

    // 鼠标键先查快捷键：命中就执行动作，不再当作触摸
    const 动作 = 状态.快捷键表.鼠标.get(事件.button);
    if (动作) {
      事件.preventDefault();
      执行动作(动作);
      return;
    }

    if (事件.button !== 0) return;
    事件.preventDefault();
    const 坐标 = 换算坐标(事件);
    if (!坐标) return;

    层.setPointerCapture(事件.pointerId);
    状态.指针按下 = true;
    状态.上次坐标 = 坐标;
    状态.按下时刻 = performance.now();
    状态.已拖动 = false;
    状态.起点事件 = { clientX: 事件.clientX, clientY: 事件.clientY };
    层.classList.add('按下中');

    // 单击脉冲立刻出现（保持原来的手感）
    画脉冲(事件);

    // 300ms 后仍在同一个位置，就认为是长按，显示进度环
    状态.长按环 = null;
    状态.长按定时 = setTimeout(() => {
      if (!状态.指针按下 || 状态.已拖动) return;
      状态.长按环 = 画长按(状态.起点事件);
    }, 300);

    window.deck.触控.按下(坐标.x, 坐标.y).catch(() => {});
  });

  层.addEventListener('pointermove', (事件) => {
    if (!状态.指针按下 || !状态.已连接) return;
    const 坐标 = 换算坐标(事件);
    if (!坐标) return;

    if (状态.上次坐标) {
      const 距离 = Math.hypot(坐标.x - 状态.上次坐标.x, 坐标.y - 状态.上次坐标.y);
      if (距离 < 2) return;
    }

    // 第一次真正移动：取消长按判定，转为拖动状态并画出轨迹
    if (!状态.已拖动) {
      状态.已拖动 = true;
      clearTimeout(状态.长按定时);
      if (状态.长按环) {
        状态.长按环.remove();
        状态.长按环 = null;
      }
      层.classList.add('拖动中');
      状态.轨迹 = 画拖动态(状态.起点事件);
    }

    更新轨迹(状态.轨迹, 状态.起点事件, 事件);

    状态.上次坐标 = 坐标;
    window.deck.触控.移动(坐标.x, 坐标.y).catch(() => {});
  });

  const 抬起 = (事件) => {
    if (!状态.指针按下) return;
    状态.指针按下 = false;
    clearTimeout(状态.长按定时);
    清理动效();
    层.classList.remove('按下中');
    层.classList.remove('拖动中');
    const 坐标 = 换算坐标(事件) || 状态.上次坐标;
    状态.上次坐标 = null;
    状态.已拖动 = false;
    if (坐标 && 状态.已连接) window.deck.触控.抬起(坐标.x, 坐标.y).catch(() => {});
  };

  层.addEventListener('pointerup', 抬起);
  层.addEventListener('pointercancel', 抬起);

  层.addEventListener(
    'wheel',
    (事件) => {
      if (!状态.已连接) return;
      事件.preventDefault();
      const 坐标 = 换算坐标(事件);
      if (!坐标) return;
      // 浏览器向下滚 deltaY 为正，Android 的滚动事件同理，
      // 但实测两者语义相反：电脑向下滚应让手机内容向下移动（即往上翻），
      // 所以这里取反，保证「滚向哪边，页面就往哪边走」。
      const 竖向 = Math.max(-16, Math.min(16, Math.round(-事件.deltaY / 6)));
      if (竖向 !== 0) window.deck.触控.滚动(坐标.x, 坐标.y, 竖向, 0).catch(() => {});
    },
    { passive: false },
  );

  window.addEventListener('pointerup', () => {
    if (!状态.指针按下) return;
    状态.指针按下 = false;
    clearTimeout(状态.长按定时);
    清理动效();
    层.classList.remove('按下中');
    层.classList.remove('拖动中');
    const 坐标 = 状态.上次坐标;
    if (坐标) window.deck.触控.抬起(坐标.x, 坐标.y).catch(() => {});
    状态.上次坐标 = null;
    状态.已拖动 = false;
  });
}

/** 清掉长按环和拖动光晕 */
function 清理动效() {
  if (状态.长按环) {
    状态.长按环.remove();
    状态.长按环 = null;
  }
  if (状态.轨迹) {
    状态.轨迹.remove();
    状态.轨迹 = null;
  }
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

const 动作实现 = {
  返回: () => window.deck.设备.返回(),
  主页: () => window.deck.设备.按键(3),
  任务: () => window.deck.设备.按键(187),
  通知: () => window.deck.设备.通知栏(),
  控制中心: () => window.deck.设备.快捷设置(),
  旋转: () => window.deck.设备.旋转(),
  音量加: () => 调节音量(状态.音量值 + 8),
  音量减: () => 调节音量(状态.音量值 - 8),
  截图: async () => {
    const 结果 = 取值(await window.deck.截图.保存());
    if (结果.saved) 提示('已保存原图（手机原始分辨率）', '成功');
  },
  剪贴板: () => 发送剪贴板(),
};

/**
 * 左栏按钮的 data-act 用的是英文（back/home/task…），
 * 而动作表用的是中文键（返回/主页/任务…）。
 *
 * 之前没做映射，动作实现['back'] 是 undefined，执行动作直接 return，
 * 表现就是「左栏按钮点了完全没反应，也不报错」——极难查。
 * 这里显式做一张对照表，任何一边改名都会立刻暴露。
 */
const 按钮动作名 = {
  back: '返回',
  home: '主页',
  task: '任务',
  rotate: '旋转',
  notif: '通知',
  settings: '控制中心',
  shot: '截图',
  clipboard: '剪贴板',
};

async function 执行动作(动作) {
  // 允许传中文动作名，也允许传按钮上的英文 key
  const 中文名 = 按钮动作名[动作] || 动作;
  const 实现 = 动作实现[中文名];
  if (!实现) {
    提示('未实现的动作：' + 动作, '错误');
    return;
  }
  if (!状态.已连接) return 提示('先连接一台设备');
  if (document.activeElement === 元素.文字输入) return;
  try {
    await 实现();
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

/* ------------------------------------------------------------------ */
/* 键盘                                                                */
/* ------------------------------------------------------------------ */

function 绑定键盘() {
  document.addEventListener(
    'keydown',
    (事件) => {
      // 设置里正在录制绑定：交给录制器
      if (快捷键界面.是否在录制()) {
        事件.preventDefault();
        事件.stopPropagation();
        快捷键界面.接收按键(事件);
        return;
      }

      // 输入框内正常打字
      if (document.activeElement === 元素.文字输入) {
        if (事件.key === 'Escape') 元素.文字输入.blur();
        return;
      }

      // 有浮层时只处理 Esc
      if (!元素.设置抽屉.hidden || !元素.添加设备对话框.hidden || !元素.文档对话框.hidden) {
        if (事件.key === 'Escape') {
          事件.preventDefault();
          if (!元素.文档对话框.hidden) 关闭文档();
          else if (!元素.添加设备对话框.hidden) 关闭添加设备();
          else 关闭设置();
        }
        return;
      }

      const 文本 = 快捷键界面.键盘绑定文本(事件);
      const 动作 = 文本 ? 状态.快捷键表.键盘.get(文本) : null;
      if (动作) {
        事件.preventDefault();
        事件.stopPropagation();
        执行动作(动作);
      }
      // 未绑定的按键不转发到手机，避免打字时误输入
    },
    true,
  );
}

/* ------------------------------------------------------------------ */
/* 右侧面板                                                            */
/* ------------------------------------------------------------------ */

async function 刷新右侧() {
  if (!状态.已连接) return;

  // 防止堆积：上一次还没回来就跳过这一轮。
  // 原来三条命令要 900ms，而定时器每 400ms 触发一次，请求会越积越多，
  // 整个界面都跟着卡——这是「应用很卡」的真正原因。
  if (状态.刷新中) return;
  状态.刷新中 = true;

  try {
    const 数据 = 取值(await window.deck.状态.汇总());

    // 拖动滑杆时不回写，否则会和用户的手抢
    if (状态.正在拖动 !== '音量') {
      状态.音量值 = 数据.音量.百分比;
      元素.音量滑杆.value = String(数据.音量.百分比);
      元素.音量值.textContent = 数据.音量.百分比 + '%' + (数据.音量.静音 ? ' 静音' : '');
    }
    if (状态.正在拖动 !== '亮度') {
      状态.亮度值 = 数据.亮度.百分比;
      元素.亮度滑杆.value = String(数据.亮度.百分比);
      元素.亮度值.textContent = 数据.亮度.百分比 + '%';
    }
  } catch {
    // 单次失败忽略，下一轮会重试
  } finally {
    状态.刷新中 = false;
  }

  // 播放信息变化很慢，不必跟着高频刷新：每 8 轮（约 3 秒）查一次
  状态.播放节流 = (状态.播放节流 || 0) + 1;
  if (状态.播放节流 % 8 === 0) 刷新播放();
}

async function 刷新播放() {
  try {
    const 数据 = 取值(await window.deck.媒体.读取());
    if (!数据.标题 && !数据.播放中) {
      元素.播放面板.hidden = true;
      return;
    }
    元素.播放面板.hidden = false;
    元素.播放标题.textContent = 数据.标题 || '未知曲目';
    元素.播放作者.textContent = 数据.作者 || '—';
    元素.播放来源.textContent = 数据.包名 || '';
    元素.播放图标.innerHTML = 数据.播放中
      ? '<path d="M4.5 3h2.2v10H4.5zM9.3 3h2.2v10H9.3z" />'
      : '<path d="M5 3l8 5-8 5z" />';
  } catch {
    元素.播放面板.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* 音量 / 亮度                                                         */
/* ------------------------------------------------------------------ */

/**
 * 下发音量。
 *
 * 关键：**拖动期间绝不回写滑杆**。
 *
 * 原来这里 `.then` 里无条件把手机返回的百分比写回滑杆，
 * 于是「用户拖到 70 → 请求发出 → 用户继续拖到 80 → 旧请求返回 70 被写回」
 * 滑杆就被拽回去了，这就是用户看到的回弹。
 *
 * 现在只有不在拖动时才接受回写；拖动中一律以用户的鼠标为准。
 */
function 调节音量(目标百分比) {
  const 目标 = Math.max(0, Math.min(100, Math.round(目标百分比)));
  // 立刻跟手：界面值只由鼠标决定
  元素.音量滑杆.value = String(目标);
  元素.音量值.textContent = `${目标}%`;
  状态.音量值 = 目标;

  return window.deck.状态.设置音量(目标).then((r) => {
    // 拖动中忽略返回值，避免旧数据把滑杆拽回去
    if (状态.正在拖动 === '音量') return;
    const 数据 = 取值(r);
    状态.音量值 = 数据.百分比;
    元素.音量滑杆.value = String(数据.百分比);
    元素.音量值.textContent = `${数据.百分比}%`;
  });
}

/**
 * 节流：保证「最后一次的值一定会发出去」，中间过程可以丢。
 *
 * 原来的实现有个致命问题：每 60ms 就发一次 adb 命令，而「设置音量」
 * 单次要 200ms 以上，于是请求在后台越堆越多，滑杆越拖越卡。
 * 现在改成：拖动中最多 200ms 发一次，且同一时刻只允许一个请求在飞；
 * 请求返回时如果发现又有新值，只补发最新的那一个，中间的丢掉。
 */
function 节流(函数, 间隔 = 200) {
  let 上次 = 0;
  let 待执行 = null;
  let 最新的参数 = null;
  let 正在执行 = false;

  const 执行 = async (参数) => {
    if (正在执行) {
      // 有请求在飞，记下最新值，等它回来再发
      最新的参数 = 参数;
      return;
    }
    正在执行 = true;
    最新的参数 = null;
    try {
      await 函数(参数);
    } catch {
      // 单次失败忽略
    } finally {
      正在执行 = false;
      if (最新的参数 !== null) {
        const 下一个 = 最新的参数;
        最新的参数 = null;
        执行(下一个);
      }
    }
  };

  return (参数) => {
    const 现在 = performance.now();
    const 剩余 = 间隔 - (现在 - 上次);
    if (剩余 <= 0) {
      上次 = 现在;
      执行(参数);
      return;
    }
    clearTimeout(待执行);
    待执行 = setTimeout(() => {
      上次 = performance.now();
      执行(参数);
    }, 剩余);
  };
}


/** 设置亮度（与调节音量对称，同样支持拖动中实时下发） */
async function 设置亮度(目标百分比) {
  const 目标 = Math.max(0, Math.min(100, Math.round(目标百分比)));
  try {
    const 数据 = 取值(await window.deck.状态.设置亮度(目标));
    状态.亮度值 = 数据.百分比;
    // 拖动中不回写滑杆，否则会和用户的手抢位置
    if (状态.正在拖动 !== '亮度') {
      元素.亮度滑杆.value = String(数据.百分比);
      元素.亮度值.textContent = 数据.百分比 + '%';
    }
  } catch {
    // 拖动过程中的单次失败忽略，下一次节流会补上
  }
}

/**
 * 滑杆：拖动即生效。
 *
 * 原来只在 change（松手）时下发，拖动全程手机没反应，感觉像「拖了没用」。
 * 现在绑定 input 事件实时发送，并用节流限制频率。
 * 拖动期间暂停轮询回读（状态.正在拖动），避免手机返回的旧值把滑杆拽回去。
 */
/**
 * 音量与亮度滑杆。
 *
 * 核心诉求：**拖动时必须完全跟手，不能回弹，电脑端优先于手机**。
 *
 * 要做到这几点，靠三层配合：
 *   1. 拖动中：界面值只由鼠标决定。滑杆位置、百分比文字都直接写，
 *      绝不用手机返回的值回写——一旦回写，用户的手和手机的值就会互相拉扯。
 *   2. 下发：每 120ms 最多发一次，且同一时刻只允许一个请求在飞；
 *      在飞期间的新值只保留「最新的一个」，回来再发。拖动再快也不会堆积。
 *   3. 松手后：等一小会儿再放开「由手机回写」的开关，
 *      让最后一次写入落地，避免刚松手就被上一轮的旧读数盖掉。
 *
 * 手机上按音量键不会打断拖动：拖动期间界面完全不看手机的值。
 * 松手后如果用户又在手机上按了键，下一轮轮询会把新值同步过来——
 * 这正是「电脑端优先，但手机端改动也能被看到」。
 */
function 绑定滑杆() {
  const 实时音量 = 节流((值) => 调节音量(值), 120);
  const 实时亮度 = 节流((值) => 设置亮度(值), 120);

  /** 拖动结束后延后一会儿再放开回写，让最后一次写入落地 */
  const 松开后延迟 = (名称) => {
    setTimeout(() => {
      // 只有当前拖的确实是这一项才清空，避免误伤另一个滑杆
      if (状态.正在拖动 === 名称) 状态.正在拖动 = '';
    }, 400);
  };

  /* ---- 音量 ---- */
  const 音量开始 = () => {
    状态.正在拖动 = '音量';
  };
  元素.音量滑杆.addEventListener('pointerdown', 音量开始);
  元素.音量滑杆.addEventListener('keydown', 音量开始);
  元素.音量滑杆.addEventListener('input', () => {
    // 键盘方向键调节不会触发 pointerdown，这里补一次，保证同样跟手
    状态.正在拖动 = '音量';
    const 值 = Number(元素.音量滑杆.value);
    元素.音量值.textContent = 值 + '%';
    状态.音量值 = 值;
    if (状态.已连接) 实时音量(值);
  });
  元素.音量滑杆.addEventListener('change', () => 松开后延迟('音量'));
  元素.音量滑杆.addEventListener('pointerup', () => 松开后延迟('音量'));
  元素.音量滑杆.addEventListener('pointercancel', () => 松开后延迟('音量'));

  /* ---- 亮度 ---- */
  const 亮度开始 = () => {
    状态.正在拖动 = '亮度';
  };
  元素.亮度滑杆.addEventListener('pointerdown', 亮度开始);
  元素.亮度滑杆.addEventListener('keydown', 亮度开始);
  元素.亮度滑杆.addEventListener('input', () => {
    状态.正在拖动 = '亮度';
    const 值 = Number(元素.亮度滑杆.value);
    元素.亮度值.textContent = 值 + '%';
    状态.亮度值 = 值;
    if (状态.已连接) 实时亮度(值);
  });
  元素.亮度滑杆.addEventListener('change', () => 松开后延迟('亮度'));
  元素.亮度滑杆.addEventListener('pointerup', () => 松开后延迟('亮度'));
  元素.亮度滑杆.addEventListener('pointercancel', () => 松开后延迟('亮度'));
}

function 绑定媒体控制() {
  document.querySelectorAll('[data-media]').forEach((按钮) => {
    按钮.addEventListener('click', async () => {
      if (!状态.已连接) return 提示('先连接一台设备');
      try {
        取值(await window.deck.媒体.控制(按钮.dataset.media));
        setTimeout(刷新播放, 700);
      } catch (错误) {
        提示(错误.message, '错误');
      }
    });
  });
}


/* ------------------------------------------------------------------ */
/* 声音开关                                                            */
/* ------------------------------------------------------------------ */

async function 刷新声音() {
  try {
    const 数据 = 取值(await window.deck.声音.读取());
    元素.电脑发声开关.checked = 数据.电脑发声 === true;
    元素.电脑发声开关.disabled = !数据.电脑发声可用;
    // 面板标题右侧空间有限，这里只放最关键的短句，完整说明见提示语
    元素.声音说明.textContent = 数据.电脑发声 ? '电脑播放中' : '手机外放中';
  } catch {
    // 未连接时保持默认
  }
}

function 绑定声音开关() {
  元素.电脑发声开关.addEventListener('change', async () => {
    if (!状态.已连接) {
      元素.电脑发声开关.checked = false;
      return 提示('先连接一台设备');
    }

    const 开启 = 元素.电脑发声开关.checked;
    元素.电脑发声开关.disabled = true;

    try {
      取值(await window.deck.声音.切换电脑播放(开启));
      提示(开启 ? '手机声音已转到电脑，手机自动静音' : '已恢复手机外放', '成功');
    } catch (错误) {
      元素.电脑发声开关.checked = !开启;
      提示(错误.message, '错误');
    } finally {
      元素.电脑发声开关.disabled = false;
      刷新声音();
    }
  });
}
/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */
/* 侧栏                                                                */
/* ------------------------------------------------------------------ */

async function 发送剪贴板() {
  if (!状态.已连接) return 提示('先连接一台设备');
  const { 文本 } = 取值(await window.deck.剪贴板.读取());
  if (!文本) return 提示('电脑剪贴板是空的', '错误');
  取值(await window.deck.剪贴板.发送到手机(文本));
  提示(`已发送 ${文本.length} 个字符到手机剪贴板`, '成功');
}

function 绑定侧栏() {
  元素.刷新设备.addEventListener('click', () => 刷新设备列表(true));

  元素.下载adb.addEventListener('click', async () => {
    元素.下载adb.disabled = true;
    元素.下载adb.textContent = '准备中…';
    元素.下载进度.hidden = false;
    try {
      取值(await window.deck.adb.准备());
      提示('adb 准备完成', '成功');
      元素.环境提示.hidden = true;
      元素.下载adb.disabled = false;
      元素.下载adb.textContent = '下载 adb';
      await 刷新设备列表(false);
    } catch (错误) {
      元素.下载adb.disabled = false;
      元素.下载adb.textContent = '重试下载';
      提示(`下载失败：${错误.message}`, '错误');
    }
  });

  window.deck.adb.进度((信息) => {
    元素.下载进度.hidden = false;
    元素.进度填充.style.width = `${信息.percent}%`;
    元素.进度文字.textContent = 信息.message;
  });

  // 左侧按键：data-act 走动作表
  document.querySelectorAll('.按键').forEach((按钮) => {
    按钮.addEventListener('click', () => {
      // 只有带 data-act 的按钮才走动作表，否则执行动作会直接返回，看起来像点不动
      const 动作 = 按钮.dataset.act;
      if (!动作) return;
      执行动作(动作);
    });
  });

  元素.刷新状态.addEventListener('click', () => {
    刷新右侧();
    提示('已刷新');
  });

  // 「打开控制面板」：弹出独立窗口（摄像头、麦克风、虚拟摄像头都在里面）
  元素.打开更多窗口.addEventListener('click', () => {
    window.deck.更多.显示窗口(true).catch((错误) => 提示(错误.message, '错误'));
  });

  // 手动重连：恢复失败后的唯一入口
  元素.手动重连.addEventListener('click', () => 手动重连());
  元素.保存截图.addEventListener('click', () => 执行动作('截图'));

  元素.复制截图.addEventListener('click', async () => {
    if (!状态.已连接) return 提示('先连接一台设备');
    try {
      取值(await window.deck.截图.复制());
      提示('已复制原图到剪贴板（手机原始分辨率）', '成功');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  // 文字输入：直接投递到手机聚焦的输入框
  元素.文字表单.addEventListener('submit', async (事件) => {
    事件.preventDefault();
    if (!状态.已连接) return 提示('先连接一台设备');
    const 文本 = 元素.文字输入.value;
    if (!文本) return;
    try {
      const 结果 = 取值(await window.deck.设备.输入文本(文本));
      if (结果.已输入) {
        元素.文字输入.value = '';
        提示('已发送到手机输入框', '成功');
      } else {
        提示('手机没有聚焦的输入框，内容已复制到剪贴板', '错误');
      }
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  元素.最小化.addEventListener('click', () => window.deck.窗口.最小化());
  元素.最大化.addEventListener('click', () => window.deck.窗口.最大化());
  元素.关闭.addEventListener('click', () => window.deck.窗口.关闭());
}

/* ------------------------------------------------------------------ */
/* 设置抽屉                                                            */
/* ------------------------------------------------------------------ */

function 打开设置(页) {
  元素.设置遮罩.hidden = false;
  元素.设置抽屉.hidden = false;
  if (页) 切换到设置页(页);
  快捷键界面.重置录制();
}

function 关闭设置() {
  元素.设置遮罩.hidden = true;
  元素.设置抽屉.hidden = true;
  快捷键界面.重置录制();
}

function 切换到设置页(名称) {
  document.querySelectorAll('.设置标签').forEach((标签) => {
    标签.classList.toggle('选中', 标签.dataset.tab === 名称);
  });
  document.querySelectorAll('.设置页').forEach((页) => {
    页.hidden = 页.dataset.page !== 名称;
  });
}

function 应用设置(设置) {
  状态.设置 = 设置;
  应用主题(设置.主题);
  元素.主题选择.value = 设置.主题;
  元素.语言选择.value = 设置.语言;
  元素.剪贴板同步开关.checked = 设置.剪贴板同步 !== false;
  // 画质已固定为最高（跟随手机原生分辨率），界面上不再提供调节项
  状态.快捷键表 = 快捷键界面.编译绑定(设置.快捷键);
  快捷键界面.渲染快捷键列表(设置.快捷键);
}

async function 保存设置(片段) {
  try {
    const 新设置 = 取值(await window.deck.设置.保存(片段));
    应用设置(新设置);
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

async function 查看文档(名称) {
  const 标题 = {
    LICENSE: '开源协议（MIT）',
    PRIVACY: '隐私政策',
    CHANGELOG: '更新记录',
    README: '使用说明',
    THIRDPARTY: '第三方组件声明',
  };
  try {
    const 内容 = 取值(await window.deck.设置.文档(名称));
    元素.文档标题.textContent = 标题[名称] || '文档';
    // 用 Markdown 渲染，而不是直接塞纯文本：更新记录/README 里有标题、
    // 列表、代码块和表格，纯文本读起来很费劲。
    元素.文档内容.innerHTML = 渲染Markdown(内容);
    // 文档里的外链交给系统浏览器打开，不在应用内跳转
    元素.文档内容.querySelectorAll('[data-md-link]').forEach((链接) => {
      链接.addEventListener('click', (事件) => {
        事件.preventDefault();
        window.deck.打开链接(链接.dataset.mdLink);
      });
    });
    元素.文档遮罩.hidden = false;
    元素.文档对话框.hidden = false;
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

function 关闭文档() {
  元素.文档遮罩.hidden = true;
  元素.文档对话框.hidden = true;
}

/**
 * 初始化多语言。
 *
 * 流程：
 *   1. 读设置里存的语言代码（没存就是 zh-CN）
 *   2. 让主进程把该语言的语言包读出来
 *   3. 交给 i18n 模块，由它扫描 DOM 做文本替换
 *
 * 语言包加载失败（文件被删了、JSON 写坏了）不会中断启动，
 * 界面保持中文，同时在设置里提示一下。
 */
async function 初始化语言() {
  let 代码 = 'zh-CN';
  try {
    const 设置 = 取值(await window.deck.设置.读取());
    代码 = 设置.语言 || 'zh-CN';
  } catch {
    // 读不到设置就按中文走
  }

  if (代码 === 'zh-CN') {
    设置语言('zh-CN', null);
    await 刷新语言列表();
    return;
  }

  try {
    const 包 = 取值(await window.deck.语言.读取(代码));
    if (包 && 包.词典) {
      设置语言(代码, 包.词典);
    } else {
      设置语言('zh-CN', null);
      提示(`语言包 ${代码} 是空的，已回退中文`, '错误');
    }
  } catch (错误) {
    // 语言包坏了：回退中文，但把原因说出来，否则用户会以为设置没生效
    设置语言('zh-CN', null);
    提示('语言包加载失败：' + 错误.message, '错误');
  }

  await 刷新语言列表();
}

/**
 * 刷新语言下拉框。
 *
 * 列出内置语言 + 用户在数据目录里放的自定义语言。
 * 自定义语言的名称后面标出来源，方便用户确认自己那份有没有被读到。
 */
async function 刷新语言列表() {
  const 下拉 = 元素.语言选择;
  if (!下拉) return;

  try {
    const 列表 = 取值(await window.deck.语言.列表());
    下拉.replaceChildren();

    for (const 项 of 列表) {
      const 选项 = document.createElement('option');
      选项.value = 项.代码;
      // 自定义语言加个标记，一眼能看出哪几个是自己加的
      选项.textContent = 项.来源 === '自定义' ? `${项.名称}（自定义）` : 项.名称;
      下拉.appendChild(选项);
    }

    // 设置里存的语言若已不存在（用户删了语言包），回落到中文避免空白
    const 当前 = 状态.设置?.语言 || 'zh-CN';
    const 存在 = 列表.some((项) => 项.代码 === 当前);
    下拉.value = 存在 ? 当前 : 'zh-CN';
  } catch {
    // 列不出来就保留默认的中文选项
  }
}

function 绑定设置() {
  元素.设置按钮.addEventListener('click', () => 打开设置());
  元素.关闭设置.addEventListener('click', 关闭设置);
  元素.设置遮罩.addEventListener('click', 关闭设置);
  $('打开快捷键设置').addEventListener('click', () => 打开设置('快捷键'));

  document.querySelectorAll('.设置标签').forEach((标签) => {
    标签.addEventListener('click', () => 切换到设置页(标签.dataset.tab));
  });

  元素.主题选择.addEventListener('change', () => {
    应用主题(元素.主题选择.value);
    保存设置({ 主题: 元素.主题选择.value });
  });

  元素.语言选择.addEventListener('change', async () => {
    const 代码 = 元素.语言选择.value;
    await 保存设置({ 语言: 代码 });
    /*
     * 直接重新加载界面，而不是就地替换文本。
     *
     * 原因：文本替换虽然能改静态文案，但已经渲染出去的动态内容
     * （提示、设备列表、快捷键名等）仍然是旧语言，两边混在一起很难看。
     * 重新加载最干净，代价只是一次刷新。
     */
    location.reload();
  });

  元素.剪贴板同步开关.addEventListener('change', () =>
    保存设置({ 剪贴板同步: 元素.剪贴板同步开关.checked }),
  );

  元素.快捷键恢复默认.addEventListener('click', async () => {
    try {
      const 新设置 = 取值(await window.deck.设置.重置快捷键());
      应用设置(新设置);
      提示('已恢复默认绑定', '成功');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  /* ---- 自定义语言 ---- */

  // 打开语言包目录：顺带生成一份模板，用户可以直接丢给 AI 翻译
  元素.打开语言目录.addEventListener('click', async () => {
    try {
      const 数据 = 取值(await window.deck.语言.打开目录());
      元素.语言目录提示.textContent = 数据.目录;
      提示('已打开语言文件夹，里面有一份 _模板.json 可以照着填', '成功');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  // 重新扫描：用户放进新文件后不必重启应用就能刷出来
  元素.刷新语言列表.addEventListener('click', async () => {
    await 刷新语言列表();
    提示('已重新扫描语言包', '成功');
  });

  document.querySelectorAll('[data-doc]').forEach((按钮) => {
    按钮.addEventListener('click', () => 查看文档(按钮.dataset.doc));
  });

  document.querySelectorAll('[data-link]').forEach((按钮) => {
    按钮.addEventListener('click', () => window.deck.打开链接(按钮.dataset.link));
  });

  元素.检查更新.addEventListener('click', async () => {
    元素.更新结果.textContent = '正在检查…';
    try {
      const 结果 = 取值(await window.deck.设置.检查更新());
      元素.更新结果.textContent = 结果.有更新 ? `发现新版本 ${结果.最新版本}` : 结果.说明;
    } catch (错误) {
      元素.更新结果.textContent = 错误.message;
    }
  });

  快捷键界面.初始化({
    列表容器: 元素.快捷键列表,
    捕获提示: 元素.捕获提示,
    取消按钮: 元素.取消捕获,
    获取当前: () => 状态.设置?.快捷键 || {},
    保存: (新绑定) => 保存设置({ 快捷键: 新绑定 }),
  });
}

/* ------------------------------------------------------------------ */
/* 添加设备                                                            */
/* ------------------------------------------------------------------ */

/** 各品牌 USB 调试教程（指向官方帮助中心/开发者文档） */
const 教程链接 = {
  '小米 / Redmi': 'https://www.mi.com/service/support',
  '华为 / 荣耀': 'https://consumer.huawei.com/cn/support/',
  'OPPO / 一加 / realme': 'https://www.oppo.com/cn/service/',
  'vivo / iQOO': 'https://www.vivo.com.cn/service/',
  三星: 'https://www.samsung.com/cn/support/',
  '原生 Android': 'https://developer.android.com/studio/debug/dev-options',
};

function 打开添加设备(标签页 = 'usb') {
  元素.添加设备遮罩.hidden = false;
  元素.添加设备对话框.hidden = false;
  切换添加页(标签页);
  元素.usb状态.textContent = 状态.已连接
    ? `当前已连接：${状态.当前设备}`
    : '插上数据线后，设备会自动出现在左侧列表';
  刷新无线历史();
}

function 关闭添加设备() {
  元素.添加设备遮罩.hidden = true;
  元素.添加设备对话框.hidden = true;
}

function 切换添加页(模式) {
  document.querySelectorAll('.标签[data-mode]').forEach((标签) => {
    标签.classList.toggle('选中', 标签.dataset.mode === 模式);
  });
  document.querySelectorAll('.添加页').forEach((页) => {
    页.hidden = 页.dataset.page !== 模式;
  });
}

async function 刷新无线历史() {
  try {
    const 信息 = 取值(await window.deck.无线.本机信息());
    元素.历史设备.replaceChildren();
    if (!信息.历史?.length) {
      元素.历史设备.textContent = '暂无';
      return;
    }
    for (const 地址 of 信息.历史) {
      const 项 = document.createElement('button');
      项.className = '扫描项';
      项.textContent = 地址;
      项.addEventListener('click', () => 连接无线(地址));
      元素.历史设备.appendChild(项);
    }
  } catch {
  }
}

async function 连接无线(地址) {
  元素.连接地址.value = 地址;
  try {
    取值(await window.deck.无线.连接(地址));
    提示('已连接，正在建立画面通道…', '成功');
    关闭添加设备();
    await 刷新设备列表(false);
    const 目标 = 状态.设备.find((d) => d.serial === 地址 && d.state === 'device');
    if (目标) 选择设备(目标);
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

function 绑定添加设备() {
  元素.添加设备按钮.addEventListener('click', () => 打开添加设备());
  元素.关闭添加设备.addEventListener('click', 关闭添加设备);
  元素.添加设备遮罩.addEventListener('click', 关闭添加设备);
  元素.教程链接.addEventListener('click', () => 打开添加设备('教程'));

  document.querySelectorAll('.标签[data-mode]').forEach((标签) => {
    标签.addEventListener('click', () => 切换添加页(标签.dataset.mode));
  });

  元素.执行配对.addEventListener('click', async () => {
    try {
      取值(await window.deck.无线.配对(元素.配对地址.value, 元素.配对码.value));
      提示('配对成功，请用下方连接按钮连接', '成功');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  元素.执行连接.addEventListener('click', () => {
    const 地址 = 元素.连接地址.value.trim();
    if (!地址) return 提示('请填写手机 IP 与端口', '错误');
    连接无线(地址);
  });

  元素.扫描局域网.addEventListener('click', async () => {
    元素.扫描结果.textContent = '正在扫描局域网（约 4 秒）…';
    try {
      const 列表 = 取值(await window.deck.无线.扫描());
      元素.扫描结果.replaceChildren();
      if (!列表.length) {
        元素.扫描结果.textContent = '没找到已开放无线调试的设备';
        return;
      }
      for (const 地址 of 列表) {
        const 项 = document.createElement('button');
        项.className = '扫描项';
        项.textContent = 地址;
        项.addEventListener('click', () => 连接无线(地址));
        元素.扫描结果.appendChild(项);
      }
    } catch (错误) {
      元素.扫描结果.textContent = 错误.message;
    }
  });

  元素.转为无线.addEventListener('click', async () => {
    try {
      const 结果 = 取值(await window.deck.无线.转为无线());
      元素.连接地址.value = 结果.地址;
      提示(`已切换到无线模式：${结果.地址}`, '成功');
    } catch (错误) {
      提示(错误.message, '错误');
    }
  });

  document.querySelectorAll('[data-tutorial]').forEach((按钮) => {
    按钮.addEventListener('click', () => {
      const 名称 = 按钮.dataset.tutorial;
      window.deck.打开链接(教程链接[名称] || 教程链接['原生 Android']);
    });
  });

  元素.关闭文档.addEventListener('click', 关闭文档);
  元素.文档遮罩.addEventListener('click', 关闭文档);
}
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 主进程推送的事件                                                     */
/* ------------------------------------------------------------------ */

// 设备状态：断开 / 异常 / 已连接
window.deck.设备.状态((信息) => {
  if (信息.状态 === '已断开') {
    /*
     * 画面异常/断开的处理：**全程静默**。
     *
     * 横竖屏切换、码流抖动都会让通道重连，这些是正常现象，
     * 不该弹「设备断开」吓用户。用户要的只是画面自动接上。
     * 所以这里：锁住最后一帧 → 后台重连 → 成功就切比例，全程不提示。
     * 只有三次都失败、确实彻底断了，才在角落显示状态并给出手动重连。
     */
    状态.断开原因 = String(信息.原因 || '');
    锁住画面();

    if (状态.当前设备 && !状态.正在恢复) {
      后台重连(状态.当前设备, 3);
      return;
    }

    静默标记断开();
  } else if (信息.状态 === '异常') {
    // 异常同样静默处理，交给重连逻辑兜底，不弹错误
    锁住画面();
    if (状态.当前设备 && !状态.正在恢复) 后台重连(状态.当前设备, 3);
  } else if (信息.状态 === '已连接' && !状态.已连接) {
    // 主进程已连上而界面还没跟上：把界面状态对齐（例如连接比界面渲染慢一步）
    状态.已连接 = true;
    状态.当前设备 = 信息.序列号 || 状态.当前设备;
    界面_连接中(false);
    界面_显示画面();
    设置状态('画面同步中', '在线');
    刷新声音();
    clearInterval(状态.状态定时);
    // 400ms 一次：手机上调音量/亮度能几乎实时反映到电脑上。
    // 轮询本身是几条 dumpsys，开销很小，且拖动时会被 状态.正在拖动 跳过。
    状态.状态定时 = setInterval(刷新右侧, 800);
  }
});

// 处理一段视频帧
function 处理视频帧(帧) {
  if (!帧 || !帧.数据) return;
  if (!状态.播放器) 创建播放器();
  const 字节 = 帧.数据 instanceof Uint8Array ? 帧.数据 : new Uint8Array(帧.数据);
  状态.播放器.送数据(字节, 帧.关键帧 === true);
  if (!状态.已连接) {
    状态.已连接 = true;
    元素.手机壳.classList.add('已连接');
    元素.手机壳.classList.remove('等待中');
  }
  // 回报消费进度，主进程据此做背压丢帧。
  // 必须每帧都报：之前按「每 3 帧」节流，画面静止只有 2~3fps 时几乎永远
  // 不满足条件，主进程以为一直积压就一路丢帧，画面直接冻住。
  if (帧.帧号) {
    window.deck.画面.回报消费(帧.帧号);
  }
}

// 画面数据：主进程按「数据 + 是否关键帧 + 帧号」分包推来
window.deck.画面.片段((片段) => {
  处理视频帧(片段);
});

// 会话尺寸（编码分辨率）
window.deck.画面.会话((会话) => {
  状态.编码尺寸 = { 宽: 会话.宽, 高: 会话.高 };
  调整画面尺寸();
});

/*
 * 手机物理分辨率变化（横竖屏切换）。
 *
 * 主进程会重读一次 `wm size`，这里只更新状态与指标显示：
 *   - 编码尺寸由「会话」事件驱动，画布比例自动跟上
 *   - 触控坐标换算用的是画布尺寸，不受影响
 * 整个过程不重连、不提示，用户只会看到画面比例变过来。
 */
window.deck.画面.分辨率(({ 宽, 高 }) => {
  if (!宽 || !高) return;
  状态.手机尺寸 = { 宽, 高 };
  if (状态.设备信息) {
    状态.设备信息.width = 宽;
    状态.设备信息.height = 高;
  }
  元素.指标分辨率.textContent = `${宽}×${高}`;
});

// 手机复制了内容（主进程已写入电脑剪贴板）
window.deck.剪贴板.来自手机((信息) => {
  if (信息?.文本) 提示('已同步手机剪贴板到电脑', '成功');
});


/* ------------------------------------------------------------------ */
/* 画面异常恢复：锁帧 → 后台重连 → 切换比例 / 提示断开                 */
/* ------------------------------------------------------------------ */

/**
 * 锁住最后一帧画面。
 *
 * 画面出问题（码流错位、通道断开）时，绝对不要立刻清空画布——
 * 那会让用户突然看到一片黑，比看到一张"卡住的旧画面"更糟。
 * 这里只是停止继续送帧，画布上保留的内容原样留着。
 */
function 锁住画面() {
  状态.已连接 = false;
  // 不调用 界面_显示空画面()，画布内容保持不动
  设置状态('画面已暂停', '忙碌');
}

/**
 * 三次重连都失败后，才在界面上标记断开。
 *
 * 仍然不弹提示框——用户正在看手机画面，弹窗只会挡住内容。
 * 只在状态栏把文字改成「设备已断开」，并浮出「手动重连」按钮。
 */
function 静默标记断开() {
  状态.正在恢复 = false;
  设置状态('设备已断开', '异常');
  元素.连接标记?.classList.add('断开');
  if (元素.连接标记?.lastChild) 元素.连接标记.lastChild.textContent = '未连接';
  元素.指标帧率.textContent = '—';
  元素.指标延迟.textContent = '—';
  clearInterval(状态.状态定时);
  显示手动重连();
}

/**
 * 后台重连，最多 次数 次。
 *
 * 每次尝试前都会重新拉一次设备信息，这样横竖屏切换后拿到的是**新的宽高**，
 * 成功后画面自然按新比例显示，不需要额外处理。
 */
async function 后台重连(序列号, 次数) {
  if (状态.正在恢复) return;
  状态.正在恢复 = true;

  for (let i = 1; i <= 次数; i++) {
    设置状态('正在恢复画面（' + i + '/' + 次数 + '）', '忙碌');
    try {
      await 连接(序列号, true); // 静默：恢复过程不弹任何提示
      // 连接成功：比例会由新的会话尺寸驱动，这里主动重算一次布局
      状态.正在恢复 = false;
      状态.自动重连次数 = 0;
      调整画面尺寸();
      隐藏手动重连();
      设置状态('画面同步中', '在线');
      return;
    } catch {
      // 失败就等一会儿再试
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }

  状态.正在恢复 = false;
  静默标记断开();
}

/** 显示「手动重连」按钮 */
function 显示手动重连() {
  const 按钮 = 元素.手动重连;
  if (!按钮) return;
  按钮.hidden = false;
}

/** 隐藏「手动重连」按钮 */
function 隐藏手动重连() {
  const 按钮 = 元素.手动重连;
  if (按钮) 按钮.hidden = true;
}

/** 手动重连：用户点按钮时调用 */
async function 手动重连() {
  const 序列号 = 状态.当前设备 || 状态.设备?.[0]?.serial;
  if (!序列号) {
    // 没有记录设备就重新扫一遍，让用户自己点
    await 刷新设备列表(true);
    提示('请选择要连接的设备');
    return;
  }

  元素.手动重连.disabled = true;
  try {
    await 后台重连(序列号, 1);
  } finally {
    元素.手动重连.disabled = false;
  }
}
/* ------------------------------------------------------------------ */
/* 设备轮询                                                            */
/* ------------------------------------------------------------------ */

async function 刷新设备列表(手动) {
  try {
    const 列表 = 取值(await window.deck.设备.列表());
    const 新键 = 列表.map((d) => `${d.serial}:${d.state}`).join(',');
    const 旧键 = 状态.设备.map((d) => `${d.serial}:${d.state}`).join(',');
    状态.设备 = 列表;

    if (新键 !== 旧键 || 手动) {
      渲染设备列表();

      // 只有一台设备且未连接时自动连上
      if (!状态.已连接 && 列表.length === 1 && 列表[0].state === 'device') {
        选择设备(列表[0]);
      }
      if (!状态.已连接 && 列表.length === 1 && 列表[0].state === 'unauthorized') {
        确定引导('等待手机授权', '手机弹出了「允许 USB 调试吗」，请点「允许」。没有弹窗就拔插一次数据线。');
      }
    }

    if (列表.length === 0 && !状态.已连接) {
      确定引导('用 USB 线连接手机', '在手机上打开「开发者选项 → USB 调试」，插线后点「允许」。');
      设置状态('未连接设备', '');
    }
  } catch {
    // 轮询失败静默，下次再试
  }
}

function 确定引导(标题, 正文) {
  元素.空态标题.textContent = 标题;
  元素.空态正文.textContent = 正文;
}
/* ------------------------------------------------------------------ */

/**
 * 渲染「连接过的设备」。
 * 每行显示名称、连接方式、上次连接时间，并提供重连与删除。
 * 在线的那台标为使用中，避免重复连接。
 */
/**
 * 拉取「连接过的设备」并合并进设备列表。
 *
 * 合并后不再单独渲染历史区块，只把数据放进 状态.历史设备，
 * 由 渲染设备列表() 统一画在一张表里。
 */
async function 刷新历史设备() {
  try {
    const 列表 = 取值(await window.deck.设备.历史());
    状态.历史设备 = Array.isArray(列表) ? 列表 : [];
    渲染设备列表();
  } catch {
    状态.历史设备 = [];
  }
}

async function 重连设备(序列号) {
  提示('正在连接…');
  try {
    await 连接(序列号);
    await 刷新历史设备();
  } catch (错误) {
    提示('连接失败：' + 错误.message, '错误');
  }
}

async function 删除历史设备(序列号) {
  try {
    取值(await window.deck.设备.删除历史(序列号));
    await 刷新历史设备();
    提示('已删除', '成功');
  } catch (错误) {
    提示(错误.message, '错误');
  }
}

/** 时间戳 → 刚刚 / 3 分钟前 / 昨天 */
function 相对时间(时间戳) {
  if (!时间戳) return '';
  const 差 = Date.now() - 时间戳;
  if (差 < 60000) return '刚刚';
  if (差 < 3600000) return Math.floor(差 / 60000) + ' 分钟前';
  if (差 < 86400000) return Math.floor(差 / 3600000) + ' 小时前';
  const 天 = Math.floor(差 / 86400000);
  if (天 === 1) return '昨天';
  if (天 < 30) return 天 + ' 天前';
  return new Date(时间戳).toLocaleDateString('zh-CN');
}

async function 启动() {
  绑定触控();
  绑定键盘();
  绑定侧栏();
  绑定滑杆();
  绑定媒体控制();
  绑定设置();
  绑定添加设备();
  绑定声音开关();

  // 语言最先应用：后面的提示、列表都应该是目标语言
  await 初始化语言();

  界面_显示空画面();

  // 设置最先载入：主题与快捷键立刻生效
  try {
    应用设置(取值(await window.deck.设置.读取()));
  } catch {
    // 读不到就用默认（CSS 默认深色）
  }

  try {
    const 信息 = 取值(await window.deck.应用信息());
    元素.版本号.textContent = `v${信息.version}`;
    元素.关于版本.textContent = `版本 ${信息.version} · Electron ${信息.electron}`;
    元素.提示文字.textContent = 信息.adbVersion ? `adb ${信息.adbVersion}` : '';
  } catch {
    // 忽略
  }

  try {
    const 探测 = 取值(await window.deck.adb.探测());
    if (!探测.ok) {
      元素.环境提示.hidden = false;
      设置状态('需要先准备 adb', '忙碌');
    }
  } catch {
    元素.环境提示.hidden = false;
  }

  await 刷新历史设备();
  await 刷新设备列表(false);
  状态.轮询定时 = setInterval(() => 刷新设备列表(false), 2000);

  window.addEventListener('resize', () => 调整画面尺寸());
  window.deck.窗口.最大化变化(() => 调整画面尺寸());

  // 菜单里的「设置」把请求转给界面
  window.deck.菜单.打开设置((页) => 打开设置(页));

  // 全局禁用右键菜单（右键已是「返回」）
  window.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, .文档内容')) return;
    e.preventDefault();
  });
}

// 启动时机：模块脚本是 defer 执行，可能已经错过 DOMContentLoaded，
// 所以两种时机都覆盖，避免「界面一片空白但没有任何报错」这种最难查的情况。
// 供排查使用：把内部状态挂到 window 上（只读，正式功能不依赖它）
window.__调试 = { 状态, 元素, 执行动作 };

if (document.readyState === 'loading') {
window.addEventListener('DOMContentLoaded', 启动);
} else {
  启动();
}