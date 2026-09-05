#!/usr/bin/env bash
# The test double for gh-cli.sh/project.sh/orca.sh/claude.sh. When BC_FAKE=<dir>
# is set, every read primitive in those libs calls bc_fake_read at its top
# and returns whatever that finds instead of touching gh/orca/claude; every
# write primitive calls bc_fake_write and logs instead of acting. The one
# rule: every primitive's fake behaviour lives in these two functions, not
# reimplemented per-primitive, so BC_FAKE means exactly one thing everywhere.

# bc_fake_read <fn> [arg1] [arg2] -- looks, most specific first, for:
#   $BC_FAKE/<fn>.<arg1>.<arg2>.seq   then  .json
#   $BC_FAKE/<fn>.<arg1>.seq          then  .json
#   $BC_FAKE/<fn>.seq                 then  .json
# prints the first one found and returns 0; if none exist, exits 1 (silent --
# that IS the "not found" fixture, not a broken one; see bc_fake_read_exit
# below for forcing a different code).
#
# The .seq form mirrors the write side's and exists for the one shape a
# single fixture cannot express: a read the caller polls until the answer
# changes -- "orca is not ready yet, now it is", "the loop has not appeared
# yet, now it has". Without it, a test of a poll can only ever assert the
# timeout. It sits at each level *beside* the .json rather than in front of
# all of them, so one fixture set can hold a sequence for one selector and a
# fixed answer for another without either eating the other's calls.
#
# The last line of a sequence is never consumed: it is the state the poll
# settled in, and it answers every call from then on. A sequence that ran out
# would otherwise read as "no fixture" -- which callers treat as "could not
# tell", not as "not yet" -- so one extra poll on a slow machine would fail a
# test as a bug in the script under test rather than as a fixture too short.
bc_fake_read() {
  local fn="$1" a1="${2:-}" a2="${3:-}" key f answer
  for key in \
    "${a1:+${a2:+${fn}.${a1}.${a2}}}" \
    "${a1:+${fn}.${a1}}" \
    "$fn"
  do
    [ -n "$key" ] || continue
    f="$BC_FAKE/${key}.seq"
    if [ -s "$f" ]; then
      answer="$(head -1 "$f")"
      if [ "$(wc -l < "$f")" -gt 1 ]; then
        tail -n +2 "$f" > "$f.rest" && cp "$f.rest" "$f" && rm -f "$f.rest"
      fi
      printf '%s\n' "$answer"
      return 0
    fi
    f="$BC_FAKE/${key}.json"
    [ -f "$f" ] && { cat "$f"; return 0; }
  done
  return 1
}

# bc_fake_write <fn> [args...] -- appends "fn args..." (single-space
# separated, args NOT expanded when one of them is a file path -- the path
# itself is logged, not its contents) to $BC_FAKE/calls.log, then returns 0,
# unless $BC_FAKE/<fn>.exit exists, in which case it exits with that code
# instead of logging anything.
#
# After logging, a write that HAS a return value (gh_issue_create,
# gh_pr_create, orca_terminal_create...) answers with a canned result, so a
# caller that creates something and then acts on what it got back can be
# tested at all. Two fixtures, in order:
#   $BC_FAKE/<fn>.seq   one answer per line, the first consumed and removed
#                       per call -- what a bulk create needs, since every new
#                       issue has to come back as a different number
#   $BC_FAKE/<fn>.json  the same answer for every call
# Neither present = the write happened and said nothing, which is what every
# caller written before this saw and still sees.
bc_fake_write() {
  local fn="$1"; shift
  local exitfile="$BC_FAKE/${fn}.exit" seqfile="$BC_FAKE/${fn}.seq" answer
  if [ -f "$exitfile" ]; then
    exit "$(cat "$exitfile")"
  fi
  { printf '%s' "$fn"; for a in "$@"; do printf ' %s' "$a"; done; printf '\n'; } >> "$BC_FAKE/calls.log"
  if [ -s "$seqfile" ]; then
    answer="$(head -1 "$seqfile")"
    tail -n +2 "$seqfile" > "$seqfile.rest" && mv "$seqfile.rest" "$seqfile"
    printf '%s' "$answer"
    return 0
  fi
  [ -f "$BC_FAKE/${fn}.json" ] && cat "$BC_FAKE/${fn}.json"
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
