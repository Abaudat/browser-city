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
#   4. Neither `deploy.yml`'s `backup` job nor `backup.yml`'s `export` job
#      -- the two real callers of `scripts/ops/export-world.sh` -- may
#      have a shallow checkout (story 4.18): export-world.sh walks the
#      schema snapshot's own git history to find which committed snapshot
#      is actually live, and a shallow clone (the default
#      `actions/checkout` depth, 1) hides that history from it -- a
#      future "speed up checkout" commit in *either* file would otherwise
#      silently turn the next additive deploy's backup, or the next
#      scheduled backup, into "does not match" (Quentin's/Tim's
#      direction, cycle 1: `backup.yml`'s own `export` job has the
#      identical bug, and had no guard at all). `fetch-depth: 0` is the
#      only value this accepts, in either file.
#
# Usage: check-deploy-workflow.sh [deploy.yml path] [backup.yml path]
#   [deploy.yml path]  defaults to .github/workflows/deploy.yml at the repo
#                       root; overridden by scripts/ci/tests/
#                       test-check-deploy-workflow.sh's own fixtures
#   [backup.yml path]  defaults to .github/workflows/backup.yml the same
#                       way -- only rule 4 above reads this second file
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/deploy.yml}"
BACKUP_WORKFLOW="${2:-$REPO_ROOT/.github/workflows/backup.yml}"

[ -f "$WORKFLOW" ] || { echo "check-deploy-workflow: $WORKFLOW not found" >&2; exit 1; }
[ -f "$BACKUP_WORKFLOW" ] || { echo "check-deploy-workflow: $BACKUP_WORKFLOW not found" >&2; exit 1; }

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
job_block() { # <name> [file] -- the job's full body, from its "  <name>:"
              # line to (but not including) the next top-level
              # "  <other>:" line. [file] defaults to $WORKFLOW (deploy.
              # yml) -- rule 4 below also calls this against $BACKUP_
              # WORKFLOW (backup.yml).
  local name="$1" file="${2:-$WORKFLOW}"
  awk -v name="$name" '
    $0 ~ "^  " name ":$" { inblock = 1; print; next }
    inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
    inblock { print }
  ' "$file"
}

job_header() { # <name> -- the job's own keys (needs:/if:/runs-on:/...) and
               # their own block-scalar continuations (an `if: |` value's
               # lines), excluding the `steps:` list itself -- never a
               # step's own `run:` body, so a legitimate `always()` inside
               # a bash script step is never mistaken for the job's
               # condition. YAML mapping keys have no required order, so
               # this tracks which job-level key (4-space indent) owns
               # each following deeper-indented line, rather than simply
               # stopping at the first `steps:` line -- a job whose
               # `if:`/`needs:` happens to be written *after* its `steps:`
               # block is checked exactly the same as one written before.
  job_block "$1" | awk '
    /^    [A-Za-z0-9_-]+:/ {
      key = $0
      sub(/^    /, "", key)
      sub(/:.*/, "", key)
      in_steps = (key == "steps")
      if (!in_steps) print
      next
    }
    !in_steps { print }
  '
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

# --- story 4.18: neither export-world.sh caller's checkout may be
# shallow -- the default actions/checkout depth (1) hides the schema
# snapshot's own git history from it, and export-world.sh cannot find
# which commit is actually live without it -----------------------------
check_shallow_checkout() { # <job-name> <file>
  local job="$1" file="$2" block
  block="$(job_block "$job" "$file")"
  if [ -z "$block" ]; then
    echo "check-deploy-workflow: FAIL -- $file has no '$job:' job" >&2
    FAILED=1
    return
  fi
  # Anchored to a real YAML mapping line (only leading whitespace before
  # the key) -- never a comment: a checkout step's own comment
  # explaining *why* fetch-depth is 0 can itself contain the literal text
  # "fetch-depth: 1 (a shallow default) ...", and an unanchored grep
  # matched a comment like that ahead of the real key, parsing the rest
  # of that sentence as though it were the value (this file's own
  # regression, PR #345's first CI run against deploy.yml's checkout
  # comment).
  local line value
  line="$(printf '%s\n' "$block" | grep -E '^[[:space:]]*fetch-depth:' | head -n1 || true)"
  value="$(printf '%s' "$line" | sed -E 's/.*fetch-depth:[[:space:]]*//')"
  if [ -z "$line" ] || [ "$value" != "0" ]; then
    echo "check-deploy-workflow: FAIL -- '$job' job's checkout in $file is shallow (fetch-depth: ${value:-1, the actions/checkout default}) -- scripts/ops/export-world.sh needs the schema snapshot's full git history to find which commit is actually live (story 4.18); use fetch-depth: 0" >&2
    FAILED=1
  fi
}
check_shallow_checkout backup "$WORKFLOW"
check_shallow_checkout export "$BACKUP_WORKFLOW"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-deploy-workflow: no destructive command/flag, every publishing job needs: (and can only run after) the backup job, the backup job's first-deploy exception is the positive not-found script, and neither deploy.yml's backup job nor backup.yml's export job has a shallow checkout" >&2
exit 0
