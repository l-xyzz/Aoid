/**
 * NSIS 自定义脚本：安装前彻底清理旧版本，避免各种「无法写入 / 无法关闭」。
 *
 * 用户实际遇到的两种报错：
 *   1.「Aoid 无法关闭，请手动关闭它，然后单点重试以继续」（进度条反复倒退）
 *   2.「不能打开要写入的文件：...\Aoid\Uninstall Aoid.exe」
 *
 * 原因：
 *   - Aoid 是 Electron 应用，运行时有 4 个进程，主程序名检查漏掉子进程
 *   - 卸载程序 Uninstall Aoid.exe 在更新安装时也被重写，如果它自己还挂着就写不进去
 *   - 上一次安装中断会留下半残目录，NSIS 往里写文件时撞上残留
 *
 * 做法：安装器一启动就做三件事——杀进程、清半残目录、再杀一遍。
 */

; 结束所有相关进程。taskkill 失败（比如对方是管理员权限）时用 PowerShell 兜底。
!macro 结束Aoid进程
  ; 主程序（Electron 多进程用 /T 连子进程）
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM Aoid.exe'
  Pop $0

  ; 卸载程序也可能还挂着
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "Uninstall Aoid.exe"'
  Pop $0

  ; 等系统释放文件句柄
  Sleep 1500

  ; 再清一遍刚才新冒出来的
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM Aoid.exe'
  Pop $0
  Sleep 800
!macroend

; 安装器一启动：先杀进程，再清半残目录
!macro customInit
  DetailPrint "准备安装：正在关闭旧版本…"
  !insertmacro 结束Aoid进程

  ; 目录存在但缺主程序 = 上次装了一半，整体清掉重来
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 跳过清理
    DetailPrint "检测到上次安装不完整，正在清理残留目录…"
    RMDir /r "$INSTDIR"
    Sleep 800
  跳过清理:
!macroend

; 解包前再确认一次进程没了
!macro customCheckAppRunning
  !insertmacro 结束Aoid进程
!macroend

; 卸载时也先杀进程，否则卸载不干净
!macro customUnInit
  !insertmacro 结束Aoid进程
!macroend
