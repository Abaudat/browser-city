#!/usr/bin/env bash
# `.github/workflows/explore.yml`'s structural guard (story 4.21): the
# property suite with a fresh seed, off the deploy path. It must stay
# weekly/manual only -- a `push` or `pull_request` trigger would put a
# random seed back on the gate NFR50 made deterministic. Comment lines are
# ignored.
#
#   1. `schedule` (with a `cron`) and `workflow_dispatch`, and no `push`,
#      `pull_request` or `pull_request_target` trigger.
#   2. `PROPTEST_RNG_SEED` is set, and echoed to the log.
#   3. A failure files its issue through `report-scheduled-failure.sh`
#      (`if: failure() || cancelled()`), never inline `gh issue create`.
#   4. The client job (story 6.17): `FAST_CHECK_SEED` is derived from
#      `github.run_id`, never a literal, echoed, and reported through
#      `report-scheduled-failure.sh` under `failure() || cancelled()` by a job
#      of its own, so neither half hides the other.
#   5. No `environment:` and no `secrets.` reference.
#
# Usage: check-explore-workflow.sh [explore.yml path]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/explore.yml}"
[ -f "$WORKFLOW" ] || { echo "check-explore-workflow: $WORKFLOW not found" >&2; exit 1; }

FAILED=0
fail() { echo "check-explore-workflow: FAIL -- $1" >&2; FAILED=1; }

CODE="$(sed 's/\r$//' "$WORKFLOW" | grep -vE '^[[:space:]]*#' || true)"
has() { printf '%s\n' "$CODE" | grep -qE -- "$1"; }

has '^  schedule:' && has '^    - cron: ' || fail "no \`schedule:\` trigger with a \`cron:\`"
has '^  workflow_dispatch:' || fail "no \`workflow_dispatch:\` trigger"
has '^  (push|pull_request|pull_request_target|workflow_run):' && fail "triggers on push/pull_request/workflow_run -- it must never run on the deploy path"
has 'PROPTEST_RNG_SEED:' || fail "does not set PROPTEST_RNG_SEED"
has 'echo .*PROPTEST_RNG_SEED' || fail "does not echo PROPTEST_RNG_SEED to the log"
has 'report-scheduled-failure\.sh' || fail "never calls scripts/ci/report-scheduled-failure.sh"
has 'failure\(\)' || fail "the report step is not gated on failure()"
has 'FAST_CHECK_SEED=.*\$\{\{ github\.run_id \}\}' || fail "FAST_CHECK_SEED is not set from github.run_id (a literal would never explore)"
has 'echo .*FAST_CHECK_SEED' || fail "does not echo FAST_CHECK_SEED to the log"
has '^  explore-client:' || fail "no explore-client job of its own"
CLIENT_JOB="$(printf '%s\n' "$CODE" | awk '/^  explore-client:/ { on = 1; print; next } on && /^  [A-Za-z0-9_-]+:/ { on = 0 } on { print }')"
printf '%s\n' "$CLIENT_JOB" | grep -qE 'report-scheduled-failure\.sh' || fail "the explore-client job never calls report-scheduled-failure.sh"
printf '%s\n' "$CLIENT_JOB" | grep -qE 'failure\(\) \|\| cancelled\(\)' || fail "the explore-client report step is not gated on failure() || cancelled()"
printf '%s\n' "$CLIENT_JOB" | grep -qE 'FAST_CHECK_SEED' || fail "the explore-client job never uses FAST_CHECK_SEED"
has 'gh issue create' && fail "files an issue inline (gh issue create)"
has '^    environment:' && fail "declares an environment -- it needs none"
has 'secrets\.' && fail "references a secret -- it needs none"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-explore-workflow: $WORKFLOW is scheduled/manual only, seeded from the log and reports failures (story 4.21)" >&2
exit 0
