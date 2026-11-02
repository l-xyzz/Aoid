/**
 * 沉浸窗口的渲染逻辑。
 *
 * 只显示手机画面 + 三个窗口控件，关掉后主窗口自动回来。
 *
 * 画面来源（最终方案：直接映射原窗口）：
 *   主进程周期性对主窗口 webContents.capturePage() 截图，
 *   把图片 dataURL 通过 镜像:帧 推到这里。
 *   这里不解码、不订阅视频流，只把图片 drawImage 上屏。
 *
 *   这样打开即有所见，完全复用主窗口正在显示的画面，
 *   不存在「等待手机画面」的问题。
 */
'use strict';

const $ = (id) => document.getElementById(id);

const 画布 = $('沉浸画布');
const 空态 = $('沉浸空态');

const 上下文 = 画布.getContext('2d', { alpha: false });
上下文.imageSmoothingEnabled = true;
上下文.imageSmoothingQuality = 'high';

/** 当前帧的原生尺寸 */
let 帧宽 = 画布.width;
let 帧高 = 画布.height;
let 首帧已到 = false;

/* ---------------- 画面 ---------------- */

// 复用一张 Image，避免每帧 new Image 的开销
const 图片 = new Image();
图片.onload = () => {
  // 尺寸变化（横竖屏）时同步画布
  if (图片.naturalWidth && (图片.naturalWidth !== 帧宽 || 图片.naturalHeight !== 帧高)) {
    画布.width = 帧宽 = 图片.naturalWidth;
    画布.height = 帧高 = 图片.naturalHeight;
  }
  上下文.drawImage(图片, 0, 0, 画布.width, 画布.height);
  自适应缩放();

  if (!首帧已到) {
    首帧已到 = true;
    空态.hidden = true;
  }
};

/** 订阅主进程推来的镜像帧 */
function 订阅画面() {
  if (!window.deck || !window.deck.画面 || !window.deck.画面.帧) {
    空态.textContent = '画面通道不可用';
    空态.style.color = '#ff9aa2';
    return;
  }
  window.deck.画面.帧((数据) => {
    if (数据 && 数据.数据) 图片.src = 数据.数据;
  });
}

/**
 * 按窗口尺寸等比缩放画布，多余的留黑。
 * canvas 没有 object-fit，必须用 JS 算 display size。
 */
function 自适应缩放() {
  if (!帧宽 || !帧高) return;
  const 容器宽 = window.innerWidth;
  const 容器高 = window.innerHeight;
  const 比例 = 帧宽 / 帧高;

  let 显示宽 = 容器宽;
  let 显示高 = 显示宽 / 比例;
  if (显示高 > 容器高) {
    显示高 = 容器高;
    显示宽 = 显示高 * 比例;
  }
  画布.style.width = Math.round(显示宽) + 'px';
  画布.style.height = Math.round(显示高) + 'px';
}

window.addEventListener('resize', 自适应缩放);

/* ---------------- 窗口控件 ---------------- */

$('沉浸最小化').addEventListener('click', () => {
  window.deck.窗口.沉浸控制({ 动作: '最小化' });
});

$('沉浸最大化').addEventListener('click', () => {
  window.deck.窗口.沉浸控制({ 动作: '最大化' });
});

$('沉浸关闭').addEventListener('click', () => {
  window.deck.窗口.沉浸控制({ 动作: '关闭' });
});

document.addEventListener('keydown', (事件) => {
  if (事件.key === 'Escape') {
    事件.preventDefault();
    window.deck.窗口.关闭沉浸();
  }
});

/* ---------------- 启动 ---------------- */

订阅画面();
自适应缩放();
