#!/usr/bin/env bash
# Story 7.1 (FR20, FR145): the server writer, against a real local instance.
#   1. `create_district` as owner writes buildings, their areas and the
#      dwelling stock, inside CREATE_DISTRICT_CEILING_MS;
#   2. `create_character` then writes, in one transaction, a character, one
#      tenancy over a `building` row that exists and is a `dwelling`, a
#      first `player_position` inside that building's `building_area`, the
#      starting box and the agreement on it (and its `tenancy_document`);
#   3. a second `create_character` for the same identity writes nothing;
#   4. a refused name writes no tenancy, no position and no kit.
# Usage: check-housing-live.sh   (own port, 3995)
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
# The stamped ceiling for the whole generate-and-write reducer, CLI round
# trip included: about 3x the 0.8 s CI measures. Raising it is a decision.
CREATE_DISTRICT_CEILING_MS=2500
# The starting box's object def id, read from the built defs.
BOX_DEF="$(jq -r '.balance[] | select(.key == "housing.starting_box_object_id") | .value' "$REPO_ROOT/client/public/defs/defs.json" | tr -d '\r')"
case "$BOX_DEF" in ''|*[!0-9]*) echo "check-housing-live: FAIL -- no housing.starting_box_object_id in the built defs" >&2; exit 1 ;; esac
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-housing-live.XXXXXX")"
PORT=3995
URL="http://127.0.0.1:$PORT"
DB=bc-housing-live
PID=""
cleanup() { bc_stop_spacetime "$PID"; rm -rf "$DATA_DIR"; }
trap cleanup EXIT
fail() { echo "check-housing-live: FAIL -- $1" >&2; [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2; exit 1; }

PID="$(bc_start_spacetime "$DATA_DIR" "$PORT" "$DATA_DIR/start.log")"
bc_wait_spacetime_healthy "$URL" 60 || fail "the instance never became healthy" "$DATA_DIR/start.log"
spacetime publish "$DB" --server "$URL" --no-config -y --module-path "$REPO_ROOT/server" >"$DATA_DIR/publish.log" 2>&1 \
  || fail "publish failed" "$DATA_DIR/publish.log"

sql() { # <query> -> data rows only, whitespace removed
  spacetime sql "$DB" --server "$URL" --no-config -y "$1" >"$DATA_DIR/sql.log" 2>&1 \
    || fail "query failed: $1" "$DATA_DIR/sql.log"
  awk '/^[- +|]+$/ { seen=1; next } seen && NF' "$DATA_DIR/sql.log" | tr -d ' '
}
count() { sql "SELECT COUNT(*) AS n FROM $1" | head -1; }

T0=$(date +%s%3N)
spacetime call "$DB" --server "$URL" --no-config -y create_district 7 >"$DATA_DIR/cd.log" 2>&1 \
  || fail "create_district failed" "$DATA_DIR/cd.log"
MS=$(( $(date +%s%3N) - T0 ))
echo "check-housing-live: create_district took ${MS} ms (ceiling ${CREATE_DISTRICT_CEILING_MS})" >&2
[ "$MS" -le "$CREATE_DISTRICT_CEILING_MS" ] || fail "create_district took ${MS} ms, over the ${CREATE_DISTRICT_CEILING_MS} ms ceiling"
[ "$(count building)" -gt 0 ] || fail "create_district wrote no building"
[ "$(count dwelling)" -gt 0 ] || fail "create_district wrote no dwelling"
[ "$(count placed_object)" -gt 0 ] || fail "create_district wrote no placed_object (pass 7)"
[ "$(count tenancy)" -eq 0 ] || fail "a tenancy exists before any character"

# A refused name: nothing of the arrival is written.
spacetime call "$DB" --server "$URL" --no-config -y create_character "" >"$DATA_DIR/bad.log" 2>&1 \
  && fail "an empty name was accepted"
for t in character tenancy player_position tenancy_document item_instance; do
  [ "$(count $t)" -eq 0 ] || fail "a refused create_character left rows in $t"
done
PLACED_BEFORE="$(count placed_object)"

spacetime call "$DB" --server "$URL" --no-config -y create_character "Ada" >"$DATA_DIR/cc.log" 2>&1 \
  || fail "create_character failed" "$DATA_DIR/cc.log"
for t in character tenancy player_position tenancy_document item_placed; do
  [ "$(count $t)" -eq 1 ] || fail "after create_character, $t has $(count $t) rows, not 1"
done
[ "$(count placed_object)" -eq $((PLACED_BEFORE + 1)) ] || fail "create_character must place exactly one object (the box)"

# The tenancy names a building row that is a dwelling, and the spawn lies
# inside that building's own area.
[ "$(sql "SELECT t.building_id FROM tenancy t JOIN building b ON t.building_id = b.building_id JOIN dwelling d ON d.building_id = b.building_id" | wc -l)" -eq 1 ] \
  || fail "the tenancy does not name a building row that is a dwelling"
[ "$(sql "SELECT p.character_id FROM player_position p JOIN tenancy t ON t.tenant_id = p.character_id JOIN building_area a ON a.building_id = t.building_id WHERE p.x >= a.x0 AND p.x < a.x1 AND p.y >= a.y0 AND p.y < a.y1" | wc -l)" -ge 1 ] \
  || fail "the first position is not inside the building area the tenancy names"
# The box and the agreement stand inside it too.
BID="$(sql "SELECT building_id FROM tenancy" | head -1)"
[ "$(sql "SELECT o.object_id FROM placed_object o JOIN building_area a ON o.floor = a.floor WHERE a.building_id = $BID AND o.def_id = $BOX_DEF AND o.x >= a.x0 AND o.x < a.x1 AND o.y >= a.y0 AND o.y < a.y1" | wc -l)" -ge 1 ] \
  || fail "the starting box is not inside the let building"
[ "$(sql "SELECT i.instance_id FROM item_placed i JOIN building_area a ON i.floor = a.floor WHERE a.building_id = $BID AND i.x >= a.x0 AND i.x < a.x1 AND i.y >= a.y0 AND i.y < a.y1" | wc -l)" -ge 1 ] \
  || fail "the starting agreement is not inside the let building"

# The same identity again is a no-op.
spacetime call "$DB" --server "$URL" --no-config -y create_character "Ada" >"$DATA_DIR/cc2.log" 2>&1 \
  || fail "a second create_character failed" "$DATA_DIR/cc2.log"
for t in character tenancy player_position tenancy_document item_placed; do
  [ "$(count $t)" -eq 1 ] || fail "a second create_character changed $t"
done
echo "check-housing-live: a character, its tenancy, spawn and kit land together inside one dwelling; repeats and refusals write nothing" >&2
