#!/usr/bin/env bash
# Story 1.4's central guard (in the style of check-live-migration.sh): an
# automated export -> restore -> verify round trip against a real,
# disposable local SpacetimeDB instance, on its own port (3988, never
# 3987 -- check-live-migration.sh's -- so both can run locally side by
# side). Every failure path aborts loudly with its own distinct message.
# Runs as a step in ci.yml's `migrate` job (Tim's direction: that job
# already starts a local instance; no second one).
#
# What this proves, and how (Quentin's independent-oracle direction --
# never only export(A) == export(restore(export(A))), which an exporter
# that drops a column the same way on both sides would still pass):
#   1. every non-scheduled table (Timestamp-bearing ones included -- the
#      module's own restore_<table> reducers, `server/src/tables/
#      restore.rs`, are what makes that possible) is seeded with at
#      least one row before export, except `module_owner`
#      (`seed-edge-rows.sh` never overwrites it -- see its own comment);
#   2. export -> restore -> export -> verify-world.sh's byte-for-byte
#      compare, for every non-scheduled table, no exceptions;
#   3. COUNT(*) queried directly against both live databases (source and
#      restored), independent of the export files;
#   4. literal sentinel assertions, by column on a known row (never a
#      bare grep against raw JSON that could match anywhere);
#   5. the auto_inc gap this spike found is **fixed**, not documented:
#      the post-restore auto-generated id must exceed the restored
#      maximum, strictly required, never accepted as a "known gap";
#   6. a table whose rows do not fit one byte-budgeted batch (a 4KB+
#      string) restores correctly across multiple batches;
#   7. scheduled tables restore to nothing (derived state): the restored
#      database's scheduled tables match a freshly published reference
#      database's, byte for byte;
#   8. module_owner has exactly one row after restore and it is the
#      exported owner; require_owner accepts that owner and rejects an
#      anonymous caller (reseed_codes, as check-live-migration.sh proves
#      for AC3 -- proven again here because restore is what could have
#      broken it, by leaving two owner rows or the wrong one);
#   9. four refusals, each asserted directly: a non-fresh target, a
#      schema mismatch, a wrong restoring identity, and a `restore_*`
#      call with no restore open.
set -uo pipefail
SCRIPT="check-backup-restore"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS="$REPO_ROOT/scripts/ops"
. "$OPS/lib.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-backup-restore.XXXXXX")"
WORK="$DATA_DIR/work"
mkdir -p "$WORK"
PORT=3988
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL")
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1
START_PID=""

cleanup() {
  if [ -n "${BC_KEEP_DATA_DIR:-}" ]; then
    echo "$SCRIPT: BC_KEEP_DATA_DIR set -- leaving $DATA_DIR and the instance on $SERVER_URL running" >&2
    return
  fi
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "$SCRIPT: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "$SCRIPT: ok -- $1" >&2; }

spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$PORT" >"$START_LOG" 2>&1 &
START_PID=$!
deadline=$((SECONDS + HEALTH_DEADLINE_S))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  curl -sf -o /dev/null "$SERVER_URL/v1/ping" && { healthy=1; break; }
  sleep "$POLL_INTERVAL_S"
done
[ "$healthy" -eq 1 ] || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

publish() { # <db> <log-file>
  spacetime publish --server "$SERVER_URL" --no-config -y "$1" --module-path "$REPO_ROOT/server" >"$2" 2>&1
}
row_count_live() { # <db> <table>
  local resp="$WORK/count-$1-$2.json"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  bc_wb row-count "$resp"
}

# --- 1: seed every seedable non-scheduled table (module_owner is the one
# exception -- see seed-edge-rows.sh's own comment) -----------------------
SRC=bc-backup-src
publish "$SRC" "$DATA_DIR/src-publish.log" || fail "could not publish '$SRC'" "$DATA_DIR/src-publish.log"

SEED_LOG="$DATA_DIR/seed.log"
bash "$OPS/seed-edge-rows.sh" "$SRC" --server "$SERVER_URL" --rows 3 >"$SEED_LOG" 2>&1 || fail "seed-edge-rows.sh failed" "$SEED_LOG"
cat "$SEED_LOG" >&2

while IFS= read -r table; do
  [ -n "$table" ] || continue
  [ "$table" = "module_owner" ] && continue
  n="$(row_count_live "$SRC" "$table")"
  [ "$n" -ge 1 ] || fail "'$table' has 0 rows before export -- seed-edge-rows.sh has a gap (every non-scheduled table but module_owner must be seeded)"
done <<< "$(bc_table_names non-scheduled)"
ok "every non-scheduled table but module_owner has at least one row before export (module_owner already has init's own)"

# --- extra: a table with a row too big for one byte-budgeted batch -------
# `demo_ping.message` is a plain String; a 20KB message forces
# call-batches to split across multiple `restore_demo_ping` calls at a
# small byte budget, proving the batching itself, not just a table that
# happens to fit in one call.
BIG_MESSAGE="$(printf 'x%.0s' $(seq 1 20000))"
spacetime call "$SRC" "${SERVER_ARGS[@]}" --no-config -y send_ping "\"$BIG_MESSAGE\"" >"$DATA_DIR/big-ping.log" 2>&1 \
  || fail "seeding the oversized demo_ping row failed" "$DATA_DIR/big-ping.log"

# --- 2: export -> restore -> export -> verify (byte for byte) -----------
EXPORT_A="$WORK/export-a"
bash "$OPS/export-world.sh" "$SRC" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/export-a.log" 2>&1 || fail "export-world.sh failed on '$SRC'" "$DATA_DIR/export-a.log"

DST=bc-backup-dst
publish "$DST" "$DATA_DIR/dst-publish.log" || fail "could not publish '$DST'" "$DATA_DIR/dst-publish.log"
BC_RESTORE_BATCH_BYTES=4000 bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/restore.log" 2>&1 \
  || fail "restore-world.sh failed restoring '$DST' from '$SRC's export" "$DATA_DIR/restore.log"
cat "$DATA_DIR/restore.log" >&2
grep -qE "'demo_ping' restored [0-9]+ row\(s\) in [2-9][0-9]* batch\(es\)" "$DATA_DIR/restore.log" \
  || fail "'demo_ping' (which includes a 20KB message) did not restore across multiple batches at a 4000-byte budget -- byte-budget batching is not exercised" "$DATA_DIR/restore.log"
ok "a row too big for one batch restores across multiple byte-budgeted batches"

EXPORT_B="$WORK/export-b"
bash "$OPS/export-world.sh" "$DST" "$EXPORT_B" --server "$SERVER_URL" >"$DATA_DIR/export-b.log" 2>&1 || fail "export-world.sh failed on '$DST'" "$DATA_DIR/export-b.log"

bash "$OPS/verify-world.sh" "$EXPORT_A" "$EXPORT_B" >"$DATA_DIR/verify.log" 2>&1 || fail "verify-world.sh found a mismatch between '$SRC' and the restored '$DST'" "$DATA_DIR/verify.log"
ok "$(tail -n1 "$DATA_DIR/verify.log")"

# --- 3/5: COUNT(*) on both live databases and the auto_inc sequence
# strictly advancing -- scripts/ops/verify-independent.sh, shared with
# .github/workflows/backup.yml's rehearsal job (Tim's direction: the
# Maincloud leg runs the same independent oracles the local guard does,
# never a lesser copy) ------------------------------------------------
bash "$OPS/verify-independent.sh" "$SRC" "$DST" --server "$SERVER_URL" >"$DATA_DIR/verify-independent.log" 2>&1 \
  || fail "verify-independent.sh found a mismatch between '$SRC' and restored '$DST'" "$DATA_DIR/verify-independent.log"
cat "$DATA_DIR/verify-independent.log" >&2

# --- 4: literal sentinel assertions, by column on a known row
# (Quentin's oracle (c) -- never a bare grep that could match anywhere) ---
SENTINEL_RESP="$WORK/sentinel.json"
bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM building_area" >"$SENTINEL_RESP"
grep -oE '"chunk_key"' "$SENTINEL_RESP" >/dev/null || fail "'building_area' schema missing 'chunk_key'"
grep -qF '18446744073709551615' "$SENTINEL_RESP" || fail "u64::MAX sentinel value not found in restored 'building_area'"
grep -qF -- '-2147483648' "$SENTINEL_RESP" || fail "i32::MIN sentinel value not found in restored 'building_area'"
grep -qF -- '-128' "$SENTINEL_RESP" || fail "i8 floor (-128) sentinel value not found in restored 'building_area'"

bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM layer_code" >"$WORK/layer_code.json"
LAYER_CANON="$WORK/layer_code.jsonl"
bc_wb rows-canonical "$BC_SNAPSHOT" layer_code "$WORK/layer_code.json" >"$LAYER_CANON"
grep -qF '\"quote\"' "$LAYER_CANON" || fail "adversarial string sentinel (quote/tab/newline/CR/backslash/emoji) not found in restored 'layer_code', by row"
ok "sentinel values (u64::MAX, i32::MIN, i8 floor, adversarial string) read back from named columns of the restored database"

# --- 6: scheduled tables restore to nothing -- compared against a
# freshly published reference database, byte for byte ---------------------
REF=bc-backup-ref
publish "$REF" "$DATA_DIR/ref-publish.log" || fail "could not publish '$REF'" "$DATA_DIR/ref-publish.log"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  a="$(row_count_live "$REF" "$table")"
  b="$(row_count_live "$DST" "$table")"
  [ "$a" = "$b" ] || fail "scheduled table '$table': restored '$DST' has $b row(s), a freshly published reference has $a -- schedules are derived state and must never be restored"
done <<< "$(bc_table_names scheduled)"
ok "every scheduled table in the restored database matches a freshly published reference (derived state, never restored)"

# --- 7: module_owner / require_owner --------------------------------------
OWNER_COUNT="$(row_count_live "$DST" module_owner)"
[ "$OWNER_COUNT" -eq 1 ] || fail "restored 'module_owner' has $OWNER_COUNT row(s), expected exactly 1"
ok "restored 'module_owner' has exactly one row"

spacetime call "$DST" --server "$SERVER_URL" --no-config -y reseed_codes >"$DATA_DIR/reseed.log" 2>&1 \
  || fail "reseed_codes failed against the restored database, called as its owner" "$DATA_DIR/reseed.log"
OWNER_REJECTION_PATTERN="this reducer may only be invoked by the module owner"
if spacetime call "$DST" --server "$SERVER_URL" --no-config -y --anonymous reseed_codes >"$DATA_DIR/reseed-anon.log" 2>&1; then
  fail "reseed_codes accepted an anonymous caller against the restored database; it must be rejected" "$DATA_DIR/reseed-anon.log"
fi
grep -qF "$OWNER_REJECTION_PATTERN" "$DATA_DIR/reseed-anon.log" || fail "reseed_codes rejected the anonymous call, but not with require_owner's own message" "$DATA_DIR/reseed-anon.log"
ok "require_owner accepts the restored owner and rejects an anonymous caller, against the restored database"

# --- 8a: refuses a non-fresh target ---------------------------------------
if bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-nonfresh.log" 2>&1; then
  fail "restore-world.sh accepted restoring into '$DST' a second time (already holds restored data); it must refuse a non-fresh target" "$DATA_DIR/refuse-nonfresh.log"
fi
grep -qF "not freshly published" "$DATA_DIR/refuse-nonfresh.log" || fail "the non-fresh-target refusal did not name the reason" "$DATA_DIR/refuse-nonfresh.log"
ok "restore-world.sh (begin_restore) refuses a non-fresh target"

# --- 8b: refuses a schema mismatch ----------------------------------------
BAD_EXPORT="$WORK/export-bad-schema"
cp -r "$EXPORT_A" "$BAD_EXPORT"
sed -i -E 's/"schema_sha256": *"[0-9a-f]+"/"schema_sha256": "0000000000000000000000000000000000000000000000000000000000000000"/' "$BAD_EXPORT/manifest.json"
FRESH1=bc-backup-fresh1
publish "$FRESH1" "$DATA_DIR/fresh1-publish.log" || fail "could not publish '$FRESH1'" "$DATA_DIR/fresh1-publish.log"
if bash "$OPS/restore-world.sh" "$FRESH1" "$BAD_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/refuse-schema.log" 2>&1; then
  fail "restore-world.sh accepted a manifest whose schema_sha256 does not match server/schema.snapshot.json" "$DATA_DIR/refuse-schema.log"
fi
grep -qF "does not match" "$DATA_DIR/refuse-schema.log" || fail "the schema-mismatch refusal did not name the reason" "$DATA_DIR/refuse-schema.log"
ok "restore-world.sh refuses a schema mismatch"

# --- 8c: refuses a restoring identity that is not the exported owner -----
FRESH2=bc-backup-fresh2
if ! spacetime publish --server "$SERVER_URL" --no-config -y --anonymous "$FRESH2" --module-path "$REPO_ROOT/server" >"$DATA_DIR/fresh2-publish.log" 2>&1; then
  fail "could not publish '$FRESH2' anonymously" "$DATA_DIR/fresh2-publish.log"
fi
if bash "$OPS/restore-world.sh" "$FRESH2" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-identity.log" 2>&1; then
  fail "restore-world.sh accepted restoring '$SRC's export under a different identity than the one it was exported from" "$DATA_DIR/refuse-identity.log"
fi
grep -qF "the restoring identity does not match the exported module_owner.owner" "$DATA_DIR/refuse-identity.log" || fail "the identity-mismatch refusal did not name the reason" "$DATA_DIR/refuse-identity.log"
ok "restore-world.sh refuses a restoring identity that does not match the exported owner"

# --- 8d: restore_* refuses when no restore is open ------------------------
FRESH3=bc-backup-fresh3
publish "$FRESH3" "$DATA_DIR/fresh3-publish.log" || fail "could not publish '$FRESH3'" "$DATA_DIR/fresh3-publish.log"
if spacetime call "$FRESH3" "${SERVER_ARGS[@]}" --no-config -y restore_matter_kind '[]' >"$DATA_DIR/refuse-not-open.log" 2>&1; then
  fail "restore_matter_kind accepted a call with no restore open; it must refuse" "$DATA_DIR/refuse-not-open.log"
fi
grep -qF "no restore is open" "$DATA_DIR/refuse-not-open.log" || fail "the not-open refusal did not name the reason" "$DATA_DIR/refuse-not-open.log"
ok "a restore_<table> reducer refuses to run with no restore open"

echo "$SCRIPT: story 1.4's restore is proven against a real SpacetimeDB instance -- every guard above, positive and negative" >&2
exit 0
