#!/usr/bin/env bash
# NFR33, as a standing guard: publishing HEAD's module over the world the
# PR's merge base left must be an automatic migration that loses nothing.
#   1. publishes the module at the merge base with the default branch (its
#      `server/`, extracted with `git archive`) onto a disposable local
#      instance;
#   2. seeds every non-scheduled table through the module's own restore
#      path (`scripts/ops/seed-edge-rows.sh`, schema-driven, from the
#      base's own `schema.snapshot.json`), so the world holds real rows in
#      every table, `item_held` included;
#   3. exports the world (`scripts/ops/export-world.sh`), publishes HEAD's
#      `server/` over it with neither `--delete-data` nor a clear flag,
#      exports again, and asserts every seeded row is still there, unchanged.
# If the migrator refuses, or a row changes, this fails: clearing data is
# not an option, and a table's access or index may change under it.
#
# Runs in CI's `migrate` job (needs full history for `git archive`), on its
# own port, 3995. BC_MIGRATION_BASE overrides the base ref.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-publish-over-base.XXXXXX")"
PORT=3995
SERVER_URL="http://127.0.0.1:$PORT"
DB=bc-publish-over-base
START_LOG="$DATA_DIR/start.log"
START_PID=""

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-publish-over-base: FAIL -- $1" >&2
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
[ -f "$BASE_DIR/server/schema.snapshot.json" ] || fail "the base has no server/schema.snapshot.json"

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not become healthy within 30s" "$START_LOG"

publish() { # <module-dir> <log>
  spacetime publish --server "$SERVER_URL" --no-config -y "$DB" --module-path "$1" >"$2" 2>&1
}

echo "check-publish-over-base: publishing the merge base ($BASE)" >&2
publish "$BASE_DIR/server" "$DATA_DIR/base.log" || fail "could not publish the merge base's server/" "$DATA_DIR/base.log"

# The seed comes from the base's own schema, which is the module now running.
export BC_SNAPSHOT="$BASE_DIR/server/schema.snapshot.json"
. "$REPO_ROOT/scripts/ops/lib.sh"
bash "$REPO_ROOT/scripts/ops/seed-edge-rows.sh" "$DB" --server "$SERVER_URL" --rows 3 >"$DATA_DIR/seed.log" 2>&1 \
  || fail "seeding the base world failed" "$DATA_DIR/seed.log"

OPS="$REPO_ROOT/scripts/ops"
export_to() { # <dir> -- every table, one canonical row per line (export-world.sh)
  bash "$OPS/export-world.sh" "$DB" "$1" --server "$SERVER_URL" >"$DATA_DIR/export.log" 2>&1     || fail "export-world.sh failed" "$DATA_DIR/export.log"
}

export_to "$DATA_DIR/before"
ROWS="$(cat "$DATA_DIR"/before/*.jsonl | grep -c .)"
[ "$ROWS" -ge 1 ] || fail "the seeded world holds no rows -- this would prove an empty world survives"
[ -s "$DATA_DIR/before/item_held.jsonl" ] || fail "the seeded world holds no item_held rows"

echo "check-publish-over-base: publishing HEAD over it, without --delete-data" >&2
publish "$REPO_ROOT/server" "$DATA_DIR/head.log"   || fail "HEAD's server/ was refused over the base's world" "$DATA_DIR/head.log"

export_to "$DATA_DIR/after"
# Every row the base world held must be present, byte for byte. The
# manifest names the schema and a time, a publish re-arms the scheduled
# tables by design, and a publish may add rows (a cadence a newer module
# arms), so only a lost or changed row fails.
SKIP=" manifest.json "
while IFS= read -r table; do
  [ -n "$table" ] && SKIP="$SKIP$table.jsonl "
done <<<"$(bc_table_names "$BC_SNAPSHOT" scheduled)"
: >"$DATA_DIR/lost.txt"
for f in "$DATA_DIR"/before/*; do
  name="$(basename "$f")"
  case "$SKIP" in *" $name "*) continue ;; esac
  [ -f "$DATA_DIR/after/$name" ] || { echo "$name: table is gone" >>"$DATA_DIR/lost.txt"; continue; }
  comm -23 <(sort "$f") <(sort "$DATA_DIR/after/$name") | sed "s|^|$name: |" >>"$DATA_DIR/lost.txt"
done
if [ -s "$DATA_DIR/lost.txt" ]; then
  fail "the world lost or changed rows across the publish" "$DATA_DIR/lost.txt"
fi

echo "check-publish-over-base: ok -- every row of the base world survived the publish of HEAD over $BASE unchanged" >&2
