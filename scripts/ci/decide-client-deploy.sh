#!/usr/bin/env bash
# Decides whether the client needs to be redeployed: compares the commit
# being deployed against what is *actually live* (Quentin's direction, PR
# #288 cycle 1), never the previous commit -- a commit whose own deploy
# never ran (CI cancelled by a fast-following push, or a prior deploy
# failure) must not let a later, module-only commit read as "nothing
# client-side changed" when the client that is actually live is still the
# one before it. Extracted out of `deploy.yml`'s own `changes` job (cycle
# 2: untested bash inline in YAML is exactly the class of bug cycle 1
# found and fixed in the `describe` probe by extracting it the same way)
# so the stamp-parsing, path-stripping and git-diff-exit-code mapping all
# have real fixture coverage, under `scripts/ci/tests/`.
#
# Usage: decide-client-deploy.sh <sha> <live-source> [paths-file]
#   <sha>          the commit being deployed
#   <live-source>  an http(s):// URL to fetch, or a local file path (a
#                  real temp git repo's own fixture HTML, in tests) --
#                  either way, the live page's HTML
#   [paths-file]   one glob per line, `/**`-suffixed
#                  (dorny/paths-filter's own syntax, stripped to a plain
#                  git pathspec here); defaults to
#                  scripts/ci/lib/deploy-client-paths.txt
# Prints "true" or "false" to stdout, and exits 0 either way -- "deploy"
# is never a failure of this script, only the answer it computed. Must be
# run with the current directory inside a git checkout that has the full
# history (`fetch-depth: 0`): the live commit can be arbitrarily old.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib/bc-build-stamp.sh
. "$SCRIPT_DIR/lib/bc-build-stamp.sh"
SHA="${1:-}"
LIVE_SOURCE="${2:-}"
PATHS_FILE="${3:-$REPO_ROOT/scripts/ci/lib/deploy-client-paths.txt}"

[ -n "$SHA" ] || { echo "decide-client-deploy: missing <sha> argument" >&2; exit 1; }
[ -n "$LIVE_SOURCE" ] || { echo "decide-client-deploy: missing <live-source> argument" >&2; exit 1; }
[ -f "$PATHS_FILE" ] || { echo "decide-client-deploy: $PATHS_FILE not found" >&2; exit 1; }

case "$LIVE_SOURCE" in
  http://*|https://*)
    HTML="$(curl -sf "$LIVE_SOURCE" 2>/dev/null || true)"
    ;;
  *)
    [ -f "$LIVE_SOURCE" ] || { echo "decide-client-deploy: $LIVE_SOURCE not found" >&2; exit 1; }
    HTML="$(cat "$LIVE_SOURCE")"
    ;;
esac

LIVE_SHA="$(printf '%s' "$HTML" | bc_build_stamp_extract || true)"
if [ -z "$LIVE_SHA" ]; then
  echo "decide-client-deploy: no live bc-build stamp found (unreachable, or the very first deploy) -- deploying the client" >&2
  echo "true"
  exit 0
fi

PATHSPEC=()
while IFS= read -r line; do
  line="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  [ -n "$line" ] || continue
  case "$line" in '#'*) continue ;; esac
  PATHSPEC+=("${line%/**}")
done < "$PATHS_FILE"

# git diff --quiet exits 0 (no difference -> skip), 1 (a difference ->
# deploy) or a git error, e.g. 128 on an unknown revision if the live SHA
# fell out of history -- any non-zero exit takes the same "deploy" branch
# below, the safe default.
if git diff --quiet "$LIVE_SHA" "$SHA" -- "${PATHSPEC[@]}" 2>/dev/null; then
  echo "decide-client-deploy: no client-affecting path changed since the live deploy ($LIVE_SHA) -- skipping deploy-client" >&2
  echo "false"
else
  echo "decide-client-deploy: client-affecting paths changed since the live deploy ($LIVE_SHA), or the diff could not be resolved -- deploying the client" >&2
  echo "true"
fi
