#!/usr/bin/env bash
# Story 4.3 (FR136, FR58): interest management is only as good as the
# subscriptions the client can issue, so the shape of every one is a rule.
#
#   1. `.subscribe(` appears only in net/connection.ts and
#      net/region-subscription.ts.
#   2. No `SELECT` literal under client/src outside the generated bindings
#      (comment lines excepted): queries are built with the typed builder.
#   3. The whole-table set is exactly the three global singletons --
#      `tables.demoPing`, `tables.moduleVersion` and `tables.worldClock`,
#      each `.build()` with no predicate. Any other table subscribed whole
#      fails; adding one to the allowlist below is a reviewed decision.
#
# An optional first argument overrides the scanned directory, for
# scripts/ci/tests/test-check-subscription-shape.sh.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"
[ -d "$SRC_DIR" ] || { echo "check-subscription-shape: $SRC_DIR not found" >&2; exit 1; }

ALLOWED_WHOLE_TABLES="demoPing moduleVersion worldClock"
FAILED=0
fail() { echo "check-subscription-shape: FAIL -- $1" >&2; FAILED=1; }

# Non-comment source lines of every .ts file outside the bindings, as
# "<relative path>:<line>:<text>".
code_lines() {
  find "$SRC_DIR" -name '*.ts' -not -path '*/bindings/*' -print0 | sort -z | while IFS= read -r -d '' f; do
    rel="${f#"$SRC_DIR"/}"
    sed 's/\r$//' "$f" | grep -nvE '^[[:space:]]*(//|/\*|\*)' | sed "s|^|$rel:|" || true
  done
}
LINES="$(code_lines)"

# 1. `.subscribe(` only in the two net/ files.
BAD="$(printf '%s\n' "$LINES" | grep -F '.subscribe(' | grep -vE '^net/(connection|region-subscription)\.ts:' || true)"
[ -z "$BAD" ] || fail ".subscribe( outside net/connection.ts and net/region-subscription.ts:
$BAD"

# 2. No SELECT literal.
BAD="$(printf '%s\n' "$LINES" | grep -E '\bSELECT\b' || true)"
[ -z "$BAD" ] || fail "a SELECT literal under client/src (use the typed query builder):
$BAD"

# 3. The whole-table set.
USED="$(printf '%s\n' "$LINES" | grep -oE 'tables\.[A-Za-z0-9_]+\.build\(\)' | sed -E 's/tables\.([A-Za-z0-9_]+)\.build\(\)/\1/' | sort -u || true)"
for t in $USED; do
  case " $ALLOWED_WHOLE_TABLES " in
    *" $t "*) ;;
    *) fail "table '$t' is subscribed whole (no predicate); only $ALLOWED_WHOLE_TABLES may be" ;;
  esac
done
for t in $ALLOWED_WHOLE_TABLES; do
  printf '%s\n' "$LINES" | grep -E "^net/connection\.ts:" | grep -qF "tables.$t.build()" \
    || fail "net/connection.ts no longer subscribes the global singleton '$t'"
done

[ "$FAILED" -eq 0 ] || exit 1
echo "check-subscription-shape: .subscribe( only in the two net/ files, no SELECT literal, whole-table set is exactly: $ALLOWED_WHOLE_TABLES"
