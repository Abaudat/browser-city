#!/usr/bin/env bash
# `.github/workflows/deploy.yml`'s own structural guard, mechanical rather
# than trusted -- the workflow that can break the game for every player,
# run whenever `.github/workflows/**` or `scripts/ci/**` changes (the
# `scripts-tests` job, gated on the `agentic` filter, which already lists
# both paths). Two things, both failures the workflow must never carry:
#
#   1. No destructive publish flag anywhere in the file: `--delete-data`,
#      a standalone `-c` (its short form), `--clear-database` or
#      `--break-clients`. A publish that can delete data or break
#      existing clients is exactly what this story exists to prevent --
#      see this workflow's own header comment for why none of the three
#      is ever a legitimate need here (an additive-only schema is
#      enforced at PR time by check-schema-additive.sh, so a publish never
#      needs to force through a breaking change).
#   2. Whichever job actually runs `spacetime publish` must `needs:` the
#      job that takes the pre-publish backup (NFR39) -- a publish step
#      that can run before or without its own backup step is the same
#      hole this story closes for the schema-additive guard, just for a
#      *safety net* instead of a *rejection*.
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

# --- no destructive publish flag --------------------------------------------
# Deliberately not comment-aware: this workflow's own comments must never
# spell out the banned flags either, so a future edit cannot copy one out
# of a "here is why we don't use X" note and land it for real.
DESTRUCTIVE_MATCHES="$(grep -nE -- '--delete-data|--clear-database|--break-clients' "$WORKFLOW" || true)"
if [ -n "$DESTRUCTIVE_MATCHES" ]; then
  echo "check-deploy-workflow: FAIL -- $WORKFLOW contains a destructive publish flag (--delete-data/--clear-database/--break-clients) -- a publish must never delete data or break clients:" >&2
  echo "$DESTRUCTIVE_MATCHES" >&2
  FAILED=1
fi
SHORT_FLAG_MATCHES="$(grep -nE '(^|[^A-Za-z0-9_-])-c([[:space:]]|$)' "$WORKFLOW" || true)"
if [ -n "$SHORT_FLAG_MATCHES" ]; then
  echo "check-deploy-workflow: FAIL -- $WORKFLOW contains a standalone -c flag (--delete-data's short form) -- a publish must never delete data:" >&2
  echo "$SHORT_FLAG_MATCHES" >&2
  FAILED=1
fi

# --- the job that runs `spacetime publish` must needs: the backup job ------
job_block() { # <name>
  local name="$1"
  awk -v name="$name" '
    $0 ~ "^  " name ":$" { inblock = 1; print; next }
    inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
    inblock { print }
  ' "$WORKFLOW"
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

PUBLISH_JOB=""
while IFS= read -r job; do
  [ -n "$job" ] || continue
  BLOCK="$(job_block "$job")"
  if printf '%s\n' "$BLOCK" | grep -qE 'spacetime publish\b'; then
    PUBLISH_JOB="$job"
    break
  fi
done <<< "$ALL_JOB_NAMES"

if [ -z "$PUBLISH_JOB" ]; then
  echo "check-deploy-workflow: FAIL -- no job in $WORKFLOW runs 'spacetime publish'" >&2
  FAILED=1
else
  PUBLISH_BLOCK="$(job_block "$PUBLISH_JOB")"
  NEEDS_LINE="$(printf '%s\n' "$PUBLISH_BLOCK" | grep -E '^ *needs:' || true)"
  if [ -z "$NEEDS_LINE" ] || ! printf '%s' "$NEEDS_LINE" | grep -qE '(^|[^A-Za-z0-9_-])backup([^A-Za-z0-9_-]|$)'; then
    echo "check-deploy-workflow: FAIL -- '$PUBLISH_JOB' (which runs 'spacetime publish') does not needs: a 'backup' job -- NFR39 requires a backup before every publish" >&2
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-deploy-workflow: no destructive publish flag, and the publish job needs: the backup job" >&2
exit 0
