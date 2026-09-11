@echo off
chcp 65001 >nul
rem Silence mode con: it fails noisily on consoles that cannot be resized.
mode con cols=85 lines=25 >nul 2>nul
color 0f
echo =====================================================================================
echo    🚀 SmartImage-Toolkit (静默转换版)
echo =====================================================================================
echo.
echo ⚙️ [启动] 正在检查运行环境并启动引擎...

rem IMPORTANT: keep every comment in this file ASCII-only and start it with "rem".
rem cmd.exe mis-reads "::" comment lines that contain non-ASCII text while the console
rem code page is 65001: it drops the "::" prefix and runs the rest of the line as a command
rem (symptom: "'xxx' is not recognized as an internal or external command").
rem Prefer the bundled portable runtime (bin\node.exe).
set "NODE_EXE=%~dp0bin\node.exe"
if not exist "%NODE_EXE%" (
    rem No bundled runtime found: fall back to a system-wide node.
    rem Checked with "if errorlevel" on purpose - %errorlevel% inside a block is expanded
    rem before "where" runs, so any earlier failure (e.g. mode con) would fake a miss.
    where node >nul 2>nul
    if errorlevel 1 goto :MISSING_NODE
    set "NODE_EXE=node"
)

cd /d "%~dp0"

rem Install dependencies on first run.
if exist "node_modules\" goto :RUN_NODE

echo 📦 [安装] 首次运行，正在自动配置必要组件，请稍候...
call npm install --silent
if %errorlevel% neq 0 goto :NPM_FAILED

:RUN_NODE
rem Launch chain (same idea as the bootstrap fast path, pick one):
rem   1) packaged build: compiled output is preferred, node lib\convert.js (no devDeps, clean machine).
rem   2) dev checkout without lib: fall back to ts-node on src\convert.ts (needs devDeps).
rem Default format is webp inside convert.ts; never hardcode --format here or it swallows the
rem user's own --format passed through %*.
if exist "lib\convert.js" (
    call "%NODE_EXE%" lib\convert.js %*
) else (
    call "%CD%\node_modules\.bin\ts-node.cmd" src\convert.ts %*
)

if %errorlevel% neq 0 goto :RUN_ERROR

rem Success: keep the window up briefly before closing.
echo.
echo ✅ [就绪] 转换成功！窗口将在 5 秒后优雅地自动关闭...
timeout /t 5 >nul
exit /b

:RUN_ERROR
echo ❌ [失败] 程序运行出错。
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('抱歉，转换过程中发生了未料到的引擎错误。请检查控制台日志获取更多信息。', 'SmartImage-Toolkit 运行错误', 'OK', 'Error')"
pause
exit /b

:MISSING_NODE
echo ⚠️ [警告] 未检测到 Node.js，请先安装。
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('缺少核心环境 (Node.js)。`n`n运行本程序需要安装 Node.js。点击确定将为您自动打开官方下载页面，请下载长期维护版 (LTS)。', '环境缺失', 'OK', 'Warning')"
start https://nodejs.org/
exit /b

:NPM_FAILED
echo ❌ [错误] 依赖组件安装失败，请检查网络连接或更换 npm 源后重试。
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('首次运行安装必要组件失败！`n`n请检查您的网络连接、代理或尝试更换 npm 源后再试。', '初始化失败', 'OK', 'Error')"
pause
exit /b

