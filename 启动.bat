@echo off
rem ===========================================================================
rem  Aoid launcher
rem
rem  This file is intentionally pure ASCII (English only).
rem  cmd.exe parses a batch file with the OEM code page (936 on Chinese
rem  Windows) before "chcp 65001" takes effect, so UTF-8 Chinese text inside a
rem  .bat gets split into garbage commands ("'tron' is not recognized").
rem  All Chinese output comes from scripts\notify.mjs instead.
rem
rem  Line endings must be CRLF.
rem ===========================================================================

setlocal
cd /d "%~dp0"

rem ELECTRON_RUN_AS_NODE makes Electron run in plain Node mode and crash.
set "ELECTRON_RUN_AS_NODE="
rem Some debugging setups point this at another Electron build; it makes a
rem freshly started instance crash on startup.
set "VIPSHOME="

title Aoid

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
    set "NODE_EXE="
    if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"
)

if defined NODE_EXE %NODE_EXE% "scripts\notify.mjs" banner

rem ---- 1. dependencies -----------------------------------------------------
if exist "node_modules\electron\dist\electron.exe" goto deps_ok

if not defined NODE_EXE goto no_node_at_all
where npm >nul 2>nul
if errorlevel 1 goto no_npm

%NODE_EXE% "scripts\notify.mjs" installing
call npm install --no-audit --no-fund

if exist "node_modules\electron\dist\electron.exe" goto installed
if exist "node_modules\electron\package.json" (
    %NODE_EXE% "scripts\notify.mjs" fetching-electron
    %NODE_EXE% "node_modules\electron\install.js"
)
if not exist "node_modules\electron\dist\electron.exe" goto install_failed

:installed
%NODE_EXE% "scripts\notify.mjs" installed
goto self_check

:deps_ok
if defined NODE_EXE %NODE_EXE% "scripts\notify.mjs" deps-ok
goto self_check

:no_node_at_all
echo.
echo   [ERROR] Node.js not found and node_modules is missing.
echo           Install Node.js 20 or newer: https://nodejs.org
pause
exit /b 1

:no_npm
%NODE_EXE% "scripts\notify.mjs" first-run-no-npm
pause
exit /b 1

:install_failed
%NODE_EXE% "scripts\notify.mjs" install-failed
pause
exit /b 1

rem ---- 2. self check -------------------------------------------------------
:self_check
if not defined NODE_EXE goto start_app
%NODE_EXE% "scripts\notify.mjs" self-check
%NODE_EXE% "scripts\check.mjs"
if errorlevel 1 goto check_failed
goto start_app

:check_failed
%NODE_EXE% "scripts\notify.mjs" check-failed
pause
exit /b 1

rem ---- 3. start ------------------------------------------------------------
rem Electron cannot run reliably straight off a network drive (Z:, mapped UNC).
rem It dies instantly with exit code 0x80000003 and no message. Detect that up
rem front and run from a local copy instead - the user should not have to care.
:start_app
if defined NODE_EXE %NODE_EXE% "scripts\launch.mjs"
if errorlevel 1 goto start_failed

ping -n 6 127.0.0.1 >nul 2>nul

tasklist /v /fi "imagename eq electron.exe" 2>nul | find /i "Aoid" >nul
if errorlevel 1 goto start_failed

if defined NODE_EXE %NODE_EXE% "scripts\notify.mjs" started
ping -n 4 127.0.0.1 >nul 2>nul
exit /b 0

:start_failed
if defined NODE_EXE (
    %NODE_EXE% "scripts\notify.mjs" start-failed
) else (
    echo   Aoid failed to start. Run manually to see the error:
    echo       node_modules\electron\dist\electron.exe .
)
pause
exit /b 1