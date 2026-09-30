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
#      anonymous caller (finish_publish, as check-live-migration.sh proves
#      for AC3 -- proven again here because restore is what could have
#      broken it, by leaving two owner rows or the wrong one);
#  10a. world_clock's whole row (id, epoch_at) is equal by value in the restored database;
#  11. five refusals, each asserted directly: a non-fresh target, a
#      schema mismatch, a wrong restoring identity, a `restore_*` call
#      with no restore open, and `restore_module_owner` given a row
#      whose owner is not the caller.
#
# Story 4.18's own AC3, in this same instance: the ordinary export against
# '$SRC' above (this checkout, live == HEAD) already proves schema_commit
# is a real commit sha, never 'worktree'; export-world.sh, run for real
# from a disposable git worktree one commit ahead of the real one (an
# invented table, then a column), still exports the live database
# cleanly, selecting the real, unmodified schema -- and a checkout whose
# only candidate is a superset, a database at a completely foreign schema,
# or a real `--depth 1` shallow clone, all still refuse, each naming why
# distinctly (missing/extra tables; a shallow checkout, named as such).
set -uo pipefail
SCRIPT="check-backup-restore"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
OPS="$REPO_ROOT/scripts/ops"
. "$OPS/lib.sh"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-backup-restore.XXXXXX")"
WORK="$DATA_DIR/work"
mkdir -p "$WORK"
PORT=3988
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL")
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
START_PID=""

cleanup() {
  if [ -n "${BC_KEEP_DATA_DIR:-}" ]; then
    echo "$SCRIPT: BC_KEEP_DATA_DIR set -- leaving $DATA_DIR and the instance on $SERVER_URL running" >&2
    return
  fi
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
  # story 4.18 AC3's own disposable worktrees: removed right after each is
  # used, but a failure partway through (fail() exits immediately) can
  # skip that -- `worktree prune` clears any registration whose directory
  # is already gone, harmless if there is nothing to prune.
  git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "$SCRIPT: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "$SCRIPT: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

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
done <<< "$(bc_table_names "$BC_SNAPSHOT" non-scheduled)"
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

# story 4.18 (Quentin's direction, cycle 1): '$SRC' is published from this
# very checkout, so this export's own manifest.json is exactly
# backup.yml's nightly case -- live equals HEAD -- and its schema_commit
# must be the real commit that last touched server/schema.snapshot.json,
# never 'worktree' (a clean checkout's working tree is byte-identical to
# HEAD's own committed snapshot, so it is never emitted as a distinct
# candidate at all -- see bc_snapshot_candidates). One grep on an export
# this file already produces, no second export needed.
PRE_FAKE_SHA="$(git -C "$REPO_ROOT" log --first-parent --format=%H HEAD -- server/schema.snapshot.json | head -n1)"
[ -n "$PRE_FAKE_SHA" ] || fail "could not resolve the commit that last touched server/schema.snapshot.json"
EXPORT_A_COMMIT="$(grep -oE '"schema_commit": *"[^"]*"' "$EXPORT_A/manifest.json" | sed -E 's/.*"([^"]*)"$/\1/')"
[ "$EXPORT_A_COMMIT" = "$PRE_FAKE_SHA" ] || fail "expected export A's (this checkout, live == HEAD -- exactly backup.yml's nightly-after-a-successful-deploy case) manifest.json schema_commit to be $PRE_FAKE_SHA, got '$EXPORT_A_COMMIT' -- a clean checkout must never record 'worktree'"
ok "export A's schema_commit ($EXPORT_A_COMMIT) is the real live commit, not 'worktree', even though live == HEAD"

DST=bc-backup-dst
publish "$DST" "$DATA_DIR/dst-publish.log" || fail "could not publish '$DST'" "$DATA_DIR/dst-publish.log"
BC_RESTORE_BATCH_BYTES=4000 bash "$OPS/restore-world.sh" "$DST" "$EXPORT_A" --server "$SERVER_URL" >"$DATA_DIR/restore.log" 2>&1 \
  || fail "restore-world.sh failed restoring '$DST' from '$SRC's export -- with real id gaps seeded, this exercises the gap-fill loop's delete-and-retry branch, not only the always-exact branch a contiguous seed would" "$DATA_DIR/restore.log"
cat "$DATA_DIR/restore.log" >&2
grep -qE "'demo_ping' restored [0-9]+ row\(s\) in [2-9][0-9]* batch\(es\)" "$DATA_DIR/restore.log" \
  || fail "'demo_ping' (which includes a 20KB message) did not restore across multiple batches at a 4000-byte budget -- byte-budget batching is not exercised" "$DATA_DIR/restore.log"
ok "a row too big for one batch restores across multiple byte-budgeted batches"

# --- story 4.2: begin_restore disarms every scheduled table before its
# own preconditions run -- a freshly published target's own init armed
# maintenance_schedule immediately, so without this a real fire could
# land on the target mid-restore, using an epoch that belongs to the
# target's own pre-restore world. Checked directly, on its own throwaway
# target: begin_restore, then every scheduled table's row count, before
# any restore_* call has run at all ----------------------------------
DISARM_TARGET=bc-backup-disarm
publish "$DISARM_TARGET" "$DATA_DIR/disarm-publish.log" || fail "could not publish '$DISARM_TARGET'" "$DATA_DIR/disarm-publish.log"
DISARM_BEFORE="$(row_count_live "$DISARM_TARGET" maintenance_schedule)"
[ "$DISARM_BEFORE" -eq 1 ] || fail "freshly published '$DISARM_TARGET.maintenance_schedule' holds $DISARM_BEFORE pending row(s), expected exactly 1 (init's own arm) -- nothing to disarm, this leg would prove nothing" "$DATA_DIR/disarm-publish.log"
spacetime call "$DISARM_TARGET" "${SERVER_ARGS[@]}" --no-config -y begin_restore '[]' >"$DATA_DIR/disarm-begin.log" 2>&1 \
  || fail "begin_restore failed against '$DISARM_TARGET'" "$DATA_DIR/disarm-begin.log"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  n="$(row_count_live "$DISARM_TARGET" "$table")"
  [ "$n" -eq 0 ] || fail "scheduled table '$table' on '$DISARM_TARGET' holds $n pending row(s) immediately after begin_restore, expected exactly 0 -- begin_restore must disarm every scheduled table before any cadence can fire mid-restore" "$DATA_DIR/disarm-begin.log"
done <<< "$(bc_table_names "$BC_SNAPSHOT" scheduled)"
ok "begin_restore disarms every scheduled table -- zero pending rows on '$DISARM_TARGET' immediately after, before any restore_* call"

# --- restore-world.sh's finish_restore re-arms every cadence from the
# epoch just restored, inside the module's own transaction chain.
# maintenance_schedule holds exactly one pending row, and its own
# freshly-armed target is phase-aligned to the restored epoch: the gap
# between them is a whole number of city minutes (REAL_MS_PER_CITY_MINUTE,
# 2500ms -- sim::cadence's own floor every cadence period clears, never
# the maintenance-specific period alone, so this check stays valid even if
# that period constant later changes). Read from maintenance_schedule
# itself, never cadence_liveness: that table is only ever written from
# inside a cadence's own fired reducer (never by the arm alone), so right
# after a restore -- nothing has fired yet -- it still has no row at all. -
MAINT_PENDING="$(row_count_live "$DST" maintenance_schedule)"
[ "$MAINT_PENDING" -eq 1 ] || fail "restored '$DST.maintenance_schedule' holds $MAINT_PENDING pending row(s) after finish_restore, expected exactly 1"
RESTORED_EPOCH_MICROS="$(column_values_live "$DST" world_clock epoch_at | grep -oE '[0-9]+' | head -n1)"
# scheduled_at is ScheduleAt (a sum type): SATS tags it as
# `[variant_index, payload]` -- `[1,[micros]]` for `Time` -- so the
# *last* digit run is the micros value, never the first (the variant
# tag), confirmed empirically against a real instance (story 4.2's
# check-authoritative-loop.sh carries the same fix, same reasoning).
MAINT_TARGET_MICROS="$(column_values_live "$DST" maintenance_schedule scheduled_at | grep -oE '[0-9]+' | tail -n1)"
[ -n "$RESTORED_EPOCH_MICROS" ] || fail "could not read '$DST.world_clock.epoch_at'"
[ -n "$MAINT_TARGET_MICROS" ] || fail "could not read '$DST.maintenance_schedule.scheduled_at' -- finish_restore did not arm the maintenance cadence"
CITY_MINUTE_MICROS=2500000
REMAINDER=$(( (MAINT_TARGET_MICROS - RESTORED_EPOCH_MICROS) % CITY_MINUTE_MICROS ))
[ "$REMAINDER" -eq 0 ] || fail "the restored maintenance cadence's own target ($MAINT_TARGET_MICROS) is not phase-aligned to the restored epoch ($RESTORED_EPOCH_MICROS) at a ${CITY_MINUTE_MICROS}us city-minute grid -- remainder ${REMAINDER}us"
ok "restored 'maintenance_schedule' resumes with exactly one pending row, phase-aligned to the restored epoch"

EXPORT_B="$WORK/export-b"
bash "$OPS/export-world.sh" "$DST" "$EXPORT_B" --server "$SERVER_URL" >"$DATA_DIR/export-b.log" 2>&1 || fail "export-world.sh failed on '$DST'" "$DATA_DIR/export-b.log"

bash "$OPS/verify-world.sh" "$EXPORT_A" "$EXPORT_B" >"$DATA_DIR/verify.log" 2>&1 || fail "verify-world.sh found a mismatch between '$SRC' and the restored '$DST' -- across a table with real id gaps, this is the gap-fill loop's own correctness proof" "$DATA_DIR/verify.log"
ok "$(tail -n1 "$DATA_DIR/verify.log") (including 'floor_transition', seeded with real id gaps)"

# --- story 4.18 AC3: the real export-world.sh, run from a disposable git
# worktree of this very repo whose own HEAD is one commit *ahead* of the
# real one (an invented table, then, separately, an invented column) --
# exactly the shape of a deploy that adds a table/column -- proves the
# fix directly: the pre-publish backup no longer refuses '$SRC' (published
# from the real, unmodified module) just because the checkout it runs from
# is ahead of it. No second local instance and no test-only branch in
# export-world.sh: the checkout's own history is real, `bc_snapshot_
# candidates`'s override is never used here. `server/target` is symlinked
# from the real repo into each worktree (never `CARGO_TARGET_DIR`, which
# would build to the right place but leave lib.sh's own `bc_wb()` -- a
# fixed path relative to *its own* repo root, the worktree's -- looking in
# the wrong one) so world_backup is never rebuilt from scratch for either
# worktree (Tim's direction, keeps this inside its own time budget).
#
# add_json_line <file> <after-pattern> <line> -- inserts <line> right
# after the first line matching <after-pattern> -- enough to add one table
# or one column to server/schema.snapshot.json's own JSON without a JSON
# library: this file is read by serde_json (world_backup), which does not
# care about indentation or where in its own array a new element lands.
add_json_line() { # <file> <after-pattern> <line>
  awk -v pat="$2" -v line="$3" '
    { print }
    $0 ~ pat && !done { print line; done = 1 }
  ' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}

ac3_worktree() { # <dir> -- a disposable, detached worktree of $REPO_ROOT
                 # at its own current HEAD, sharing the real repo's own
                 # server/target so world_backup is never rebuilt from
                 # scratch.
  git -C "$REPO_ROOT" worktree add -q --detach "$1" HEAD \
    || fail "could not add a disposable git worktree at '$1'"
  # A silently-degraded symlink (`|| true`) would pay for a from-scratch
  # world_backup build inside the worktree instead -- the exact time-
  # budget failure this symlink exists to prevent (Tim's direction, cycle
  # 1) -- so a checkout that cannot share the target dir (no symlink
  # support) must say so loudly, not quietly eat the cost.
  ln -s "$REPO_ROOT/server/target" "$1/server/target" \
    || fail "could not symlink server/target into the disposable worktree '$1' -- world_backup would otherwise rebuild from scratch there"
}
ac3_commit() { # <dir> <message> -- commits every modified tracked file.
  git -C "$1" -c user.email="ci@example.com" -c user.name="ci" commit -q -am "$2" \
    || fail "could not commit '$2' in the disposable worktree '$1'"
}

# PRE_FAKE_SHA (the commit the fix must select once a fixture commit lands
# on top of it) was already resolved above, right after EXPORT_A.

echo
echo "story 4.18 AC3 (positive): the incoming commit adds a whole table AND a column -- export still finds and selects the real, live schema"
# One worktree/commit/export for both additive shapes (never two -- each
# export already pays for a full table-by-table live-shape build, ~2s x
# ~26 tables x N passes, and this check has its own time budget), one
# commit adding both a whole invented table and a column on an existing
# one -- exactly "a deploy whose commit adds a table or a column" (the
# issue's own wording), together.
AC3_WT="$WORK/ac3-positive"
ac3_worktree "$AC3_WT"
add_json_line "$AC3_WT/server/schema.snapshot.json" '"tables":' \
  '    {"accessor":"story_4_18_invented_table","struct_name":"Story418InventedTable","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]},'
add_json_line "$AC3_WT/server/schema.snapshot.json" '"columns":' \
  '        {"name":"story_4_18_invented_column","ty":"i32","primary_key":false,"auto_inc":false,"unique":false,"has_default":true,"indexed":false},'
ac3_commit "$AC3_WT" "story 4.18 AC3 fixture: an invented table and an invented column, never merged"
AC3_EXPORT="$WORK/ac3-positive-export"
bash "$AC3_WT/scripts/ops/export-world.sh" "$SRC" "$AC3_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/ac3-positive.log" 2>&1 \
  || fail "export-world.sh failed on '$SRC', run from a checkout one commit ahead (an invented table and column) -- this is exactly the bug #331/#338 report" "$DATA_DIR/ac3-positive.log"
AC3_COMMIT="$(grep -oE '"schema_commit": *"[^"]*"' "$AC3_EXPORT/manifest.json" | sed -E 's/.*"([^"]*)"$/\1/')"
[ "$AC3_COMMIT" = "$PRE_FAKE_SHA" ] || fail "expected the export's manifest.json schema_commit to be $PRE_FAKE_SHA (the commit before the invented table/column), got '$AC3_COMMIT'"
[ ! -f "$AC3_EXPORT/story_4_18_invented_table.jsonl" ] || fail "the export wrote a file for 'story_4_18_invented_table', which the live database never had -- it must have exported against the real, live schema, not the incoming one"
git -C "$REPO_ROOT" worktree remove --force "$AC3_WT" 2>/dev/null || true
ok "'$SRC' exports cleanly from a checkout one commit ahead by a whole table and a column -- manifest.json's schema_commit is $PRE_FAKE_SHA, the real live commit"

echo
echo "story 4.18 AC3 (negative): a real mismatch still fails, naming the missing/extra tables"
AC3_NEG_WT="$WORK/ac3-negative"
ac3_worktree "$AC3_NEG_WT"
# An orphan commit -- its own first-parent history is exactly this one
# commit, never the real repo's, so the *only* candidate export-world.sh
# can ever find here is the superset itself (Quentin's direction: "a
# candidate list containing only the superset"). A unique branch name
# (this process's own pid): a fixed one would collide with a still-around
# branch from a previous local run -- `git worktree remove` deletes the
# worktree, never the branch it had checked out -- and `checkout --orphan`
# on a name that already exists fails *without aborting this script*
# (only `set -u`/`-o pipefail`, no `-e`), silently leaving the worktree on
# its real, non-orphan history instead.
git -C "$AC3_NEG_WT" checkout -q --orphan "ac3-negative-$$" \
  || fail "could not create the orphan branch for the AC3 negative fixture"
add_json_line "$AC3_NEG_WT/server/schema.snapshot.json" '"tables":' \
  '    {"accessor":"story_4_18_invented_table","struct_name":"Story418InventedTable","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]},'
ac3_commit "$AC3_NEG_WT" "story 4.18 AC3 fixture: superset only, orphan history"
AC3_NEG_EXPORT="$WORK/ac3-negative-export"
if bash "$AC3_NEG_WT/scripts/ops/export-world.sh" "$SRC" "$AC3_NEG_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/ac3-negative.log" 2>&1; then
  fail "export-world.sh succeeded against '$SRC' from a checkout whose only candidate snapshot is a superset with an invented table -- it must refuse (no real match exists)" "$DATA_DIR/ac3-negative.log"
fi
grep -qF "does not match" "$DATA_DIR/ac3-negative.log" || fail "the mismatch refusal did not name the reason" "$DATA_DIR/ac3-negative.log"
grep -qF "story_4_18_invented_table" "$DATA_DIR/ac3-negative.log" || fail "the mismatch refusal did not name 'story_4_18_invented_table' as missing" "$DATA_DIR/ac3-negative.log"
git -C "$REPO_ROOT" worktree remove --force "$AC3_NEG_WT" 2>/dev/null || true
git -C "$REPO_ROOT" branch -D "ac3-negative-$$" 2>/dev/null || true
ok "a real mismatch (a candidate list with no snapshot that actually matches '$SRC') still refuses, naming the invented table"

echo
echo "story 4.18 AC3 (negative): a foreign schema (a different module entirely) still refuses, naming missing and extra"
FOREIGN=bc-backup-foreign-schema
if ! spacetime publish --server "$SERVER_URL" --no-config -y "$FOREIGN" --module-path "$REPO_ROOT/server/tests/fixtures/migration_v1" >"$DATA_DIR/foreign-publish.log" 2>&1; then
  fail "could not publish the migration_v1 fixture as '$FOREIGN'" "$DATA_DIR/foreign-publish.log"
fi
AC3_FOREIGN_EXPORT="$WORK/ac3-foreign-export"
if bash "$OPS/export-world.sh" "$FOREIGN" "$AC3_FOREIGN_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/ac3-foreign.log" 2>&1; then
  fail "export-world.sh succeeded against '$FOREIGN', a completely different module (migration_v1's own fixture_row table, none of this module's real tables) -- it must refuse" "$DATA_DIR/ac3-foreign.log"
fi
grep -qF "does not match" "$DATA_DIR/ac3-foreign.log" || fail "the foreign-schema refusal did not name the reason" "$DATA_DIR/ac3-foreign.log"
grep -qF "fixture_row" "$DATA_DIR/ac3-foreign.log" || fail "the foreign-schema refusal did not name 'fixture_row' as extra" "$DATA_DIR/ac3-foreign.log"
ok "a foreign schema (a different module's own database) still refuses, naming missing and extra tables"

echo
echo "story 4.18 AC3 (negative): a real --depth 1 shallow checkout names the reason distinctly, never a generic mismatch"
# `git clone --depth 1 file://...`, never a bare local path -- a local-
# path clone silently ignores --depth (confirmed empirically) and would
# prove nothing here. Reuses '$FOREIGN' (already published, above): the
# real shallow clone's own boundary commit (this repo's real, full
# schema) still cannot match a database at a completely different
# module's schema, so this is a real mismatch too -- the only thing under
# test is which message export-world.sh gives for it.
AC3_SHALLOW_CLONE="$WORK/ac3-shallow"
git clone -q --depth 1 "file://$REPO_ROOT" "$AC3_SHALLOW_CLONE" >"$DATA_DIR/ac3-shallow-clone.log" 2>&1 \
  || fail "could not create the --depth 1 fixture clone" "$DATA_DIR/ac3-shallow-clone.log"
ln -s "$REPO_ROOT/server/target" "$AC3_SHALLOW_CLONE/server/target" \
  || fail "could not symlink server/target into the shallow clone -- world_backup would otherwise rebuild from scratch there"
AC3_SHALLOW_EXPORT="$WORK/ac3-shallow-export"
if bash "$AC3_SHALLOW_CLONE/scripts/ops/export-world.sh" "$FOREIGN" "$AC3_SHALLOW_EXPORT" --server "$SERVER_URL" >"$DATA_DIR/ac3-shallow.log" 2>&1; then
  fail "export-world.sh succeeded against '$FOREIGN' from a --depth 1 shallow clone -- it must refuse (no real match exists)" "$DATA_DIR/ac3-shallow.log"
fi
grep -qF "shallow checkout" "$DATA_DIR/ac3-shallow.log" || fail "a real shallow checkout's own mismatch did not name itself distinctly ('shallow checkout') -- it read as a plain mismatch instead" "$DATA_DIR/ac3-shallow.log"
grep -qF "fetch-depth: 0" "$DATA_DIR/ac3-shallow.log" || fail "the shallow-checkout refusal did not say how to fix it (fetch-depth: 0)" "$DATA_DIR/ac3-shallow.log"
grep -qF "does not match" "$DATA_DIR/ac3-shallow.log" || fail "the shallow-checkout refusal still must name the underlying mismatch (missing/extra), not only the shallow diagnosis" "$DATA_DIR/ac3-shallow.log"
ok "a real --depth 1 shallow checkout's own mismatch names itself distinctly ('shallow checkout', fetch-depth: 0), while still naming the underlying missing/extra tables"

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
# The `None` branch of `restore_autoinc_rows` (no rows placed at all, a
# nonzero floor, the per-table `placeholder()` literal) is otherwise
# never taken by anything in this file: every auto_inc table in the main
# restore has rows, and `building_area` above still has two. `room_area`
# here gets seeded then *entirely* deleted before export -- a real
# disaster-recovery shape (every row of a table gone, but ids it once
# issued must still never be re-issued) -- so the restore of this table
# specifically must take the placeholder branch, not the delete-R one.
sql_exec "$TAIL_SRC" "INSERT INTO room_area (area_id, room_id, x0, y0, x1, y1, floor, chunk_key) VALUES (0,1,0,0,0,0,0,0),(0,1,0,0,0,0,0,0),(0,1,0,0,0,0,0,0)" "$DATA_DIR/tail-room-area-insert.log" \
  || fail "seeding room_area ids in '$TAIL_SRC' failed" "$DATA_DIR/tail-room-area-insert.log"
sql_exec "$TAIL_SRC" "DELETE FROM room_area" "$DATA_DIR/tail-room-area-delete.log" \
  || fail "deleting every room_area row in '$TAIL_SRC' failed" "$DATA_DIR/tail-room-area-delete.log"
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
ROOM_AREA_FLOOR="$(bc_wb manifest-floor "$TAIL_EXPORT/manifest.json" room_area)"
[ "$ROOM_AREA_FLOOR" -gt 0 ] || fail "expected '$TAIL_EXPORT/manifest.json's sequence_floors.room_area to be nonzero -- room_area had 3 rows once, all deleted before export, so its sequence was touched and the None (placeholder) branch would never actually be exercised by restoring it" "$DATA_DIR/tail-export.log"
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

# room_area itself restores to exactly 0 rows -- the None branch's own
# per-table placeholder() literal must never be left behind as a real
# row, only ever used to advance the sequence and then deleted again.
ROOM_AREA_COUNT="$(row_count_live "$TAIL_DST" room_area)"
[ "$ROOM_AREA_COUNT" -eq 0 ] || fail "restored '$TAIL_DST.room_area' has $ROOM_AREA_COUNT row(s), expected exactly 0 -- the None branch's placeholder() row must be deleted again, never left behind" "$DATA_DIR/tail-restore.log"
sql_exec "$TAIL_DST" "INSERT INTO room_area (area_id, room_id, x0, y0, x1, y1, floor, chunk_key) VALUES (0,9,0,0,0,0,0,0)" "$DATA_DIR/tail-room-area-probe.log" \
  || fail "the post-restore auto_inc probe on '$TAIL_DST.room_area' failed" "$DATA_DIR/tail-room-area-probe.log"
ROOM_AREA_NEW_ID="$(max_id_live "$TAIL_DST" room_area)"
[ "$ROOM_AREA_NEW_ID" -gt "$ROOM_AREA_FLOOR" ] || fail "expected the post-restore probe on '$TAIL_DST.room_area' (restored via the None/placeholder branch -- every row was deleted before export) to land past the manifest's own sequence floor ($ROOM_AREA_FLOOR); got $ROOM_AREA_NEW_ID" "$DATA_DIR/tail-room-area-probe.log"
ok "tail-deletion (all rows gone): 'room_area' restores to exactly 0 rows and its sequence still advances past the manifest's own recorded floor ($ROOM_AREA_FLOOR), via restore_autoinc_rows's None/placeholder() branch (probe landed on $ROOM_AREA_NEW_ID)"

# --- stock: every row survives with its id and holder pair intact --------
# Before verify-independent.sh, whose probe inserts a row into the restored
# database. Two oracles: the restored table's whole rows, primary-key sorted
# (`rows-canonical`, never the scan order), equal the source's; and the three
# real-shaped rows `seed-edge-rows.sh` wrote are asserted as literals on the
# restored database, each selected by its own stock_id, so neither the export
# nor the source is the oracle for them.
stock_rows_live() { # <db> [where-clause]
  local where="${2:-}" resp
  resp="$WORK/stockrows-$1-${where//[^a-z0-9]/_}.json"
  bc_sql_json "$SCRIPT" "$1" "${SERVER_ARGS[@]}" "SELECT * FROM stock $where" >"$resp"
  bc_wb rows-canonical "$BC_SNAPSHOT" stock "$resp"
}
SRC_STOCK="$(stock_rows_live "$SRC")"
DST_STOCK="$(stock_rows_live "$DST")"
[ -n "$SRC_STOCK" ] || fail "'$SRC.stock' has no rows -- nothing to compare"
[ "$SRC_STOCK" = "$DST_STOCK" ] || fail "restored 'stock' rows differ from '$SRC's own -- expected:
$SRC_STOCK
got:
$DST_STOCK"
# [stock_id, holder_kind, holder_id, item_id, quantity]: business 1 holds 500
# of item 1, business 2 holds 20 of item 1, citizen 1 holds 3 of item 2.
for expected in '[4,0,1,1,500]' '[5,0,2,1,20]' '[6,1,1,2,3]'; do
  id="${expected#[}"; id="${id%%,*}"
  got="$(stock_rows_live "$DST" "WHERE stock_id = $id")"
  [ "$got" = "$expected" ] || fail "restored 'stock' row $id is '$got', expected the seeded '$expected' (holder kind, holder id, item, quantity intact)"
done
[ "$(row_count_live "$SRC" business)" = "$(row_count_live "$DST" business)" ] \
  || fail "restored 'business' has a different row count from '$SRC'"
ok "every stock row reads back identically from the restored database, and the three seeded business/citizen rows hold their exact holder pair, item and quantity"

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
done <<< "$(bc_table_names "$BC_SNAPSHOT" scheduled)"
ok "every scheduled table in the restored database matches a freshly published reference (compared by row count -- schedules are derived state, never restored, so both are always empty today)"

# --- 10a: world_clock's epoch survives by value ------------------------------
# The row-count check alone would pass a restore that re-ran init's own
# `ctx.timestamp` -- shifting the epoch retimes every in-city timestamp.
SRC_EPOCH="$(column_values_live "$SRC" world_clock id)/$(column_values_live "$SRC" world_clock epoch_at)"
DST_EPOCH="$(column_values_live "$DST" world_clock id)/$(column_values_live "$DST" world_clock epoch_at)"
[ "$SRC_EPOCH" != "/" ] || fail "'$SRC' has no world_clock epoch_at to compare"
[ "$SRC_EPOCH" = "$DST_EPOCH" ] || fail "restored world_clock row (id/epoch_at) is '$DST_EPOCH', the source's was '$SRC_EPOCH' -- restore must carry the epoch through by value"
ok "restored world_clock row (id and epoch_at) equals the source's ($SRC_EPOCH)"

# --- 10: module_owner / require_owner --------------------------------------
OWNER_COUNT="$(row_count_live "$DST" module_owner)"
[ "$OWNER_COUNT" -eq 1 ] || fail "restored 'module_owner' has $OWNER_COUNT row(s), expected exactly 1"
ok "restored 'module_owner' has exactly one row"

spacetime call "$DST" --server "$SERVER_URL" --no-config -y finish_publish >"$DATA_DIR/reseed.log" 2>&1 \
  || fail "finish_publish failed against the restored database, called as its owner" "$DATA_DIR/reseed.log"
OWNER_REJECTION_PATTERN="this reducer may only be invoked by the module owner"
if spacetime call "$DST" --server "$SERVER_URL" --no-config -y --anonymous finish_publish >"$DATA_DIR/reseed-anon.log" 2>&1; then
  fail "finish_publish accepted an anonymous caller against the restored database; it must be rejected" "$DATA_DIR/reseed-anon.log"
fi
grep -qF "$OWNER_REJECTION_PATTERN" "$DATA_DIR/reseed-anon.log" || fail "finish_publish rejected the anonymous call, but not with require_owner's own message" "$DATA_DIR/reseed-anon.log"
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

# --- 12: scripts/ops/check-database-exists.sh's not-found contract, against
# the pinned CLI's real wording (Quentin's cycle-2 direction, PR #288: the
# deploy story's own stub-fixture suite for this script only proves it
# agrees with itself; a real instance is already running here, so this is
# where the CLI's actual not-found wording is exercised for real, not just
# asserted by a stubbed binary) ---------------------------------------------
EXISTS_OUT="$(bash "$OPS/check-database-exists.sh" "$SRC" --server "$SERVER_URL")" \
  || fail "check-database-exists.sh failed against '$SRC', a database that really exists"
[ "$EXISTS_OUT" = "true" ] || fail "check-database-exists.sh printed '$EXISTS_OUT' for '$SRC', which really exists (expected 'true')"
ok "check-database-exists.sh recognises a real, published database"

NEVER_PUBLISHED=bc-backup-never-published
NOT_FOUND_OUT="$(bash "$OPS/check-database-exists.sh" "$NEVER_PUBLISHED" --server "$SERVER_URL")" \
  || fail "check-database-exists.sh failed against '$NEVER_PUBLISHED', a name that was never published -- the CLI's not-found wording may have drifted from the one the script matches"
[ "$NOT_FOUND_OUT" = "false" ] || fail "check-database-exists.sh printed '$NOT_FOUND_OUT' for '$NEVER_PUBLISHED', which was never published (expected 'false')"
ok "check-database-exists.sh's not-found contract holds against the real, pinned CLI"

echo "$SCRIPT: story 1.4's restore is proven against a real SpacetimeDB instance -- every guard above, positive and negative" >&2
exit 0
