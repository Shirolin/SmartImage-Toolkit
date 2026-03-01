@echo off
chcp 65001 >nul
mode con cols=85 lines=25
color 0f
echo =====================================================================================
echo    🚀 SmartImage-Toolkit (静默转换版)
echo =====================================================================================
echo.
echo ⚙️ [启动] 正在检查运行环境并启动引擎...

:: 优先检查本地便携版 Node.js
set "NODE_EXE=%~dp0bin\node.exe"
if not exist "%NODE_EXE%" (
    :: 如果没有便携版，再检查系统级 Node.js
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        set "NODE_EXE=node"
    ) else (
        goto :MISSING_NODE
    )
)

cd /d "%~dp0"

:: 检查 node_modules 是否存在
if exist "node_modules\" goto :RUN_NODE

echo 📦 [安装] 首次运行，正在自动配置必要组件，请稍候...
call npm install --silent
if %errorlevel% neq 0 goto :NPM_FAILED

:RUN_NODE
:: 运行阶段：利用 ts-node 无缝执行 TypeScript
call "%CD%\node_modules\.bin\ts-node.cmd" src\convert.ts --format webp %*

if %errorlevel% neq 0 goto :RUN_ERROR

:: 运行成功，自动关闭黑窗前稍微停留一点时间
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

