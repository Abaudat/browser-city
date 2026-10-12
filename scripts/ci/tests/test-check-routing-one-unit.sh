#!/usr/bin/env bash
# check-routing-one-unit.sh's own coverage: plants each violation in a
# throwaway pair of files.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-routing-one-unit.sh"

GOOD_GRAPH='pub struct Edge {
    pub a: u32,
    pub b: u32,
    pub cost: Milliminutes,
}'
GOOD_TABLES='pub struct RouteEdge {
    pub edge_id: u64,
    pub cost_milliminutes: i64,
}'

pair() { # <graph content> <tables content> -- prints "<graph> <tables>"
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/graph.rs"
  printf '%s\n' "$2" > "$d/routing.rs"
  printf '%s %s' "$d/graph.rs" "$d/routing.rs"
}

# shellcheck disable=SC2046
check "minutes only passes" 0 bash "$CHECK" $(pair "$GOOD_GRAPH" "$GOOD_TABLES")

# shellcheck disable=SC2046
check "a length_cells field on Edge fails" 1 bash "$CHECK" $(pair "pub struct Edge {
    pub length_cells: u32,
    pub cost: Milliminutes,
}" "$GOOD_TABLES")

# shellcheck disable=SC2046
check "a distance column fails" 1 bash "$CHECK" $(pair "$GOOD_GRAPH" "pub struct RouteEdge {
    pub distance: f64,
    pub cost_milliminutes: i64,
}")

# shellcheck disable=SC2046
check "a cost in another type fails" 1 bash "$CHECK" $(pair "pub struct Edge {
    pub cost: i64,
}" "$GOOD_TABLES")

# shellcheck disable=SC2046
check "a table without cost_milliminutes fails" 1 bash "$CHECK" $(pair "$GOOD_GRAPH" "pub struct RouteEdge {
    pub edge_id: u64,
}")

# shellcheck disable=SC2046
check "a banned name in a comment passes" 0 bash "$CHECK" $(pair "// no length_cells field
$GOOD_GRAPH" "$GOOD_TABLES")

# shellcheck disable=SC2046
check "a banned name in the test module passes" 0 bash "$CHECK" $(pair "$GOOD_GRAPH
#[cfg(test)]
mod tests { struct S { cells: u32 } }" "$GOOD_TABLES")

check "the real graph passes" 0 bash "$CHECK"

summary
exit $?
