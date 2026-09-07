#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-ci-gate.sh. Fixtures are
# needs/changes JSON blobs built inline -- never a real workflow run.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-ci-gate.sh"

ALL_SUCCESS='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "check": {"result": "success"},
  "test": {"result": "success"},
  "build": {"result": "success"},
  "coverage": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
NOTHING_CHANGED='{"agentic":"false","server":"false","client":"false","e2e":"false"}'
ALL_CHANGED='{"agentic":"true","server":"true","client":"true","e2e":"true"}'

run_check() { bash "$CHECK" "$1" "$2"; }

echo "green: every job succeeded, regardless of what changed"
check "all-success + nothing-changed passes" 0 run_check "$ALL_SUCCESS" "$NOTHING_CHANGED"
check "all-success + all-changed passes" 0 run_check "$ALL_SUCCESS" "$ALL_CHANGED"

echo
echo "green: server jobs skipped because server did not change, everything else ran"
ONLY_CLIENT_RAN='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "check": {"result": "skipped"},
  "test": {"result": "skipped"},
  "build": {"result": "skipped"},
  "coverage": {"result": "skipped"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
CLIENT_ONLY_CHANGED='{"agentic":"false","server":"false","client":"true","e2e":"true"}'
check "server jobs correctly gated off pass" 0 run_check "$ONLY_CLIENT_RAN" "$CLIENT_ONLY_CHANGED"

echo
echo "red: a job was skipped even though its filter says its paths changed"
SKIPPED_BUT_CHANGED='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "check": {"result": "skipped"},
  "test": {"result": "success"},
  "build": {"result": "success"},
  "coverage": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$SKIPPED_BUT_CHANGED" "$ALL_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the offending job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'check' was skipped but its filter 'server' reports 'true'\"" _ "$OUT"

echo
echo "red: a job failed outright"
ONE_FAILED='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "check": {"result": "failure"},
  "test": {"result": "success"},
  "build": {"result": "success"},
  "coverage": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$ONE_FAILED" "$ALL_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the failed job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'check' did not succeed (result: 'failure')\"" _ "$OUT"

echo
echo "red: a job was cancelled"
ONE_CANCELLED='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "check": {"result": "success"},
  "test": {"result": "cancelled"},
  "build": {"result": "success"},
  "coverage": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$ONE_CANCELLED" "$ALL_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "red: needs-json is missing a job entirely"
MISSING_JOB='{
  "changes": {"result": "success"},
  "scripts-tests": {"result": "success"},
  "test": {"result": "success"},
  "build": {"result": "success"},
  "coverage": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$MISSING_JOB" "$ALL_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing entry" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"no entry for job 'check'\"" _ "$OUT"

echo
echo "red: the changes job itself did not succeed"
CHANGES_FAILED='{
  "changes": {"result": "failure"},
  "scripts-tests": {"result": "skipped"},
  "check": {"result": "skipped"},
  "test": {"result": "skipped"},
  "build": {"result": "skipped"},
  "coverage": {"result": "skipped"},
  "client-check": {"result": "skipped"},
  "client-build": {"result": "skipped"},
  "e2e": {"result": "skipped"}
}'
OUT="$(run_check "$CHANGES_FAILED" "$NOTHING_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the changes job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'changes' did not succeed (result: 'failure')\"" _ "$OUT"

echo
echo "red: malformed JSON"
OUT="$(bash "$CHECK" '{not json' "$ALL_CHANGED" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the parse failure" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does not parse as JSON'" _ "$OUT"

echo
echo "red: missing arguments"
OUT="$(bash "$CHECK" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing argument" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'missing <needs-json>'" _ "$OUT"

summary
