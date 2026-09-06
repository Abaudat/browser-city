#!/usr/bin/env bash
# Fixture-driven coverage for setup-github.sh's branch-protection half
# (Story 0.16): the already-required no-op, the create path, and the
# API-failure path -- exercised because this PR added gh_branch_required_
# checks/gh_branch_require_check and wired setup-github.sh to exit 2 on
# failure, and the only verification it had before was a hand run.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
SETUP="$SCRIPTS_DIR/setup-github.sh"
. "$TEST_DIR/harness.sh"

log_has() { grep -Eq -- "$2" "$1"; } # <file> <regex>

run() { local fake="$1"; shift; BC_FAKE="$fake" bash "$SETUP" "$@"; }

# Every scenario below needs the two gates before branch protection (auth
# scope, label list) to already be satisfied, so all labels this repo's
# LABEL_DEFS names are pre-seeded as existing.
_seed_common() {
  local d="$1"
  printf 'repo project\n' > "$d/gh_auth_scopes.seq"
  echo '["lead:derek","lead:tim","lead:artie","epic","demo","breaker"]' > "$d/gh_label_list.json"
}

echo "branch protection: already required -- no mutation, exit 0:"

FAKE_OK="$(fake_dir)"
_seed_common "$FAKE_OK"
echo '["ci"]' > "$FAKE_OK/gh_branch_required_checks.json"
check "already required -> exit 0" 0 run "$FAKE_OK"
check "logs no gh_branch_require_check call" 1 test -f "$FAKE_OK/calls.log"

echo
echo "branch protection: not yet required -- creates it, exit 0:"

FAKE_CREATE="$(fake_dir)"
_seed_common "$FAKE_CREATE"
echo '[]' > "$FAKE_CREATE/gh_branch_required_checks.json"
check "not required -> exit 0" 0 run "$FAKE_CREATE"
check "required 'ci' on master" 0 log_has "$FAKE_CREATE/calls.log" '^gh_branch_require_check master ci$'

echo
echo "branch protection: API failure -- setup-github.sh must not exit 0:"
# Same quirk as test-bc-pr.sh's forced-merge-failure case: fake.sh's
# <fn>.exit hook makes the primitive itself `exit` the whole process with
# that code, rather than returning failure to its caller, so this checks
# the forced code propagates (a real gh failure returns non-zero to
# setup-github.sh's own `if gh_branch_require_check ...; then ... else exit
# 2; fi`, which this cannot simulate short of that exit) -- the assertion
# that matters is that a failure here is never silently exit 0.

FAKE_FAIL="$(fake_dir)"
_seed_common "$FAKE_FAIL"
echo '[]' > "$FAKE_FAIL/gh_branch_required_checks.json"
echo 1 > "$FAKE_FAIL/gh_branch_require_check.exit"
check "a forced gh_branch_require_check failure never reads as exit 0" 1 run "$FAKE_FAIL"

summary
