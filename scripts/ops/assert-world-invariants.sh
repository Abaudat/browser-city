#!/usr/bin/env bash
# Asserts a published world is consistent, read-only, via `spacetime sql`:
#   - every one-row table (u8 primary key `id`, per server/schema.snapshot.json:
#     module_owner, world_clock; not restore_state, see below) holds exactly one row;
#   - every scheduled table the module arms for real (the `arm_schedule!`
#     invocations in server/src/tables/schedules.rs) holds exactly one pending row;
#   - every extensible-set table (CODE_TABLES) holds at least one row;
#   - cadence_liveness, only if it already has rows, has fires >= 1 in each.
# Used by scripts/ci/check-deploy-rehearsal.sh against a local instance and
# by `deploy.yml`'s `publish-module` job against Maincloud, as its last step.
#
# Usage: assert-world-invariants.sh <db> --server <server>
set -uo pipefail

# Every table `seed_all_codes` seeds; scripts/ci/check-live-migration.sh
# keeps this list honest against the source.
CODE_TABLES="matter_kind provision reason_code node_kind unit layer_code"

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SNAPSHOT="$REPO_ROOT/server/schema.snapshot.json"
SCHEDULES_RS="$REPO_ROOT/server/src/tables/schedules.rs"

USAGE="usage: assert-world-invariants.sh <db> --server <server>"
DB="${1:-}"
[ -n "$DB" ] || { echo "assert-world-invariants: $USAGE" >&2; exit 1; }
[ "${2:-}" = "--server" ] && [ -n "${3:-}" ] && [ "$#" -eq 3 ] || { echo "assert-world-invariants: $USAGE" >&2; exit 1; }
SERVER="$3"

command -v spacetime >/dev/null 2>&1 || { echo "assert-world-invariants: 'spacetime' is not on PATH" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "assert-world-invariants: 'jq' is not on PATH" >&2; exit 1; }

FAILED=0
bad() { echo "assert-world-invariants: FAIL -- $1" >&2; FAILED=1; }

rows() { # <sql> -- prints the data rows; a failed query is a hard failure
  local out
  out="$(spacetime sql "$DB" --server "$SERVER" --no-config -y "$1" 2>&1)" \
    || { echo "assert-world-invariants: FAIL -- could not run '$1' against '$DB':" >&2; echo "$out" >&2; exit 1; }
  printf '%s\n' "$out" | awk '/^[- +]+$/ { seen=1; next } seen && NF'
}

count() { # <table>
  rows "SELECT * FROM $1" | grep -c . || true
}

# restore_state is the restore gate, written lazily by begin_restore: absent
# from a world that never restored.
ONE_ROW_TABLES="$(jq -r '.tables[] | select(any(.columns[]; .name == "id" and .ty == "u8" and .primary_key)) | .accessor' "$SNAPSHOT" | grep -vx restore_state)"
[ -n "$ONE_ROW_TABLES" ] || { echo "assert-world-invariants: FAIL -- found no one-row table in $SNAPSHOT" >&2; exit 1; }
ARMED_TABLES="$(sed -n '/^arm_schedule!(/{n;n;s/^[[:space:]]*\([a-z_]*\),.*/\1/p}' "$SCHEDULES_RS")"
[ -n "$ARMED_TABLES" ] || { echo "assert-world-invariants: FAIL -- found no arm_schedule! invocation in $SCHEDULES_RS" >&2; exit 1; }

for t in $ONE_ROW_TABLES; do
  n="$(count "$t")"
  [ "$n" -eq 1 ] || bad "one-row table '$t' holds $n row(s), expected exactly 1"
done
for t in $ARMED_TABLES; do
  n="$(count "$t")"
  [ "$n" -eq 1 ] || bad "scheduled table '$t' holds $n pending row(s), expected exactly 1 -- the cadence is not armed"
done
for t in $CODE_TABLES; do
  n="$(count "$t")"
  [ "$n" -ge 1 ] || bad "code table '$t' is empty"
done

LIVENESS="$(rows "SELECT fires FROM cadence_liveness")"
if [ -n "$LIVENESS" ]; then
  while read -r fires; do
    [ "${fires:-0}" -ge 1 ] 2>/dev/null || bad "cadence_liveness holds a row with fires=$fires, expected >= 1"
  done <<<"$LIVENESS"
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "assert-world-invariants: '$DB' is consistent ($(echo $ONE_ROW_TABLES), $(echo $ARMED_TABLES), code tables)" >&2
