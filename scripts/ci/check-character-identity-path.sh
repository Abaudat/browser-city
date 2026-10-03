#!/usr/bin/env bash
# Story 4.5 (FR142): a caller reaches its character only through
# tables/identity.rs. The `character_identity` accessor may be named only in
# tables/identity.rs (the one shell), tables/restore.rs (reproduces a past
# world by value) and tables/metrics.rs (row-count sampling). Comment lines
# are skipped.
#
# Usage: check-character-identity-path.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-character-identity-path: $SRC_DIR not found" >&2; exit 1; }
[ -f "$SRC_DIR/tables/identity.rs" ] || { echo "check-character-identity-path: FAIL -- $SRC_DIR/tables/identity.rs not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in tables/identity.rs | tables/restore.rs | tables/metrics.rs) continue ;; esac
  if grep -v '^[[:space:]]*//' "$f" | tr -d '\r' | grep -Eq '(^|[^_[:alnum:]])character_identity([^_[:alnum:]]|$)'; then
    BAD="$BAD$rel"$'\n'
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if [ -n "$BAD" ]; then
  echo "check-character-identity-path: FAIL -- only tables/identity.rs, restore.rs and metrics.rs may name the character_identity accessor:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-character-identity-path: only identity.rs, restore.rs and metrics.rs name character_identity (FR142)" >&2
