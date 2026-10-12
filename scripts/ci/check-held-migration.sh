#!/usr/bin/env bash
# Story 6.10 (FR94, NFR33): `item_held` becomes public and its two-column
# `by_container` index becomes a single-column index on `container_id`. A
# world that already holds `item_held` rows must take that as an automatic
# migration with no `--delete-data`:
#   1. publishes the module at the PR's merge base with the default branch
#      (its `server/`, extracted with `git archive`) onto a disposable local
#      instance;
#   2. restores one container, one item instance and one held row through
#      the module's own restore path;
#   3. publishes HEAD's `server/` over it with neither `--delete-data` nor a
#      clear flag, and asserts the held row survived byte-for-byte and the
#      container's rows are readable through the new index.
# If the migrator refuses, this fails and the story stops: clearing data is
# not an option.
#
# Runs in CI's `migrate` job (needs full history for `git archive`), on its
# own port, 3995. BC_MIGRATION_BASE overrides the base ref.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-held-migration.XXXXXX")"
PORT=3995
SERVER_URL="http://127.0.0.1:$PORT"
DB=bc-held-migration
START_LOG="$DATA_DIR/start.log"
START_PID=""

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-held-migration: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

BASE="${BC_MIGRATION_BASE:-}"
if [ -z "$BASE" ]; then
  for ref in origin/master origin/main master main; do
    if git -C "$REPO_ROOT" rev-parse --verify -q "$ref^{commit}" >/dev/null; then
      BASE="$(git -C "$REPO_ROOT" merge-base "$ref" HEAD)" && break
    fi
  done
fi
[ -n "$BASE" ] || fail "no base ref to publish first (set BC_MIGRATION_BASE, or fetch the default branch)"
git -C "$REPO_ROOT" cat-file -e "$BASE^{commit}" 2>/dev/null \
  || fail "commit $BASE is not in this clone -- the checkout must have full history (fetch-depth: 0)"
BASE_DIR="$DATA_DIR/base"
mkdir -p "$BASE_DIR"
git -C "$REPO_ROOT" archive "$BASE" server | tar -x -C "$BASE_DIR" \
  || fail "could not extract server/ at $BASE"

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not become healthy within 30s" "$START_LOG"

publish() { # <module-dir> <log>
  spacetime publish --server "$SERVER_URL" --no-config -y "$DB" --module-path "$1" >"$2" 2>&1
}
call() { # <log> <reducer> [args...]
  local log="$1"
  shift
  spacetime call "$DB" --server "$SERVER_URL" --no-config -y "$@" >"$log" 2>&1
}
held_rows() { # the whole table, one normalised line per row
  local log="$DATA_DIR/held.log"
  spacetime sql "$DB" --server "$SERVER_URL" --no-config -y \
    "SELECT * FROM item_held" >"$log" 2>&1 || fail "could not query item_held" "$log"
  awk '/^[- +|]+$/ { seen=1; next } seen && NF' "$log" | tr -d ' ' | sort
}

echo "check-held-migration: publishing the merge base ($BASE)" >&2
publish "$BASE_DIR/server" "$DATA_DIR/base.log" || fail "could not publish the merge base's server/" "$DATA_DIR/base.log"

call "$DATA_DIR/r1.log" begin_restore || fail "begin_restore failed on the base module" "$DATA_DIR/r1.log"
# placed_object (object_id, def_id, x, y, floor, layer, orientation, chunk_key).
call "$DATA_DIR/r2.log" restore_placed_object '[[1,26,0,0,0,2,0,0]]' 1 \
  || fail "restore_placed_object failed" "$DATA_DIR/r2.log"
call "$DATA_DIR/r3.log" restore_item_instance '[[1,9,[0]]]' 1 \
  || fail "restore_item_instance failed" "$DATA_DIR/r3.log"
# item_held (instance_id, container_kind, container_id, slot_x, slot_y, orientation).
call "$DATA_DIR/r4.log" restore_item_held '[[1,0,1,2,1,1]]' \
  || fail "restore_item_held failed" "$DATA_DIR/r4.log"
call "$DATA_DIR/r5.log" finish_restore || fail "finish_restore failed on the base module" "$DATA_DIR/r5.log"

BEFORE="$(held_rows)"
[ -n "$BEFORE" ] || fail "the held row did not land -- this would prove an empty table survives, not a live one"

echo "check-held-migration: publishing HEAD over it, without --delete-data" >&2
publish "$REPO_ROOT/server" "$DATA_DIR/head.log" \
  || fail "HEAD's server/ was refused over a world holding item_held rows" "$DATA_DIR/head.log"

AFTER="$(held_rows)"
[ "$AFTER" = "$BEFORE" ] || fail "the held rows changed across the migration: '$BEFORE' -> '$AFTER'"

# The new single-column index serves the equality a container view issues.
log="$DATA_DIR/by-container.log"
spacetime sql "$DB" --server "$SERVER_URL" --no-config -y \
  "SELECT * FROM item_held WHERE container_id = 1" >"$log" 2>&1 || fail "could not query by container_id" "$log"
[ "$(awk '/^[- +|]+$/ { seen=1; next } seen && NF' "$log" | tr -d ' ' | sort)" = "$BEFORE" ] \
  || fail "the container's rows are not readable by container_id after the migration" "$log"

echo "check-held-migration: ok -- item_held rows survived the publish of HEAD over $BASE with no data cleared" >&2
