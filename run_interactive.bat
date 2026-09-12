@echo off
chcp 65001 >nul
rem Silence mode con: it fails noisily on consoles that cannot be resized.
mode con cols=85 lines=25 >nul 2>nul
color 0f
echo =====================================================================================
echo    🎨 SmartImage-Toolkit (交互模式版)
echo =====================================================================================
echo.
echo ⚙️ [启动] 正在检查运行环境并启动引擎...

rem IMPORTANT: keep every comment in this file ASCII-only and start it with "rem".
rem cmd.exe mis-reads "::" comment lines that contain non-ASCII text while the console
rem code page is 65001: it drops the "::" prefix and runs the rest of the line as a command
rem (symptom: "'xxx' is not recognized as an internal or external command").
rem Prefer the bundled portable runtime (bin\node.exe). Otherwise pick the first node on PATH
rem that is Node 18 or newer: IDE bundles and tool vendors (WeChat devtools, ...) ship ancient
rem node.exe files that shadow the real one, and those lack the Web globals (Blob/fetch) the
rem AI cutout path depends on. If every candidate is older, keep the first one and let the
rem runtime guard in lib\core.js explain what the AI feature needs.
set "NODE_EXE=%~dp0bin\node.exe"
if exist "%NODE_EXE%" goto :NODE_READY

set "NODE_EXE="
set "FALLBACK_NODE="
for /f "delims=" %%i in ('where node 2^>nul') do call :TRY_NODE "%%i"
if not defined NODE_EXE set "NODE_EXE=%FALLBACK_NODE%"
if not defined NODE_EXE goto :MISSING_NODE

:NODE_READY

cd /d "%~dp0"

rem Install dependencies on first run.
if exist "node_modules\" goto :RUN_NODE

echo 📦 [安装] 首次运行，正在自动配置必要组件，请稍候...
call npm install --silent
if %errorlevel% neq 0 goto :NPM_FAILED

:RUN_NODE
rem Launch chain (same idea as the bootstrap fast path, pick one):
rem   1) packaged build: compiled output is preferred, node lib\convert.js --interactive (no devDeps, clean machine).
rem   2) dev checkout without lib: fall back to ts-node on src\convert.ts --interactive (needs devDeps).
rem Default format is webp inside convert.ts; never hardcode --format here or it swallows the
rem user's own --format passed through %*.
if exist "lib\convert.js" (
    call "%NODE_EXE%" lib\convert.js --interactive %*
) else (
    call "%CD%\node_modules\.bin\ts-node.cmd" src\convert.ts --interactive %*
)

if %errorlevel% neq 0 goto :RUN_ERROR

rem Success: keep the window up briefly before closing.
echo.
echo ✅ [就绪] 流程结束！窗口将在 5 秒后优雅地自动关闭...
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

:TRY_NODE
rem Pick the first Node 18+ candidate on PATH; remember the first hit as a fallback.
if defined NODE_EXE exit /b
if not defined FALLBACK_NODE set "FALLBACK_NODE=%~1"
set "MAJOR="
for /f "delims=." %%m in ('"%~1" -v 2^>nul') do set "MAJOR=%%m"
if not defined MAJOR exit /b
set "MAJOR=%MAJOR:v=%"
echo %MAJOR%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 exit /b
if %MAJOR% GEQ 18 set "NODE_EXE=%~1"
exit /b
