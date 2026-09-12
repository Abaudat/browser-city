#!/usr/bin/env bash
# A def's id or key in tools/defs-build/goldens/defs-manifest.golden is as
# permanent as a code number in sim::codes (NFR31, Tim's direction):
# renumbering one, or handing a retired id to a different key, would
# silently change the meaning of anything already placed under it (an
# object_def id above all). Diffs the golden against the PR's merge base
# and fails unless every line committed there still appears, verbatim, in
# the current file -- an existing line may never change or disappear;
# only new lines may be appended. Same base-resolution contract as
# check-codes-append-only.sh, copied verbatim (balance carries no id in
# this story, so it is not in this golden).
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

GOLDEN="tools/defs-build/goldens/defs-manifest.golden"

_fail_or_skip() { # <message> -- hard fail under GITHUB_ACTIONS, soft skip otherwise
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "check-defs-ids-append-only: FAIL -- $1" >&2
    exit 1
  fi
  echo "check-defs-ids-append-only: $1 -- skipping" >&2
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

[ -f "$GOLDEN" ] || {
  echo "check-defs-ids-append-only: $GOLDEN not found" >&2
  exit 1
}

MERGE_BASE="$(git merge-base "$BASE" HEAD)"

OLD_CONTENT="$(git show "$MERGE_BASE:$GOLDEN" 2>/dev/null || true)"
if [ -z "$OLD_CONTENT" ]; then
  echo "check-defs-ids-append-only: no $GOLDEN at merge base $MERGE_BASE -- this PR introduces it, nothing to diff against" >&2
  exit 0
fi

NEW_CONTENT="$(cat "$GOLDEN")"
FAILED=0
while IFS= read -r old_line; do
  [ -n "$old_line" ] || continue
  if ! grep -qxF "$old_line" <<<"$NEW_CONTENT"; then
    echo "check-defs-ids-append-only: FAIL -- $GOLDEN: an existing line changed or disappeared: '$old_line'" >&2
    FAILED=1
  fi
done <<< "$OLD_CONTENT"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-defs-ids-append-only: no committed id/key line moved since $MERGE_BASE" >&2
exit 0
