#!/usr/bin/env bash
# Story 4.2 AC2's client half (a regression guard, Quentin's direction --
# today there is no reducer call anywhere under client/src/): no reducer
# call may be wired to the render frame loop. `client/src/net/` calls a
# reducer at its own measured rate; the frame loop (`render/`, `world/`,
# `test-street/`, or any `ticker.add` callback anywhere) never does.
#
#   - No `.reducers.` call anywhere under `client/src/render/**`,
#     `client/src/world/**` or `client/src/test-street/**`.
#   - No `.reducers.` call inside a `ticker.add` callback, anywhere under
#     client/src/ -- tracked by matching parens from each `ticker.add(`
#     call site to its own closing paren (an awk state machine, since a
#     plain grep line cannot see a multi-line callback body).
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# scripts/ci/tests/test-check-no-frame-rate-reducers.sh's own use, so it
# can plant each banned construct in a throwaway temp tree rather than the
# real client/src/. `client-check` itself always calls this with no
# argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"

[ -d "$SRC_DIR" ] || { echo "check-no-frame-rate-reducers: $SRC_DIR not found" >&2; exit 1; }

FAILED=0

# --- no reducer call under the frame-loop directories -----------------------
FRAME_LOOP_DIRS=""
for d in render world test-street; do
  [ -d "$SRC_DIR/$d" ] && FRAME_LOOP_DIRS="$FRAME_LOOP_DIRS $SRC_DIR/$d"
done
if [ -n "$FRAME_LOOP_DIRS" ]; then
  # shellcheck disable=SC2086
  MATCHES="$(grep -rnF '.reducers.' $FRAME_LOOP_DIRS --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-no-frame-rate-reducers: FAIL -- a reducer call (.reducers.) was found under client/src/render|world|test-street/ -- a reducer call must go through net/, never the frame loop:" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
fi

# --- no reducer call inside any ticker.add callback, anywhere ---------------
TICKER_MATCHES="$(
  find "$SRC_DIR" -name '*.ts' -not -path '*/bindings/*' -print0 2>/dev/null \
    | xargs -0 -r awk '
      { lines[FNR] = $0; n = FNR }
      ENDFILE {
        for (i = 1; i <= n; i++) {
          line = lines[i]
          if (match(line, /\.ticker\.add\(/)) {
            depth = 0
            started = 0
            end_line = n
            for (j = i; j <= n; j++) {
              seg = lines[j]
              start_col = (j == i) ? RSTART + RLENGTH - 1 : 1
              for (k = start_col; k <= length(seg); k++) {
                c = substr(seg, k, 1)
                if (c == "(") { depth++; started = 1 }
                else if (c == ")") { depth-- }
              }
              if (started && depth <= 0) { end_line = j; break }
            }
            span = ""
            for (m = i; m <= end_line; m++) span = span lines[m] "\n"
            if (index(span, ".reducers.") > 0) {
              print FILENAME ":" i ": .reducers. call found inside a ticker.add callback"
            }
          }
        }
        delete lines
      }
    ' 2>/dev/null || true
)"
if [ -n "$TICKER_MATCHES" ]; then
  echo "check-no-frame-rate-reducers: FAIL -- a reducer call (.reducers.) was found inside a ticker.add callback -- the frame loop must never call a reducer directly:" >&2
  echo "$TICKER_MATCHES" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-no-frame-rate-reducers: no reducer call under render/world/test-street, and none inside any ticker.add callback (story 4.2 AC2)" >&2
exit 0
