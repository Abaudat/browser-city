#!/usr/bin/env bash
# Story 6.3 (FR89): stock moves only by hand. The `stock` table accessor
# may be named only by the files that need it, so no reducer under
# server/src/ can write a stock row except through the one shell a later
# story adds to tables/stock.rs (which widens this guard in the same PR):
#
#   - tables/stock.rs   declares the table; carries no reducer, procedure
#                       or `.stock()` call of its own.
#   - tables/restore.rs operator backup restore reproduces a past world by
#                       value under require_owner; it is not a movement.
#   - tables/metrics.rs row-count sampling reads the table, never writes.
#
# Any other file naming the accessor (`.stock()`, `stock::stock`, a
# `stock::*` glob, or a brace import from `stock::` listing `stock`,
# single- or multi-line) fails. Comment lines are skipped.
#
# Usage: check-stock-write-path.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-stock-write-path: $SRC_DIR not found" >&2; exit 1; }

DECL="$SRC_DIR/tables/stock.rs"
[ -f "$DECL" ] || { echo "check-stock-write-path: FAIL -- $DECL not found (the scan matched nothing)" >&2; exit 1; }

# flat <file> -- the file as one line with comment lines dropped, so an
# import split over several lines is one match.
flat() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r' | tr '\n' ' '; }

NAMES_ACCESSOR='\.[[:space:]]*stock[[:space:]]*\(\)|use[^;]*stock::[[:space:]]*(stock([^_[:alnum:]]|$)|\*)|use[^;]*stock::[[:space:]]*\{[^}]*(\{|,|[[:space:]])stock[[:space:]]*(,|\})|stock::stock([^_[:alnum:]]|$)'

BAD=""
while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in
    tables/stock.rs | tables/restore.rs | tables/metrics.rs) continue ;;
  esac
  if flat "$f" | grep -Eq "$NAMES_ACCESSOR"; then
    BAD="$BAD$rel: names the stock accessor"$'\n'
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if grep -v '^[[:space:]]*//' "$DECL" | grep -Eq '#\[spacetimedb::(reducer|procedure)|\.[[:space:]]*stock[[:space:]]*\(\)'; then
  BAD="${BAD}tables/stock.rs: carries a reducer, procedure or .stock() call"$'\n'
fi

if [ -n "$BAD" ]; then
  echo "check-stock-write-path: FAIL -- stock is written only through the authored shell (FR89):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-stock-write-path: only restore and metrics name the stock accessor (FR89)" >&2
