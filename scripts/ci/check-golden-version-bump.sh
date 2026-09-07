#!/usr/bin/env bash
# Guards the determinism golden itself: if a tests/goldens/rng_*.golden
# changed since the base, sim::rng::RNG_VERSION must have changed too -- a
# golden that moves without a version bump means "generation output moved"
# went unnoticed, which is exactly what the determinism harness exists to
# catch.
#
# Every golden under server/sim/tests/goldens/ must be classified here by
# name -- not just the ones this script happens to know the rule for. A
# golden matching no known prefix fails loudly ("has no permanence rule,
# add one") rather than passing by default: narrowing this script from
# every `*.golden` to `rng_*.golden` (so `codes_*.golden`, governed
# instead by check-codes-append-only.sh, stops tripping the RNG rule) must
# not silently start waving through a fourth golden named anything else.
#
# A guard that cannot resolve a base to diff against must not read as
# "nothing to guard": outside CI (a bare local run, no base given) that is a
# legitimate no-op, but inside GitHub Actions it must fail loudly instead of
# waving the run through. On a pull_request, the base is the PR's target
# branch; on push (a merge landing on master), it is the previous commit --
# there is always a real "before" to compare against once a base branch has
# history, since a push is itself a merged, already-checked PR.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

_fail_or_skip() { # <message> -- hard fail under GITHUB_ACTIONS, soft skip otherwise
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "check-golden-version-bump: FAIL -- $1" >&2
    exit 1
  fi
  echo "check-golden-version-bump: $1 -- skipping" >&2
  exit 0
}

if [ -n "${1:-}" ]; then
  BASE="$1"
elif [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  BASE="${GITHUB_BASE_REF:+origin/$GITHUB_BASE_REF}"
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  BASE="HEAD^"
else
  BASE=""
fi

[ -n "$BASE" ] || _fail_or_skip "no base ref could be resolved"
git rev-parse --verify "$BASE" >/dev/null 2>&1 || _fail_or_skip "base ref '$BASE' not found"

MERGE_BASE="$(git merge-base "$BASE" HEAD)"

CHANGED_GOLDENS="$(git diff --name-only "$MERGE_BASE" HEAD -- 'server/sim/tests/goldens/*.golden')"
if [ -z "$CHANGED_GOLDENS" ]; then
  echo "check-golden-version-bump: no golden changed -- nothing to guard" >&2
  exit 0
fi

FAILED=0
CHANGED_RNG=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  base_name="$(basename "$path")"
  case "$base_name" in
    rng_*.golden)
      CHANGED_RNG="$CHANGED_RNG
$path"
      ;;
    codes_*.golden)
      # Governed by check-codes-append-only.sh instead: renumbering or
      # renaming an existing code is caught there, and a purely-appended
      # new code is not this script's concern.
      echo "check-golden-version-bump: $path changed -- governed by check-codes-append-only.sh, not this script" >&2
      ;;
    *)
      echo "check-golden-version-bump: FAIL -- $path has no permanence rule, add one" >&2
      FAILED=1
      ;;
  esac
done <<<"$CHANGED_GOLDENS"

if [ -n "$CHANGED_RNG" ]; then
  CHANGED_RNG="$(printf '%s\n' "$CHANGED_RNG" | sed '/^$/d')"
  CHANGED_RNG_VERSION="$(git diff --name-only "$MERGE_BASE" HEAD -- 'server/sim/src/rng.rs')"
  if [ -z "$CHANGED_RNG_VERSION" ]; then
    echo "check-golden-version-bump: FAIL -- golden(s) changed with no RNG_VERSION bump:" >&2
    printf '%s\n' "$CHANGED_RNG" >&2
    FAILED=1
  # rng.rs changed -- confirm the RNG_VERSION line itself, not just some
  # other part of the file, actually moved.
  elif ! git diff "$MERGE_BASE" HEAD -- 'server/sim/src/rng.rs' | grep -qE '^[+-]pub const RNG_VERSION'; then
    echo "check-golden-version-bump: FAIL -- golden(s) changed but RNG_VERSION did not:" >&2
    printf '%s\n' "$CHANGED_RNG" >&2
    FAILED=1
  else
    echo "check-golden-version-bump: golden changed alongside an RNG_VERSION bump -- ok" >&2
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-golden-version-bump: every changed golden is classified and honours its rule" >&2
exit 0
