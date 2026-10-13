#!/usr/bin/env bash
# Story 3.9 AC6: the macro routing graph lives in tables, not module
# globals. Proven against a real disposable local SpacetimeDB instance, on
# its own port (3999 -- 3987-3998 are taken), with the `time-control`
# flavour, which alone carries the test-only reducer
# `debug_write_graph_then_fail` (writes a whole graph through the real
# writer, then returns Err).
#
# Legs, in order:
#   (a) rollback on an empty world: the test reducer is refused and
#       `district`, `business`, `route_node` and `route_edge` stay empty;
#   (b) `create_district` as owner writes a graph and its businesses;
#   (c) rollback on a world holding a graph: the test reducer is refused
#       and every graph table is byte-identical;
#   (d) restart on the same data directory: byte-identical;
#   (e) republish without --delete-data plus `finish_publish`: byte-
#       identical, auto_inc ids included -- a rebuild would renumber them.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-routing-graph.XXXXXX")"
PORT=3999
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL" --no-config)
DB=bc-routing-graph
START_LOG="$DATA_DIR/start.log"
START_PID=""
# `sim::routing::graph`'s own floor for a 512 x 512 district: a graph under
# this is not the generated one.
MIN_NODES=1000

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-routing-graph-persistence: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-routing-graph-persistence: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not become healthy within 30s" "$START_LOG"

table() { # <table> -- every row, one line each, sorted, whitespace removed
  local log="$DATA_DIR/table-$1.log"
  spacetime sql "$DB" "${SERVER_ARGS[@]}" -y "SELECT * FROM $1" >"$log" 2>&1 \
    || fail "could not query $1" "$log"
  awk '/^[- +|]+$/ { seen=1; next } seen && NF' "$log" | tr -d ' ' | sort
}
graph_state() { # every table the graph write touches, each tagged
  local t
  for t in district business route_node route_edge; do
    table "$t" | sed "s/^/$t:/"
  done
}
count_of() { # <state> <table>
  grep -c "^$2:" <<<"$1" || true
}

publish() { # <log> -- the time-control flavour, never --delete-data
  bash "$REPO_ROOT/scripts/dev/publish-dev.sh" "$DB" "${SERVER_ARGS[@]}" >"$1" 2>&1
}
finish_publish() {
  spacetime call "$DB" "${SERVER_ARGS[@]}" -y finish_publish >"$DATA_DIR/finish-publish.log" 2>&1 \
    || fail "finish_publish failed as owner" "$DATA_DIR/finish-publish.log"
}

publish "$DATA_DIR/publish-1.log" || fail "could not publish the time-control flavour" "$DATA_DIR/publish-1.log"
finish_publish

# --- (a) rollback on an empty world --------------------------------------
STATE_EMPTY="$(graph_state)"
[ -z "$STATE_EMPTY" ] || fail "a freshly published world already has district/business/graph rows"
if spacetime call "$DB" "${SERVER_ARGS[@]}" -y debug_write_graph_then_fail 7 >"$DATA_DIR/rollback-1.log" 2>&1; then
  fail "debug_write_graph_then_fail returned Ok -- it must always return Err" "$DATA_DIR/rollback-1.log"
fi
grep -qF "rolled back on purpose" "$DATA_DIR/rollback-1.log" \
  || fail "debug_write_graph_then_fail was refused, but not by its own Err -- the graph may never have been written" "$DATA_DIR/rollback-1.log"
[ "$(graph_state)" = "$STATE_EMPTY" ] || fail "an aborted reducer left graph, business or district rows behind"
ok "an aborting reducer that wrote a whole graph left every table empty"

# --- (b) create_district writes the graph --------------------------------
spacetime call "$DB" "${SERVER_ARGS[@]}" -y create_district >"$DATA_DIR/create.log" 2>&1 \
  || fail "create_district as owner failed" "$DATA_DIR/create.log"
STATE="$(graph_state)"
NODES="$(count_of "$STATE" route_node)"
EDGES="$(count_of "$STATE" route_edge)"
BUSINESSES="$(count_of "$STATE" business)"
[ "$NODES" -ge "$MIN_NODES" ] || fail "route_node has $NODES rows after create_district, expected at least $MIN_NODES"
[ "$EDGES" -ge "$NODES" ] || fail "route_edge has $EDGES rows for $NODES nodes -- fewer edges than nodes is not a connected graph"
[ "$BUSINESSES" -ge 1 ] || fail "create_district wrote no business rows"
[ "$(count_of "$STATE" district)" -eq 1 ] || fail "create_district did not write exactly one district row"
# Every source node's business id resolves to exactly one generated business,
# and every business is some source node's: the two id sets are equal.
NODE_BUSINESS_IDS="$(grep '^route_node:.*(some=' <<<"$STATE" | sed -E 's/.*\(some=([0-9]+)\).*/\1/' | sort -n)"
BUSINESS_IDS="$(grep '^business:' <<<"$STATE" | sed -E 's/^business:([0-9]+).*/\1/' | sort -n)"
[ -n "$BUSINESS_IDS" ] || fail "could not read the business ids out of the business table"
[ "$NODE_BUSINESS_IDS" = "$BUSINESS_IDS" ]   || fail "the route_node business ids are not exactly the business rows' ids (a source node names no business, one twice, or a business has no node)"
[ "$(sort -u <<<"$NODE_BUSINESS_IDS" | wc -l)" -eq "$BUSINESSES" ] || fail "two source nodes share a business id"
ok "create_district wrote $NODES nodes, $EDGES edges and $BUSINESSES businesses, each the business of exactly one source node"

# --- (c) rollback on a populated world -----------------------------------
if spacetime call "$DB" "${SERVER_ARGS[@]}" -y debug_write_graph_then_fail 8 >"$DATA_DIR/rollback-2.log" 2>&1; then
  fail "debug_write_graph_then_fail returned Ok -- it must always return Err" "$DATA_DIR/rollback-2.log"
fi
grep -qF "rolled back on purpose" "$DATA_DIR/rollback-2.log" \
  || fail "debug_write_graph_then_fail was refused, but not by its own Err" "$DATA_DIR/rollback-2.log"
[ "$(graph_state)" = "$STATE" ] || fail "an aborted reducer changed the stored graph"
ok "an aborting reducer that wrote a second graph left the stored one byte-identical"

# --- (d) restart ---------------------------------------------------------
bc_stop_spacetime_confirmed "$START_PID" "$SERVER_URL" 30 \
  || fail "the instance was still answering 30s after it was stopped" "$START_LOG"
START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not come back healthy after a restart" "$START_LOG"
bc_spacetime_alive "$START_PID" || fail "the restarted instance's process is not running" "$START_LOG"
[ "$(graph_state)" = "$STATE" ] || fail "a restart changed the stored graph"
ok "the graph survived a restart on the same data directory"

# --- (e) republish and finish_publish ------------------------------------
publish "$DATA_DIR/publish-2.log" || fail "could not republish the module over its own world" "$DATA_DIR/publish-2.log"
finish_publish
finish_publish
[ "$(graph_state)" = "$STATE" ] || fail "a republish plus finish_publish changed the stored graph (ids included)"
ok "the graph survived a republish and finish_publish unchanged, auto_inc ids included"

echo "check-routing-graph-persistence: ok -- the graph rolls back with its transaction and survives restart and republish without rebuilding" >&2
