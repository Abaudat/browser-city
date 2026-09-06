#!/usr/bin/env bash
# Keeps docs/trace-matrix.md honest against the actual test suite: a
# `covered` row whose test does not exist is a claim nobody can verify, and
# an `inv_*` test with no row is coverage the matrix does not know about.
# Also bans `#[ignore]` outright -- a skipped test is an unautomated test.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MATRIX="$REPO_ROOT/docs/trace-matrix.md"
cd "$REPO_ROOT/server"

[ -f "$MATRIX" ] || { echo "check-trace-matrix: $MATRIX not found" >&2; exit 1; }

# --- collect every test name the workspace actually runs -------------------
# browser_city is excluded: it embeds SpacetimeDB's reducer/table macros,
# which reference host FFI symbols the wasm runtime supplies, so it cannot
# be linked natively (see server/Cargo.toml).
LIST_OUTPUT="$(cargo test --workspace --exclude browser_city -- --list 2>&1)" || {
  echo "check-trace-matrix: 'cargo test -- --list' failed:" >&2
  echo "$LIST_OUTPUT" >&2
  exit 1
}

TEST_NAMES="$(printf '%s\n' "$LIST_OUTPUT" | grep -E ': (test|benchmark)$' | sed -E 's/: (test|benchmark)$//')"

# --- ban #[ignore] -----------------------------------------------------------
IGNORED="$(grep -rl '#\[ignore' --include='*.rs' . || true)"
if [ -n "$IGNORED" ]; then
  echo "check-trace-matrix: FAIL -- #[ignore] found (a skipped test is an unautomated test):" >&2
  printf '%s\n' "$IGNORED" >&2
  exit 1
fi

# --- parse the matrix's data rows --------------------------------------------
# | id | description | status | test | story |
MATRIX_ROWS="$(grep -E '^\| `' "$MATRIX" || true)"

FAILED=0

# every `covered` row's Test column must name a real test
while IFS='|' read -r _ id _ status test _; do
  id="$(printf '%s' "$id" | tr -d '`' | xargs)"
  status="$(printf '%s' "$status" | xargs)"
  test="$(printf '%s' "$test" | tr -d '`' | xargs)"
  if [ "$status" = "covered" ]; then
    if [ -z "$test" ]; then
      echo "check-trace-matrix: FAIL -- '$id' is 'covered' but names no test" >&2
      FAILED=1
    elif ! printf '%s\n' "$TEST_NAMES" | grep -qxF "$test"; then
      echo "check-trace-matrix: FAIL -- '$id' claims coverage via '$test', but no such test exists" >&2
      FAILED=1
    fi
  fi
done <<< "$MATRIX_ROWS"

# every inv_* test must have a matrix row
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$name" in
    *inv_*) short="${name##*::}" ;;
    *) continue ;;
  esac
  if ! printf '%s\n' "$MATRIX_ROWS" | grep -qF "\`$short\`"; then
    echo "check-trace-matrix: FAIL -- test '$name' has no row in docs/trace-matrix.md" >&2
    FAILED=1
  fi
done <<< "$TEST_NAMES"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-trace-matrix: matrix and test suite agree" >&2
exit 0
