#!/usr/bin/env bash
# Self-test for scripts/ci/list-time-control-reducers.sh: a gated reducer, a
# reducer of a gated module and nothing else is listed.
set -uo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=harness.sh
. "$HERE/harness.sh"
SCRIPT="$HERE/../list-time-control-reducers.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/src/tables"
cat >"$WORK/src/tables/mod.rs" <<'EOF'
pub mod world;
#[cfg(feature = "time-control")]
pub mod clock;
EOF
cat >"$WORK/src/tables/clock.rs" <<'EOF'
#[spacetimedb::reducer]
pub fn jump(ctx: &ReducerContext) {}
fn helper() {}
EOF
cat >"$WORK/src/tables/world.rs" <<'EOF'
#[spacetimedb::reducer]
pub fn live_reducer(ctx: &ReducerContext) {}

/// Test-only.
#[cfg(feature = "time-control")]
#[spacetimedb::reducer]
pub fn debug_wipe(ctx: &ReducerContext) {}

#[cfg(feature = "time-control")]
pub fn gated_helper() {}

#[spacetimedb::reducer]
pub fn another_live(ctx: &ReducerContext) {}
EOF

OUT="$(bash "$SCRIPT" "$WORK/src" 2>&1)"
check_contains "a gated reducer is listed" "debug_wipe" "$OUT"
check_contains "a gated module's reducer is listed" "jump" "$OUT"
check "exactly the two" 0 test "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" = 2
check "a live reducer is not listed" 1 grep -q "live_reducer\|another_live\|gated_helper\|helper" <<<"$OUT"

mkdir -p "$WORK/empty"
echo 'pub fn x() {}' >"$WORK/empty/a.rs"
check "no time-control reducer at all fails" 1 bash "$SCRIPT" "$WORK/empty"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
