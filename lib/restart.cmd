@echo off
rem ---------------------------------------------------------------------------
rem  dsh-topbar-restart detached helper.
rem
rem  Created through Win32_Process.Create (see spawn-detached.ps1), so it lives
rem  outside the process tree it is about to stop: taskkill /T on the DSH main
rem  process cannot kill the helper that issued it.
rem
rem  This file must stay PURE ASCII with CRLF line endings. cmd.exe reads a .cmd
rem  through the OEM code page (GBK on a Chinese Windows); a stray UTF-8 byte can
rem  be taken as a double-byte lead and swallow the following newline, after which
rem  the parser desynchronises, comment text runs as a command, and a goto can
rem  loop forever. scripts/check-lib-encoding.mjs enforces this before packing.
rem
rem    1. wait about two seconds so the HTTP response asking for this restart
rem       leaves the Host before the connection dies with it;
rem    2. stop the whole tree rooted at the main process: the Electron main
rem       process, the Host child, renderers, GPU/utility processes and every
rem       subprocess a plugin started, none may keep the port or the
rem       single-instance lock;
rem    3. wait until that PID is really gone, plus a second for the port;
rem    4. start the same executable again.
rem
rem  Every step is appended to %TEMP%\dsh-topbar-restart.log, so a restart that
rem  fails to come back can still be diagnosed after the page is gone.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions DisableDelayedExpansion
set "MAINPID=%~1"
set "APPEXE=%~2"
set "LOGFILE=%TEMP%\dsh-topbar-restart.log"

if "%MAINPID%"=="" goto nopid
if "%APPEXE%"=="" goto noexe

call :log "helper start main=%MAINPID%"
call :log "exe=%APPEXE%"

rem ping, not timeout: timeout refuses to run without an interactive console.
ping -n 3 127.0.0.1 >nul

call :log "stopping process tree"
taskkill /PID %MAINPID% /T /F >>"%LOGFILE%" 2>&1
call :log "taskkill rc=%ERRORLEVEL%"

set /a WAITED=0
:waitloop
tasklist /FI "PID eq %MAINPID%" /NH 2>nul | find /I "%MAINPID%" >nul
if errorlevel 1 goto stopped
ping -n 2 127.0.0.1 >nul
set /a WAITED+=1
if %WAITED% LSS 20 goto waitloop
call :log "aborting: main process survived taskkill"
exit /b 7

:stopped
call :log "main process gone"
ping -n 2 127.0.0.1 >nul

if exist "%APPEXE%" goto launch
call :log "aborting: executable missing"
exit /b 8

:launch
rem WmiPrvSE's working directory is System32; start where the app lives.
for %%A in ("%APPEXE%") do set "APPDIR=%%~dpA"
if defined APPDIR cd /d "%APPDIR%"
call :log "starting app (cwd=%CD%)"
start "" "%APPEXE%"
call :log "restart requested; helper done"
exit /b 0

:nopid
call :log "aborting: no main pid argument"
exit /b 2

:noexe
call :log "aborting: no application path argument"
exit /b 3

:log
>>"%LOGFILE%" echo [%DATE% %TIME%] %~1
exit /b 0
