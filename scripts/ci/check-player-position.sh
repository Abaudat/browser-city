#!/usr/bin/env bash
# Story 4.4 (FR138, NFR17, NFR32): `player_position` proven against a real
# disposable SpacetimeDB instance with real, distinct identities (minted by
# POST /v1/identity, each a bearer token). Own instance and port (3998),
# never 3987-3997. Bounded polls only, well under a minute after publish.
#
# Legs:
#   1. Two characters each write several positions inside one chunk: each has
#      exactly one row equal to its last write, no other table's row count
#      moved, and the `position` class counter grew by exactly the calls made.
#   2. Whose row: the reducer takes no character or identity argument, a
#      caller with no character is refused and nothing changes, and an
#      out-of-range floor or cell is refused (Err, never a panic) while a
#      jump of any distance inside the world is accepted (FR137).
#   3. A held chunk-equality subscriber sees the player of its chunk and never
#      a player of a far one; a chunk crossing moves the row's chunk_key.
#   4. Durability: the instance is stopped and restarted on the same data
#      directory, and the row is still the last write.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-player-position.XXXXXX")"
PORT="${BC_PLAYER_POSITION_PORT:-3998}"
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
DB=bc-player-position
HEALTH_DEADLINE_S=30
SUBSCRIBE_TIMEOUT_S=8
START_PID=""

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() {
  echo "check-player-position: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-player-position: ok -- $1" >&2; }

# Chunk keys come from `sim::world::chunk_key` itself, never a copy of the
# bit layout.
mapfile -t KEY_VALUES < <(printf '%s\n' "0 0 0" "5 5 0" | (cd "$REPO_ROOT/server" && cargo run -q -p bounds --bin chunk-key)) \
  || fail "could not compute the chunk keys"
[ "${#KEY_VALUES[@]}" -eq 2 ] || fail "chunk-key returned ${#KEY_VALUES[@]} keys for 2 chunks"
KEY_NEAR="${KEY_VALUES[0]}"
KEY_FAR="${KEY_VALUES[1]}"

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"
spacetime publish --server "$SERVER_URL" --no-config -y "$DB" --module-path "$REPO_ROOT/server" \
  >"$DATA_DIR/publish.log" 2>&1 || fail "could not publish the module" "$DATA_DIR/publish.log"

mint() { curl -sf -X POST "$SERVER_URL/v1/identity" | sed 's/.*"token":"\([^"]*\)".*/\1/'; }
call() { # <token> <reducer> [json-args] -> "<body> <http-status>"
  local tok="$1" red="$2" args="${3:-[]}"
  curl -s -w ' %{http_code}' -X POST "$SERVER_URL/v1/database/$DB/call/$red" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$args"
}
expect_ok() {
  local out; out="$(call "$2" "$3" "${4:-[]}")"
  case "$out" in *" 200") ;; *) fail "$1 -- expected success, got: $out" ;; esac
}
expect_err() {
  local out; out="$(call "$2" "$3" "${4:-[]}")"
  case "$out" in *" 530") ;; *) fail "$1 -- expected a refusal (Err, never a panic), got: $out" ;; esac
  case "$out" in *panick*) fail "$1 -- the reducer panicked: $out" ;; esac
  [ -z "${5:-}" ] || case "$out" in *"$5"*) ;; *) fail "$1 -- refusal does not say '$5': $out" ;; esac
}
owner_sql() { spacetime sql --server "$SERVER_URL" --no-config -y "$DB" "$1" 2>/dev/null; }
row_of() { # <character_id> -> the position columns of its one row
  owner_sql "SELECT * FROM player_position WHERE character_id = $1" | tail -n +3     | awk -F'|' '{ gsub(/ /, ""); print $3 "|" $4 "|" $5 "|" $6 "|" $7 }'
}
rows_of() { owner_sql "SELECT * FROM $1" | tail -n +3 | grep -c . ; }

# Every table's row count, except the metered counters themselves.
snapshot() {
  spacetime describe --json --server "$SERVER_URL" --no-config -y "$DB" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const t of j.sections.find(x=>x.Tables).Tables)console.log(t.source_name)})' \
    | sort | while read -r t; do
      case "$t" in reducer_class_counter | reducer_class_sample | table_sample | storage_sample | player_position) continue ;; esac
      echo "$t=$(rows_of "$t")"
    done
}

A="$(mint)"; B="$(mint)"; C="$(mint)"
[ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] || fail "could not mint identities"
expect_ok "create_character as A" "$A" create_character
expect_ok "create_character as B" "$B" create_character
# C never creates a character.

# --- leg 1: one row per character, equal to its last write ----------------
BEFORE="$(snapshot)"
[ -n "$BEFORE" ] || fail "the schema listing came back empty -- this leg would pass vacuously"
CALLS_A=0; CALLS_B=0
for i in 1 2 3 4 5 6; do
  expect_ok "A writes position $i" "$A" set_player_position "[$i,$((i + 1)),0,$((i * 10)),$((i * 20))]"
  CALLS_A=$((CALLS_A + 1))
  expect_ok "B writes position $i" "$B" set_player_position "[$((i + 100)),$((i + 101)),0,7,9]"
  CALLS_B=$((CALLS_B + 1))
done
[ "$(rows_of player_position)" = "2" ] || fail "expected one player_position row per character, got $(rows_of player_position)"
[ "$(row_of 1)" = "6|7|0|60|120" ] || fail "A's row is not its last write: $(row_of 1)"
[ "$(row_of 2)" = "106|107|0|7|9" ] || fail "B's row is not its last write: $(row_of 2)"
[ "$(snapshot)" = "$BEFORE" ] || fail "a position write moved another table's row count (no event table, no second channel): $BEFORE -> $(snapshot)"
COUNTED="$(owner_sql "SELECT calls FROM reducer_class_counter WHERE class = 'position'" | tail -n +3 | tr -d ' ')"
[ "$COUNTED" = "$((CALLS_A + CALLS_B))" ] || fail "the position class counted '$COUNTED' calls, expected $((CALLS_A + CALLS_B))"
ok "one row per character equal to its last write; no other table moved; the position counter grew by exactly the $((CALLS_A + CALLS_B)) calls made"

# --- leg 2: whose row, and what is refused --------------------------------
spacetime describe --json --server "$SERVER_URL" --no-config -y "$DB" >"$DATA_DIR/describe.json" 2>/dev/null \
  || fail "spacetime describe --json failed" "$DATA_DIR/describe.json"
PARAMS="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=j.sections.find(x=>x.Reducers).Reducers.find(r=>r.source_name==="set_player_position");if(!r){console.log("MISSING");process.exit(0)}console.log(r.params.elements.map(e=>e.name.some).join(","))' "$DATA_DIR/describe.json")"
[ "$PARAMS" = "x,y,floor,frac_x,frac_y" ] || fail "set_player_position takes '$PARAMS' -- it must take no character or identity argument"
BEFORE_ROWS="$(rows_of player_position)"
expect_err "a caller with no character" "$C" set_player_position "[1,1,0,0,0]" "no character"
[ "$(rows_of player_position)" = "$BEFORE_ROWS" ] || fail "a refused caller changed player_position"
LAST_A="$(row_of 1)"
expect_err "an out-of-range floor" "$A" set_player_position "[1,1,100,0,0]" "floor"
expect_err "an out-of-range cell" "$A" set_player_position "[2147483647,0,0,0,0]" "addressable"
[ "$(row_of 1)" = "$LAST_A" ] || fail "a refused write changed A's row"
expect_ok "a jump of any distance inside the world (no plausibility check)" "$A" set_player_position "[200000000,-200000000,0,255,255]"
expect_ok "and back" "$A" set_player_position "[6,7,0,60,120]"
[ "$(row_of 1)" = "$LAST_A" ] || fail "A's row after the jump and back is $(row_of 1), expected $LAST_A"
ok "no character argument; a caller with no character, an out-of-range floor and an out-of-range cell are refused and change nothing; a jump is accepted"

# --- leg 3: a held chunk subscriber sees its chunk's player and no other ---
held() { # <key> <log>
  spacetime subscribe --server "$SERVER_URL" --no-config -y --anonymous --print-initial-update \
    --timeout "$SUBSCRIBE_TIMEOUT_S" "$DB" \
    "SELECT * FROM player_position WHERE player_position.chunk_key = $1" >"$2" 2>&1
}
held "$KEY_NEAR" "$DATA_DIR/near.log" &
NEAR_PID=$!
held "$KEY_FAR" "$DATA_DIR/far.log" &
FAR_PID=$!
sleep 3
# A stays inside chunk (0,0); B walks into chunk (5,5) and across to it.
expect_ok "A moves inside its chunk" "$A" set_player_position "[8,8,0,0,0]"
expect_ok "B crosses into chunk (5,5)" "$B" set_player_position "[170,170,0,1,1]"
wait "$NEAR_PID"; wait "$FAR_PID"
grep -q "\"chunk_key\":$KEY_NEAR" "$DATA_DIR/near.log" || fail "the near subscriber never saw a player of its chunk" "$DATA_DIR/near.log"
grep -q "\"chunk_key\":$KEY_FAR" "$DATA_DIR/near.log" && fail "the near subscriber saw a player of a far chunk" "$DATA_DIR/near.log"
grep -q "\"chunk_key\":$KEY_FAR" "$DATA_DIR/far.log" || fail "the far subscriber never saw B cross into its chunk" "$DATA_DIR/far.log"
grep -q "\"chunk_key\":$KEY_NEAR" "$DATA_DIR/far.log" && fail "the far subscriber saw a player of the near chunk" "$DATA_DIR/far.log"
ok "a held chunk-equality subscriber sees the players of its chunk and never one in a far chunk; a crossing moves the row"

# --- leg 4: durability ----------------------------------------------------
LAST_A="$(row_of 1)"; LAST_B="$(row_of 2)"
bc_stop_spacetime_confirmed "$START_PID" "$SERVER_URL" 20 || fail "the instance did not stop"
START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$DATA_DIR/restart.log")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" || fail "the instance did not come back" "$DATA_DIR/restart.log"
[ "$(row_of 1)" = "$LAST_A" ] && [ "$(row_of 2)" = "$LAST_B" ] \
  || fail "the rows after a restart are '$(row_of 1)' / '$(row_of 2)', expected '$LAST_A' / '$LAST_B'"
ok "both rows are exactly the last write after the instance restarted on the same data directory"

echo "check-player-position: one durable row per character, written only by its owner, against a real instance" >&2
exit 0
