@echo off
REM Orca automation precheck entry point. See team-charter.md sections 3 and 8.
REM
REM The precheck runs under cmd.exe and its value must be a single path with no
REM shell in it -- nested quoting through cmd mangles anything more. This file
REM is that path, and it hands off to bash so the gate logic stays readable.
REM
REM The automation names this file absolutely; that one path is the only
REM hardcoded one. Everything after it derives from %~dp0, so a copy of the
REM repo in another worktree gates itself rather than the one typed here.
setlocal
set "HERE=%~dp0"
set "HERE=%HERE:\=/%"
"C:\Program Files\Git\bin\bash.exe" -lc "'%HERE%precheck.sh'"
exit /b %ERRORLEVEL%
