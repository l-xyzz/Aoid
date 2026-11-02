/**
 * electron-builder 的 afterPack 钩子。
 *
 * 用途：打包完成后删掉用不到的 Chromium 组件，减小体积。
 *
 * 为什么不用 win.files 排除：
 *   实测 `win.files: ['!dxcompiler.dll']` 对 exe 同级的 dll 无效——
 *   那些文件由 electron-builder 内置逻辑从 Electron 发行版复制，
 *   不经过 files 过滤。而且误加 files 反而让体积变大（117→129MB）。
 *   正确做法是在打包结束、生成安装包之前把它们删掉。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 可以从 win-unpacked 安全删除的文件 */
const 可删文件 = [
  // DirectX Shader Compiler，仅供 WebGPU。Aoid 走 Canvas 2D，用不到。（24.6MB）
  'dxcompiler.dll',
];

module.exports = async function afterPack(context) {
  const 目录 = context.appOutDir;
  console.log('\n[afterPack] 清理冗余组件：' + 目录);

  let 省下 = 0;
  for (const 名 of 可删文件) {
    const 全路径 = path.join(目录, 名);
    try {
      if (fs.existsSync(全路径)) {
        const 大小 = fs.statSync(全路径).size;
        fs.unlinkSync(全路径);
        省下 += 大小;
        console.log(`  ✓ 已删除 ${名}  ${(大小 / 1048576).toFixed(1)} MB`);
      }
    } catch (e) {
      console.warn(`  ⚠ 删除 ${名} 失败：${e.message}`);
    }
  }

  console.log(`[afterPack] 共省下 ${(省下 / 1048576).toFixed(1)} MB\n`);
};
