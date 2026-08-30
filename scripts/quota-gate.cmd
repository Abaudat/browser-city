@echo off
REM Orca automation precheck entry point. See team-charter.md section 8.
REM The precheck runs under cmd.exe; this hands off to bash so the gate logic
REM stays readable and quoting stays out of the automation definition.
"C:\Program Files\Git\bin\bash.exe" -lc "/c/Users/granb/orca/workspaces/BrowserCity/Create-game-brief/scripts/quota-gate.sh"
exit /b %ERRORLEVEL%
