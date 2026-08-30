#!/usr/bin/env bash
# Registers (or updates) Scotty's scheduled automation. See team-charter.md §3.
#
# The automation lives in Orca's own state, not in this repository, so this
# script is the repository's record of it: a machine that loses its Orca state
# gets the team back by running this, and a change to the schedule is a commit
# rather than something somebody once typed.
#
#   register-scotty.sh            create or update it, disabled
#   register-scotty.sh --enable   create or update it, enabled
#   register-scotty.sh --print    print the command and change nothing
#
# It is deliberately not enabled by default. An enabled automation dispatches
# real agents against real budget, and until Story 0.4's watchdog exists a
# broken gate is invisible until Friday.

set -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
. "$REPO_ROOT/scripts/lib/paths.sh"

NAME="${BC_AUTOMATION_NAME:-BrowserCity Scotty}"

# Every 12 minutes: inside the 10-15 the story asks for, and evenly spaced
# across the hour boundary. No --timezone: a fixed interval has no local time
# to be wrong about.
TRIGGER="${BC_AUTOMATION_TRIGGER:-*/12 * * * *}"

# A run missed while the machine was off is not replayed. The point is to pick
# up on the next waking hours, not to fire a night's worth of catch-up ticks at
# boot -- each of which would dispatch an agent.
GRACE="${BC_AUTOMATION_GRACE:-10}"

ORCA="${BC_ORCA:-$(resolve_orca || true)}"
JQ="${BC_JQ:-$(resolve_jq || true)}"
[ -x "$ORCA" ] || { echo "orca not found" >&2; exit 2; }
[ -x "$JQ" ]   || { echo "jq not found" >&2; exit 2; }

MODE="create"
case "${1:-}" in
  --enable) ENABLED_FLAG="--enabled" ;;
  --print)  MODE="print"; ENABLED_FLAG="--disabled" ;;
  "")       ENABLED_FLAG="--disabled" ;;
  *)        echo "usage: $0 [--enable|--print]" >&2; exit 2 ;;
esac

# Scotty runs in the main checkout, on master: that is where he merges and where
# he edits the sprint tracker. The path is discovered from Orca rather than
# written down, and the query is scoped to this project -- the runtime knows
# unrelated worktrees, and an unscoped query returns them.
WORKTREES="$("$ORCA" worktree list --repo name:BrowserCity --json 2>&1)" \
  || { echo "orca worktree list failed: $WORKTREES" >&2; exit 2; }

WORKSPACE="$(printf '%s' "$WORKTREES" | "$JQ" -r \
  '[.result.worktrees[]? | select(.isMainWorktree == true)] | first | .path // empty' 2>/dev/null)"
[ -n "$WORKSPACE" ] \
  || { echo "no main worktree found for repo name:BrowserCity" >&2; exit 2; }

# The precheck is a single path with no shell in it, in the Windows form
# cmd.exe expects, and it points into the worktree the automation actually runs
# in -- not into whichever worktree this script was run from.
PRECHECK="$(posix2win "$WORKSPACE/scripts/precheck.cmd" | tr '/' '\134')"

# The precheck must exist in the worktree the automation runs in, which is not
# the worktree this script is run from. A checkout that has never been pulled
# has no scripts/ at all, and the automation would then skip on every tick with
# a non-zero precheck -- indistinguishable from a spent budget. Checked here
# because this is the last moment anyone is looking.
if [ ! -f "$WORKSPACE/scripts/precheck.cmd" ]; then
  echo "no precheck at $WORKSPACE/scripts/precheck.cmd" >&2
  echo "the automation would skip every tick and look like a spent budget." >&2
  echo "bring that worktree up to date first." >&2
  exit 2
fi

PROMPT_FILE="$REPO_ROOT/scripts/automation/scotty-prompt.md"
[ -r "$PROMPT_FILE" ] || { echo "prompt missing at $PROMPT_FILE" >&2; exit 2; }
PROMPT="$(cat "$PROMPT_FILE")"

EXISTING="$("$ORCA" automations list --json 2>/dev/null | "$JQ" -r \
  --arg n "$NAME" '[.result.automations[]? | select(.name == $n)] | first | .id // empty' 2>/dev/null)"

if [ -n "$EXISTING" ]; then
  set -- automations edit "$EXISTING"
else
  set -- automations create --name "$NAME"
fi

set -- "$@" \
  --trigger "$TRIGGER" \
  --provider claude \
  --workspace "path:$WORKSPACE" \
  --workspace-mode existing \
  --precheck "$PRECHECK" \
  --missed-run-grace-minutes "$GRACE" \
  --fresh-session \
  "$ENABLED_FLAG" \
  --prompt "$PROMPT" \
  --json

if [ "$MODE" = "print" ]; then
  # Quoted as it would have to be typed, and with the prompt body elided --
  # the point is to show the shape of the call, not to reprint the prompt.
  printf 'orca'
  for arg in "$@"; do
    case "$arg" in
      "$PROMPT") printf " '<%s lines of scotty-prompt.md>'" "$(printf '%s\n' "$PROMPT" | wc -l | tr -d ' ')" ;;
      -*)        printf " %s" "$arg" ;;
      *)         printf " '%s'" "$arg" ;;
    esac
  done
  printf '\n'
  exit 0
fi

"$ORCA" "$@"
