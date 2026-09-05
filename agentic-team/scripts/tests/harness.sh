#!/usr/bin/env bash
# Shared assertion helpers for the fixture-driven test-*.sh files. Wraps
# nothing external -- pure bash bookkeeping. The one rule: every test file
# sources this, calls check/check_out some number of times, then calls
# `summary` exactly once at the end, and the whole file's exit code is
# summary's exit code (0 all green, 1 any failure).

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

# check_out <name> <want_exit> <want_stdout> <cmd...> -- also compares stdout.
check_out() {
  local name="$1" want_exit="$2" want_out="$3"; shift 3
  local out code
  out="$("$@" 2>/dev/null)"
  code=$?
  if [ "$code" = "$want_exit" ] && [ "$out" = "$want_out" ]; then
    printf '  ok   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL %s -> exit %s out %q (want exit %s out %q)\n' "$name" "$code" "$out" "$want_exit" "$want_out"
    fail=$((fail + 1))
  fi
}

# fake_dir -- creates (and prints the path to) a fresh scratch dir suitable
# for BC_FAKE=$(fake_dir), one per test file, cleaned up by the OS temp
# directory rather than by us (kept around on failure for inspection).
fake_dir() {
  local d
  d="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-fake.XXXXXX")"
  printf '%s' "$d"
}

# summary -- prints pass/fail counts, exits 1 if any test failed.
summary() {
  echo
  echo "passed $pass, failed $fail"
  [ "$fail" -eq 0 ]
}
