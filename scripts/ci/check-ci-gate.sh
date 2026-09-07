#!/usr/bin/env bash
# The `ci` aggregate job's actual gate decision, moved out of YAML.
# `ci.yml`'s inline expression used to treat `skipped` as failure, and
# rightly so -- a required check silently becoming decorative is how a
# path-filtered pipeline rots. So this passes a job only when it either
# succeeded, or was skipped because *its own* `changes` filter said the
# paths it cares about did not change. A job that is skipped for any other
# reason (cancelled upstream, a filter that says it should have run) still
# fails the gate.
#
# Usage: check-ci-gate.sh <needs-json> <changes-json>
#   <needs-json>    ${{ toJSON(needs) }} -- {"<job>": {"result": "success"|"skipped"|"failure"|"cancelled"}, ...}
#   <changes-json>  ${{ toJSON(needs.changes.outputs) }} -- {"<filter>": "true"|"false", ...}
set -euo pipefail

NEEDS_JSON="${1:-}"
CHANGES_JSON="${2:-}"

[ -n "$NEEDS_JSON" ] || { echo "check-ci-gate: missing <needs-json> argument" >&2; exit 1; }
[ -n "$CHANGES_JSON" ] || { echo "check-ci-gate: missing <changes-json> argument" >&2; exit 1; }

echo "$NEEDS_JSON" | jq -e . >/dev/null 2>&1 || { echo "check-ci-gate: <needs-json> does not parse as JSON" >&2; exit 1; }
echo "$CHANGES_JSON" | jq -e . >/dev/null 2>&1 || { echo "check-ci-gate: <changes-json> does not parse as JSON" >&2; exit 1; }

# Every gated job's own path-filter, by name in `changes-json`. Kept in
# lockstep by hand with each job's `if:` in ci.yml -- there is no way to
# read a workflow's own `if:` expressions back out of `toJSON(needs)`, so
# this is the one place that mapping is written down for the gate to check
# against.
declare -A JOB_FILTER=(
  [scripts-tests]=agentic
  [check]=server
  [test]=server
  [build]=server
  [coverage]=server
  [client-check]=client
  [client-build]=client
  [e2e]=e2e
)

FAILED=0

# The `changes` job itself gates every other job above -- it has no filter
# of its own and must simply have succeeded.
CHANGES_RESULT="$(echo "$NEEDS_JSON" | jq -r '.changes.result // "missing"')"
if [ "$CHANGES_RESULT" != "success" ]; then
  echo "check-ci-gate: FAIL -- 'changes' did not succeed (result: '$CHANGES_RESULT')" >&2
  FAILED=1
fi

for job in "${!JOB_FILTER[@]}"; do
  filter="${JOB_FILTER[$job]}"
  result="$(echo "$NEEDS_JSON" | jq -r --arg j "$job" '.[$j].result // "missing"')"
  changed="$(echo "$CHANGES_JSON" | jq -r --arg f "$filter" '.[$f] // "missing"')"

  case "$result" in
    success) ;;
    skipped)
      if [ "$changed" = "false" ]; then
        : # correctly gated off -- its filter said no relevant path changed
      else
        echo "check-ci-gate: FAIL -- '$job' was skipped but its filter '$filter' reports '$changed' (expected 'false' to explain the skip)" >&2
        FAILED=1
      fi
      ;;
    missing)
      echo "check-ci-gate: FAIL -- needs-json has no entry for job '$job'" >&2
      FAILED=1
      ;;
    *)
      echo "check-ci-gate: FAIL -- '$job' did not succeed (result: '$result')" >&2
      FAILED=1
      ;;
  esac
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-ci-gate: every job succeeded or was correctly gated off" >&2
exit 0
