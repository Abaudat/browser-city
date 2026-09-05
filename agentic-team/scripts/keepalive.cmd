@echo off
rem OFF THE WAKE -- the Windows Task Scheduler entry point for keepalive.sh.
rem The Scheduler runs a program, not a shell script, and its environment
rem predates every tool install, so this file does exactly two things: find a
rem git bash that can run POSIX, and hand it keepalive.sh by absolute path.
rem Everything else -- logging, the reason line, the exit contract -- belongs
rem to keepalive.sh, which is also runnable on its own from any bash prompt.
rem
rem   schtasks /Create /TN "BrowserCity keepalive" /SC MINUTE /MO 12 ^
rem     /TR "\"D:\Projects\BrowserCity\agentic-team\scripts\keepalive.cmd\"" ^
rem     /RU %%USERNAME%% /IT /F
rem
rem /IT matters: Orca is a desktop app, so the task has to run in the logged-on
rem session. A task running in session 0 would open an Orca nobody can see.
setlocal

set "BC_KA_DIR=%~dp0"
set "BC_KA_DIR=%BC_KA_DIR:\=/%"

if defined BC_GIT_BASH goto :have_bash
set "BC_GIT_BASH=%ProgramFiles%\Git\bin\bash.exe"
if exist "%BC_GIT_BASH%" goto :have_bash
set "BC_GIT_BASH=%ProgramW6432%\Git\bin\bash.exe"
if exist "%BC_GIT_BASH%" goto :have_bash
set "BC_GIT_BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if exist "%BC_GIT_BASH%" goto :have_bash
set "BC_GIT_BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if exist "%BC_GIT_BASH%" goto :have_bash
echo keepalive broken git bash not found - set BC_GIT_BASH 1>&2
exit /b 2

:have_bash
"%BC_GIT_BASH%" -l "%BC_KA_DIR%keepalive.sh" %*
exit /b %ERRORLEVEL%
