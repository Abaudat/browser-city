#!/usr/bin/env bash
# Keeps docs/trace-matrix.md honest against both the actual test suite and
# the invariant registry (server/sim/tests/invariants.rs), in every
# direction that can rot silently:
#   - a `covered` row whose named test does not exist is a claim nobody can
#     verify
#   - a `deferred` row whose named test DOES exist means the matrix was
#     never flipped when the coverage landed
#   - an INV_* constant with no matrix row, or a matrix row with no INV_*
#     constant, means the registry and the matrix have drifted apart
#   - an inv_* test with no row at all is coverage the matrix does not know
#     about
# Also bans `#[ignore]` outright -- a skipped test is an unautomated test.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
MATRIX="$REPO_ROOT/docs/trace-matrix.md"
INVARIANTS_FILE="$REPO_ROOT/server/sim/tests/invariants.rs"

[ -f "$MATRIX" ] || { echo "check-trace-matrix: $MATRIX not found" >&2; exit 1; }
[ -f "$INVARIANTS_FILE" ] || { echo "check-trace-matrix: $INVARIANTS_FILE not found" >&2; exit 1; }

# --- collect every test name the workspace actually runs --------------------
# browser_city is excluded: it embeds SpacetimeDB's reducer/table macros,
# which reference host FFI symbols the wasm runtime supplies, so it cannot
# be linked natively (see server/Cargo.toml). --release reuses the
# artifacts the CI test job already built in release rather than compiling
# the workspace a second time in debug just to print test names.
LIST_OUTPUT="$(cd "$REPO_ROOT/server" && cargo test --workspace --exclude browser_city --release -- --list 2>&1)" || {
  echo "check-trace-matrix: 'cargo test -- --list' failed:" >&2
  echo "$LIST_OUTPUT" >&2
  exit 1
}

TEST_NAMES="$(printf '%s\n' "$LIST_OUTPUT" | grep -E ': (test|benchmark)$' | sed -E 's/: (test|benchmark)$//')"

# --- ban #[ignore] -----------------------------------------------------------
# Driven off tracked files, not a recursive grep from server/ -- that would
# walk target/, which the test job's own release build populates, and a
# dependency that ships an ignored test in build-script-generated source
# would turn this into a false red nobody in this repo can fix.
IGNORED="$(cd "$REPO_ROOT" && git ls-files '*.rs' -z | xargs -0 -r grep -l '#\[ignore' || true)"
if [ -n "$IGNORED" ]; then
  echo "check-trace-matrix: FAIL -- #[ignore] found (a skipped test is an unautomated test):" >&2
  printf '%s\n' "$IGNORED" >&2
  exit 1
fi

# --- parse the matrix's data rows --------------------------------------------
# | id | description | status | test | story |
MATRIX_ROWS="$(grep -E '^\| `' "$MATRIX" || true)"
MATRIX_IDS="$(printf '%s\n' "$MATRIX_ROWS" | awk -F'|' '{print $2}' | tr -d '`' | xargs -n1 2>/dev/null || true)"

# --- parse the invariant registry's INV_* constants --------------------------
CONSTANT_IDS="$(grep -oE 'pub const INV_[A-Z0-9_]+' "$INVARIANTS_FILE" | sed -E 's/pub const //' | tr 'A-Z' 'a-z' | sort -u)"

FAILED=0

# every covered row's Test column must name a real test; every deferred
# row's id must NOT already have a test (or it should have been flipped)
while IFS='|' read -r _ id _ status test _; do
  id="$(printf '%s' "$id" | tr -d '`' | xargs)"
  status="$(printf '%s' "$status" | xargs)"
  test="$(printf '%s' "$test" | tr -d '`' | xargs)"
  [ -n "$id" ] || continue
  case "$status" in
    covered)
      if [ -z "$test" ]; then
        echo "check-trace-matrix: FAIL -- '$id' is 'covered' but names no test" >&2
        FAILED=1
      elif ! printf '%s\n' "$TEST_NAMES" | grep -qxF "$test"; then
        echo "check-trace-matrix: FAIL -- '$id' claims coverage via '$test', but no such test exists" >&2
        FAILED=1
      fi
      ;;
    deferred)
      if printf '%s\n' "$TEST_NAMES" | grep -qxF "$id"; then
        echo "check-trace-matrix: FAIL -- '$id' is 'deferred' but a test named '$id' now exists -- flip its row to 'covered'" >&2
        FAILED=1
      fi
      ;;
  esac
done <<< "$MATRIX_ROWS"

# every inv_* test must have a matrix row
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case "$name" in
    *inv_*) short="${name##*::}" ;;
    *) continue ;;
  esac
  if ! printf '%s\n' "$MATRIX_IDS" | grep -qxF "$short"; then
    echo "check-trace-matrix: FAIL -- test '$name' has no row in docs/trace-matrix.md" >&2
    FAILED=1
  fi
done <<< "$TEST_NAMES"

# every INV_* constant must have a matrix row, and every matrix row an INV_*
# constant -- the registry and the matrix are two hands on the same list.
while IFS= read -r cid; do
  [ -n "$cid" ] || continue
  if ! printf '%s\n' "$MATRIX_IDS" | grep -qxF "$cid"; then
    echo "check-trace-matrix: FAIL -- invariants.rs declares '$cid' but docs/trace-matrix.md has no row for it" >&2
    FAILED=1
  fi
done <<< "$CONSTANT_IDS"

while IFS= read -r mid; do
  [ -n "$mid" ] || continue
  if ! printf '%s\n' "$CONSTANT_IDS" | grep -qxF "$mid"; then
    echo "check-trace-matrix: FAIL -- docs/trace-matrix.md has a row for '$mid' but invariants.rs declares no such INV_ constant" >&2
    FAILED=1
  fi
done <<< "$MATRIX_IDS"

# --- Guard-column sections: every `covered` row's Guard column names a
# real path, checked mechanically rather than by eye -- a guard renamed or
# deleted without updating the row is a lie the matrix would otherwise
# keep telling. Not part of the `inv_*`/`INV_*` id symmetry above (these
# guard requirements that span the client/server boundary, the CI graph
# itself, or a permanent schema decision, not a `sim` invariant). Add a
# section title here whenever a new "Requirement | Status | Guard" table
# is added to the matrix -- this loop is the only thing that makes that
# table's claims checked rather than decorative.
GUARD_SECTIONS=(
  "Round trip and client/server boundary"
  "Schema permanence"
)

for section in "${GUARD_SECTIONS[@]}"; do
  SECTION_TEXT="$(awk -v title="## $section" '
    $0 == title { insection = 1; next }
    /^## / { insection = 0 }
    insection { print }
  ' "$MATRIX")"
  if [ -z "$SECTION_TEXT" ]; then
    echo "check-trace-matrix: FAIL -- no '## $section' section found in $MATRIX" >&2
    FAILED=1
    continue
  fi
  SECTION_ROWS="$(printf '%s\n' "$SECTION_TEXT" | grep -E '^\| [A-Za-z]' || true)"

  while IFS='|' read -r _ requirement status guard _; do
    requirement="$(printf '%s' "$requirement" | xargs)"
    status="$(printf '%s' "$status" | xargs)"
    [ -n "$requirement" ] || continue
    [ "$status" = "covered" ] || continue
    path="$(printf '%s' "$guard" | grep -oE '`[^`]+`' | head -n1 | tr -d '`')"
    if [ -z "$path" ]; then
      echo "check-trace-matrix: FAIL -- '$requirement' is 'covered' but its Guard column names no backtick-quoted path" >&2
      FAILED=1
    elif [ ! -e "$REPO_ROOT/$path" ]; then
      echo "check-trace-matrix: FAIL -- '$requirement' claims coverage via '$path', but that path does not exist" >&2
      FAILED=1
    fi
  done <<< "$SECTION_ROWS"
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-trace-matrix: matrix, registry and test suite all agree" >&2
exit 0
