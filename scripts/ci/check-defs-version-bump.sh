#!/usr/bin/env bash
# Guards `defs_version` itself (NFR31): if anything under `defs/` changed
# since the base, `server/sim/src/generated/defs.rs`'s own `DEFS_VERSION`
# line must have changed too -- `defs_version` is computed from every
# git-tracked file under `defs/` (docs/architecture.md), so a real content
# change with no version movement means the generated artefacts were
# never regenerated. Same base-resolution and fail-closed conventions as
# check-golden-version-bump.sh, copied verbatim.
#
# Every changed path under `defs/` must fall under one of the kind
# subdirectories `defs/` actually declares -- a path this script cannot
# classify fails loudly ("has no version rule, add one") rather than
# passing by default, the same habit check-golden-version-bump.sh has for
# an unclassified golden. The prop atlases, character-part atlases and
# audio manifest fold into this same check for free once they exist,
# because their own manifests must live under `defs/` (docs/
# architecture.md) rather than beside their producing pipeline.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

DEFS_RS="server/sim/src/generated/defs.rs"
KNOWN_KINDS="objects items recipes professions chains balance"

_fail_or_skip() { # <message> -- hard fail under GITHUB_ACTIONS, soft skip otherwise
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "check-defs-version-bump: FAIL -- $1" >&2
    exit 1
  fi
  echo "check-defs-version-bump: $1 -- skipping" >&2
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

CHANGED_DEFS="$(git diff --name-only "$MERGE_BASE" HEAD -- 'defs/**')"
if [ -z "$CHANGED_DEFS" ]; then
  echo "check-defs-version-bump: no defs/ file changed -- nothing to guard" >&2
  exit 0
fi

FAILED=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  # path is "defs/<kind>/...": the kind is the second path component.
  kind="$(printf '%s' "$path" | awk -F/ '{print $2}')"
  match=0
  for k in $KNOWN_KINDS; do
    [ "$kind" = "$k" ] && match=1
  done
  if [ "$match" -ne 1 ]; then
    echo "check-defs-version-bump: FAIL -- $path has no version rule, add one" >&2
    FAILED=1
  fi
done <<< "$CHANGED_DEFS"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

CHANGED_DEFS_RS="$(git diff --name-only "$MERGE_BASE" HEAD -- "$DEFS_RS")"
if [ -z "$CHANGED_DEFS_RS" ]; then
  echo "check-defs-version-bump: FAIL -- defs/ changed with no defs_version bump:" >&2
  printf '%s\n' "$CHANGED_DEFS" >&2
  exit 1
elif ! git diff "$MERGE_BASE" HEAD -- "$DEFS_RS" | grep -qE '^[+-]pub const DEFS_VERSION'; then
  echo "check-defs-version-bump: FAIL -- defs/ changed but DEFS_VERSION did not:" >&2
  printf '%s\n' "$CHANGED_DEFS" >&2
  exit 1
fi

echo "check-defs-version-bump: defs/ changed alongside a DEFS_VERSION bump -- ok" >&2
exit 0
