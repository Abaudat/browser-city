#!/usr/bin/env bash
# Shared assertion helpers for scripts/ops/tests/test-*.sh -- a deliberate
# copy of agentic-team/scripts/tests/harness.sh's tiny surface, not a
# cross-directory dependency: scripts/ops/ tests game operations tooling,
# agentic-team/ tests the agent tooling, and Tim's direction was that the
# two never share a home. Pure bash bookkeeping either way.

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
# to pin a specific failure message rather than only its exit code.
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
  d="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-ops-fake.XXXXXX")"
  printf '%s' "$d"
}

summary() {
  echo
  echo "passed $pass, failed $fail"
  [ "$fail" -eq 0 ]
}
