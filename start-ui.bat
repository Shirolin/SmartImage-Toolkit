@echo off
rem IMPORTANT: keep every comment in this file ASCII-only and start it with "rem".
rem cmd.exe mis-reads "::" comment lines that contain non-ASCII text while the console
rem code page is 65001: it drops the "::" prefix and runs the rest of the line as a command
rem (symptom: "'xxx' is not recognized as an internal or external command").
rem Accepts every dragged / "Send to" argument (several images at once).
setlocal enabledelayedexpansion

cd /d "%~dp0"

rem No arguments: open an empty UI.
if "%~1"=="" (
    start cmd /c "node bootstrap.js"
    exit /b
)

rem One concurrent process (and browser page) per image argument.
:loop
if "%~1"=="" goto end
start cmd /c "node bootstrap.js "%~1""
shift
goto loop

:end
