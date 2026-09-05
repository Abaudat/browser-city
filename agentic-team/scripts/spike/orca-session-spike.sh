#!/usr/bin/env bash
# Phase 0 spike: can a Claude Code role session live in an Orca terminal, be
# found again by title, be messaged, be closed and resumed in place?
# Run by hand from any bash; findings are in FINDINGS.md next to this file.
set -u
ORCA="${ORCA:-$LOCALAPPDATA/Programs/orca/resources/bin/orca.exe}"
REPO_ID="${REPO_ID:-61a8f373-6a62-4138-a33c-fb4be6d0ddc1}"   # Abaudat/browser-city in Orca
NAME=spike-1
UUID=$(python -c "import uuid;print(uuid.uuid4())"); U8=${UUID:0:8}

say() { printf '\n== %s\n' "$*"; }

say "1. worktree create"
"$ORCA" worktree create --repo "id:$REPO_ID" --name "$NAME" --no-parent --json \
  | jq -c '.result.worktree | {path, branch}'
WT="path:C:/Users/granb/orca/workspaces/BrowserCity/$NAME"

say "2. terminal create running claude --agent tim --session-id"
H=$("$ORCA" terminal create --worktree "$WT" --title "bc-tim #0" \
  --command "claude --agent tim --session-id $UUID -n 'bc-tim #0 ($U8)' --permission-mode bypassPermissions" --json \
  | jq -r .result.terminal.handle)

say "3. wait tui-idle, then list: which title won?"
"$ORCA" terminal wait --terminal "$H" --for tui-idle --timeout-ms 60000 --json | jq -c .result.wait
"$ORCA" terminal list --worktree "$WT" --json | jq -c '.result.terminals[] | {title, agentIdentity, connected, orphaned}'

say "4. send a message and read the reply"
"$ORCA" terminal send --terminal "$H" --text "Reply with exactly the word SPIKE-ONE and your agent name, then stop." --enter --json | jq -c .ok
sleep 25
"$ORCA" terminal read --terminal "$H" --json | jq -r '.result.terminal.tail[]' | grep -v '^─*$' | tail -8

say "5. close, then resume in the same worktree path"
"$ORCA" terminal close --terminal "$H" --json | jq -c .ok
ls ~/.claude/projects/C--Users-granb-orca-workspaces-BrowserCity-$NAME/
H=$("$ORCA" terminal create --worktree "$WT" \
  --command "claude --resume $UUID --agent tim -n 'bc-tim #0 ($U8)' --permission-mode bypassPermissions" --json \
  | jq -r .result.terminal.handle)
"$ORCA" terminal wait --terminal "$H" --for tui-idle --timeout-ms 60000 --json | jq -c .result.wait.satisfied
"$ORCA" terminal list --worktree "$WT" --json | jq -c '.result.terminals[] | {title, agentIdentity}'
"$ORCA" terminal read --terminal "$H" --json | jq -r '.result.terminal.tail[]' | grep -v '^─*$' | tail -8

say "6. title glyph while working"
"$ORCA" terminal send --terminal "$H" --text "Run the shell command 'sleep 40' with Bash, then reply DONE." --enter --json | jq -c .ok
sleep 12; "$ORCA" terminal list --worktree "$WT" --json | jq -c '.result.terminals[] | select(.agentIdentity=="claude") | .title'
sleep 50; "$ORCA" terminal list --worktree "$WT" --json | jq -c '.result.terminals[] | select(.agentIdentity=="claude") | .title'

say "7. worktree rm"
"$ORCA" worktree rm --worktree "$WT" --force --json | jq -c .result
