#!/usr/bin/env bash
# `.github/workflows/watch.yml`'s own structural guard (story 4.13, FR170),
# the check-deploy-workflow.sh pattern: a scheduled workflow is invisible to
# check-ci-gate.sh (it only reads ci.yml), so this stands in for it. Run in
# the `scripts-tests` job, which `.github/workflows/**` changes trigger.
# Comment lines are ignored throughout.
#
#   1. A `schedule` trigger (with a `cron`) and a `workflow_dispatch`.
#   2. `environment: maincloud`, and a `timeout-minutes`.
#   3. Gated on `vars.DEPLOY_ENABLED` (a notice and success while it is
#      not `true`, never a red run).
#   4. Every `secrets.*` reference is an `env:` entry (`KEY: ${{ ... }}`),
#      never interpolated into a `run:` body.
#   5. Checks the logged-in identity (`spacetime login show`) against
#      `MAINCLOUD_OWNER_IDENTITY`, and runs `storage-report.sh`.
#   6. The report step -- the one calling `report-scheduled-failure.sh` --
#      fires on `failure() || cancelled()` (a `timeout-minutes` expiry is
#      `cancelled`, NFR49), and nothing files an issue inline
#      (`gh issue create`).
#
# Usage: check-watch-workflow.sh [watch.yml path]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/watch.yml}"
[ -f "$WORKFLOW" ] || { echo "check-watch-workflow: $WORKFLOW not found" >&2; exit 1; }

FAILED=0
fail() { echo "check-watch-workflow: FAIL -- $1" >&2; FAILED=1; }

CODE="$(sed 's/\r$//' "$WORKFLOW" | grep -vE '^[[:space:]]*#' || true)"
has() { printf '%s\n' "$CODE" | grep -qE -- "$1"; }

has '^  schedule:' && has '^    - cron: ' || fail "no \`schedule:\` trigger with a \`cron:\`"
has '^  workflow_dispatch:' || fail "no \`workflow_dispatch:\` trigger"
has '^    environment: maincloud$' || fail "the job does not declare \`environment: maincloud\`"
has '^    timeout-minutes: [0-9]+$' || fail "the job has no \`timeout-minutes\`"
has 'vars\.DEPLOY_ENABLED' || fail "not gated on vars.DEPLOY_ENABLED"
has 'DEPLOY_ENABLED.*!= "true"|DEPLOY_ENABLED.*!= .true.' || fail "the DEPLOY_ENABLED gate never compares against 'true'"
has 'spacetime login show' && has 'MAINCLOUD_OWNER_IDENTITY' || fail "does not check the logged-in identity against MAINCLOUD_OWNER_IDENTITY"
has 'storage-report\.sh' || fail "never runs scripts/ops/storage-report.sh"
has 'gh issue create' && fail "files an issue inline (gh issue create) -- report-scheduled-failure.sh is the one alarm path"

# Every secret is an env: entry.
BAD_SECRETS="$(printf '%s\n' "$CODE" | grep -nE 'secrets\.' | grep -vE '^[0-9]+:[[:space:]]+[A-Z_][A-Z0-9_]*: \$\{\{ secrets\.[A-Za-z0-9_]+ \}\}[[:space:]]*$' || true)"
if [ -n "$BAD_SECRETS" ]; then
  fail "a secret is referenced outside an \`env:\` entry:
$BAD_SECRETS"
fi

# The step that calls report-scheduled-failure.sh, as one record.
REPORT_STEP="$(printf '%s\n' "$CODE" | awk '
  /^      - / { if (step ~ /report-scheduled-failure\.sh/) print step; step = "" }
  { step = step "\n" $0 }
  END { if (step ~ /report-scheduled-failure\.sh/) print step }
')"
if [ -z "$REPORT_STEP" ]; then
  fail "no step calls scripts/ci/report-scheduled-failure.sh"
else
  IF_LINE="$(printf '%s\n' "$REPORT_STEP" | grep -E '^[[:space:]]+(- )?if:' | head -n1 || true)"
  case "$IF_LINE" in
    *failure\(\)*) ;;
    *) fail "the report step's if: (\`${IF_LINE:-none}\`) does not include failure()" ;;
  esac
  case "$IF_LINE" in
    *cancelled\(\)*) ;;
    *) fail "the report step's if: (\`${IF_LINE:-none}\`) does not include cancelled() -- a timeout-minutes expiry ends the job cancelled (NFR49)" ;;
  esac
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "check-watch-workflow: $WORKFLOW is scheduled, gated, secret-safe and reports on failure() || cancelled() (story 4.13)" >&2
exit 0
