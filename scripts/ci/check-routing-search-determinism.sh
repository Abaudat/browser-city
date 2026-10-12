#!/usr/bin/env bash
# Story 3.12 (FR129): the route search is deterministic by construction --
# no hash-ordered collection under server/sim/src/routing/ (HashMap,
# HashSet, their `hash_map`/`hash_set` module paths, RandomState), whose
# iteration order would leak into a route. Ordered collections only.
# Optional first argument overrides the scanned directory.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-"$REPO_ROOT/server/sim/src/routing"}"
[ -d "$DIR" ] || { echo "check-routing-search-determinism: $DIR not found" >&2; exit 1; }

MATCHES="$(grep -rnE 'HashMap|HashSet|hash_map|hash_set|RandomState' "$DIR" --include='*.rs' \
  | awk '{ line = $0; sub(/^.*:[0-9]+:/, "", line); gsub(/^[ \t]+/, "", line); if (line !~ /^\/\//) print $0 }' || true)"
if [ -n "$MATCHES" ]; then
  echo "check-routing-search-determinism: FAIL -- a hash-ordered collection under routing/ (use BTreeMap/BTreeSet):" >&2
  echo "$MATCHES" >&2
  exit 1
fi
echo "check-routing-search-determinism: routing/ holds no hash-ordered collection (FR129)" >&2
