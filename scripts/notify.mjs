/**
 * 启动脚本的提示输出。
 *
 * 为什么中文提示放在这里，而不是写在 .bat 里：
 *   cmd.exe 会先按系统 OEM 代码页（中文 Windows 是 936）解析整个 bat，
 *   chcp 65001 之后才生效，于是 bat 里的 UTF-8 中文会被拆成乱码命令，
 *   出现 "'tron' is not recognized" 这类报错。
 *   所以 bat 保持纯 ASCII，中文由这个 Node 脚本输出（Node 处理 UTF-8 没问题）。
 *
 * 用法：node scripts/notify.mjs <阶段>
 * 阶段：banner | installing | installed | deps-ok | first-run-no-npm |
 *       install-failed | self-check | no-node | check-failed |
 *       starting | started | start-failed
 */
import process from 'node:process';

const 提示 = {
  banner: ['', '  Aoid  电脑控制手机', '  ------------------------------', ''],

  installing: ['  首次运行，正在安装依赖，请稍候（约 1~3 分钟）...'],
  'fetching-electron': ['  Electron 运行时未下载完成，正在补下载...'],
  installed: ['  依赖安装完成。'],
  'deps-ok': ['  [1/3] 依赖已就绪'],

  'first-run-no-npm': [
    '',
    '  [错误] 没有找到 npm。',
    '         请先安装 Node.js 20 或更高版本：https://nodejs.org',
  ],

  'install-failed': [
    '',
    '  [错误] 依赖安装失败。',
    '         请在项目目录手动执行：npm install',
  ],

  'self-check': ['  [2/3] 正在自检...'],
  'no-node': ['  跳过自检（没有找到 Node.js）'],
  'check-failed': ['', '  [错误] 自检未通过，请按上面的提示处理后重试。'],

  starting: ['  [3/3] 正在启动 Aoid...', ''],

  started: ['  启动成功。', '', '  这个窗口可以直接关掉，不影响 Aoid 运行。'],

  'start-failed': [
    '  启动 Aoid 失败。',
    '',
    '  请依次尝试：',
    '    1. 手动运行下面的命令，查看具体报错：',
    '         node_modules\\electron\\dist\\electron.exe .',
    '    2. 确认手机已插好数据线，且没有其他程序占用',
    '    3. 首次启动可能较慢，可以多等几秒再看',
  ],
};

const 阶段 = process.argv[2] || '';
const 行 = 提示[阶段];

if (行) {
  for (const 一 of 行) console.log(一);
} else if (阶段) {
  console.log(`(未知阶段: ${阶段})`);
}
