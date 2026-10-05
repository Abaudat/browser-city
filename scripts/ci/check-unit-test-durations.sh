#!/usr/bin/env bash
# No client unit test may take more than 30% of its own effective timeout
# on the CI runner, under coverage (story 5.22, NFR49). Reads the file
# client/tests/unit/setup/duration-report.ts writes; a missing or empty file,
# a timeout above 60 s, or any `retry`/`repeats` (resolved per test, so a
# config, describe or test option all show) or a `--retry` flag fails too, so
# the guard never passes on an absent signal. Prints the 10 slowest tests always.
#   check-unit-test-durations.sh [durations.json [vitest.config.ts [flag-file...]]]
set -u
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
JSON="${1:-$ROOT/client/.vitest-durations.json}"
CONFIG="${2:-$ROOT/client/vitest.config.ts}"
if [ "$#" -gt 2 ]; then shift 2; FLAG_FILES=("$@"); else FLAG_FILES=("$ROOT/client/package.json" "$ROOT/.github/workflows/ci.yml"); fi
MAX_PERCENT=30
MAX_TIMEOUT_MS=60000

fail=0
say() { printf '%s\n' "$*" >&2; fail=1; }

if [ ! -s "$JSON" ]; then
  say "check-unit-test-durations: $JSON is missing or empty (reporter not registered, or the run crashed)"
  exit 1
fi
if ! jq -e '(.tests | type == "array") and (.tests | length > 0)
  and all(.tests[]; (.durationMs | type == "number") and (.timeoutMs | type == "number")
    and .timeoutMs > 0 and (.retry | type == "number") and (.repeats | type == "number") and (.file | type == "string") and (.name | type == "string"))' \
  "$JSON" >/dev/null 2>&1; then
  say "check-unit-test-durations: $JSON has no tests, or a malformed entry (need file, name, durationMs, timeoutMs > 0, retry, repeats)"
  exit 1
fi

if grep -Eq '^[^/]*\bretry\s*:' "$CONFIG" 2>/dev/null; then
  say "check-unit-test-durations: $CONFIG sets retry; a re-run must never change a verdict"
fi

if grep -nE -- '--retry' "${FLAG_FILES[@]}" 2>/dev/null | grep -q .; then
  say "check-unit-test-durations: a --retry flag is set in ${FLAG_FILES[*]}; a re-run must never change a verdict"
fi

reran="$(jq -r '.tests[] | select(.retry > 0 or .repeats > 0)
  | "\(.file) > \(.name): retry \(.retry), repeats \(.repeats) -- a re-run must never decide a verdict"' "$JSON")"
if [ -n "$reran" ]; then
  while IFS= read -r line; do say "check-unit-test-durations: $line"; done <<<"$reran"
fi

over="$(jq -r --argjson p "$MAX_PERCENT" '.tests[]
  | select(.state == "passed" and (.durationMs * 100 > .timeoutMs * $p))
  | "\(.file) > \(.name): \(.durationMs) ms of a \(.timeoutMs) ms timeout (limit \($p)% = \(.timeoutMs * $p / 100) ms)"' "$JSON")"
if [ -n "$over" ]; then
  while IFS= read -r line; do say "check-unit-test-durations: $line"; done <<<"$over"
fi

capped="$(jq -r --argjson m "$MAX_TIMEOUT_MS" '.tests[] | select(.timeoutMs > $m)
  | "\(.file) > \(.name): timeout \(.timeoutMs) ms is above the \($m) ms cap"' "$JSON")"
if [ -n "$capped" ]; then
  while IFS= read -r line; do say "check-unit-test-durations: $line"; done <<<"$capped"
fi

slow="$(jq -r '.tests | sort_by(-.durationMs) | .[:10][]
  | "| \(.durationMs) ms | \(.timeoutMs) ms | \(.file) > \(.name) |"' "$JSON")"
table="10 slowest unit tests (duration, timeout)
$slow"
printf '%s\n' "$table"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { printf '### 10 slowest unit tests\n\n| duration | timeout | test |\n| --- | --- | --- |\n%s\n' "$slow"; } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$fail"
