#!/usr/bin/env bash
# No committed (indexed) text file under docs/, scripts/, .github/ or
# client/ contains a carriage return: a Windows checkout that commits CRLF
# turns every line of a file into a change and hides the real diff.
#
# Usage: check-no-crlf-committed.sh [repo-root]
set -euo pipefail

REPO_ROOT="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO_ROOT"

# -I skips binary files; --cached reads the committed blobs, never the
# working copy's own line-ending conversion.
FOUND="$(git grep -I --cached -l -P '\r' -- docs scripts .github client ':!client/package-lock.json' || true)"
if [ -n "$FOUND" ]; then
  echo "check-no-crlf-committed: FAIL -- these tracked files contain a carriage return (commit them with LF):" >&2
  printf '%s\n' "$FOUND" | sed 's/^/  /' >&2
  exit 1
fi
echo "check-no-crlf-committed: no committed text file under docs/, scripts/, .github/ or client/ contains a CR" >&2
