#!/usr/bin/env bash
# Story 6.3 (FR89): nothing mints an author. A write names a citizen who
# acted, so no scheduled or detect-and-change code may pick a citizen id and
# call it a procedure step. Outside tests, only these may build an `Author`
# or name a `Cause` variant:
#
#   - server/sim/src/author.rs   the type itself.
#   - server/sim/src/stock.rs    the exhaustive match on `Cause` (`Cause::`
#                                only, never `Author::new`).
#
# The procedure machine (8.1) and the consumption path (7.7) widen this list
# by name when they land, in the same PR. A `#[cfg(test)]` inline module
# (or `mod x;`) is test code and skipped; anything else, including a
# `#[cfg(test)]` item above production code, is scanned. Renaming either
# type (`as`, `type`) fails, and outside those files `Cause` may not be named
# at all. Comment lines are skipped.
#
# Usage: check-author-construction.sh [root]   (default: the repository)
# Scans <root>/server/src and <root>/server/sim/src, minus generated/.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${1:-$REPO_ROOT}"

DIRS=()
for d in "$ROOT/server/src" "$ROOT/server/sim/src"; do
  [ -d "$d" ] && DIRS+=("$d")
done
[ "${#DIRS[@]}" -gt 0 ] || { echo "check-author-construction: no source directory under $ROOT" >&2; exit 1; }
[ -f "$ROOT/server/sim/src/author.rs" ] || { echo "check-author-construction: FAIL -- server/sim/src/author.rs not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  [ "$rel" = "server/sim/src/author.rs" ] && continue
  body="$({ grep -v '^[[:space:]]*//' "$f" || true; } | tr -d '\r' | awk '
    /#\[cfg\(test\)\]/ { pend = 1; next }
    pend && /^[ 	]*#\[/ { next }
    pend {
      pend = 0
      if ($0 ~ /^[ 	]*(pub[ 	]+)?mod[ 	]+[A-Za-z_0-9]+[ 	]*;/) next
      if ($0 ~ /^[ 	]*(pub[ 	]+)?mod[ 	]+[A-Za-z_0-9]+[ 	]*\{/) { inmod = 1; next }
    }
    inmod { if ($0 ~ /^\}/) inmod = 0; next }
    { printf "%s ", $0 }')"
  if printf '%s
' "$body" | grep -Eq 'Author[[:space:]]*::[[:space:]]*new|<[[:space:]]*Author[[:space:]]*>'; then
    BAD="$BAD$rel: constructs an Author"$'
'
  fi
  if printf '%s
' "$body" | grep -Eq '(Author|Cause)[[:space:]]+as[[:space:]]|type[[:space:]]+[A-Za-z_0-9]+[[:space:]]*=[^;]*(Author|Cause)'; then
    BAD="$BAD$rel: renames Author or Cause"$'
'
  fi
  if [ "$rel" != "server/sim/src/stock.rs" ]     && printf '%s
' "$body" | grep -Eq '(^|[^_[:alnum:]])Cause([^_[:alnum:]]|$)'; then
    BAD="$BAD$rel: names Cause"$'
'
  fi
done < <(find "${DIRS[@]}" -name '*.rs' -not -path '*/generated/*' | sort)

if [ -n "$BAD" ]; then
  echo "check-author-construction: FAIL -- only the procedure machine and the consumption path may author a write (FR89):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-author-construction: nothing outside sim::author builds an Author (FR89)" >&2
