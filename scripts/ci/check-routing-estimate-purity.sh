#!/usr/bin/env bash
# FR131: the travel-time estimator is pure -- no graph, walkability grid or
# collision import, and no collection at all (an estimator that needs one
# is traversing something). Optional first argument overrides the file.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
FILE="${1:-"$REPO_ROOT/server/sim/src/routing/estimate.rs"}"
[ -f "$FILE" ] || { echo "check-routing-estimate-purity: $FILE not found" >&2; exit 1; }

# Only the code above `#[cfg(test)]` is scanned; tests may use collections.
MATCHES="$(sed '/^#\[cfg(test)\]/,$d' "$FILE" | grep -nE 'use crate::generation|use crate::world::walkability|use crate::world::collision|BTreeMap|BTreeSet|HashMap|HashSet|Vec<' || true)"
if [ -n "$MATCHES" ]; then
  echo "check-routing-estimate-purity: FAIL -- the estimator must import no generation/walkability/collision and hold no collection (FR131):" >&2
  echo "$MATCHES" >&2
  exit 1
fi
echo "check-routing-estimate-purity: estimate.rs is graph-free and collection-free (FR131)" >&2
