#!/usr/bin/env bash
# Guards the determinism golden itself: if tests/goldens/*.golden changed in
# this PR, sim::rng::RNG_VERSION must have changed too -- a golden that moves
# without a version bump means "generation output moved" went unnoticed,
# which is exactly what the determinism harness exists to catch.
#
# Only meaningful with a base to diff against (a pull request); on push to
# master there is nothing to compare against a predecessor commit that
# wasn't already checked as a PR, so this is a no-op there.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BASE="${1:-${GITHUB_BASE_REF:+origin/$GITHUB_BASE_REF}}"

if [ -z "$BASE" ]; then
  echo "check-golden-version-bump: no base ref given (not a PR) -- skipping" >&2
  exit 0
fi

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "check-golden-version-bump: base ref '$BASE' not found -- skipping" >&2
  exit 0
fi

MERGE_BASE="$(git merge-base "$BASE" HEAD)"

CHANGED_GOLDENS="$(git diff --name-only "$MERGE_BASE" HEAD -- 'server/sim/tests/goldens/*.golden')"
if [ -z "$CHANGED_GOLDENS" ]; then
  echo "check-golden-version-bump: no golden changed -- nothing to guard" >&2
  exit 0
fi

CHANGED_RNG_VERSION="$(git diff --name-only "$MERGE_BASE" HEAD -- 'server/sim/src/rng.rs')"
if [ -z "$CHANGED_RNG_VERSION" ]; then
  echo "check-golden-version-bump: FAIL -- golden(s) changed with no RNG_VERSION bump:" >&2
  printf '%s\n' "$CHANGED_GOLDENS" >&2
  exit 1
fi

# rng.rs changed -- confirm the RNG_VERSION line itself, not just some other
# part of the file, actually moved.
if git diff "$MERGE_BASE" HEAD -- 'server/sim/src/rng.rs' | grep -qE '^[+-]pub const RNG_VERSION'; then
  echo "check-golden-version-bump: golden changed alongside an RNG_VERSION bump -- ok" >&2
  exit 0
fi

echo "check-golden-version-bump: FAIL -- golden(s) changed but RNG_VERSION did not:" >&2
printf '%s\n' "$CHANGED_GOLDENS" >&2
exit 1
