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
#   1. every table in server/schema.snapshot.json is seeded with at least
#      one row before export (scripts/ops/seed-edge-rows.sh), or is named
#      here as one this module cannot seed yet, and why;
#   2. export -> restore -> export -> verify-world.sh's byte-for-byte
#      compare, for every non-scheduled, SQL-constructable table;
#   3. COUNT(*) queried directly against both live databases (source and
#      restored), independent of the export files;
#   4. literal sentinel assertions: specific adversarial values read back
#      from the restored database itself, by name;
#   5. the auto_inc gap this spike found (see docs/spikes/
#      1.4-backup-restore.md): asserts, rather than assumes, whether a
#      post-restore auto-generated id exceeds the restored maximum;
#   6. module_owner has exactly one row after restore and it is the
#      exported owner; require_owner accepts that owner and rejects an
#      anonymous caller (reseed_codes, as check-live-migration.sh proves
#      for AC3 -- proven again here because restore is what could have
#      broken it, by leaving two owner rows or the wrong one);
#   7. three refusals, each asserted directly: a non-fresh target, a
#      schema mismatch, and a wrong restoring identity;
#   8. the Timestamp/ScheduleAt limitation itself: seeding a table SQL
#      cannot restore must make restore-world.sh refuse, loudly, not
#      silently drop the table and report success.
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
  bc_canon row-count "$resp"
}

# --- 1: seed every table this module can seed today, and name the rest --
SRC=bc-backup-src
publish "$SRC" "$DATA_DIR/src-publish.log" || fail "could not publish '$SRC'" "$DATA_DIR/src-publish.log"

SEED_LOG="$DATA_DIR/seed.log"
bash "$OPS/seed-edge-rows.sh" "$SRC" --server "$SERVER_URL" --rows 3 >"$SEED_LOG" 2>&1 || fail "seed-edge-rows.sh failed" "$SEED_LOG"
cat "$SEED_LOG" >&2

# Every table not in this list must now hold at least one row -- a table
# seed-edge-rows.sh silently produced zero rows for for any other reason
# is exactly the "exporter/seeder silently skips it" gap Quentin's
# direction guards against.
UNSEEDABLE_TODAY="building character citizen citizen_state demo_ping room"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  case " $UNSEEDABLE_TODAY " in
    *" $table "*) continue ;;
  esac
  n="$(row_count_live "$SRC" "$table")"
  [ "$n" -ge 1 ] || fail "'$table' has 0 rows before export and is not in the documented unseedable list -- seed-edge-rows.sh has a gap"
done <<< "$(bc_table_names non-scheduled | grep -v '^module_owner$')"
ok "every seedable non-scheduled table has at least one row; $UNSEEDABLE_TODAY have none (no reducer writes them yet, or SQL cannot construct their Timestamp column -- docs/spikes/1.4-backup-restore.md)"

# --- 2: export -> restore -> export -> verify (byte for byte) -----------
EXPORT_A="$WORK/export-a"
bash "$OPS/export-world.sh" "$SRC" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/export-a.log" 2>&1 || fail "export-world.sh failed on '$SRC'" "$DATA_DIR/export-a.log"

DST=bc-backup-dst
publish "$DST" "$DATA_DIR/dst-publish.log" || fail "could not publish '$DST'" "$DATA_DIR/dst-publish.log"
bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/restore.log" 2>&1 || fail "restore-world.sh failed restoring '$DST' from '$SRC's export" "$DATA_DIR/restore.log"
cat "$DATA_DIR/restore.log" >&2

EXPORT_B="$WORK/export-b"
bash "$OPS/export-world.sh" "$DST" "$EXPORT_B" --server "$SERVER_URL" >"$DATA_DIR/export-b.log" 2>&1 || fail "export-world.sh failed on '$DST'" "$DATA_DIR/export-b.log"

bash "$OPS/verify-world.sh" "$EXPORT_A" "$EXPORT_B" >"$DATA_DIR/verify.log" 2>&1 || fail "verify-world.sh found a mismatch between '$SRC' and the restored '$DST'" "$DATA_DIR/verify.log"
ok "$(tail -n1 "$DATA_DIR/verify.log")"

# --- 3: COUNT(*) directly on both live databases (independent of the
# export files -- Quentin's oracle (b)) -----------------------------------
while IFS= read -r table; do
  [ -n "$table" ] || continue
  case " $UNSEEDABLE_TODAY " in *" $table "*) continue ;; esac
  a="$(row_count_live "$SRC" "$table")"
  b="$(row_count_live "$DST" "$table")"
  [ "$a" = "$b" ] || fail "'$table': COUNT(*) differs between '$SRC' ($a) and restored '$DST' ($b), queried directly, not via the export"
done <<< "$(bc_table_names non-scheduled)"
ok "COUNT(*) matches directly against both live databases for every restored table"

# --- 4: literal sentinel assertions (Quentin's oracle (c)) ---------------
SENTINEL_RESP="$WORK/sentinel.json"
bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM building_area" >"$SENTINEL_RESP"
grep -qF '18446744073709551615' "$SENTINEL_RESP" || fail "u64::MAX sentinel value not found in restored 'building_area'"
grep -qF -- '-2147483648' "$SENTINEL_RESP" || fail "i32::MIN sentinel value not found in restored 'building_area'"
grep -qF -- '-128' "$SENTINEL_RESP" || fail "i8 floor (-128) sentinel value not found in restored 'building_area'"
bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM layer_code" >"$SENTINEL_RESP"
"$BC_PYTHON" - "$SENTINEL_RESP" <<'PY' || fail "adversarial string sentinel (quote/tab/newline/emoji) not found byte-exact in restored 'layer_code'"
import json, sys
doc = json.load(open(sys.argv[1]))
names = [r[1] for r in doc[0]["rows"]]
expected = "adversarial: '\"quote\"'\tTAB\nNEWLINE pipe|emoji\U0001F600"
sys.exit(0 if expected in names else 1)
PY
ok "sentinel values (u64::MAX, i32::MIN, i8 floor, quote/tab/newline/emoji string) read back byte-exact from the restored database"

# --- 5: the auto_inc gap -- asserted, not assumed -------------------------
# A post-restore auto-generated id may either land above the restored
# maximum (no gap -- SpacetimeDB started tracking it) or collide outright
# with an id this same restore just wrote (the sharpest possible evidence
# of the gap: not just "not greater than", but a primary-key collision on
# the very first auto-generated insert after restore). Both outcomes are
# informative; only a *different* failure is a bug in this check.
BEFORE_RESP="$WORK/autoinc-before.json"
bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM building_area" >"$BEFORE_RESP"
MAX_BEFORE="$("$BC_PYTHON" -c "
import json, sys
rows = json.load(open(sys.argv[1]))[0]['rows']
print(max(r[0] for r in rows))
" "$BEFORE_RESP")"
AUTOINC_LOG="$DATA_DIR/autoinc-insert.log"
if spacetime sql "$DST" "${SERVER_ARGS[@]}" --no-config -y \
    "INSERT INTO building_area (area_id, building_id, x0, y0, x1, y1, floor, chunk_key) VALUES (0, 999999, 0, 0, 0, 0, 0, 0)" \
    >"$AUTOINC_LOG" 2>&1; then
  AFTER_RESP="$WORK/autoinc-after.json"
  bc_sql_json "$SCRIPT" "$DST" "${SERVER_ARGS[@]}" "SELECT * FROM building_area WHERE building_id = 999999" >"$AFTER_RESP"
  NEW_ID="$("$BC_PYTHON" -c "
import json, sys
rows = json.load(open(sys.argv[1]))[0]['rows']
print(rows[0][0])
" "$AFTER_RESP")"
  if [ "$NEW_ID" -gt "$MAX_BEFORE" ]; then
    ok "auto_inc: the post-restore auto-generated id ($NEW_ID) exceeds the restored maximum ($MAX_BEFORE) -- SpacetimeDB may have started advancing the sequence on explicit-id inserts; docs/spikes/1.4-backup-restore.md's finding should be re-verified"
  else
    echo "$SCRIPT: KNOWN GAP (documented, docs/spikes/1.4-backup-restore.md) -- the post-restore auto-generated id ($NEW_ID) does NOT exceed the restored maximum ($MAX_BEFORE): SpacetimeDB 2.9's auto_inc sequence is not advanced by an explicit-id SQL insert, and no tool (SQL or reducer) can advance it. A restored auto_inc table is not safe for continued play until the counter naturally passes the restored maximum." >&2
  fi
elif grep -qF "Unique constraint violation" "$AUTOINC_LOG" && grep -qF "area_id" "$AUTOINC_LOG"; then
  echo "$SCRIPT: KNOWN GAP (documented, docs/spikes/1.4-backup-restore.md) -- the first auto-generated insert after restore collided outright with a restored 'area_id' (primary-key violation), the sharpest evidence of the gap: SpacetimeDB 2.9's auto_inc sequence is not advanced by an explicit-id SQL insert, and no tool (SQL or reducer) can advance it." >&2
else
  fail "the post-restore auto_inc insert failed for a reason other than the documented sequence gap" "$AUTOINC_LOG"
fi

# --- 6: module_owner / require_owner --------------------------------------
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

# --- 7a: refuses a non-fresh target ---------------------------------------
if bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-nonfresh.log" 2>&1; then
  fail "restore-world.sh accepted restoring into '$DST' a second time (already holds restored data); it must refuse a non-fresh target" "$DATA_DIR/refuse-nonfresh.log"
fi
grep -qF "not freshly published" "$DATA_DIR/refuse-nonfresh.log" || fail "the non-fresh-target refusal did not name the reason" "$DATA_DIR/refuse-nonfresh.log"
ok "restore-world.sh refuses a non-fresh target"

# --- 7b: refuses a schema mismatch ----------------------------------------
BAD_EXPORT="$WORK/export-bad-schema"
cp -r "$EXPORT_A" "$BAD_EXPORT"
"$BC_PYTHON" -c "
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m['schema_sha256'] = '0' * 64
json.dump(m, open(p, 'w'))
" "$BAD_EXPORT/manifest.json"
FRESH1=bc-backup-fresh1
publish "$FRESH1" "$DATA_DIR/fresh1-publish.log" || fail "could not publish '$FRESH1'" "$DATA_DIR/fresh1-publish.log"
if bash "$OPS/restore-world.sh" "$FRESH1" "$BAD_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/refuse-schema.log" 2>&1; then
  fail "restore-world.sh accepted a manifest whose schema_sha256 does not match server/schema.snapshot.json" "$DATA_DIR/refuse-schema.log"
fi
grep -qF "does not match" "$DATA_DIR/refuse-schema.log" || fail "the schema-mismatch refusal did not name the reason" "$DATA_DIR/refuse-schema.log"
ok "restore-world.sh refuses a schema mismatch"

# --- 7c: refuses a restoring identity that is not the exported owner -----
FRESH2=bc-backup-fresh2
if ! spacetime publish --server "$SERVER_URL" --no-config -y --anonymous "$FRESH2" --module-path "$REPO_ROOT/server" >"$DATA_DIR/fresh2-publish.log" 2>&1; then
  fail "could not publish '$FRESH2' anonymously" "$DATA_DIR/fresh2-publish.log"
fi
if bash "$OPS/restore-world.sh" "$FRESH2" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/refuse-identity.log" 2>&1; then
  fail "restore-world.sh accepted restoring '$SRC's export under a different identity than the one it was exported from" "$DATA_DIR/refuse-identity.log"
fi
grep -qF "the restoring identity does not match the exported module_owner.owner" "$DATA_DIR/refuse-identity.log" || fail "the identity-mismatch refusal did not name the reason" "$DATA_DIR/refuse-identity.log"
ok "restore-world.sh refuses a restoring identity that does not match the exported owner"

# --- 8: the Timestamp/ScheduleAt limitation itself, asserted -------------
SRC_TS=bc-backup-src-ts
publish "$SRC_TS" "$DATA_DIR/src-ts-publish.log" || fail "could not publish '$SRC_TS'" "$DATA_DIR/src-ts-publish.log"
spacetime call "$SRC_TS" --server "$SERVER_URL" --no-config -y send_ping '"backup spike"' >"$DATA_DIR/send-ping.log" 2>&1 \
  || fail "send_ping failed while seeding the Timestamp-limitation case" "$DATA_DIR/send-ping.log"
EXPORT_TS="$WORK/export-ts"
bash "$OPS/export-world.sh" "$SRC_TS" "$EXPORT_TS" --server "$SERVER_URL" >"$DATA_DIR/export-ts.log" 2>&1 || fail "export-world.sh failed on '$SRC_TS'" "$DATA_DIR/export-ts.log"
DST_TS=bc-backup-dst-ts
publish "$DST_TS" "$DATA_DIR/dst-ts-publish.log" || fail "could not publish '$DST_TS'" "$DATA_DIR/dst-ts-publish.log"
if bash "$OPS/restore-world.sh" "$DST_TS" "$EXPORT_TS" --server "$SERVER_URL" >"$DATA_DIR/refuse-timestamp.log" 2>&1; then
  fail "restore-world.sh restored a table with a Timestamp column and rows and still reported success -- it must refuse, never silently drop the table" "$DATA_DIR/refuse-timestamp.log"
fi
grep -qF "'demo_ping' has 1 exported row(s) and a Timestamp/ScheduleAt column" "$DATA_DIR/refuse-timestamp.log" \
  || fail "the Timestamp-limitation refusal did not name 'demo_ping' and the reason" "$DATA_DIR/refuse-timestamp.log"
ok "restore-world.sh refuses to restore a populated table it cannot write via SQL (the Timestamp/ScheduleAt finding), rather than silently reporting success"

echo "$SCRIPT: story 1.4's restore is proven against a real SpacetimeDB instance -- every guard above, positive and negative" >&2
exit 0
