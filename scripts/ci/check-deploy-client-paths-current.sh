#!/usr/bin/env bash
# Keeps scripts/ci/lib/deploy-client-paths.txt (the one list deciding
# whether deploy.yml needs to redeploy the client) from drifting out of
# ci.yml's own `client:` changes filter, which must always be a superset
# of it (Quentin's direction, PR #288 cycle 1). A grep, not a YAML parser
# -- same discipline as scripts/ci/check-ci-gate.sh.
#
# Usage: check-deploy-client-paths-current.sh [paths-file] [ci-workflow]
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PATHS_FILE="${1:-$REPO_ROOT/scripts/ci/lib/deploy-client-paths.txt}"
CI_WORKFLOW="${2:-$REPO_ROOT/.github/workflows/ci.yml}"

[ -f "$PATHS_FILE" ] || { echo "check-deploy-client-paths-current: $PATHS_FILE not found" >&2; exit 1; }
[ -f "$CI_WORKFLOW" ] || { echo "check-deploy-client-paths-current: $CI_WORKFLOW not found" >&2; exit 1; }

FAILED=0

while IFS= read -r line; do
  line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "$line" ] || continue
  case "$line" in
    '#'*) continue ;;
  esac
  if ! grep -qF -- "$line" "$CI_WORKFLOW"; then
    echo "check-deploy-client-paths-current: FAIL -- '$line' ($PATHS_FILE) does not appear in $CI_WORKFLOW's own filters -- deploy.yml's client-changed decision and ci.yml's client: filter have drifted apart" >&2
    FAILED=1
  fi
done < "$PATHS_FILE"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-deploy-client-paths-current: every deploy-client-paths.txt entry is still covered by $CI_WORKFLOW" >&2
exit 0
