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
#   3. the auto_inc gap-fill loop is actually exercised, not merely
#      present: `floor_transition` is seeded with real holes (a single
#      deleted row, plus ~2,000 bulk-inserted ids deleted down to a
#      handful) before export, so restoring it *requires* the
#      delete-and-retry branch of `restore_autoinc_rows`, not just the
#      "already exact" branch a gap-free seed would only ever exercise.
#      A real ~100,000-id gap is measured, not skipped -- but in
#      `scripts/dev/run-backup-perf.sh`'s gappy leg, not here: bulk
#      seeding one at PR time would blow Tim's <2-minute budget for this
#      check, so this file proves *correctness* at a real but modest
#      scale, and the perf harness proves *scale* separately;
#   4. an overshoot (a restore that skips an id) aborts the reducer and
#      leaves no partial row -- the whole call rolls back, not just the
#      offending insert;
#   5. COUNT(*) queried directly against both live databases (source and
#      restored), independent of the export files;
#   6. literal sentinel assertions, by exact column value on a known row
#      (never a bare grep against raw JSON that could match a substring
#      anywhere) -- including a Timestamp and an Identity, the two types
#      this story's restore mechanism made possible at all;
#   7. the auto_inc gap this spike found is **fixed**, not documented:
#      the post-restore auto-generated id must exceed the restored
#      maximum, strictly required, never accepted as a "known gap";
#   8. a table whose rows do not fit one byte-budgeted batch (a 4KB+
#      string) restores correctly across multiple batches;
#   9. scheduled tables restore to nothing (derived state): the restored
#      database's scheduled tables match a freshly published reference
#      database's, by row count -- both are always empty today, since
#      schedules are derived state and this restore never writes one;
#  10. module_owner has exactly one row after restore and it is the
#      exported owner; require_owner accepts that owner and rejects an
#      anonymous caller (reseed_codes, as check-live-migration.sh proves
#      for AC3 -- proven again here because restore is what could have
#      broken it, by leaving two owner rows or the wrong one);
#  11. five refusals, each asserted directly: a non-fresh target, a
#      schema mismatch, a wrong restoring identity, a `restore_*` call
#      with no restore open, and `restore_module_owner` given a row
#      whose owner is not the caller.
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
sql_exec() { # <db> <statement> <log-file>
  spacetime sql "$1" "${SERVER_ARGS[@]}" --no-config -y "$2" >"$3" 2>&1
}
row_count_live() { # <db> <table>
  local resp="$WORK/count-$1-$2.json"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  bc_wb row-count "$resp"
}
column_values_live() { # <db> <table> <column>
  local resp="$WORK/colval-$1-$2-$3.json"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  bc_wb column-values "$resp" "$3"
}
# values_contain <needle> <newline-separated haystack> -- exact,
# line-for-line equality, never a substring search. Deliberately never
# `grep -F`/`grep -x`: confirmed empirically that the `grep` on this dev
# box's PATH reports no match for an exact multi-byte UTF-8 (emoji) line
# against itself, byte-for-byte identical per `cmp` -- a `grep`-build
# quirk, not a real mismatch. Plain bash string equality has no such bug.
values_contain() {
  local needle="$1" line
  while IFS= read -r line; do
    [ "$line" = "$needle" ] && return 0
  done <<<"$2"
  return 1
}
# max_id_live <db> <table> -- the table's own real primary-key column,
# max'd as an exact integer (`world_backup max-pk`, built on
# `canonical_rows`' own real-primary-key sort -- never a `sed`/`sort -g`
# pipeline over raw text, which both reintroduces the "primary key is
# column 0" assumption `canonical_rows` was built to remove, and compares
# through a machine float via `sort -g`): empty if the table has no rows.
# Mirrors verify-independent.sh's own helper of the same name and
# contract.
max_id_live() {
  local resp="$WORK/maxid-$1-$2.json"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM $2" >"$resp"
  bc_wb max-pk "$BC_SNAPSHOT" "$2" "$resp"
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

# --- extra: real holes in an auto_inc id space (Quentin's/Tim's
# direction -- `seed-edge-rows.sh`'s own ids are always contiguous
# 1..n, so without this the gap-fill loop's delete-and-retry branch
# would never run at all, in this check or in run-backup-perf.sh's
# gap-free legs). `floor_transition` already holds 3 seeded rows
# (ids 1-3, no Timestamp column, SQL-writable) -- `seed-id-gaps.sh`,
# shared with `backup.yml`'s own rehearsal (a real, >=100k-id gap there,
# never duplicated logic) -----------------------------------------------
sql_exec "$SRC" "DELETE FROM floor_transition WHERE transition_id = 2" "$DATA_DIR/gap-delete-1.log" \
  || fail "deleting floor_transition id 2 (the small gap) failed" "$DATA_DIR/gap-delete-1.log"
GAP_N=2000
bash "$OPS/seed-id-gaps.sh" "$SRC" --table floor_transition --gap "$GAP_N" --server "$SERVER_URL" >"$DATA_DIR/seed-id-gaps.log" 2>&1 \
  || fail "seed-id-gaps.sh failed to carve a gap into floor_transition" "$DATA_DIR/seed-id-gaps.log"
cat "$DATA_DIR/seed-id-gaps.log" >&2
ok "'floor_transition' seeded with real id gaps (one deleted row, one ~${GAP_N}-id gap) before export"

# --- 2: export -> restore -> export -> verify (byte for byte) -----------
EXPORT_A="$WORK/export-a"
bash "$OPS/export-world.sh" "$SRC" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/export-a.log" 2>&1 || fail "export-world.sh failed on '$SRC'" "$DATA_DIR/export-a.log"

DST=bc-backup-dst
publish "$DST" "$DATA_DIR/dst-publish.log" || fail "could not publish '$DST'" "$DATA_DIR/dst-publish.log"
BC_RESTORE_BATCH_BYTES=4000 bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/restore.log" 2>&1 \
  || fail "restore-world.sh failed restoring '$DST' from '$SRC's export -- with real id gaps seeded, this exercises the gap-fill loop's delete-and-retry branch, not only the always-exact branch a contiguous seed would" "$DATA_DIR/restore.log"
cat "$DATA_DIR/restore.log" >&2
grep -qE "'demo_ping' restored [0-9]+ row\(s\) in [2-9][0-9]* batch\(es\)" "$DATA_DIR/restore.log" \
  || fail "'demo_ping' (which includes a 20KB message) did not restore across multiple batches at a 4000-byte budget -- byte-budget batching is not exercised" "$DATA_DIR/restore.log"
ok "a row too big for one batch restores across multiple byte-budgeted batches"

EXPORT_B="$WORK/export-b"
bash "$OPS/export-world.sh" "$DST" "$EXPORT_B" --server "$SERVER_URL" >"$DATA_DIR/export-b.log" 2>&1 || fail "export-world.sh failed on '$DST'" "$DATA_DIR/export-b.log"

bash "$OPS/verify-world.sh" "$EXPORT_A" "$EXPORT_B" >"$DATA_DIR/verify.log" 2>&1 || fail "verify-world.sh found a mismatch between '$SRC' and the restored '$DST' -- across a table with real id gaps, this is the gap-fill loop's own correctness proof" "$DATA_DIR/verify.log"
ok "$(tail -n1 "$DATA_DIR/verify.log") (including 'floor_transition', seeded with real id gaps)"

# --- 4: an overshoot rolls back the whole call, no partial row left ------
FRESH_OVERSHOOT=bc-backup-overshoot
publish "$FRESH_OVERSHOOT" "$DATA_DIR/overshoot-publish.log" || fail "could not publish '$FRESH_OVERSHOOT'" "$DATA_DIR/overshoot-publish.log"
spacetime call "$FRESH_OVERSHOOT" "${SERVER_ARGS[@]}" --no-config -y begin_restore '[]' >"$DATA_DIR/overshoot-begin.log" 2>&1 \
  || fail "begin_restore failed against '$FRESH_OVERSHOOT'" "$DATA_DIR/overshoot-begin.log"
spacetime call "$FRESH_OVERSHOOT" "${SERVER_ARGS[@]}" --no-config -y restore_building_area '[[5,1,0,0,0,0,0,0]]' 0 >"$DATA_DIR/overshoot-first.log" 2>&1 \
  || fail "restoring building_area id 5 failed" "$DATA_DIR/overshoot-first.log"
if spacetime call "$FRESH_OVERSHOOT" "${SERVER_ARGS[@]}" --no-config -y restore_building_area '[[3,2,0,0,0,0,0,0]]' 0 >"$DATA_DIR/overshoot-second.log" 2>&1; then
  fail "restore_building_area accepted an id (3) behind the sequence's current position (past 5); it must overshoot and abort" "$DATA_DIR/overshoot-second.log"
fi
grep -qF "overshot the exported id 3" "$DATA_DIR/overshoot-second.log" || fail "the overshoot refusal did not name the reason" "$DATA_DIR/overshoot-second.log"
AFTER_OVERSHOOT="$(row_count_live "$FRESH_OVERSHOOT" building_area)"
[ "$AFTER_OVERSHOOT" -eq 1 ] || fail "building_area has $AFTER_OVERSHOOT row(s) after the failed overshoot call, expected exactly 1 (id 5) -- the failed call's own inserts/deletes must roll back entirely" "$DATA_DIR/overshoot-second.log"
ok "an overshoot aborts the whole reducer call and leaves no partial row (building_area still has exactly its one row)"

# --- tail-deletion: the restored sequence advances past the manifest's
# own recorded floor (st_sequence.allocated at export time), never merely
# to the restored data's own maximum id -- so it never re-issues an id
# the source ever handed out, even one deleted off the table's tail
# before export. Pinned here directly, not merely asserted in prose. -----
TAIL_SRC=bc-backup-tail
publish "$TAIL_SRC" "$DATA_DIR/tail-publish.log" || fail "could not publish '$TAIL_SRC'" "$DATA_DIR/tail-publish.log"
sql_exec "$TAIL_SRC" "INSERT INTO building_area (area_id, building_id, x0, y0, x1, y1, floor, chunk_key) VALUES (0,1,0,0,0,0,0,0),(0,1,0,0,0,0,0,0),(0,1,0,0,0,0,0,0)" "$DATA_DIR/tail-insert.log" \
  || fail "seeding building_area ids 1-3 in '$TAIL_SRC' failed" "$DATA_DIR/tail-insert.log"
sql_exec "$TAIL_SRC" "DELETE FROM building_area WHERE area_id = 3" "$DATA_DIR/tail-delete.log" \
  || fail "deleting building_area id 3 (the tail row) failed" "$DATA_DIR/tail-delete.log"
TAIL_EXPORT="$WORK/tail-export"
bash "$OPS/export-world.sh" "$TAIL_SRC" "$TAIL_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/tail-export.log" 2>&1 || fail "export-world.sh failed on '$TAIL_SRC'" "$DATA_DIR/tail-export.log"
TAIL_FLOOR="$(bc_wb manifest-floor "$TAIL_EXPORT/manifest.json" building_area)"
# `st_sequence.allocated` pre-allocates in blocks (docs/spikes/
# 1.4-backup-restore.md) -- after 3 inserts on a fresh table, the floor
# is the block ceiling, never merely 3, so this is also, incidentally,
# proof the floor is really read from `st_sequence`, not derived from the
# exported rows themselves (those only ever reach id 2, area_id 3 having
# been deleted before export).
[ "$TAIL_FLOOR" -gt 2 ] || fail "expected '$TAIL_EXPORT/manifest.json's sequence_floors.building_area to exceed the restored maximum (2); got $TAIL_FLOOR -- st_sequence.allocated was not captured" "$DATA_DIR/tail-export.log"
TAIL_DST=bc-backup-tail-dst
publish "$TAIL_DST" "$DATA_DIR/tail-dst-publish.log" || fail "could not publish '$TAIL_DST'" "$DATA_DIR/tail-dst-publish.log"
bash "$OPS/restore-world.sh" "$TAIL_DST" "$TAIL_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/tail-restore.log" 2>&1 \
  || fail "restore-world.sh failed restoring '$TAIL_DST'" "$DATA_DIR/tail-restore.log"
# The next auto-generated insert on the restored database must land
# strictly past the manifest's own floor -- never at id 3, the restored
# maximum (2) plus one, which is what a restore that stopped at the
# restored data's own maximum id would give (and did, before this
# cycle): area_id 3 was real, once, on the source, and letting the
# restored database hand it out again would silently point any dangling
# reference at the wrong row.
sql_exec "$TAIL_DST" "INSERT INTO building_area (area_id, building_id, x0, y0, x1, y1, floor, chunk_key) VALUES (0,9,0,0,0,0,0,0)" "$DATA_DIR/tail-probe.log" \
  || fail "the post-restore auto_inc probe on '$TAIL_DST' failed" "$DATA_DIR/tail-probe.log"
TAIL_NEW_ID="$(max_id_live "$TAIL_DST" building_area)"
[ "$TAIL_NEW_ID" -gt "$TAIL_FLOOR" ] || fail "expected the post-restore probe on '$TAIL_DST' to land past the manifest's own sequence floor ($TAIL_FLOOR), never merely at the restored maximum + 1 (3, the id the source once issued and then deleted); got $TAIL_NEW_ID" "$DATA_DIR/tail-probe.log"
ok "tail-deletion: the restored sequence advances past the manifest's own recorded floor ($TAIL_FLOOR), so it never re-issues an id the source once handed out (probe landed on $TAIL_NEW_ID)"

# --- 5/7: COUNT(*) on both live databases and the auto_inc sequence
# strictly advancing -- scripts/ops/verify-independent.sh, shared with
# .github/workflows/backup.yml's rehearsal job (Tim's direction: the
# Maincloud leg runs the same independent oracles the local guard does,
# never a lesser copy) ------------------------------------------------
bash "$OPS/verify-independent.sh" "$SRC" "$DST" "$EXPORT_A/manifest.json" --server "$SERVER_URL" >"$DATA_DIR/verify-independent.log" 2>&1 \
  || fail "verify-independent.sh found a mismatch between '$SRC' and restored '$DST'" "$DATA_DIR/verify-independent.log"
cat "$DATA_DIR/verify-independent.log" >&2

# --- 6: literal sentinel assertions, by exact column value on a known
# row (Quentin's oracle (c) -- never a bare grep that could match a
# substring anywhere) -------------------------------------------------
# `world_backup adversarial-string-line`, never `jq`: the exact same
# constant `server/tools/world_backup`'s own `edge_values` seeds every
# String column with, run through the very same canonical-line serializer
# `column-values` itself uses -- the expected and actual values go
# through the same serializer (Tim's direction), and never retyped by
# hand here as a second, driftable copy of the literal bytes.
EXPECT_STRING_JSON="$(bc_wb adversarial-string-line)"
CHUNK_KEYS="$(column_values_live "$DST" building_area chunk_key)"
values_contain '18446744073709551615' "$CHUNK_KEYS" || fail "u64::MAX not found exactly in restored 'building_area.chunk_key'"
X0_VALUES="$(column_values_live "$DST" building_area x0)"
values_contain '-2147483648' "$X0_VALUES" || fail "i32::MIN not found exactly in restored 'building_area.x0'"
FLOOR_VALUES="$(column_values_live "$DST" building_area floor)"
values_contain '-128' "$FLOOR_VALUES" || fail "i8 floor (-128) not found exactly in restored 'building_area.floor'"
NAME_VALUES="$(column_values_live "$DST" layer_code name)"
values_contain "$EXPECT_STRING_JSON" "$NAME_VALUES" \
  || fail "the exact adversarial string (quote/tab/newline/CR/backslash/emoji) was not found byte-exact in restored 'layer_code.name'"
CREATED_AT_VALUES="$(column_values_live "$DST" building created_at)"
values_contain '[0]' "$CREATED_AT_VALUES" || fail "Timestamp 0 micros not found exactly in restored 'building.created_at'"
values_contain '[9223372036854775807]' "$CREATED_AT_VALUES" || fail "Timestamp i64::MAX micros not found exactly in restored 'building.created_at'"
# Identity: exact, not shape-only (Quentin's direction -- a shape-only
# check like `^\["0x[0-9a-f]+"\]$` would pass a *corrupted* Identity too,
# as long as it still looked like one). SQL trims an Identity's leading
# zero nibbles on read the same way on both the source and the restored
# database (docs/spikes/1.4-backup-restore.md's own documented quirk), so
# the source's own live `character_identity.identity` values, sorted, are
# the exact expected set to compare the restored ones against -- exact
# and independent of the export files, never merely "looks well-formed".
SRC_IDENTITY_VALUES="$(column_values_live "$SRC" character_identity identity | sort)"
DST_IDENTITY_VALUES="$(column_values_live "$DST" character_identity identity | sort)"
[ -n "$SRC_IDENTITY_VALUES" ] || fail "'$SRC.character_identity' has no rows -- nothing to compare Identity values against"
[ "$SRC_IDENTITY_VALUES" = "$DST_IDENTITY_VALUES" ] || fail "restored 'character_identity.identity' values do not exactly match '$SRC's own, sorted -- expected:
$SRC_IDENTITY_VALUES
got:
$DST_IDENTITY_VALUES"
ok "sentinel values (u64::MAX, i32::MIN, i8 floor, the full adversarial string, a Timestamp at 0 and i64::MAX micros, and every Identity, exact and sorted) read back exactly, by column, from the restored database"

# --- 9: scheduled tables restore to nothing -- compared against a
# freshly published reference database, byte for byte ---------------------
REF=bc-backup-ref
publish "$REF" "$DATA_DIR/ref-publish.log" || fail "could not publish '$REF'" "$DATA_DIR/ref-publish.log"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  a="$(row_count_live "$REF" "$table")"
  b="$(row_count_live "$DST" "$table")"
  [ "$a" = "$b" ] || fail "scheduled table '$table': restored '$DST' has $b row(s), a freshly published reference has $a -- schedules are derived state and must never be restored"
done <<< "$(bc_table_names scheduled)"
ok "every scheduled table in the restored database matches a freshly published reference (compared by row count -- schedules are derived state, never restored, so both are always empty today)"

# --- 10: module_owner / require_owner --------------------------------------
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

# --- 11a: refuses a non-fresh target ---------------------------------------
if bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-nonfresh.log" 2>&1; then
  fail "restore-world.sh accepted restoring into '$DST' a second time (already holds restored data); it must refuse a non-fresh target" "$DATA_DIR/refuse-nonfresh.log"
fi
grep -qF "not freshly published" "$DATA_DIR/refuse-nonfresh.log" || fail "the non-fresh-target refusal did not name the reason" "$DATA_DIR/refuse-nonfresh.log"
ok "restore-world.sh (begin_restore) refuses a non-fresh target"

# --- 11b: refuses a schema mismatch ----------------------------------------
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

# --- 11c: refuses a restoring identity that is not the exported owner -----
FRESH2=bc-backup-fresh2
if ! spacetime publish --server "$SERVER_URL" --no-config -y --anonymous "$FRESH2" --module-path "$REPO_ROOT/server" >"$DATA_DIR/fresh2-publish.log" 2>&1; then
  fail "could not publish '$FRESH2' anonymously" "$DATA_DIR/fresh2-publish.log"
fi
if bash "$OPS/restore-world.sh" "$FRESH2" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-identity.log" 2>&1; then
  fail "restore-world.sh accepted restoring '$SRC's export under a different identity than the one it was exported from" "$DATA_DIR/refuse-identity.log"
fi
grep -qF "the restoring identity does not match the exported module_owner.owner" "$DATA_DIR/refuse-identity.log" || fail "the identity-mismatch refusal did not name the reason" "$DATA_DIR/refuse-identity.log"
ok "restore-world.sh refuses a restoring identity that does not match the exported owner"

# --- 11d: restore_* refuses when no restore is open ------------------------
FRESH3=bc-backup-fresh3
publish "$FRESH3" "$DATA_DIR/fresh3-publish.log" || fail "could not publish '$FRESH3'" "$DATA_DIR/fresh3-publish.log"
if spacetime call "$FRESH3" "${SERVER_ARGS[@]}" --no-config -y restore_matter_kind '[]' >"$DATA_DIR/refuse-not-open.log" 2>&1; then
  fail "restore_matter_kind accepted a call with no restore open; it must refuse" "$DATA_DIR/refuse-not-open.log"
fi
grep -qF "no restore is open" "$DATA_DIR/refuse-not-open.log" || fail "the not-open refusal did not name the reason" "$DATA_DIR/refuse-not-open.log"
ok "a restore_<table> reducer refuses to run with no restore open"

# --- 11e: restore_module_owner refuses a foreign owner ---------------------
spacetime call "$FRESH3" "${SERVER_ARGS[@]}" --no-config -y begin_restore '[]' >"$DATA_DIR/foreign-owner-begin.log" 2>&1 \
  || fail "begin_restore failed against '$FRESH3'" "$DATA_DIR/foreign-owner-begin.log"
FOREIGN_IDENTITY="0x$(printf '1%.0s' $(seq 1 64) | head -c 64)"
if spacetime call "$FRESH3" "${SERVER_ARGS[@]}" --no-config -y restore_module_owner "[[0,[\"$FOREIGN_IDENTITY\"]]]" >"$DATA_DIR/foreign-owner.log" 2>&1; then
  fail "restore_module_owner accepted a row whose owner is not the caller; it must refuse" "$DATA_DIR/foreign-owner.log"
fi
grep -qF "not the caller" "$DATA_DIR/foreign-owner.log" || fail "the foreign-owner refusal did not name the reason" "$DATA_DIR/foreign-owner.log"
ok "restore_module_owner refuses a row whose owner is not the caller"

echo "$SCRIPT: story 1.4's restore is proven against a real SpacetimeDB instance -- every guard above, positive and negative" >&2
exit 0
