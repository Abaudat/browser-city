#!/usr/bin/env bash
# Shared assertion helpers for scripts/ci/tests/test-*.sh -- a deliberate
# copy of scripts/ops/tests/harness.sh's tiny surface, not a
# cross-directory dependency (the same reason that file is its own copy
# of agentic-team/scripts/tests/harness.sh rather than a shared import):
# scripts/ci/ tests the CI-only mechanical guards, scripts/ops/ tests game
# operations tooling, agentic-team/ tests the agent tooling, and none of
# the three shares a home. Pure bash bookkeeping either way.

pass=0
fail=0

# check <name> <want_exit> <cmd...> -- runs the command, compares exit code.
check() {
  local name="$1" want_exit="$2"; shift 2
  local out code
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" = "$want_exit" ]; then
    printf '  ok   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL %s -> exit %s (want %s)\n       %s\n' "$name" "$code" "$want_exit" "$out"
    fail=$((fail + 1))
  fi
}

# check_contains <name> <needle> <haystack> -- substring assertion, used
# to pin a specific stdout value (e.g. decide-client-deploy.sh's
# "true"/"false") rather than only a command's exit code.
check_contains() {
  local name="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    printf '  ok   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL %s -- expected to find %q in:\n       %s\n' "$name" "$needle" "$haystack"
    fail=$((fail + 1))
  fi
}

fake_dir() {
  local d
  d="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-ci-fake.XXXXXX")"
  printf '%s' "$d"
}

summary() {
  echo
  echo "passed $pass, failed $fail"
  [ "$fail" -eq 0 ]
}
