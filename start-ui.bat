@echo off
rem IMPORTANT: keep every comment in this file ASCII-only and start it with "rem".
rem cmd.exe mis-reads "::" comment lines that contain non-ASCII text while the console
rem code page is 65001: it drops the "::" prefix and runs the rest of the line as a command
rem (symptom: "'xxx' is not recognized as an internal or external command").
rem Accepts every dragged / "Send to" argument (several images at once).
setlocal enabledelayedexpansion

cd /d "%~dp0"

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
if not defined NODE_EXE (
    echo [ERROR] Node.js not found on PATH. Please install Node 18 or newer.
    pause
    exit /b 1
)

:NODE_READY
rem No arguments: open an empty UI.
if "%~1"=="" (
    start "" "%NODE_EXE%" bootstrap.js
    exit /b
)

rem One concurrent process (and browser page) per image argument.
:loop
if "%~1"=="" goto end
start "" "%NODE_EXE%" bootstrap.js "%~1"
shift
goto loop

:end
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
