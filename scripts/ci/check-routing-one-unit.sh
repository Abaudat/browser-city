#!/usr/bin/env bash
# FR130, story 3.9 AC3: edge cost is denominated in minutes and no second
# distance unit exists anywhere in the macro routing graph. Fails on any
# struct field named for cells, tiles, distance, length or a metric unit in
# `sim::routing::graph` (above its test module) and in the graph tables
# (`tables/routing.rs`), and on an `Edge` that does not carry its cost as
# `Milliminutes`. Comment lines are skipped.
#
# Usage: check-routing-one-unit.sh [graph.rs] [routing-tables.rs]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
GRAPH="${1:-"$REPO_ROOT/server/sim/src/routing/graph.rs"}"
TABLES="${2:-"$REPO_ROOT/server/src/tables/routing.rs"}"
for f in "$GRAPH" "$TABLES"; do
  [ -f "$f" ] || { echo "check-routing-one-unit: $f not found" >&2; exit 1; }
done

scan() { # <file> -- the file's code above `#[cfg(test)]`, comments dropped
  sed '/^#\[cfg(test)\]/,$d' "$1" | tr -d '\r' | grep -v '^[[:space:]]*//'
}

FIELD='^[[:space:]]*(pub(\([a-z ]+\))?[[:space:]]+)?[a-z_0-9]*(cell|tile|dist|length|metre|meter|km)[a-z_0-9]*[[:space:]]*:'
BAD=""
for f in "$GRAPH" "$TABLES"; do
  HITS="$(scan "$f" | grep -nE "$FIELD" || true)"
  [ -z "$HITS" ] || BAD="$BAD$f:"$'\n'"$HITS"$'\n'
done
if [ -n "$BAD" ]; then
  echo "check-routing-one-unit: FAIL -- a graph field is denominated in cells, tiles or a distance; the graph's only unit is Milliminutes (FR130):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi

if ! scan "$GRAPH" | tr '\n' ' ' | grep -Eq 'pub struct Edge[[:space:]]*\{[^}]*pub cost:[[:space:]]*Milliminutes'; then
  echo "check-routing-one-unit: FAIL -- routing::graph::Edge does not carry 'pub cost: Milliminutes' (FR130)" >&2
  exit 1
fi
if ! scan "$TABLES" | tr '\n' ' ' | grep -Eq 'pub cost_milliminutes:[[:space:]]*i64'; then
  echo "check-routing-one-unit: FAIL -- route_edge has no 'cost_milliminutes' column (FR130)" >&2
  exit 1
fi
echo "check-routing-one-unit: the graph and its tables carry minutes and no second distance unit (FR130)" >&2
