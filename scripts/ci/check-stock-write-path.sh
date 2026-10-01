#!/usr/bin/env bash
# Story 6.3 (FR89): stock moves only by hand. The `stock` table accessor
# may be named only where it is needed, so no reducer under server/src/ can
# write a stock row except through the one shell a later story adds to
# tables/stock.rs (which widens this guard in the same PR):
#
#   - tables/stock.rs   declares the table; carries no reducer, procedure
#                       or `.stock()` call of its own.
#   - tables/restore.rs operator backup restore reproduces a past world by
#                       value under require_owner; it is not a movement.
#                       The accessor appears only inside `begin_restore`
#                       (the emptiness check) and `restore_stock`.
#   - tables/metrics.rs row-count sampling imports the accessor for
#                       `sample!(stock)` and never calls it.
#
# Any other file fails when it calls the accessor (`.stock()`, `::stock(`,
# `stock::stock`), globs the module (`stock::*`), or has a `use` that
# reaches the `stock` module other than to name its capitalised types and
# the `business` accessor: the module itself (bare or `as`), `self`, `as`,
# `stock` in a brace list, `stock as _` are all failures. `sim::stock` is a different
# module and is not touched. Comment lines are skipped.
#
# Usage: check-stock-write-path.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-stock-write-path: $SRC_DIR not found" >&2; exit 1; }

DECL="$SRC_DIR/tables/stock.rs"
[ -f "$DECL" ] || { echo "check-stock-write-path: FAIL -- $DECL not found (the scan matched nothing)" >&2; exit 1; }

# code <file> -- the file without comment lines.
code() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r'; }
# flat <file> -- the code as one line, so a statement split over several
# lines is one match.
flat() { code "$1" | tr '\n' ' '; }

CALLS='\.[[:space:]]*stock[[:space:]]*\(\)|::[[:space:]]*stock[[:space:]]*\(|stock[[:space:]]*::[[:space:]]*(stock([^_[:alnum:]]|$)|\*)'
PATHCALLS='::[[:space:]]*stock[[:space:]]*\(|stock[[:space:]]*::[[:space:]]*(stock([^_[:alnum:]]|$)|\*)'
WORD='(^|[^_[:alnum:]])stock([^_[:alnum:]]|$)'

# reaches_module <file> -- a `use` statement that leaves a bare `stock`
# after the `stock::` path segments (and `sim::stock`) are taken out.
reaches_module() {
  flat "$1" | grep -oE 'use [^;]*;' \
    | sed -E 's/sim[[:space:]]*::[[:space:]]*stock/ /g; s/stock[[:space:]]*::/ /g' \
    | grep -Eq "$WORD"
}

# renames_module <file> -- a `use` reaching the module (not `sim::stock`)
# with `self` or `as` in it: `{self as st}` or `{self, Stock}`.
renames_module() {
  flat "$1" | grep -oE 'use [^;]*;'     | sed -E 's/sim[[:space:]]*::[[:space:]]*stock/ /g'     | grep -E 'stock[[:space:]]*::'     | grep -Eq '(^|[^_[:alnum:]])(self|as)([^_[:alnum:]]|$)'
}

BAD=""
note() { BAD="$BAD$1"$'\n'; }

while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in
    tables/stock.rs) continue ;;
    tables/restore.rs)
      # Every `.stock()` must sit inside one of the two named functions.
      OUT="$(code "$f" | awk '
        /^[ \t]*(pub(\([a-z]+\))?[ \t]+)?fn[ \t]+[A-Za-z_0-9]+/ {
          cur = $0; sub(/^.*fn[ \t]+/, "", cur); sub(/[^A-Za-z_0-9].*$/, "", cur)
        }
        /\.[ \t]*stock[ \t]*\(\)/ {
          if (cur != "begin_restore" && cur != "restore_stock") print cur
        }')"
      if flat "$f" | grep -Eq "$PATHCALLS"; then note "$rel: calls the accessor by path"; fi
      [ -z "$OUT" ] || note "$rel: names the accessor outside begin_restore and restore_stock (in: $(echo "$OUT" | tr '\n' ' '))"
      continue ;;
    tables/metrics.rs)
      if flat "$f" | grep -Eq "$CALLS"; then note "$rel: calls the accessor (it only samples row counts)"; fi
      continue ;;
  esac
  if flat "$f" | grep -Eq "$CALLS" || reaches_module "$f" || renames_module "$f"; then
    note "$rel: names the stock accessor"
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if code "$DECL" | grep -Eq '#\[(spacetimedb::)?(reducer|procedure)|\.[[:space:]]*stock[[:space:]]*\(\)'; then
  note "tables/stock.rs: carries a reducer, procedure or .stock() call"
fi

if [ -n "$BAD" ]; then
  echo "check-stock-write-path: FAIL -- stock is written only through the authored shell (FR89):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-stock-write-path: only restore and metrics name the stock accessor (FR89)" >&2
