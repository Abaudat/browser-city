#!/usr/bin/env bash
# scripts/ci/check-trace-matrix-retired.sh's own coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-trace-matrix-retired.sh"

D="$(fake_dir)"
cat > "$D/base.md" <<'M'
| Requirement | Status | Guard |
| --- | --- | --- |
| The stairwell is drawn between its railings so the player walks between them | covered | `a.ts` |
| A door opens onto the pavement and never onto another wall of the city | covered | `b.ts` |
M

cp "$D/base.md" "$D/same.md"
bash "$CHECK" "$D/base.md" "$D/same.md" >/dev/null 2>&1
check "an unchanged matrix passes" 0 bash -c "exit $?"

sed '4d' "$D/base.md" > "$D/dropped.md"
OUT="$(bash "$CHECK" "$D/base.md" "$D/dropped.md" 2>&1)"; CODE=$?
check "a silently dropped row fails" 1 bash -c "exit $CODE"
check_contains "names the row" "A door opens onto the pavement" "$OUT"

{ cat "$D/dropped.md"; echo '| retired: story 3.16 -- A door opens onto the pavement and never onto another wall of the city | retired | the street is gone |'; } > "$D/retired.md"
bash "$CHECK" "$D/base.md" "$D/retired.md" >/dev/null 2>&1
check "a row named as retired passes" 0 bash -c "exit $?"

summary
