#!/usr/bin/env bash
# The one logical export path (AC2): dumps every table the *live* schema
# names via the real `spacetime sql`, never a second export path for tests
# (Quentin's direction). Used identically by a human, by
# scripts/ci/check-backup-restore.sh and by .github/workflows/backup.yml.
#
# Usage: export-world.sh <db> <out-dir> [--server <url-or-nickname>]
#
# Story 4.18: this script used to compare the live database against
# server/schema.snapshot.json from the checkout it runs from -- which is
# exactly wrong for its own two real callers, `deploy.yml`'s `backup` job
# and `backup.yml`'s scheduled export, both of which run from a commit
# that is, by definition, at or ahead of what is actually live (that is
# what a pre-publish backup is *for*). Any additive migration -- the only
# kind a live schema ever takes -- made every such deploy refuse itself.
#
# The fix matches, never records: rather than trust a stored pointer to
# "the last live commit" (expires under Actions' own retention, drifts the
# moment anyone writes it by hand), this walks the schema snapshot's own
# git history (bc_snapshot_candidates, scripts/ops/lib.sh) and asks
# world_backup's `select-schema` which candidate's whole shape (every
# table's accessor and its own normalised columns) actually equals the
# live database's, newest first. `check-schema-additive.sh`'s append-only
# rule is what makes this well-defined: table names plus column names
# identify exactly one point on the deploying commit's own first-parent
# history.
#
# Writes <out-dir>/<table>.jsonl (one canonical JSON row per line, sorted
# by the table's real primary key -- server/tools/world_backup) for every
# table, plus manifest.json (CLI version, the *selected* schema snapshot's
# own sha256 and the git commit it was selected from -- `schema_commit`,
# a real commit sha in every normal case; `worktree` only when the
# checkout's own working-tree copy of server/schema.snapshot.json is
# itself the selected one *and* differs from HEAD's own committed
# version (a human's own uncommitted edit against a local instance) --
# the database identity, the exporting identity, per-table row counts and
# per-file sha256, and every auto_inc table's own `sequence_floors` --
# `st_sequence.allocated` at export time, a safe upper bound
# restore-world.sh advances each sequence past, so a restore never
# re-issues an id the source ever handed out, not merely the highest one
# still present in the export). Every value passes through world_backup,
# never `jq` -- see that crate's module doc for why (u64/chunk_key
# precision).
#
# Atomic: builds in <out-dir>.partial, then rename-swaps into place. A
# failed or half-written export never looks like one at the final path
# (Quentin's direction), and a failed *rename* never destroys a previous
# good export either: the old export is moved aside first and only
# deleted after the new one is fully in place.
set -uo pipefail
SCRIPT="export-world"
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

USAGE="usage: export-world.sh <db> <out-dir> [--server <url-or-nickname>]"
[ "$#" -ge 2 ] || bc_ops_die "$SCRIPT" "$USAGE"
DB="$1"; OUT_DIR="$2"; shift 2
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
bc_reject_unknown_args "$SCRIPT" "$USAGE" "$@"

[ -f "$BC_SNAPSHOT" ] || bc_ops_die "$SCRIPT" "$BC_SNAPSHOT not found"
command -v spacetime >/dev/null 2>&1 || bc_ops_die "$SCRIPT" "'spacetime' is not on PATH"

TMP_DIR="${OUT_DIR%/}.partial"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
cleanup() { [ -n "${BC_KEEP_PARTIAL:-}" ] || rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# --- the live database's own table list and every live table's own
# response, fetched once, kept, and never re-queried (Quentin's/Tim's
# direction): the same responses this loop caches are what the row export
# further down reads from, and what the live "shape" is built from for
# matching below -----------------------------------------------------------
DESCRIBE_JSON="$TMP_DIR/.describe.json"
if ! spacetime describe "$DB" "${SERVER_ARGS[@]}" --no-config -y --json >"$DESCRIBE_JSON" 2>"$TMP_DIR/.describe.err"; then
  bc_ops_die "$SCRIPT" "'spacetime describe $DB --json' failed:
$(cat "$TMP_DIR/.describe.err")"
fi
LIVE_TABLES="$(bc_wb describe-tables "$DESCRIBE_JSON" | grep -v '^restore_state$' | sort)"

LIVE_SHAPE_FILE="$TMP_DIR/.live-shape.txt"
: > "$LIVE_SHAPE_FILE"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  RESPONSE="$TMP_DIR/$table.response.json"
  bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM $table" >"$RESPONSE"
  # column drift, name-normalised (SpacetimeDB echoes e.g. `x0` back as
  # `x_0` -- see world_backup::normalize_name), sorted so this line
  # compares byte-for-byte against a candidate's own `snapshot-shape` line
  # regardless of either side's own column order.
  COLS_SORTED="$(bc_wb columns-normalized "$RESPONSE" | sort | paste -sd, -)"
  printf '%s\t%s\n' "$table" "$COLS_SORTED" >> "$LIVE_SHAPE_FILE"
done <<< "$LIVE_TABLES"

# --- which committed snapshot is actually live? matched, never recorded
# (story 4.18) -------------------------------------------------------------
CANDIDATES_DIR="$TMP_DIR/.candidates"
LABELS="$(bc_snapshot_candidates "$CANDIDATES_DIR" "$BC_REPO_ROOT" "$BC_SNAPSHOT")"
CANDIDATE_COUNT=0
CANDIDATE_INDEXES=()
CANDIDATE_LABELS=()
CANDIDATE_SHAPE_FILES=()
while IFS=$'\t' read -r idx label; do
  [ -n "$idx" ] || continue
  bc_wb snapshot-shape "$CANDIDATES_DIR/$idx" > "$CANDIDATES_DIR/$idx.shape"
  CANDIDATE_INDEXES+=("$idx")
  CANDIDATE_LABELS+=("$label")
  CANDIDATE_SHAPE_FILES+=("$CANDIDATES_DIR/$idx.shape")
  CANDIDATE_COUNT=$((CANDIDATE_COUNT + 1))
done <<< "$LABELS"
[ "$CANDIDATE_COUNT" -ge 1 ] || bc_ops_die "$SCRIPT" "bc_snapshot_candidates produced no candidates at all -- $BC_SNAPSHOT should always be reachable, at least as the worktree candidate"
SHALLOW="$(cat "$CANDIDATES_DIR/shallow" 2>/dev/null || echo false)"

SELECT_LOG="$TMP_DIR/.select.err"
if ! WINNER="$(bc_wb select-schema "$LIVE_SHAPE_FILE" "${CANDIDATE_SHAPE_FILES[@]}" 2>"$SELECT_LOG")"; then
  REASON="$(cat "$SELECT_LOG")"
  # Distinct from a real mismatch (Tim's/Quentin's direction, cycle 1):
  # keyed on the repo's own real shallow-ness (`git rev-parse --is-
  # shallow-repository`), never on how many candidates came out -- a
  # shallow clone whose HEAD happens to have touched the snapshot still
  # yields more than one candidate (the boundary commit plus, sometimes,
  # a dirty worktree), and a live database that is perfectly healthy must
  # never read as "does not match" just because this checkout cannot see
  # far enough back to prove it.
  case "$SHALLOW" in
    non-git)
      bc_ops_die "$SCRIPT" "not a git checkout ($BC_REPO_ROOT) -- only the working-tree snapshot ($BC_SNAPSHOT) is a candidate, and it does not match the live database. $REASON"
      ;;
    true)
      bc_ops_die "$SCRIPT" "shallow checkout ($CANDIDATE_COUNT commit(s) visible) -- fetch full history (fetch-depth: 0) to see the live schema. $REASON"
      ;;
    *)
      bc_ops_die "$SCRIPT" "'$DB' $REASON (checked $CANDIDATE_COUNT candidate snapshot(s), newest: $BC_SNAPSHOT)"
      ;;
  esac
fi

SELECTED_SNAPSHOT="$CANDIDATES_DIR/${CANDIDATE_INDEXES[$WINNER]}"
SELECTED_LABEL="${CANDIDATE_LABELS[$WINNER]}"
SNAPSHOT_TABLES="$LIVE_TABLES"

# --- notice, right in this step's own log: which commit is live, and what
# this deploy is about to add relative to it -- every added table, and
# every added column on a table both sides already have (Quentin's
# direction, cycle 1: a column-only deploy is exactly the case an operator
# reading only the table list would see nothing at all) -- so the deploy
# log says what happened without anyone having to read the export -------
INCOMING_TABLES="$(bc_table_names "$BC_SNAPSHOT" all | sort)"
ADDED_TABLES="$(comm -23 <(printf '%s\n' "$INCOMING_TABLES") <(printf '%s\n' "$SNAPSHOT_TABLES"))"
ADDED_COLUMNS=""
while IFS= read -r table; do
  [ -n "$table" ] || continue
  INC_COLS="$(bc_wb snapshot-columns "$BC_SNAPSHOT" "$table" | sort)"
  SEL_COLS="$(bc_wb snapshot-columns "$SELECTED_SNAPSHOT" "$table" | sort)"
  TABLE_ADDED="$(comm -23 <(printf '%s\n' "$INC_COLS") <(printf '%s\n' "$SEL_COLS"))"
  [ -n "$TABLE_ADDED" ] || continue
  [ -n "$ADDED_COLUMNS" ] && ADDED_COLUMNS="$ADDED_COLUMNS; "
  ADDED_COLUMNS="${ADDED_COLUMNS}${table}: [${TABLE_ADDED//$'\n'/, }]"
done <<< "$(comm -12 <(printf '%s\n' "$INCOMING_TABLES") <(printf '%s\n' "$SNAPSHOT_TABLES"))"
echo "::notice::export-world: live schema is $SELECTED_LABEL -- table(s) this deploy adds: [${ADDED_TABLES//$'\n'/, }] -- column(s) this deploy adds: $ADDED_COLUMNS" >&2

declare -A ROW_COUNTS
TABLES_JSON="$TMP_DIR/.tables.json"
{
  printf '{\n'
  first=1
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    RESPONSE="$TMP_DIR/$table.response.json"

    LIVE_COLS="$(bc_wb columns-normalized "$RESPONSE")"
    SNAP_COLS="$(bc_wb snapshot-columns "$SELECTED_SNAPSHOT" "$table")"
    if [ "$LIVE_COLS" != "$SNAP_COLS" ]; then
      bc_ops_die "$SCRIPT" "'$table' columns differ from the selected schema ($SELECTED_LABEL) (live: [$(printf '%s' "$LIVE_COLS" | tr '\n' ',')] snapshot: [$(printf '%s' "$SNAP_COLS" | tr '\n' ',')])"
    fi

    bc_wb rows-canonical "$SELECTED_SNAPSHOT" "$table" "$RESPONSE" >"$TMP_DIR/$table.jsonl"
    rm -f "$RESPONSE"
    count="$(wc -l < "$TMP_DIR/$table.jsonl" | tr -d ' ')"
    ROW_COUNTS["$table"]="$count"
    sha="$(bc_sha256 "$TMP_DIR/$table.jsonl")"
    [ "$first" -eq 1 ] || printf ',\n'
    first=0
    printf '  "%s": {"rows": %s, "sha256": "%s"}' "$table" "$count" "$sha"
  done <<< "$SNAPSHOT_TABLES"
  printf '\n}\n'
} > "$TABLES_JSON"

# --- every auto_inc table's own sequence floor (Tim's direction, cycle
# 4): the restore must never re-issue an id the source ever handed out,
# not merely the highest one still present among the exported rows --
# `st_sequence.allocated` (a system table, readable regardless of the
# target table's own column types) is a safe upper bound, since nothing
# above it was ever issued. One query for every table's sequence at once,
# never one per table. ---------------------------------------------------
ST_SEQUENCE_RESPONSE="$TMP_DIR/.st_sequence.json"
bc_sql_json "$SCRIPT" "$DB" "${SERVER_ARGS[@]}" "SELECT * FROM st_sequence" >"$ST_SEQUENCE_RESPONSE"
FLOORS_JSON="$TMP_DIR/.sequence-floors.json"
{
  printf '{\n'
  first=1
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    col="$(bc_wb auto-inc-column "$SELECTED_SNAPSHOT" "$table")"
    floor="$(bc_wb sequence-floor "$ST_SEQUENCE_RESPONSE" "$table" "$col")"
    [ "$first" -eq 1 ] || printf ',\n'
    first=0
    printf '  "%s": %s' "$table" "$floor"
  done <<< "$(bc_wb autoinc-tables "$SELECTED_SNAPSHOT")"
  printf '\n}\n'
} > "$FLOORS_JSON"

CLI_VERSION="$(spacetime --version 2>/dev/null | grep -oE 'spacetimedb tool version [0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo unknown)"
SNAPSHOT_SHA="$(bc_schema_sha256 "$SELECTED_SNAPSHOT")"
EXPORTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# database/exporting identity: best-effort, informational metadata only --
# `spacetime list` is the only subcommand that names both (never used for
# an authorization decision; restore-world.sh reads module_owner for that).
LIST_OUT="$(spacetime list "${SERVER_ARGS[@]}" 2>/dev/null || true)"
EXPORTING_IDENTITY="$(printf '%s' "$LIST_OUT" | grep -oE 'for user [0-9a-f]+' | awk '{print $3}')"
DATABASE_IDENTITY="$(printf '%s' "$LIST_OUT" | awk -v db="$DB" '$1 == db {print $3}')"
[ -n "$EXPORTING_IDENTITY" ] || EXPORTING_IDENTITY="unknown"
[ -n "$DATABASE_IDENTITY" ] || DATABASE_IDENTITY="unknown"

bc_wb write-manifest "$TMP_DIR/manifest.json" \
  "cli_version=$CLI_VERSION" \
  "schema_sha256=$SNAPSHOT_SHA" \
  "schema_commit=$SELECTED_LABEL" \
  "database_identity=$DATABASE_IDENTITY" \
  "exporting_identity=$EXPORTING_IDENTITY" \
  "exported_at=$EXPORTED_AT" \
  "database=$DB" \
  "tables_file=$TABLES_JSON" \
  "sequence_floors_file=$FLOORS_JSON" \
  || bc_ops_die "$SCRIPT" "could not write manifest.json"

rm -f "$DESCRIBE_JSON" "$TMP_DIR/.describe.err" "$TABLES_JSON" "$ST_SEQUENCE_RESPONSE" "$FLOORS_JSON" "$LIVE_SHAPE_FILE" "$SELECT_LOG"
rm -rf "$CANDIDATES_DIR"

trap - EXIT
# Move the previous good export aside first, and delete it only once the
# new one is fully in place -- a failed rename must never destroy a
# working export (Quentin's direction).
ASIDE=""
if [ -e "$OUT_DIR" ]; then
  ASIDE="${OUT_DIR%/}.previous.$$"
  mv "$OUT_DIR" "$ASIDE"
fi
if ! mv "$TMP_DIR" "$OUT_DIR"; then
  [ -n "$ASIDE" ] && mv "$ASIDE" "$OUT_DIR"
  bc_ops_die "$SCRIPT" "could not move $TMP_DIR into place at $OUT_DIR -- the previous export, if any, was restored"
fi
[ -n "$ASIDE" ] && rm -rf "$ASIDE"

TOTAL=0
for table in "${!ROW_COUNTS[@]}"; do TOTAL=$((TOTAL + ROW_COUNTS["$table"])); done
echo "export-world: ok -- $DB exported to $OUT_DIR ($(printf '%s\n' "$SNAPSHOT_TABLES" | wc -l | tr -d ' ') tables, $TOTAL rows, schema_commit=$SELECTED_LABEL)" >&2
exit 0
