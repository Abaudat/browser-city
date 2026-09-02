#!/usr/bin/env bash
# Claude session argv construction, the judgement one-shot, and transcript
# lookup. Wraps `claude` -- one function per concern, no branching beyond
# picking --session-id vs --resume. The one rule: session/one-shot flags are
# spelled out ONCE, here; nothing above this file builds a `claude` command
# line itself. claude_oneshot is fake-aware via fake.sh; the other two are
# pure string/filesystem logic and need no external tool to test.

_BC_CLAUDE_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_CLAUDE_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_CLAUDE_LIB_DIR/fake.sh"

claude_session_argv() { # <role> <uuid> <new|resume> <name> -> command string
  local role="$1" uuid="$2" mode="$3" name="$4" idflag
  case "$mode" in
    new)    idflag="--session-id $uuid" ;;
    resume) idflag="--resume $uuid" ;;
    *) return 2 ;;
  esac
  printf "%s --agent %s %s -n '%s' --permission-mode bypassPermissions" \
    "$CLAUDE" "$role" "$idflag" "$name"
}

claude_oneshot() { # <promptfile> <inputfile> -> claude's stdout (the input is piped to stdin)
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read claude_oneshot "$(basename "$1")"; return; }
  "$CLAUDE" -p --model sonnet --tools "" --no-session-persistence \
    --system-prompt "$(cat "$1")" < "$2" 2>/dev/null
}

claude_transcript_exists() { # <worktree-path, posix or windows form> <uuid> -> exit 0/1
  local winp encoded home="${BC_CLAUDE_HOME:-$HOME}"
  winp="$(posix2win "$1")"
  encoded="$(printf '%s' "$winp" | sed -e 's/[:\/\\]/-/g')"
  [ -f "$home/.claude/projects/$encoded/$2.jsonl" ]
}
