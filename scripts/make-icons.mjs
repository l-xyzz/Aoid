/**
 * 图标生成脚本（零依赖）。
 *
 * 自己用光线投射画一个 3D 小方块 + 手机屏幕的图标，输出多尺寸 PNG：
 *   resources/icon.png        512×512 应用图标（窗口与任务栏）
 *   resources/icon.ico        多尺寸 ICO（打包用，PNG 内嵌格式）
 *
 * 用法：node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const 根目录 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* PNG 编码（RGBA8）                                                   */
/* ------------------------------------------------------------------ */

const CRC表 = (() => {
  const 表 = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    表[n] = c >>> 0;
  }
  return 表;
})();

function crc32(缓冲) {
  let c = 0xffffffff;
  for (let i = 0; i < 缓冲.length; i += 1) c = CRC表[(c ^ 缓冲[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 块 */
function 块(类型, 数据) {
  const 长度 = Buffer.alloc(4);
  长度.writeUInt32BE(数据.length);
  const 类型和数据 = Buffer.concat([Buffer.from(类型, 'latin1'), 数据]);
  const 校验 = Buffer.alloc(4);
  校验.writeUInt32BE(crc32(类型和数据));
  return Buffer.concat([长度, 类型和数据, 校验]);
}

/** RGBA 缓冲区编码成 PNG */
function 编码PNG(rgba, 宽, 高) {
  const 头 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(宽, 0);
  ihdr.writeUInt32BE(高, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前面加一个过滤器字节 0
  const 原始 = Buffer.alloc((宽 * 4 + 1) * 高);
  for (let y = 0; y < 高; y += 1) {
    原始[y * (宽 * 4 + 1)] = 0;
    rgba.copy(原始, y * (宽 * 4 + 1) + 1, y * 宽 * 4, (y + 1) * 宽 * 4);
  }
  const 压缩 = zlib.deflateSync(原始, { level: 9 });

  return Buffer.concat([头, 块('IHDR', ihdr), 块('IDAT', 压缩), 块('IEND', Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ */
/* 图标绘制                                                            */
/* ------------------------------------------------------------------ */

/** 线性混合 */
function 混合(底, 顶, 透明度) {
  return {
    r: 底.r + (顶.r - 底.r) * 透明度,
    g: 底.g + (顶.g - 底.g) * 透明度,
    b: 底.b + (顶.b - 底.b) * 透明度,
  };
}

/** 圆角矩形的有向距离（负数表示在内部） */
function 圆角矩形距离(px, py, cx, cy, 半宽, 半高, 圆角) {
  const dx = Math.abs(px - cx) - (半宽 - 圆角);
  const dy = Math.abs(py - cy) - (半高 - 圆角);
  const 外 = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const 内 = Math.min(Math.max(dx, dy), 0);
  return 外 + 内 - 圆角;
}

/**
 * 画一张 512×512 的图标：深色圆角底板 + 竖放的手机 + 琥珀色屏幕光。
 * 边缘用超采样抗锯齿，看起来干净。
 */
function 画图标(尺寸) {
  const 画布 = Buffer.alloc(尺寸 * 尺寸 * 4);
  const 采样 = 3;
  const 单位 = 尺寸 / 512;

  const 底色 = { r: 17, g: 20, b: 25 };
  const 琥珀 = { r: 245, g: 165, b: 36 };
  const 琥珀亮 = { r: 255, g: 205, b: 120 };

  for (let y = 0; y < 尺寸; y += 1) {
    for (let x = 0; x < 尺寸; x += 1) {
      let 红 = 0;
      let 绿 = 0;
      let 蓝 = 0;
      let 透明 = 0;

      for (let sy = 0; sy < 采样; sy += 1) {
        for (let sx = 0; sx < 采样; sx += 1) {
          const px = (x + (sx + 0.5) / 采样) / 单位;
          const py = (y + (sy + 0.5) / 采样) / 单位;

          let 颜色 = 底色;
          let 当前透明 = 1;

          // 底板：圆角矩形，带一点点竖向渐变
          const 底板距离 = 圆角矩形距离(px, py, 256, 256, 240, 240, 96);
          if (底板距离 > 0) {
            当前透明 = 0;
          } else {
            const 渐变 = Math.min(1, Math.max(0, (py - 20) / 480));
            颜色 = 混合({ r: 28, g: 32, b: 39 }, { r: 11, g: 13, b: 16 }, 渐变);
          }

          // 手机外框：竖放圆角矩形，偏右一点点更自然
          const 框距离 = 圆角矩形距离(px, py, 256, 258, 108, 168, 40);
          if (当前透明 > 0 && 框距离 < 0) {
            颜色 = 混合({ r: 42, g: 47, b: 56 }, { r: 26, g: 30, b: 36 }, py / 512);
          }

          // 屏幕：内凹的圆角矩形，琥珀色渐变
          const 屏距离 = 圆角矩形距离(px, py, 256, 258, 88, 146, 28);
          if (当前透明 > 0 && 屏距离 < 0) {
            const 竖向 = Math.min(1, Math.max(0, (py - 112) / 300));
            颜色 = 混合(琥珀亮, 琥珀, 0.35 + 竖向 * 0.6);
          }

          // 屏幕里的一道斜向高光，让图标有点“亮着”的感觉
          if (当前透明 > 0 && 屏距离 < 0) {
            const 高光 = (px - 150) * 0.5 + (py - 130) * -0.85;
            if (高光 > -40 && 高光 < 40) {
              const 强度 = 1 - Math.abs(高光) / 40;
              颜色 = 混合(颜色, { r: 255, g: 246, b: 226 }, 强度 * 0.22);
            }
          }

          // 听筒
          const 听筒距离 = 圆角矩形距离(px, py, 256, 138, 20, 5, 5);
          if (当前透明 > 0 && 听筒距离 < 0 && 颜色.b < 200) {
            颜色 = { r: 232, g: 234, b: 237 };
          }

          红 += 颜色.r * 当前透明;
          绿 += 颜色.g * 当前透明;
          蓝 += 颜色.b * 当前透明;
          透明 += 当前透明;
        }
      }

      const 总数 = 采样 * 采样;
      const 序号 = (y * 尺寸 + x) * 4;
      画布[序号] = Math.round(红 / 总数);
      画布[序号 + 1] = Math.round(绿 / 总数);
      画布[序号 + 2] = Math.round(蓝 / 总数);
      画布[序号 + 3] = Math.round((透明 / 总数) * 255);
    }
  }

  return 画布;
}

/* ------------------------------------------------------------------ */
/* ICO 封装（PNG 内嵌）                                                */
/* ------------------------------------------------------------------ */

function 编码ICO(条目) {
  // ICO 头：保留 0 + 类型 1 + 数量
  const 头 = Buffer.alloc(6);
  头.writeUInt16LE(0, 0);
  头.writeUInt16LE(1, 2);
  头.writeUInt16LE(条目.length, 4);

  const 目录 = Buffer.alloc(16 * 条目.length);
  let 偏移 = 6 + 目录.length;

  条目.forEach(({ 尺寸, png }, 序号) => {
    const 基 = 序号 * 16;
    目录[基] = 尺寸 >= 256 ? 0 : 尺寸;
    目录[基 + 1] = 尺寸 >= 256 ? 0 : 尺寸;
    目录[基 + 2] = 0; // 调色板数
    目录[基 + 3] = 0;
    目录.writeUInt16LE(1, 基 + 4); // 平面数
    目录.writeUInt16LE(32, 基 + 6); // 位深
    目录.writeUInt32LE(png.length, 基 + 8);
    目录.writeUInt32LE(偏移, 基 + 12);
    偏移 += png.length;
  });

  return Buffer.concat([头, 目录, ...条目.map((项) => 项.png)]);
}

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

const 资源目录 = path.join(根目录, 'resources');
fs.mkdirSync(资源目录, { recursive: true });

// 主图标
const 主图标 = 编码PNG(画图标(512), 512, 512);
fs.writeFileSync(path.join(资源目录, 'icon.png'), 主图标);

// ICO 需要的多个尺寸
const 尺寸列表 = [256, 128, 64, 48, 32, 16];
const 条目 = 尺寸列表.map((尺寸) => {
  const 画布 = 画图标(尺寸);
  return { 尺寸, png: 编码PNG(画布, 尺寸, 尺寸) };
});
const ico = 编码ICO(条目);
fs.writeFileSync(path.join(资源目录, 'icon.ico'), ico);

// 界面上用的小图标（托盘/关于页可直接引用 png）
console.log(`已生成 icon.png（${(主图标.length / 1024).toFixed(0)} KB）`);
console.log(`已生成 icon.ico（${(ico.length / 1024).toFixed(0)} KB，含 ${尺寸列表.join('/')}）`);
