#!/usr/bin/env bash
# Story 1.2's AC3, proven against the platform itself rather than inferred
# from reading the macro's rules: brings up a disposable local SpacetimeDB
# instance, publishes `tests/fixtures/migration_v1`, inserts one row (so
# the database is not empty -- this is "does a live world survive it", not
# "does an empty one"), then republishes over that same database with
# neither `--delete-data` nor a clear flag:
#   - `migration_v2_good` (adds a column with #[default(...)]) must succeed
#     and the row inserted under v1 must still be there.
#   - `migration_v2_bad` (adds a column with neither a default nor
#     #[auto_inc]) must fail with the automigration rejection SpacetimeDB
#     itself emits, and the row inserted under v1 must still be there.
# Then publishes the real module and proves `reseed_codes` is idempotent
# (calling it a second time changes no companion table's row count) --
# `browser_city` has no native tests, so this is the only place that claim
# is ever exercised against a running module.
# Every failure path below aborts loudly and immediately rather than
# folding into a pass/fail count: a missing `spacetime` binary, a port
# already in use, a fixture that fails to compile, a mistyped database
# name and an actual rejected automigration must never be indistinguishable
# from each other, or this script protects nothing (Quentin/Tim's review
# of PR #268).
#
# Runs in CI's own `migrate` job (ci.yml), gated on the `server` changes
# filter and `needs: build` so a module that does not compile never spins
# an instance.
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURES="$REPO_ROOT/server/tests/fixtures"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-live-migration.XXXXXX")"
PORT=3987
SERVER_URL="http://127.0.0.1:$PORT"
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1
# The exact substring SpacetimeDB 2.9 prints when a publish is rejected for
# requiring a manual migration -- the one piece of evidence that
# distinguishes "NFR33 held" from "something else went wrong".
REJECTION_PATTERN="Aborting because publishing would require manual migration"

START_PID=""

cleanup() {
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-live-migration: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

# The struct's field list, trimmed -- the one part of the fixture that a
# "differs only by the column under test" claim is actually about.
# `rustfmt` reflows the reducer body's `insert(FixtureRow { ... })` call
# once a third field no longer fits one line, so the body is deliberately
# not compared here: that reflow is a formatting artefact of adding the
# field, not a drift in what the fixture tests.
extract_fields() { # <lib.rs>
  awk '/pub struct FixtureRow/ { flag=1; next } flag && /^}/ { exit } flag { print }' "$1" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    | grep -v '^$'
}

# assert_pure_addition <label> <v1 lib.rs> <v2 lib.rs> -- the two v2
# fixtures are only meaningful as "v1 plus the column under test"; nothing
# enforced that by construction, so this enforces it by diff: every field
# declared in v1 must still be declared, unchanged, in v2, and the
# reducer's own signature must not have moved either.
assert_pure_addition() {
  local label="$1" old="$2" new="$3" removed
  removed="$(diff <(extract_fields "$old") <(extract_fields "$new") | grep -c '^<' || true)"
  if [ "$removed" -ne 0 ]; then
    echo "check-live-migration: FAIL -- $label's fixture_row loses or changes a field migration_v1 declared:" >&2
    diff <(extract_fields "$old") <(extract_fields "$new") >&2 || true
    exit 1
  fi
  if ! grep -qxF "$(grep '^pub fn add_fixture_row' "$old")" "$new"; then
    echo "check-live-migration: FAIL -- $label's add_fixture_row signature differs from migration_v1's" >&2
    exit 1
  fi
}

assert_pure_addition "migration_v2_good" "$FIXTURES/migration_v1/src/lib.rs" "$FIXTURES/migration_v2_good/src/lib.rs"
assert_pure_addition "migration_v2_bad" "$FIXTURES/migration_v1/src/lib.rs" "$FIXTURES/migration_v2_bad/src/lib.rs"

spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$PORT" >"$START_LOG" 2>&1 &
START_PID=$!

deadline=$((SECONDS + HEALTH_DEADLINE_S))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -sf -o /dev/null "$SERVER_URL/v1/ping"; then
    healthy=1
    break
  fi
  sleep "$POLL_INTERVAL_S"
done
[ "$healthy" -eq 1 ] || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

publish() { # <module-dir> <db-name> <log-file>
  spacetime publish --server "$SERVER_URL" --no-config -y "$2" --module-path "$1" >"$3" 2>&1
}

insert_a_row() { # <db-name> -- a failed call is a hard, immediate failure,
                 # never folded into "the world had no data to lose".
  local log="$DATA_DIR/insert-$1.log"
  spacetime call "$1" --server "$SERVER_URL" --no-config -y add_fixture_row '"seed"' >"$log" 2>&1 \
    || fail "could not insert the seed row into '$1'" "$log"
}

row_count() { # <db-name> <table> -- a failed query is a hard, immediate
              # failure, never silently read as zero rows (row_count's 0
              # must mean "queried and found none", not "could not ask").
  local log="$DATA_DIR/sql-$1-$2.log"
  spacetime sql "$1" --server "$SERVER_URL" --no-config -y "SELECT * FROM $2" >"$log" 2>&1 \
    || fail "could not query '$1' for $2" "$log"
  grep -cE '^ [0-9]+ ' "$log"
}

echo "check-live-migration: positive case -- appending a column with a default must succeed" >&2
publish "$FIXTURES/migration_v1" bc-live-migration-good "$DATA_DIR/good-v1.log" \
  || fail "could not publish the baseline fixture (good)" "$DATA_DIR/good-v1.log"
insert_a_row bc-live-migration-good
BEFORE="$(row_count bc-live-migration-good fixture_row)"
[ "$BEFORE" -ge 1 ] || fail "seeded row did not land -- this would validate an empty world surviving, not a live one" "$DATA_DIR/insert-bc-live-migration-good.log"

if publish "$FIXTURES/migration_v2_good" bc-live-migration-good "$DATA_DIR/good-v2.log"; then
  AFTER="$(row_count bc-live-migration-good fixture_row)"
  [ "$AFTER" = "$BEFORE" ] || fail "row count changed across a same-data migration ($BEFORE -> $AFTER)" "$DATA_DIR/good-v2.log"
  echo "check-live-migration: ok -- publish succeeded, $AFTER row(s) survived. What the platform did:" >&2
  grep -E 'Created column|Updated database|Publishing module' "$DATA_DIR/good-v2.log" >&2 || cat "$DATA_DIR/good-v2.log" >&2
else
  fail "publishing a column with a default was rejected" "$DATA_DIR/good-v2.log"
fi

echo "check-live-migration: negative case -- appending a column with no default must fail loudly" >&2
publish "$FIXTURES/migration_v1" bc-live-migration-bad "$DATA_DIR/bad-v1.log" \
  || fail "could not publish the baseline fixture (bad)" "$DATA_DIR/bad-v1.log"
insert_a_row bc-live-migration-bad
BEFORE_BAD="$(row_count bc-live-migration-bad fixture_row)"
[ "$BEFORE_BAD" -ge 1 ] || fail "seeded row did not land" "$DATA_DIR/insert-bc-live-migration-bad.log"

if publish "$FIXTURES/migration_v2_bad" bc-live-migration-bad "$DATA_DIR/bad-v2.log"; then
  fail "publishing a column with no default and no #[auto_inc] was accepted; it must be rejected" "$DATA_DIR/bad-v2.log"
fi
if ! grep -qF "$REJECTION_PATTERN" "$DATA_DIR/bad-v2.log"; then
  fail "publish failed, but not for the reason NFR33 requires -- expected to find '$REJECTION_PATTERN'" "$DATA_DIR/bad-v2.log"
fi
MATCHED_LINE="$(grep -F "$REJECTION_PATTERN" "$DATA_DIR/bad-v2.log" | head -n1)"
AFTER_BAD="$(row_count bc-live-migration-bad fixture_row)"
[ "$AFTER_BAD" = "$BEFORE_BAD" ] || fail "row count changed across a rejected migration ($BEFORE_BAD -> $AFTER_BAD) -- a rejected publish must not touch data" "$DATA_DIR/bad-v2.log"
echo "check-live-migration: ok -- publish was rejected, $AFTER_BAD row(s) intact. What the platform said:" >&2
echo "  $MATCHED_LINE" >&2

echo "check-live-migration: reseed_codes must be idempotent -- proven nowhere else, since browser_city has no native tests" >&2
publish "$REPO_ROOT/server" bc-live-migration-codes "$DATA_DIR/codes-v1.log" \
  || fail "could not publish the real module" "$DATA_DIR/codes-v1.log"

CODE_TABLES="matter_kind provision reason_code node_kind"
declare -A BEFORE_COUNT
for table in $CODE_TABLES; do
  count="$(row_count bc-live-migration-codes "$table")"
  [ "$count" -ge 1 ] || fail "table '$table' has no rows right after publish -- init's seed_all_codes did not run" "$DATA_DIR/codes-v1.log"
  BEFORE_COUNT["$table"]="$count"
done

spacetime call bc-live-migration-codes --server "$SERVER_URL" --no-config -y reseed_codes >"$DATA_DIR/reseed.log" 2>&1 \
  || fail "reseed_codes itself failed" "$DATA_DIR/reseed.log"

for table in $CODE_TABLES; do
  after="$(row_count bc-live-migration-codes "$table")"
  [ "$after" = "${BEFORE_COUNT[$table]}" ] || fail "table '$table' row count changed across a re-seed (${BEFORE_COUNT[$table]} -> $after) -- seed_all_codes is not idempotent" "$DATA_DIR/reseed.log"
done
echo "check-live-migration: ok -- reseed_codes changed nothing on a second call, across all four companion tables" >&2

echo "check-live-migration: both halves of AC3 hold against a real SpacetimeDB instance" >&2
exit 0
