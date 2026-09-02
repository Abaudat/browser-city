#!/usr/bin/env bash
# Worktree and terminal primitives via the `orca` CLI. Wraps `orca worktree
# *` and `orca terminal *`. The one rule: every function is exactly one orca
# call, checks `.ok` before trusting `.result` (a rejected selector answers
# ok:false with exit 0, which reads as "nothing" rather than as an error if
# unchecked), and is fake-aware via fake.sh. Handles are never stored by
# these functions or their callers -- always re-listed.

_BC_ORCA_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_ORCA_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_ORCA_LIB_DIR/fake.sh"

orca_worktree_create() { # <name> [issue-number] -> worktree path
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write orca_worktree_create "$@"; return; }
  local name="$1" issue="${2:-}" out
  local args=(--repo "id:$BC_ORCA_REPO_ID" --name "$name" --no-parent --json)
  [ -n "$issue" ] && args+=(--issue "$issue")
  out="$("$ORCA" worktree create "${args[@]}" 2>/dev/null)"
  printf '%s' "$out" | "$JQ" -e '.ok == true' >/dev/null 2>&1 || return 1
  printf '%s' "$out" | "$JQ" -r '.result.worktree.path'
}

orca_worktree_path() { # <selector, e.g. issue:3 or name:issue-3> -> path
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read orca_worktree_path "$1"; return; }
  local out
  out="$("$ORCA" worktree show --worktree "$1" --json 2>/dev/null)"
  printf '%s' "$out" | "$JQ" -e '.ok == true' >/dev/null 2>&1 || return 1
  printf '%s' "$out" | "$JQ" -r '.result.worktree.path'
}

orca_worktree_rm() { # <selector>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write orca_worktree_rm "$@"; return; }
  "$ORCA" worktree rm --worktree "$1" --force --json >/dev/null 2>&1
}

orca_terminals() { # <worktree-path, posix or windows form> -> JSON array of terminals
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read orca_terminals "$1"; return; }
  local winp out
  winp="$(posix2win "$1")"
  out="$("$ORCA" terminal list --worktree "path:$winp" --json 2>/dev/null)"
  printf '%s' "$out" | "$JQ" -e '.ok == true' >/dev/null 2>&1 || return 1
  printf '%s' "$out" | "$JQ" -c '.result.terminals'
}

orca_terminal_create() { # <worktree-path> <title> <command> -> terminal handle
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write orca_terminal_create "$@"; return; }
  local path="$1" title="$2" command="$3" winp out
  winp="$(posix2win "$path")"
  out="$("$ORCA" terminal create --worktree "path:$winp" --title "$title" --command "$command" --json 2>/dev/null)"
  printf '%s' "$out" | "$JQ" -e '.ok == true' >/dev/null 2>&1 || return 1
  printf '%s' "$out" | "$JQ" -r '.result.terminal.handle'
}

orca_terminal_send() { # <handle> <text>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write orca_terminal_send "$@"; return; }
  "$ORCA" terminal send --terminal "$1" --text "$2" --enter --json >/dev/null 2>&1
}

orca_terminal_wait_idle() { # <handle> <timeout-ms> -> exit 0 satisfied, 1 timed out/unreadable
  local out
  if [ -n "${BC_FAKE:-}" ]; then
    out="$(bc_fake_read orca_terminal_wait_idle "$1")" || return 1
  else
    out="$("$ORCA" terminal wait --terminal "$1" --for tui-idle --timeout-ms "$2" --json 2>/dev/null)"
  fi
  printf '%s' "$out" | "$JQ" -e '.result.wait.satisfied == true' >/dev/null 2>&1
}

orca_terminal_close() { # <handle>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write orca_terminal_close "$@"; return; }
  "$ORCA" terminal close --terminal "$1" --json >/dev/null 2>&1
}
