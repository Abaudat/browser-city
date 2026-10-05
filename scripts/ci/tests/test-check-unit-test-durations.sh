#!/usr/bin/env bash
# scripts/ci/check-unit-test-durations.sh's own coverage: a green report, then
# one red fixture per rule (story 5.22, NFR49).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-unit-test-durations.sh"
# report <dir> <state> <durationMs> <timeoutMs> [retry [repeats]]: a one-test report.
report() {
  printf '{"defaultTimeoutMs":5000,"tests":[{"file":"tests/unit/a.test.ts","name":"slow one","durationMs":%s,"timeoutMs":%s,"retry":%s,"repeats":%s,"state":"%s"}]}\n' \
    "$3" "$4" "${5:-0}" "${6:-0}" "$2" > "$1/d.json"
}
cfg() { printf 'export default { test: { testTimeout: 5000 } };\n' > "$1/vitest.config.ts"; }
run() { bash "$CHECK" "$1/d.json" "$1/vitest.config.ts" 2>&1; }

d="$(fake_dir)"; cfg "$d"
report "$d" passed 100 5000
check "a fast test passes" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 1500 5000
check "exactly 30% of the timeout passes (the limit is >)" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 1600 5000
check "a no-timeout test at 1.6 s fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
check_contains "and names the test" "slow one" "$(run "$d")"
check_contains "and its duration" "1600 ms" "$(run "$d")"
report "$d" passed 2000 6000
check "an explicit 6 s timeout at 2 s fails (no token timeouts)" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 2000 60000
check "the same duration under a 60 s timeout passes" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 1 600000
check "a timeout above 60 s fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
check_contains "and names the cap" "above the 60000 ms cap" "$(run "$d")"
report "$d" failed 4000 5000
check "a failed test is vitest's to report (the guard looks at passed ones)" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 100 5000
check_contains "the 10 slowest are printed on a pass" "slow one" "$(run "$d")"

summary="$d/summary.md"
GITHUB_STEP_SUMMARY="$summary" bash "$CHECK" "$d/d.json" "$d/vitest.config.ts" >/dev/null 2>&1
check_contains "the 10 slowest go to the step summary" "slow one" "$(cat "$summary")"

check "a missing report fails" 1 bash "$CHECK" "$d/none.json" "$d/vitest.config.ts"
: > "$d/empty.json"
check "an empty report fails" 1 bash "$CHECK" "$d/empty.json" "$d/vitest.config.ts"
printf '{"defaultTimeoutMs":5000,"tests":[]}\n' > "$d/notests.json"
check "a report with no tests fails" 1 bash "$CHECK" "$d/notests.json" "$d/vitest.config.ts"
printf '{"tests":[{"file":"a","name":"b","durationMs":"x","timeoutMs":5000,"state":"passed"}]}\n' > "$d/bad.json"
check "a malformed entry fails" 1 bash "$CHECK" "$d/bad.json" "$d/vitest.config.ts"
report "$d" passed 1 0
check "a zero timeout fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"

report "$d" passed 100 5000
printf 'export default { test: { retry: 2 } };\n' > "$d/vitest.config.ts"
check "a retry in vitest.config.ts fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
check_contains "and says why" "sets retry" "$(run "$d")"
printf '// retry: never\nexport default {};\n' > "$d/vitest.config.ts"
check "a retry in a comment is not a retry" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"

report "$d" passed 100 5000 0 0
check "retry 0 and repeats 0 pass" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed 100 5000 2 0
check "a per-test retry fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
check_contains "and names the test and the retry" "slow one: retry 2" "$(run "$d")"
report "$d" passed 100 5000 0 3
check "a per-test repeats fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
report "$d" passed null 5000
check "a test with no measured duration fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts"
printf '{"tests":[{"file":"a","name":"b","durationMs":1,"timeoutMs":5000,"state":"passed"}]}
' > "$d/old.json"
check "a report without retry/repeats fails" 1 bash "$CHECK" "$d/old.json" "$d/vitest.config.ts"

report "$d" passed 100 5000
printf '{ "scripts": { "test": "vitest run --retry 2" } }
' > "$d/package.json"
check "a --retry flag fails" 1 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts" "$d/package.json"
printf '{ "scripts": { "test": "vitest run" } }
' > "$d/package.json"
check "a flag file without --retry passes" 0 bash "$CHECK" "$d/d.json" "$d/vitest.config.ts" "$d/package.json"

cfg "$d"
check "the real config, package.json and ci.yml are clean" 0 bash "$CHECK" "$d/d.json" "$REPO_ROOT/client/vitest.config.ts"

summary
exit $?
