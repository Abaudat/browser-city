#!/usr/bin/env bash
# scripts/dev/verify-defs.sh's own fast, no-real-toolchain coverage (story
# 2.12, AC1): the script's only logic is mapping each of its three `cargo`
# invocations to one of three exit codes, so a stubbed `cargo` on PATH --
# never a real build -- is enough to cover every branch. The stub tells
# step 1 ("run", regenerating defs/) apart from steps 2/3 (both "test ...
# --test rule_examples", step 2 alone carrying "--no-run") by its own
# arguments, and exits per $STEP1_EXIT/$STEP2_EXIT/$STEP3_EXIT (default 0
# each) -- so each case below only ever sets the one it is testing.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
VERIFY="$REPO_ROOT/scripts/dev/verify-defs.sh"

stub_cargo_dir() {
  local d
  d="$(fake_dir)"
  cat > "$d/cargo" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "run" ]; then
  exit "${STEP1_EXIT:-0}"
fi
if [ "$1" = "test" ]; then
  for a in "$@"; do
    if [ "$a" = "--no-run" ]; then
      exit "${STEP2_EXIT:-0}"
    fi
  done
  exit "${STEP3_EXIT:-0}"
fi
exit 0
STUB
  chmod +x "$d/cargo"
  printf '%s' "$d"
}

bin="$(stub_cargo_dir)"

check "every step passing exits 0" 0 \
  env "PATH=$bin:$PATH" bash "$VERIFY"

check "step 1 (defs/ regeneration) failing is a harness error, exit 2" 2 \
  env "STEP1_EXIT=1" "PATH=$bin:$PATH" bash "$VERIFY"

check "step 2 (the harness binary failing to build) is a harness error, exit 2" 2 \
  env "STEP2_EXIT=1" "PATH=$bin:$PATH" bash "$VERIFY"

check "step 3 (a named content failure) is exit 1, never collapsed into exit 2" 1 \
  env "STEP3_EXIT=1" "PATH=$bin:$PATH" bash "$VERIFY"

out="$(env "STEP1_EXIT=1" PATH="$bin:$PATH" bash "$VERIFY" 2>&1)"
check_contains "a step 1 failure names it as a build/harness error, never a rule failure" \
  "the defs/ tree itself does not build" "$out"

out="$(env "STEP2_EXIT=1" PATH="$bin:$PATH" bash "$VERIFY" 2>&1)"
check_contains "a step 2 failure names the harness binary, never a rule failure" \
  "rule-examples test binary does not build" "$out"

out="$(env "STEP3_EXIT=1" PATH="$bin:$PATH" bash "$VERIFY" 2>&1)"
check_contains "a step 3 failure points back at the named content failure(s) above" \
  "named content failure" "$out"

out="$(env PATH="$bin:$PATH" bash "$VERIFY" 2>&1)"
check_contains "a clean run prints its own elapsed seconds" "elapsed" "$out"

summary
exit $?
