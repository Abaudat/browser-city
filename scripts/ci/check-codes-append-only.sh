#!/usr/bin/env bash
# A code's number in sim::codes is as permanent as a primary key (NFR36):
# renumbering one, or handing a retired number to a different name, would
# silently change the meaning of every matter, decision record or reason
# already stored under it. Diffs every server/sim/tests/goldens/codes_*.golden
# against the PR's merge base and fails unless every line committed there
# still appears, verbatim, in the current file -- an existing `set code
# name` line may never change or disappear; only new lines may be
# appended. Same base-resolution contract as check-golden-version-bump.sh
# and check-schema-additive.sh, copied verbatim.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

_fail_or_skip() { # <message> -- hard fail under GITHUB_ACTIONS, soft skip otherwise
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "check-codes-append-only: FAIL -- $1" >&2
    exit 1
  fi
  echo "check-codes-append-only: $1 -- skipping" >&2
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

FAILED=0
shopt -s nullglob
for path in server/sim/tests/goldens/codes_*.golden; do
  OLD_CONTENT="$(git show "$MERGE_BASE:$path" 2>/dev/null || true)"
  if [ -z "$OLD_CONTENT" ]; then
    echo "check-codes-append-only: no $path at merge base $MERGE_BASE -- this PR introduces it, nothing to diff against" >&2
    continue
  fi

  NEW_CONTENT="$(cat "$path")"
  while IFS= read -r old_line; do
    [ -n "$old_line" ] || continue
    if ! grep -qxF "$old_line" <<<"$NEW_CONTENT"; then
      echo "check-codes-append-only: FAIL -- $path: an existing line changed or disappeared: '$old_line'" >&2
      FAILED=1
    fi
  done <<<"$OLD_CONTENT"
done
shopt -u nullglob

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-codes-append-only: no committed code line moved since $MERGE_BASE" >&2
exit 0
