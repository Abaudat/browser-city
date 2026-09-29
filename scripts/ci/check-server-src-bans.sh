#!/usr/bin/env bash
# Story 4.2: two mechanical guards over the reducer crate, run in `check`
# before any instance is spun up (fail fast) -- the spike measured
# ScheduleAt::Interval compounding at ~9ms/tick forever
# (docs/spikes/1.3-scheduled-reducer-timing.md), so its presence anywhere
# under server/src/ is a bug, not a style choice; and NFR41 (never
# unwrap/expect/panic in a reducer -- a wrapping-arithmetic bug is a
# production abort of the whole world, not this one) is made mechanical
# rather than promised.
#
#   - `ScheduleAt::Interval` -- never the platform's own repeat, anywhere
#     under server/src/. sim::cadence::next_target + ScheduleAt::Time is
#     the one permitted idiom (docs/architecture.md's "Scheduled
#     reducers" section).
#   - `ctx.timestamp`, `world_clock`, `read_clock` -- banned in
#     tables/cadences.rs (a cadence body knows its city minute, never
#     real time).
#   - `unwrap(`, `expect(`, `panic!`, `todo!`, `unimplemented!`,
#     `unreachable!` -- banned across server/src/**, excluding
#     `generated/` (defs-build's own emitted code, never hand-written).
#     `debug_assert!` stays allowed: the architecture's own deliberate
#     abort on a violated invariant (NFR41), not an escape hatch for
#     these.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# scripts/ci/tests/test-check-server-src-bans.sh's own use, so it can
# plant each banned construct in a throwaway temp file rather than the
# real server/src/. `check` itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"

[ -d "$SRC_DIR" ] || { echo "check-server-src-bans: $SRC_DIR not found" >&2; exit 1; }

FAILED=0

# not_a_comment_line <grep-output> -- drops any "file:lineno:content" line
# whose content, after leading whitespace, starts with `//` -- so a doc
# comment explaining the ban (this file's own header, or a `//!`/`///` in
# server/src/ pointing back at it) never trips it. Content is never
# stripped mid-line (a real `code(); // ScheduleAt::Interval` would still
# match) -- this codebase's own style never puts a banned construct after
# a trailing comment marker. Strips up to the *rightmost* `:<digits>:` in
# the line, never the first two colons split naively -- a Windows path
# (`C:\Users\...`) carries its own extra colon right after the drive
# letter, which a naive two-field split would consume in place of the
# real line-number separator.
not_a_comment_line() {
  awk '{
    line = $0
    sub(/^.*:[0-9]+:/, "", line)
    gsub(/^[ \t]+/, "", line)
    if (line !~ /^\/\//) print $0
  }'
}

INTERVAL_MATCHES="$(grep -rnF 'ScheduleAt::Interval' "$SRC_DIR" --include='*.rs' --exclude-dir=generated 2>/dev/null | not_a_comment_line || true)"
if [ -n "$INTERVAL_MATCHES" ]; then
  echo "check-server-src-bans: FAIL -- ScheduleAt::Interval found under server/src/ -- it compounds its own dispatch lateness without bound (docs/spikes/1.3-scheduled-reducer-timing.md); use sim::cadence::next_target + ScheduleAt::Time instead:" >&2
  echo "$INTERVAL_MATCHES" >&2
  FAILED=1
fi

PANIC_PATTERN='\.unwrap\(|\.expect\(|\bpanic!|\btodo!|\bunimplemented!|\bunreachable!'
PANIC_MATCHES="$(grep -rnE "$PANIC_PATTERN" "$SRC_DIR" --include='*.rs' --exclude-dir=generated 2>/dev/null | not_a_comment_line || true)"
if [ -n "$PANIC_MATCHES" ]; then
  echo "check-server-src-bans: FAIL -- unwrap/expect/panic!/todo!/unimplemented!/unreachable! found under server/src/ (NFR41: every reducer fallible path returns Err, never panics -- debug_assert! stays allowed):" >&2
  echo "$PANIC_MATCHES" >&2
  FAILED=1
fi

# A cadence body (tables/cadences.rs) is a function of the city minute it
# fires for, never of real time -- a live tick and a jump's replayed tick
# must be the same code path, so `ctx.timestamp`, `world_clock` and
# `read_clock` are banned there (the epoch is real time by subtraction).
CADENCE_FILES="$(find "$SRC_DIR" -name cadences.rs -not -path '*/generated/*' 2>/dev/null || true)"
if [ -n "$CADENCE_FILES" ]; then
  # shellcheck disable=SC2086
  TIMESTAMP_MATCHES="$(grep -nHE 'ctx\.timestamp|world_clock|read_clock' $CADENCE_FILES 2>/dev/null | not_a_comment_line || true)"
  if [ -n "$TIMESTAMP_MATCHES" ]; then
    echo "check-server-src-bans: FAIL -- real time (ctx.timestamp, world_clock, read_clock) read in a cadence body (cadences.rs): a body is a function of its city minute alone (the epoch is real time by subtraction, and a replayed body sees the pre-jump row), so a replayed tick and a live tick are the same code path (FR163):" >&2
    echo "$TIMESTAMP_MATCHES" >&2
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-server-src-bans: no ScheduleAt::Interval and no unwrap/expect/panic!/todo!/unimplemented!/unreachable! under server/src/ (story 4.2, NFR41)" >&2
exit 0
