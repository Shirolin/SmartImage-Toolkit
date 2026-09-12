@echo off
chcp 65001 >nul
rem Silence mode con: it fails noisily on consoles that cannot be resized.
mode con cols=85 lines=25 >nul 2>nul
color 0f
echo =====================================================================================
echo    SmartImage-Toolkit - interactive mode
echo =====================================================================================
echo.
echo [start] Checking the runtime and starting the engine...

rem IMPORTANT - keep this file pure ASCII, comments included.
rem Under code page 65001 cmd.exe mis-parses lines whose multi-byte characters land across
rem its internal read buffer: it drops part of the line or runs the rest as a command
rem (symptom: "'xxx' is not recognized as an internal or external command", occasionally the
rem window just closes before anything can be read). All Chinese UI text is printed by the
rem Node side, which handles UTF-8 correctly - never echo it from here.

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

echo [setup] First run: installing dependencies, please wait...
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

rem Exit codes agreed with the CLI: 0 = success, 2 = cancelled by the user, any other value
rem = failure. This read must stay on a line of its own: %errorlevel% inside a parenthesized
rem block is expanded when the whole block is parsed, so the fresh value would be missed.
set "RC=%errorlevel%"
if "%RC%"=="0" goto :RUN_DONE
if "%RC%"=="2" goto :RUN_CANCELLED
goto :RUN_ERROR

:RUN_DONE
rem Success: keep the window up briefly before closing.
echo.
echo Done. This window closes in 5 seconds...
timeout /t 5 >nul
exit /b 0

:RUN_CANCELLED
rem Stopping on purpose is a normal outcome (partial output may already exist): report it
rem plainly, never show the success line and never raise the error dialog.
echo.
echo Session cancelled. This window closes in 5 seconds...
timeout /t 5 >nul
exit /b 2

:RUN_ERROR
echo [error] Processing did not complete. See the messages above for the reason.
rem Neutral wording on purpose: a couple of failed files or a folder with nothing to convert
rem are expected outcomes of a batch run, so this must not read like an unexpected crash.
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Processing did not complete. Some files may have been skipped. Check the console log for details.', 'SmartImage-Toolkit', 'OK', 'Warning')"
pause
exit /b 1

:MISSING_NODE
echo [error] Node.js was not found on PATH. Please install Node 18 or newer.
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Node.js is required but was not found. Click OK to open the official download page, then install the LTS build.', 'Missing environment', 'OK', 'Warning')"
start https://nodejs.org/
exit /b

:NPM_FAILED
echo [error] Dependency installation failed. Check your network or npm registry and retry.
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Installing the required components failed. Check your network, proxy or npm registry and retry.', 'Setup failed', 'OK', 'Error')"
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
