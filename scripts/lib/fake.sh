#!/usr/bin/env bash
# The test double for gh-cli.sh/project.sh/orca.sh/claude.sh. When BC_FAKE=<dir>
# is set, every read primitive in those libs calls bc_fake_read at its top
# and returns whatever that finds instead of touching gh/orca/claude; every
# write primitive calls bc_fake_write and logs instead of acting. The one
# rule: every primitive's fake behaviour lives in these two functions, not
# reimplemented per-primitive, so BC_FAKE means exactly one thing everywhere.

# bc_fake_read <fn> [arg1] [arg2] -- looks for, in order:
#   $BC_FAKE/<fn>.<arg1>.<arg2>.json
#   $BC_FAKE/<fn>.<arg1>.json
#   $BC_FAKE/<fn>.json
# prints the first one found and returns 0; if none exist, exits 1 (silent --
# that IS the "not found" fixture, not a broken one; see bc_fake_read_exit
# below for forcing a different code).
bc_fake_read() {
  local fn="$1" a1="${2:-}" a2="${3:-}" f
  if [ -n "$a1" ] && [ -n "$a2" ]; then
    f="$BC_FAKE/${fn}.${a1}.${a2}.json"
    [ -f "$f" ] && { cat "$f"; return 0; }
  fi
  if [ -n "$a1" ]; then
    f="$BC_FAKE/${fn}.${a1}.json"
    [ -f "$f" ] && { cat "$f"; return 0; }
  fi
  f="$BC_FAKE/${fn}.json"
  [ -f "$f" ] && { cat "$f"; return 0; }
  return 1
}

# bc_fake_write <fn> [args...] -- appends "fn args..." (single-space
# separated, args NOT expanded when one of them is a file path -- the path
# itself is logged, not its contents) to $BC_FAKE/calls.log, then returns 0,
# unless $BC_FAKE/<fn>.exit exists, in which case it exits with that code
# instead of logging anything. After logging, a write that has a return value
# (gh_issue_create, gh_pr_create, orca_terminal_create...) prints
# $BC_FAKE/<fn>[.<arg1>].json when present, so callers see a canned result.
bc_fake_write() {
  local fn="$1"; shift
  local exitfile="$BC_FAKE/${fn}.exit"
  if [ -f "$exitfile" ]; then
    exit "$(cat "$exitfile")"
  fi
  { printf '%s' "$fn"; for a in "$@"; do printf ' %s' "$a"; done; printf '\n'; } >> "$BC_FAKE/calls.log"
  return 0
}

# bc_faking -- true when BC_FAKE is set and usable. Every primitive that
# wants fake-awareness starts with:
#   [ -n "${BC_FAKE:-}" ] && { bc_fake_read fn "$1"; return; }
# for a read, or
#   [ -n "${BC_FAKE:-}" ] && { bc_fake_write fn "$@"; return; }
# for a write. This helper exists only for readability at call sites that
# need the plain boolean.
bc_faking() { [ -n "${BC_FAKE:-}" ]; }
