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
  local role="$1" uuid="$2" mode="$3" name="$4" idflag claude_win
  case "$mode" in
    new)    idflag="--session-id $uuid" ;;
    resume) idflag="--resume $uuid" ;;
    *) return 2 ;;
  esac
  # This command string is typed into the Orca terminal's own shell
  # (PowerShell on Windows), not bash -- $CLAUDE is resolved in POSIX form
  # ("/c/Users/...") for every other caller in these scripts, all of which
  # run under bash, but PowerShell has no such path syntax and reports
  # CommandNotFoundException on it. Convert to Windows form here only.
  claude_win="$(posix2win "$CLAUDE")"
  printf "%s --agent %s %s -n '%s' --permission-mode bypassPermissions" \
    "$claude_win" "$role" "$idflag" "$name"
}

# Session ids are derived, never recorded: md5 of "browser-city <role> #<issue>"
# shaped like a v4 uuid so `claude --session-id` accepts it. Every tick can
# recompute who to talk to from role + issue alone -- no stub has to carry a
# uuid, a half-finished N1 has nothing to repair -- and after a restart
# `bc-session start` resumes the transcript that id names, if one exists.
bc_role_uuid() { # <role> <issue> -> uuid
  local h
  h="$(printf 'browser-city %s #%s' "$1" "$2" | md5sum | cut -c1-32)"
  printf '%s-%s-4%s-8%s-%s' "${h:0:8}" "${h:8:4}" "${h:13:3}" "${h:17:3}" "${h:20:12}"
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
