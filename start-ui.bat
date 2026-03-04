@echo off
:: 接收所有拖拽或“发送到”进来的参数（多张图片）
setlocal enabledelayedexpansion

cd /d "c:\Users\shiro\Tools\SmartImage-Toolkit"

:: 如果没有参数，直接启动打开一个空界面
if "%~1"=="" (
    start cmd /c "node bootstrap.js"
    exit /b
)

:: 遍历所有传进来的图片参数，为每一张图片都并发出一个进程打开网页
:loop
if "%~1"=="" goto end
start cmd /c "node bootstrap.js "%~1""
shift
goto loop

:end
