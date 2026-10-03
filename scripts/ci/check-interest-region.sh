#!/usr/bin/env bash
# Story 4.3 (FR136, FR58): proves, against a real disposable SpacetimeDB
# instance, the half of interest management only the server can answer --
# that the exact query the client's typed builder emits for a chunk
# (`SELECT * FROM "<table>" WHERE "<table>"."chunk_key" = <key>`) is
# accepted anonymously, on every spatial table the region streams, and
# returns the rows of that chunk and no row of any other.
#
# The world is seeded across a 7x7 block of chunks (negative chunk
# coordinates included, whose keys sit above 2^53) through the module's
# own owner-only restore path -- no test-only reducer exists in the
# production module. Subscribers are held `spacetime subscribe` sessions
# (the idiom check-view-live-refresh.sh uses), never one-off SQL.
#
# Its own disposable local instance and port (3996), never 3987-3995.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-interest-region.XXXXXX")"
PORT=3996
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
DB_NAME=bc-interest-region
HEALTH_DEADLINE_S=30
SUBSCRIBE_TIMEOUT_S=6
SPAN=3 # chunks -SPAN..SPAN on each axis

START_PID=""
cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-interest-region: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-interest-region: ok -- $1" >&2; }

# Every chunk key this check uses comes from `sim::world::chunk_key` itself
# (the `bounds` crate's `chunk-key` binary) -- no copy of the bit layout
# lives here. One cargo run for the whole list.
declare -A KEYS
KEY_COORDS=()
for cx in $(seq -"$SPAN" "$SPAN"); do
  for cy in $(seq -"$SPAN" "$SPAN"); do KEY_COORDS+=("$cx $cy 0"); done
done
KEY_COORDS+=("100 100 0" "0 0 -1")
mapfile -t KEY_VALUES < <(printf '%s\n' "${KEY_COORDS[@]}" | (cd "$REPO_ROOT/server" && cargo run -q -p bounds --bin chunk-key)) \
  || fail "could not compute the chunk keys"
[ "${#KEY_VALUES[@]}" -eq "${#KEY_COORDS[@]}" ] || fail "chunk-key returned ${#KEY_VALUES[@]} keys for ${#KEY_COORDS[@]} chunks"
for i in "${!KEY_COORDS[@]}"; do
  read -r kx ky kf <<<"${KEY_COORDS[$i]}"
  KEYS["$kx,$ky,$kf"]="${KEY_VALUES[$i]}"
done
chunk_key() { echo "${KEYS[$1,$2,$3]}"; } # <cx> <cy> <floor>

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

spacetime publish --server "$SERVER_URL" --no-config -y "$DB_NAME" --module-path "$REPO_ROOT/server" \
  >"$DATA_DIR/publish.log" 2>&1 || fail "could not publish the module" "$DATA_DIR/publish.log"

call() { # <reducer> <args-json...>
  local reducer="$1"; shift
  spacetime call "$DB_NAME" --server "$SERVER_URL" --no-config -y "$reducer" "$@" \
    >"$DATA_DIR/call.log" 2>&1 || fail "$reducer failed" "$DATA_DIR/call.log"
}

# --- seed: one placed_object and one actor_location per chunk
PLACED=""; ACTORS=""; N=0
for cx in $(seq -"$SPAN" "$SPAN"); do
  for cy in $(seq -"$SPAN" "$SPAN"); do
    N=$((N + 1))
    key="$(chunk_key "$cx" "$cy" 0)"
    x=$((cx * 32 + 5)); y=$((cy * 32 + 5))
    PLACED="$PLACED${PLACED:+,}[$N,1,$x,$y,0,3,0,$key]"
    ACTORS="$ACTORS${ACTORS:+,}[$N,0,$N,$key,0]"
  done
done
call begin_restore '[]'
call restore_placed_object "[$PLACED]" "$N"
call restore_actor_location "[$ACTORS]" "$N"
call finish_restore '[]'
ok "seeded $N chunks with one placed_object and one actor_location each (through begin_restore/restore_*/finish_restore)"

# held <table> <chunk key> <log> -- one anonymous held subscription to
# exactly the query the typed builder emits.
held() {
  local table="$1" key="$2" log="$3"
  spacetime subscribe --server "$SERVER_URL" --no-config -y --anonymous --print-initial-update \
    --timeout "$SUBSCRIBE_TIMEOUT_S" "$DB_NAME" \
    "SELECT * FROM \"$table\" WHERE \"$table\".\"chunk_key\" = $key" >"$log" 2>&1
}

check_chunk() { # <cx> <cy>
  local cx="$1" cy="$2" key
  key="$(chunk_key "$cx" "$cy" 0)"
  for table in placed_object actor_location; do
    local log="$DATA_DIR/held-$table-$cx-$cy.log"
    held "$table" "$key" "$log"
    [ "$(grep -o "\"chunk_key\":[0-9]*" "$log" | sort -u | wc -l)" -eq 1 ] \
      || fail "'$table' chunk ($cx,$cy): expected rows of exactly one chunk" "$log"
    grep -q "\"chunk_key\":$key[,}]" "$log" \
      || fail "'$table' chunk ($cx,$cy): the chunk's own row (key $key) never arrived" "$log"
    [ "$(grep -o "\"chunk_key\":" "$log" | wc -l)" -eq 1 ] \
      || fail "'$table' chunk ($cx,$cy): more than the one seeded row arrived" "$log"
  done
}

check_chunk 0 0
check_chunk "-$SPAN" "-$SPAN"
check_chunk "$SPAN" "-$SPAN"
check_chunk "-1" "$SPAN"
ok "a subscriber filtered to one chunk receives that chunk's row and no row of any other, on both placed_object and actor_location, negative chunk keys (above 2^53) included"

# A chunk nobody seeded: the query is accepted and returns nothing.
EMPTY_KEY="$(chunk_key 100 100 0)"
held placed_object "$EMPTY_KEY" "$DATA_DIR/held-empty.log"
grep -q '"chunk_key"' "$DATA_DIR/held-empty.log" && fail "an empty chunk returned a row" "$DATA_DIR/held-empty.log"
grep -qi "error" "$DATA_DIR/held-empty.log" && fail "the server rejected a pure chunk-equality query on an empty chunk" "$DATA_DIR/held-empty.log"
ok "a chunk with no rows subscribes cleanly and returns nothing"

# The other floor of the band is its own key.
SUB_KEY="$(chunk_key 0 0 -1)"
held placed_object "$SUB_KEY" "$DATA_DIR/held-sub.log"
grep -q '"chunk_key"' "$DATA_DIR/held-sub.log" && fail "floor -1 of chunk (0,0) returned the ground floor's row" "$DATA_DIR/held-sub.log"
ok "a chunk key carries its floor: floor -1 of a seeded chunk is empty"

echo "check-interest-region: a chunk-equality subscription returns exactly its chunk, anonymously, against a real instance" >&2
exit 0
