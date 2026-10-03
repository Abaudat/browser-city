#!/usr/bin/env bash
# Story 4.5 (FR141-FR143): the identity reducers proven against a real
# disposable SpacetimeDB instance with real, distinct identities (minted by
# POST /v1/identity, each a bearer token). Own instance and port (3997),
# never 3987-3996. Same fail-loud shape as its siblings: every failure
# aborts at once and names what went wrong.
#
# What is proven here: connecting alone writes nothing; create_character
# writes one row in each table and is a no-op the second time; a stranger,
# a spent code, a wrong provider's audience and two different characters
# are all refused with Err text and change nothing; after a link both
# identities reach the same character with the same created_at; a client
# can read only its own character (`character_identity` stays private).
# Code expiry and pruning are time-driven and proven in `sim`
# (`check_claim`) rather than waited for here.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-identity.XXXXXX")"
PORT="${BC_IDENTITY_PORT:-3997}"
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
DB=bc-identity
START_PID=""

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() {
  echo "check-identity-link: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-identity-link: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not become healthy" "$START_LOG"
spacetime publish --server "$SERVER_URL" --no-config -y "$DB" --module-path "$REPO_ROOT/server" \
  >"$DATA_DIR/publish.log" 2>&1 || fail "could not publish the module" "$DATA_DIR/publish.log"

# mint -> a fresh identity's bearer token
mint() { curl -sf -X POST "$SERVER_URL/v1/identity" | sed 's/.*"token":"\([^"]*\)".*/\1/'; }

# call <token> <reducer> [json-args] -> prints "<http-status> <body>"
call() {
  local tok="$1" red="$2" args="${3:-[]}"
  curl -s -w ' %{http_code}' -X POST "$SERVER_URL/v1/database/$DB/call/$red" \
    -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$args"
}
# expect_ok / expect_err <description> <token> <reducer> [json-args] [message-fragment]
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

# Owner-side reads (the CLI identity published the module and may read private tables).
owner_sql() { spacetime sql --server "$SERVER_URL" --no-config -y "$DB" "$1" 2>/dev/null; }
rows() { owner_sql "SELECT * FROM $1" | grep -cE '^ [0-9]+ '; }
# my_character as a given identity -> the JSON result
my_character() {
  curl -s -X POST "$SERVER_URL/v1/database/$DB/sql" -H "Authorization: Bearer $1" -d 'SELECT * FROM my_character'
}
snapshot() { echo "$(rows character)/$(rows character_identity)"; }
character_row() { owner_sql "SELECT * FROM character WHERE character_id = $1" | grep -E "^ $1 "; }

# --- connecting alone writes nothing --------------------------------------
BEFORE="$(snapshot)"
spacetime subscribe --server "$SERVER_URL" --no-config -y --timeout 3 "$DB" "SELECT * FROM module_version" \
  >"$DATA_DIR/connect.log" 2>&1
[ "$(snapshot)" = "$BEFORE" ] || fail "connecting changed the character tables ($BEFORE -> $(snapshot))" "$DATA_DIR/connect.log"
ok "connecting writes no character and no mapping"

# --- create ---------------------------------------------------------------
A="$(mint)"; B="$(mint)"; C="$(mint)"; D="$(mint)"
[ -n "$A" ] && [ -n "$B" ] && [ -n "$C" ] && [ -n "$D" ] || fail "could not mint identities"
expect_ok "create_character as A" "$A" create_character
[ "$(rows character)" = "1" ] && [ "$(rows character_identity)" = "1" ] || fail "create wrote $(snapshot), expected 1/1"
expect_ok "create_character a second time as A" "$A" create_character
[ "$(snapshot)" = "1/1" ] || fail "a second create wrote rows ($(snapshot))"
expect_ok "create_character as D" "$D" create_character
[ "$(snapshot)" = "2/2" ] || fail "D's create wrote $(snapshot), expected 2/2"
ok "create writes one row in each table; a second create writes nothing"

# --- link ------------------------------------------------------------------
CODE_1="$(printf 'a1%.0s' $(seq 32))"
CODE_2="$(printf 'b2%.0s' $(seq 32))"
CODE_3="$(printf 'c3%.0s' $(seq 32))"
expect_err "begin_link before any provider is accepted" "$A" begin_link "[\"$CODE_1\"]" "not available"
spacetime call --server "$SERVER_URL" --no-config -y "$DB" accept_oidc_issuer localhost spacetimedb \
  >"$DATA_DIR/accept.log" 2>&1 || fail "accept_oidc_issuer failed" "$DATA_DIR/accept.log"
spacetime call --server "$SERVER_URL" --no-config -y "$DB" accept_oidc_issuer localhost spacetimedb \
  >"$DATA_DIR/accept2.log" 2>&1 || fail "accept_oidc_issuer is not idempotent" "$DATA_DIR/accept2.log"
[ "$(rows oidc_issuer)" = "1" ] || fail "accepting the same issuer twice wrote $(rows oidc_issuer) rows"
expect_err "accept_oidc_issuer by a stranger" "$C" accept_oidc_issuer '["x","y"]' "module owner"

expect_err "begin_link with a malformed code" "$A" begin_link '["zz"]' "64 hex"
expect_err "a stranger redeeming a code nobody issued" "$C" complete_link "[\"$CODE_1\"]" "unknown or already used"
expect_ok "begin_link as A" "$A" begin_link "[\"$CODE_1\"]"

# Two different characters are never merged.
expect_ok "begin_link as D" "$D" begin_link "[\"$CODE_2\"]"
BEFORE="$(owner_sql 'SELECT * FROM character_identity')"
expect_err "linking onto a different character" "$A" complete_link "[\"$CODE_2\"]" "different character"
[ "$(owner_sql 'SELECT * FROM character_identity')" = "$BEFORE" ] || fail "a refused link changed character_identity"
ok "two identities with different characters are refused, and nothing changes"

# A token minted for another application is refused.
spacetime call --server "$SERVER_URL" --no-config -y "$DB" accept_oidc_issuer localhost some-other-app \
  >"$DATA_DIR/accept3.log" 2>&1 || fail "could not re-point the issuer" "$DATA_DIR/accept3.log"
OUT="$(call "$B" complete_link "[\"$CODE_1\"]")"
case "$OUT" in *"another application"*" 403") ;; *) fail "a token for another application was not refused at connect: $OUT" ;; esac
spacetime call --server "$SERVER_URL" --no-config -y "$DB" accept_oidc_issuer localhost spacetimedb \
  >"$DATA_DIR/accept4.log" 2>&1 || fail "could not restore the issuer" "$DATA_DIR/accept4.log"
ok "a token for another application cannot link"

# A cannot redeem its own code.
expect_err "redeeming one's own code" "$A" complete_link "[\"$CODE_1\"]" "itself"

CHAR_A_BEFORE="$(character_row 1)"
[ -n "$CHAR_A_BEFORE" ] || fail "could not read A's character row"
expect_ok "complete_link as B" "$B" complete_link "[\"$CODE_1\"]"
expect_err "redeeming the same code twice" "$B" complete_link "[\"$CODE_1\"]" "unknown or already used"
[ "$(rows character)" = "2" ] || fail "linking changed the number of characters"
[ "$(rows character_identity)" = "3" ] || fail "linking wrote $(rows character_identity) mappings, expected 3"
[ "$(character_row 1)" = "$CHAR_A_BEFORE" ] || fail "linking changed the character row"
MINE_A="$(my_character "$A")"; MINE_B="$(my_character "$B")"
ROW_A="$(echo "$MINE_A" | sed 's/.*"rows":\(\[\[.*\]\]\).*/\1/')"
ROW_B="$(echo "$MINE_B" | sed 's/.*"rows":\(\[\[.*\]\]\).*/\1/')"
case "$ROW_B" in "[[1,"*) ;; *) fail "B does not reach character 1 after linking: $MINE_B" ;; esac
case "$ROW_A" in "[[1,"*) ;; *) fail "A no longer reaches character 1: $MINE_A" ;; esac
# Same character_id and created_at for both; `linked` is true for both.
[ "$ROW_A" = "$ROW_B" ] || fail "A and B read different my_character rows: $ROW_A vs $ROW_B"
case "$ROW_A" in *true*) ;; *) fail "my_character does not report linked after a link: $ROW_A" ;; esac
ok "after a link both identities reach the same character, which is unchanged"

# --- one identity cannot read another's mapping ----------------------------
OUT="$(curl -s -X POST "$SERVER_URL/v1/database/$DB/sql" -H "Authorization: Bearer $C" -d 'SELECT * FROM character_identity')"
case "$OUT" in *"private"*|*"no such table"*) ;; *) fail "a client could read character_identity: $OUT" ;; esac
MINE_C="$(my_character "$C")"
case "$MINE_C" in *'"rows":[]'*) ;; *) fail "a stranger's my_character is not empty: $MINE_C" ;; esac
MINE_D="$(my_character "$D")"
case "$MINE_D" in *'[[2,'*) ;; *) fail "D's my_character does not show D's own character: $MINE_D" ;; esac
case "$MINE_D" in *'[[1,'*) fail "D's my_character leaked another character: $MINE_D" ;; esac
ok "character_identity is private and my_character returns only the caller's row"

# The requester's own issuer is what its new mapping records: a requester that
# came through the registered issuer (every local token here does) is never
# written down as anonymous.
E="$(mint)"; F="$(mint)"
CODE_4="$(printf 'd4%.0s' $(seq 32))"
expect_ok "create_character as E" "$E" create_character
expect_ok "begin_link as F" "$F" begin_link "[\"$CODE_4\"]"
expect_ok "complete_link as E (the redeemer has the character)" "$E" complete_link "[\"$CODE_4\"]"
FISSUER="$(owner_sql 'SELECT * FROM character_identity' | grep -E '^ [0-9]+ ' | tail -1 | awk -F'|' '{gsub(/ /, "", $4); print $4}')"
[ "$FISSUER" = "1" ] || fail "the requester's mapping was recorded under issuer '$FISSUER', not its own (1)"
ok "a mapped requester is recorded under its own issuer"

echo "check-identity-link: all checks passed" >&2
