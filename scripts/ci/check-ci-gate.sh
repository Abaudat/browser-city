#!/usr/bin/env bash
# The `ci` aggregate job's actual gate decision, moved out of YAML.
# `ci.yml`'s inline expression used to treat `skipped` as failure, and
# rightly so -- a required check silently becoming decorative is how a
# path-filtered pipeline rots. So this passes a job only when it either
# succeeded, or was skipped because *its own* `changes` filter said the
# paths it cares about did not change.
#
# The job-to-filter mapping is not a hand-maintained table living only in
# this script (that mirror drifting apart from ci.yml is exactly the
# failure that makes a skip invisible): it is derived from ci.yml itself,
# every run. For each job named in the `ci` job's own `needs:` list (other
# than `changes`), this greps that job's block for the one
# `needs.changes.outputs.<filter>` reference its `if:` uses -- a grep, not
# a YAML parser, which is all `if:` ever needs (even e2e's compound
# condition contains exactly one such reference). A job in `needs:` with
# no such reference, or more than one distinct one, fails closed rather
# than guessing.
#
# Usage: check-ci-gate.sh <needs-json> <changes-json> [workflow-file]
#   <needs-json>    ${{ toJSON(needs) }} -- {"<job>": {"result": "success"|"skipped"|"failure"|"cancelled"}, ...}
#   <changes-json>  ${{ toJSON(needs.changes.outputs) }} -- {"<filter>": "true"|"false", ...}
#   [workflow-file] defaults to .github/workflows/ci.yml at the repo root
set -euo pipefail

NEEDS_JSON="${1:-}"
CHANGES_JSON="${2:-}"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${3:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -n "$NEEDS_JSON" ] || { echo "check-ci-gate: missing <needs-json> argument" >&2; exit 1; }
[ -n "$CHANGES_JSON" ] || { echo "check-ci-gate: missing <changes-json> argument" >&2; exit 1; }
[ -f "$WORKFLOW" ] || { echo "check-ci-gate: $WORKFLOW not found" >&2; exit 1; }

echo "$NEEDS_JSON" | jq -e . >/dev/null 2>&1 || { echo "check-ci-gate: <needs-json> does not parse as JSON" >&2; exit 1; }
echo "$CHANGES_JSON" | jq -e . >/dev/null 2>&1 || { echo "check-ci-gate: <changes-json> does not parse as JSON" >&2; exit 1; }

FAILED=0

# --- extract a named job's block: from its "  <name>:" line up to (but
# not including) the next top-level "  <other>:" line, or EOF. -----------
job_block() {
  local name="$1"
  awk -v name="$name" '
    $0 ~ "^  " name ":$" { inblock = 1; print; next }
    inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
    inblock { print }
  ' "$WORKFLOW"
}

# --- the `ci` job's own `needs:` list, as a flow sequence on one line ----
CI_BLOCK="$(job_block ci)"
if [ -z "$CI_BLOCK" ]; then
  echo "check-ci-gate: FAIL -- $WORKFLOW has no 'ci:' job" >&2
  exit 1
fi
NEEDS_LINE="$(printf '%s\n' "$CI_BLOCK" | grep -E '^ *needs: *\[.*\] *$' || true)"
if [ -z "$NEEDS_LINE" ]; then
  echo "check-ci-gate: FAIL -- could not find 'needs: [...]' as a single-line flow list in the 'ci:' job of $WORKFLOW" >&2
  exit 1
fi
WORKFLOW_JOBS="$(printf '%s' "$NEEDS_LINE" | sed -E 's/^ *needs: *\[(.*)\] *$/\1/' | tr ',' '\n' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"

# --- derive JOB_FILTER from each job's own if: -----------------------------
declare -A JOB_FILTER
while IFS= read -r job; do
  [ -n "$job" ] || continue
  [ "$job" = "changes" ] && continue
  BLOCK="$(job_block "$job")"
  if [ -z "$BLOCK" ]; then
    echo "check-ci-gate: FAIL -- $WORKFLOW's 'ci:' job needs '$job', but there is no '$job:' job block" >&2
    FAILED=1
    continue
  fi
  # `|| true`: zero matches (a job with no filter reference at all) makes
  # grep exit 1, which -- inside a pipeline, under `pipefail` -- would
  # otherwise abort the script right here instead of reaching the
  # FILTER_COUNT==0 diagnostic below.
  FILTERS="$(printf '%s\n' "$BLOCK" | grep -oE 'needs\.changes\.outputs\.[A-Za-z0-9_-]+' | sed -E 's/^needs\.changes\.outputs\.//' | sort -u || true)"
  FILTER_COUNT="$(printf '%s\n' "$FILTERS" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$FILTER_COUNT" -eq 0 ]; then
    echo "check-ci-gate: FAIL -- job '$job' has no 'needs.changes.outputs.<filter>' reference in its block -- it cannot be gated" >&2
    FAILED=1
  elif [ "$FILTER_COUNT" -gt 1 ]; then
    echo "check-ci-gate: FAIL -- job '$job' references more than one changes filter (${FILTERS//$'\n'/, }) -- ambiguous" >&2
    FAILED=1
  else
    JOB_FILTER["$job"]="$FILTERS"
  fi
done <<< "$WORKFLOW_JOBS"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

# --- the `changes` job itself gates every other job above -- it has no
# filter of its own and must simply have succeeded. ------------------------
CHANGES_RESULT="$(echo "$NEEDS_JSON" | jq -r '.changes.result // "missing"')"
if [ "$CHANGES_RESULT" != "success" ]; then
  echo "check-ci-gate: FAIL -- 'changes' did not succeed (result: '$CHANGES_RESULT')" >&2
  FAILED=1
fi

# --- every job the workflow's own needs: list names must appear in the
# runtime needs-json, and vice versa: a job in needs-json that the derived
# mapping does not know about is exactly the hole this script exists to
# close (added to ci.yml's needs: but never wired an if:, or a stale
# runtime blob from a different workflow shape). -----------------------
while IFS= read -r job; do
  [ -n "$job" ] || continue
  [ "$job" = "changes" ] && continue
  if ! echo "$NEEDS_JSON" | jq -e --arg j "$job" 'has($j)' >/dev/null 2>&1; then
    echo "check-ci-gate: FAIL -- needs-json has no entry for job '$job' (named in ci.yml's 'ci:' job needs:)" >&2
    FAILED=1
  fi
done <<< "$WORKFLOW_JOBS"

# `tr -d '\r'` guards against a jq build that emits CRLF on some hosts --
# harmless on any host that doesn't.
for job in $(echo "$NEEDS_JSON" | jq -r 'keys[]' | tr -d '\r'); do
  [ "$job" = "changes" ] && continue
  filter="${JOB_FILTER[$job]:-}"
  if [ -z "$filter" ]; then
    echo "check-ci-gate: FAIL -- needs-json has job '$job', which is neither 'changes' nor a job ci.yml's 'ci:' needs: gates on a changes filter" >&2
    FAILED=1
    continue
  fi

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
