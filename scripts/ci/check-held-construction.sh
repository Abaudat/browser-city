#!/usr/bin/env bash
# Story 6.10 (FR94, FR95): a held item's slot is validated against its
# container's real grid, so nothing under server/src/ may build a `Held` or
# touch the `item_held` accessor except the operator restore path (which is
# restore is by value, like `restore_stock`). Every later writer goes through
# `sim::container_grid::plan_store`, the one code that builds a `Held` meant
# for a write and only after `fits` said yes.
#
#   - tables/item_instance.rs declares the table; carries no `.item_held()`
#                       call or `Held::new` of its own.
#   - tables/restore.rs the restore reducers.
#   - tables/metrics.rs imports the accessor to sample row counts and never
#                       calls it.
#
# Any other file fails when it calls `Held::new(`, names `.item_held()`, or
# reaches the accessor by path (`item_instance::item_held(`). Comment lines
# are skipped. `sim::` is not scanned: sim is pure and builds no row.
#
# A file that calls `plan_store(` is a store writer, and must also call
# `record_store_attempt(`: the `packing_forced` series (FR172) is only as
# true as its writers, and the first one adds the emitter in the same PR.
#
# Usage: check-held-construction.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-held-construction: $SRC_DIR not found" >&2; exit 1; }

DECL="$SRC_DIR/tables/item_instance.rs"
[ -f "$DECL" ] || { echo "check-held-construction: FAIL -- $DECL not found (the scan matched nothing)" >&2; exit 1; }

code() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r'; }
flat() { code "$1" | tr '\n' ' '; }

CONSTRUCT='(^|[^_[:alnum:]])Held[[:space:]]*::[[:space:]]*new[[:space:]]*\('
ACCESSOR='\.[[:space:]]*item_held[[:space:]]*\(\)|::[[:space:]]*item_held[[:space:]]*\(|item_held[[:space:]]*::[[:space:]]*(item_held([^_[:alnum:]]|$)|\*)'

BAD=""
note() { BAD="$BAD$1"$'\n'; }

while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in
    tables/restore.rs) continue ;;
    tables/metrics.rs)
      if flat "$f" | grep -Eq "$ACCESSOR|$CONSTRUCT"; then note "$rel: calls the accessor or builds a Held (it only samples row counts)"; fi
      continue ;;
  esac
  if flat "$f" | grep -Eq "$CONSTRUCT"; then note "$rel: builds a Held outside plan_store"; fi
  if flat "$f" | grep -Eq "$ACCESSOR"; then note "$rel: names the item_held accessor"; fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  if flat "$f" | grep -Eq '(^|[^_[:alnum:]])plan_store[[:space:]]*\('     && ! flat "$f" | grep -Eq '(^|[^_[:alnum:]])record_store_attempt[[:space:]]*\('; then
    note "$rel: calls plan_store but never record_store_attempt (every store attempt feeds packing_forced)"
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if [ -n "$BAD" ]; then
  echo "check-held-construction: FAIL -- a held row is built only by sim::container_grid::plan_store (FR94/FR95):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-held-construction: only restore names the item_held accessor or builds a Held (FR95)" >&2
