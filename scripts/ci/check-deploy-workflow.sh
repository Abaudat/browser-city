#!/usr/bin/env bash
# `.github/workflows/deploy.yml`'s own structural guard, mechanical rather
# than trusted -- the workflow that can break the game for every player,
# run whenever `.github/workflows/**` or `scripts/ci/**` changes (the
# `scripts-tests` job, gated on the `agentic` filter, which already lists
# both paths). Quentin's cycle-1 direction (PR #288) widened this from
# "the first publishing job" to every one, and closed the hole where
# `needs: [backup]` is decoration if the job's own `if:` can still run it
# after a failed backup.
#
#   1. No destructive command or flag anywhere in the file: `--delete-
#      data`, a standalone `-c` (its short form), `--clear-database`,
#      `--break-clients`, or `spacetime delete`. A publish that can
#      delete data or break existing clients, or a step that can delete a
#      database outright, is exactly what this story exists to prevent --
#      see this workflow's own header comment for why none of these is
#      ever a legitimate need here (an additive-only schema is enforced
#      at PR time by check-schema-additive.sh, so a publish never needs
#      to force through a breaking change).
#   2. Every job that runs `spacetime publish` must `needs:` the job that
#      takes the pre-publish backup (NFR39) -- a publish step that can
#      run before or without its own backup step is the same hole this
#      story closes for the schema-additive guard, just for a *safety
#      net* instead of a *rejection*. `needs:` alone is not enough: a
#      job's own `if:` containing `always()`, `failure()` or
#      `!cancelled()` can still let it run after `backup` failed, so any
#      of those three anywhere in a publishing job's own condition (its
#      lines before `steps:`) fails too.
#   3. The `backup` job's own first-deploy exception (NFR39) is never an
#      inline `spacetime describe` -- that reads as `|| true` in disguise
#      the moment anyone widens its error handling, so it must go through
#      `scripts/ops/check-database-exists.sh`, which positively
#      recognises "not found" rather than treating any failure as one.
#
# Usage: check-deploy-workflow.sh [deploy.yml path]
#   [deploy.yml path]  defaults to .github/workflows/deploy.yml at the repo
#                       root; overridden by scripts/ci/tests/
#                       test-check-deploy-workflow.sh's own fixtures
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/deploy.yml}"

[ -f "$WORKFLOW" ] || { echo "check-deploy-workflow: $WORKFLOW not found" >&2; exit 1; }

FAILED=0

# --- no destructive command or flag -----------------------------------------
# Deliberately not comment-aware: this workflow's own comments must never
# spell out the banned flags either, so a future edit cannot copy one out
# of a "here is why we don't use X" note and land it for real.
DESTRUCTIVE_MATCHES="$(grep -nE -- '--delete-data|--clear-database|--break-clients|spacetime delete' "$WORKFLOW" || true)"
if [ -n "$DESTRUCTIVE_MATCHES" ]; then
  echo "check-deploy-workflow: FAIL -- $WORKFLOW contains a destructive command or flag (--delete-data/--clear-database/--break-clients/spacetime delete):" >&2
  echo "$DESTRUCTIVE_MATCHES" >&2
  FAILED=1
fi
SHORT_FLAG_MATCHES="$(grep -nE '(^|[^A-Za-z0-9_-])-c([[:space:]]|$)' "$WORKFLOW" || true)"
if [ -n "$SHORT_FLAG_MATCHES" ]; then
  echo "check-deploy-workflow: FAIL -- $WORKFLOW contains a standalone -c flag (--delete-data's short form) -- a publish must never delete data:" >&2
  echo "$SHORT_FLAG_MATCHES" >&2
  FAILED=1
fi

# --- every job that runs `spacetime publish` must needs: the backup job,
# and its own condition must never be able to run it after a failed one --
job_block() { # <name> -- the job's full body, from its "  <name>:" line to
              # (but not including) the next top-level "  <other>:" line.
  local name="$1"
  awk -v name="$name" '
    $0 ~ "^  " name ":$" { inblock = 1; print; next }
    inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
    inblock { print }
  ' "$WORKFLOW"
}

job_header() { # <name> -- the job's own keys (needs:/if:/runs-on:/...),
               # stopping before its `steps:` list -- never a step's own
               # `run:` body, so a legitimate `always()` inside a bash
               # script step is never mistaken for the job's condition.
  job_block "$1" | awk '/^ *steps:$/ { exit } { print }'
}

ALL_JOB_NAMES="$(awk '
  /^jobs:$/ { injobs = 1; next }
  injobs && /^[^ ]/ { injobs = 0 }
  injobs && /^  [A-Za-z0-9_-]+:$/ {
    line = $0
    sub(/^  /, "", line)
    sub(/:$/, "", line)
    print line
  }
' "$WORKFLOW")"

PUBLISH_JOBS=""
while IFS= read -r job; do
  [ -n "$job" ] || continue
  BLOCK="$(job_block "$job")"
  if printf '%s\n' "$BLOCK" | grep -qE 'spacetime publish\b'; then
    PUBLISH_JOBS="$PUBLISH_JOBS $job"
  fi
done <<< "$ALL_JOB_NAMES"
PUBLISH_JOBS="$(printf '%s' "$PUBLISH_JOBS" | xargs -n1 2>/dev/null || true)"

if [ -z "$PUBLISH_JOBS" ]; then
  echo "check-deploy-workflow: FAIL -- no job in $WORKFLOW runs 'spacetime publish'" >&2
  FAILED=1
else
  while IFS= read -r job; do
    [ -n "$job" ] || continue
    HEADER="$(job_header "$job")"

    NEEDS_LINE="$(printf '%s\n' "$HEADER" | grep -E '^ *needs:' || true)"
    if [ -z "$NEEDS_LINE" ] || ! printf '%s' "$NEEDS_LINE" | grep -qE '(^|[^A-Za-z0-9_-])backup([^A-Za-z0-9_-]|$)'; then
      echo "check-deploy-workflow: FAIL -- '$job' (which runs 'spacetime publish') does not needs: a 'backup' job -- NFR39 requires a backup before every publish" >&2
      FAILED=1
    fi

    ALWAYS_RUN_MATCH="$(printf '%s\n' "$HEADER" | grep -nE 'always\(\)|failure\(\)|!\s*cancelled\(\)' || true)"
    if [ -n "$ALWAYS_RUN_MATCH" ]; then
      echo "check-deploy-workflow: FAIL -- '$job' (which runs 'spacetime publish') has always()/failure()/!cancelled() in its own condition -- it could still run after 'backup' failed, making its needs: [backup] decorative:" >&2
      echo "$ALWAYS_RUN_MATCH" >&2
      FAILED=1
    fi
  done <<< "$PUBLISH_JOBS"
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

# --- the backup job's first-deploy exception goes through the positive
# not-found script, never an inline `spacetime describe` -----------------
BACKUP_BLOCK="$(job_block backup)"
if [ -z "$BACKUP_BLOCK" ]; then
  echo "check-deploy-workflow: FAIL -- $WORKFLOW has no 'backup:' job" >&2
  FAILED=1
else
  if printf '%s\n' "$BACKUP_BLOCK" | grep -qE 'spacetime describe\b'; then
    echo "check-deploy-workflow: FAIL -- 'backup' inlines its own 'spacetime describe' -- NFR39's first-deploy exception must go through scripts/ops/check-database-exists.sh, which positively recognises 'not found' rather than treating any failure as one" >&2
    FAILED=1
  fi
  if ! printf '%s\n' "$BACKUP_BLOCK" | grep -qF 'check-database-exists.sh'; then
    echo "check-deploy-workflow: FAIL -- 'backup' never calls scripts/ops/check-database-exists.sh -- NFR39's first-deploy exception is unguarded" >&2
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-deploy-workflow: no destructive command/flag, every publishing job needs: (and can only run after) the backup job, and the backup job's first-deploy exception is the positive not-found script" >&2
exit 0
