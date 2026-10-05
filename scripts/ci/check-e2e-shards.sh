#!/usr/bin/env bash
# NFR49: the `e2e` job is N Playwright shards, and nothing silently skips a
# slice of the specs. Greps ci.yml (no YAML parser), like check-ci-gate.sh.
# Usage: check-e2e-shards.sh [workflow-file] [playwright-config]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="${1:-$REPO_ROOT/.github/workflows/ci.yml}"
CONFIG="${2:-$REPO_ROOT/client/playwright.config.ts}"
. "$REPO_ROOT/scripts/ci/lib/workflow-job.sh"

FAILED=0
fail() { echo "check-e2e-shards: FAIL -- $*" >&2; FAILED=1; }

[ -f "$WORKFLOW" ] || { echo "check-e2e-shards: $WORKFLOW not found" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "check-e2e-shards: $CONFIG not found" >&2; exit 1; }

E2E="$(workflow_job_block "$WORKFLOW" e2e)"
PERF="$(workflow_job_block "$WORKFLOW" e2e-perf)"
code() { grep -vE '^[[:space:]]*#' || true; }

[ -n "$E2E" ] || { echo "check-e2e-shards: FAIL -- no 'e2e:' job" >&2; exit 1; }
[ -n "$PERF" ] || fail "no 'e2e-perf:' job (perf and the deploy-smoke rehearsal run there, never behind a shard)"

# matrix is exactly 1..N, N >= 2, and --shard uses the same N
LIST="$(printf '%s\n' "$E2E" | code | sed -nE 's/^ *shard: *\[(.*)\] *$/\1/p' | head -1 | tr -d ' ')"
if [ -z "$LIST" ]; then
  fail "e2e has no 'matrix.shard: [1, 2, ...]' list"
else
  N="$(printf '%s' "$LIST" | awk -F, '{print NF}')"
  EXPECT="$(seq -s, 1 "$N")"
  [ "$N" -ge 2 ] || fail "e2e matrix has $N shard(s); sharding needs at least 2"
  [ "$LIST" = "$EXPECT" ] || fail "e2e matrix is [$LIST], expected exactly [$EXPECT]"
  DENOMS="$(printf '%s\n' "$E2E" | code | grep -oE -- '--shard=\$\{\{ *matrix\.shard *\}\}/[0-9]+' | sed -E 's|.*/||' | sort -u || true)"
  if [ -z "$DENOMS" ]; then
    fail "e2e never runs '--shard=\${{ matrix.shard }}/$N'"
  elif [ "$DENOMS" != "$N" ]; then
    fail "e2e --shard denominator ($(echo $DENOMS)) is not the matrix length ($N)"
  fi
fi
if printf '%s\n' "$E2E" | code | grep -E -- '--shard=' | grep -vqE -- '--shard=\$\{\{ *matrix\.shard *\}\}/'; then
  fail "e2e has a --shard flag that is not driven by matrix.shard"
fi

printf '%s\n' "$E2E" | code | grep -qE '^ *fail-fast: *false *$' || fail "e2e strategy needs 'fail-fast: false' (every red shard must report)"

for pair in "e2e:$E2E" "e2e-perf:$PERF"; do
  name="${pair%%:*}"; block="${pair#*:}"
  [ -n "$block" ] || continue
  T="$(printf '%s\n' "$block" | code | sed -nE 's/^    timeout-minutes: *([0-9]+) *$/\1/p' | head -1)"
  if [ -z "$T" ]; then fail "$name has no job-level timeout-minutes"
  elif [ "$T" -gt 10 ]; then fail "$name timeout-minutes is $T, over 10 (raise N, never the timeout)"; fi
done

if printf '%s\n' "$E2E" | code | grep -qE 'test:e2e:perf|--project=perf|serve-for-deploy-smoke'; then
  fail "e2e runs perf or the deploy-smoke rehearsal; they belong in e2e-perf"
fi

# e2e-perf must actually run perf and the deploy-smoke rehearsal (NFR2 gate)
if [ -n "$PERF" ]; then
  printf '%s\n' "$PERF" | code | grep -q 'test:e2e:perf' || fail "e2e-perf never runs 'npm run test:e2e:perf' (NFR2 would stop gating)"
  printf '%s\n' "$PERF" | code | grep -q 'serve-for-deploy-smoke' || fail "e2e-perf never runs the deploy-smoke rehearsal (serve-for-deploy-smoke)"
fi

# every artifact name in the shard job carries the shard (v4+ rejects duplicates)
while IFS= read -r nm; do
  [ -n "$nm" ] || continue
  printf '%s' "$nm" | grep -qF 'matrix.shard' || fail "e2e artifact name '$nm' does not contain matrix.shard"
done < <(printf '%s\n' "$E2E" | code | awk '/upload-artifact/ { u = 1 } u && /^ *name:/ { sub(/^ *name: */, ""); print; u = 0 }')

grep -vE '^[[:space:]]*//' "$CONFIG" | grep -qE 'workers: *process\.env\.CI *\? *1 *:' \
  || fail "$CONFIG must keep 'workers: process.env.CI ? 1 : ...' (sharding is the parallelism)"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-e2e-shards: ok" >&2
