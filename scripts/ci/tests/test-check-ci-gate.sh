#!/usr/bin/env bash
# scripts/ci/check-ci-gate.sh's FAST_CHECK_SEED rules (story 6.17, NFR50):
# the real ci.yml satisfies them, and each way to break them is reported.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-ci-gate.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"

# run <workflow>: the gate's stderr, against empty (but valid) JSON.
run() { bash "$CHECK" '{}' '{}' "$1" 2>&1 || true; }

variant() {
  local d; d="$(fake_dir)"
  sed 's/\r$//' "$CI_YML" | sed -E "$1" > "$d/ci.yml"
  printf '%s' "$d/ci.yml"
}

out="$(run "$CI_YML")"
if printf '%s' "$out" | grep -q 'FAST_CHECK_SEED'; then
  printf '  FAIL the real ci.yml passes the FAST_CHECK_SEED rules\n       %s\n' "$out"; fail=$((fail + 1))
else
  printf '  ok   the real ci.yml passes the FAST_CHECK_SEED rules\n'; pass=$((pass + 1))
fi
check_contains "no workflow-level seed is reported" "FAST_CHECK_SEED: <digits>" \
  "$(run "$(variant 's/^  FAST_CHECK_SEED: .*//')")"
check_contains "an expression seed is reported" "FAST_CHECK_SEED: <digits>" \
  "$(run "$(variant 's/^  FAST_CHECK_SEED: .*/  FAST_CHECK_SEED: ${{ github.run_id }}/')")"
check_contains "a non-numeric seed is reported" "FAST_CHECK_SEED: <digits>" \
  "$(run "$(variant 's/^  FAST_CHECK_SEED: .*/  FAST_CHECK_SEED: fixed/')")"
check_contains "a unit-test job that never echoes the seed is reported" "never echoes FAST_CHECK_SEED" \
  "$(run "$(variant 's/echo .*FAST_CHECK_SEED.*/echo hi/')")"

summary
exit $?
