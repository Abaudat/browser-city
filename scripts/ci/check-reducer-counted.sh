#!/usr/bin/env bash
# Story 4.13 (NFR17): every `#[spacetimedb::reducer]` and
# `#[spacetimedb::procedure]` under server/src/ must open with
# `count_call` (`tables::metrics::count_call`) as its first statement, so
# each call is attributed to its cost class. The lifecycle reducers
# (`init`, `client_connected`, `client_disconnected`) are the only
# exemptions. A reducer's class is registered separately
# (`sim::reducer_classes`, checked by `bounds/tests/reducer_classes_
# coverage.rs`); this guard only pins the counting.
#
# Usage: check-reducer-counted.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-reducer-counted: $SRC_DIR not found" >&2; exit 1; }

FILES="$(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)"
[ -n "$FILES" ] || { echo "check-reducer-counted: no .rs file under $SRC_DIR" >&2; exit 1; }

# One awk pass per file: after a counted attribute, find the signature's
# opening `{` (the first line ending in `{`), then the first line that is
# neither blank nor a comment must contain `count_call(`.
# shellcheck disable=SC2086
RESULT="$(awk '
  function report(msg) { print FILENAME ":" NR ": " msg; bad = 1 }
  /^[ \t]*\/\// { if (state == 3) next }
  /^[ \t]*#\[spacetimedb::(reducer|procedure)/ {
    if ($0 ~ /\((init|client_connected|client_disconnected)\)/) { state = 0; next }
    state = 1; seen++; next
  }
  state == 1 && /fn / {
    name = $0; sub(/^.*fn /, "", name); sub(/\(.*$/, "", name)
    state = 2
  }
  state == 2 {
    if ($0 ~ /\{[ \t\r]*$/) { state = 3; next }
    if ($0 ~ /\{/) { # one-line body: the statement follows the brace
      body = $0; sub(/^[^{]*\{/, "", body)
      if (body !~ /count_call\(/) report("`" name "` does not start with count_call")
      state = 0
    }
    next
  }
  state == 3 {
    if ($0 ~ /^[ \t\r]*$/) next
    if ($0 !~ /count_call\(/) report("`" name "` does not start with count_call")
    state = 0
  }
  END { print "SEEN " seen + 0; exit 0 }
' $FILES | sed 's/\r$//')"

SEEN="$(printf '%s\n' "$RESULT" | awk '/^SEEN /{s+=$2} END{print s+0}')"
BAD="$(printf '%s\n' "$RESULT" | grep -v '^SEEN ' || true)"
if [ "$SEEN" -eq 0 ]; then
  echo "check-reducer-counted: FAIL -- found no reducer or procedure under $SRC_DIR (the scan matched nothing)" >&2
  exit 1
fi
if [ -n "$BAD" ]; then
  echo "check-reducer-counted: FAIL -- a reducer or procedure whose first statement is not count_call (NFR17):" >&2
  echo "$BAD" >&2
  exit 1
fi
echo "check-reducer-counted: all $SEEN counted reducers/procedures open with count_call (NFR17)" >&2
exit 0
