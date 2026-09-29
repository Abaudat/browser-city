#!/usr/bin/env bash
# NFR50: proptest replays every `cc` entry of a `*.proptest-regressions`
# file before it draws new cases, but only if the file is in the tree CI
# checks out. So every such file under server/ must be tracked by git and
# not masked by an ignore rule.
#
# Usage: check-proptest-regressions.sh [repo-root]
set -euo pipefail
REPO_ROOT="${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"
cd "$REPO_ROOT"

FAILED=0
COUNT=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  COUNT=$((COUNT + 1))
  if git check-ignore -q -- "$f"; then
    echo "check-proptest-regressions: FAIL -- $f is matched by an ignore rule" >&2
    FAILED=1
  fi
  if ! git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    echo "check-proptest-regressions: FAIL -- $f is not tracked by git" >&2
    FAILED=1
  fi
done < <(find server -name '*.proptest-regressions' -not -path '*/target/*' | sort)

# A future regressions file must not be ignorable by pattern either.
PROBE="server/sim/tests/probe.proptest-regressions"
if git check-ignore -q -- "$PROBE"; then
  echo "check-proptest-regressions: FAIL -- an ignore rule masks *.proptest-regressions ($PROBE)" >&2
  FAILED=1
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "check-proptest-regressions: $COUNT regressions file(s) tracked and not ignored" >&2
exit 0
