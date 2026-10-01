#!/usr/bin/env bash
# A district is generated once and read back as stored (FR108, FR109): the
# `district` record has one writer. Under server/src/:
#
#   - `generation::` (the generator) is named only in tables/district.rs.
#   - the `district` accessor is called only in tables/district.rs (inside
#     `create_district`, which only inserts: no update, no delete), in
#     tables/restore.rs (inside `begin_restore` and `restore_district`
#     only) and never in tables/metrics.rs (which imports it to sample
#     row counts).
#   - any other file naming the accessor (a call, a path, a glob or a
#     `use` reaching the module's accessor) fails.
#
# Comment lines are skipped. Usage: check-district-write-path.sh [src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-district-write-path: $SRC_DIR not found" >&2; exit 1; }

DECL="$SRC_DIR/tables/district.rs"
[ -f "$DECL" ] || { echo "check-district-write-path: FAIL -- $DECL not found (the scan matched nothing)" >&2; exit 1; }

code() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r'; }
flat() { code "$1" | tr '\n' ' '; }

CALLS='\.[[:space:]]*district[[:space:]]*\(\)|::[[:space:]]*district[[:space:]]*\(|district[[:space:]]*::[[:space:]]*(district([^_[:alnum:]]|$)|\*)'
METHOD='\.[[:space:]]*district[[:space:]]*\(\)|::[[:space:]]*district[[:space:]]*\('
GEN='generation[[:space:]]*::'

# A `use` that leaves a bare `district` after the `district::` segments are
# taken out: `use super::district::{District, district};` reaches the
# accessor, `use super::district::District;` does not.
reaches_accessor() {
  flat "$1" | grep -oE 'use [^;]*;' \
    | sed -E 's/district[[:space:]]*::/ /g' \
    | grep -Eq '(^|[^_[:alnum:]])district([^_[:alnum:]]|$)'
}

# calls_outside <file> <fn>... -- the enclosing fn of every `.district()`
# call that is not one of the named functions.
calls_outside() {
  local f="$1"; shift
  local allowed=" $* "
  code "$f" | awk -v allowed="$allowed" '
    /^[ \t]*(pub(\([a-z]+\))?[ \t]+)?fn[ \t]+[A-Za-z_0-9]+/ {
      cur = $0; sub(/^.*fn[ \t]+/, "", cur); sub(/[^A-Za-z_0-9].*$/, "", cur)
    }
    /\.[ \t]*district[ \t]*\(\)/ { if (index(allowed, " " cur " ") == 0) print cur }'
}

BAD=""
note() { BAD="$BAD$1"$'\n'; }

while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  case "$rel" in
    tables/district.rs)
      OUT="$(calls_outside "$f" create_district)"
      [ -z "$OUT" ] || note "$rel: names the accessor outside create_district (in: $(echo "$OUT" | tr '\n' ' '))"
      if flat "$f" | grep -Eq '\.[[:space:]]*(delete|update)[[:space:]]*\('; then
        note "$rel: updates or deletes (the record is insert-only)"
      fi
      continue ;;
    tables/restore.rs)
      OUT="$(calls_outside "$f" begin_restore restore_district)"
      [ -z "$OUT" ] || note "$rel: names the accessor outside begin_restore and restore_district (in: $(echo "$OUT" | tr '\n' ' '))"
      if flat "$f" | grep -Eq '::[[:space:]]*district[[:space:]]*\('; then note "$rel: calls the accessor by path"; fi
      if flat "$f" | grep -Eq "$GEN"; then note "$rel: names the generator"; fi
      continue ;;
    tables/metrics.rs)
      if flat "$f" | grep -Eq "$METHOD"; then note "$rel: calls the accessor (it only samples row counts)"; fi
      if flat "$f" | grep -Eq "$GEN"; then note "$rel: names the generator"; fi
      continue ;;
  esac
  if flat "$f" | grep -Eq "$GEN"; then note "$rel: names the generator (only tables/district.rs may)"; fi
  if flat "$f" | grep -Eq "$CALLS" || reaches_accessor "$f"; then note "$rel: names the district accessor"; fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if [ -n "$BAD" ]; then
  echo "check-district-write-path: FAIL -- a district is generated once and read back, never regenerated or rewritten (FR108, FR109):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-district-write-path: only create_district inserts the record, only restore restores it (FR108, FR109)" >&2
