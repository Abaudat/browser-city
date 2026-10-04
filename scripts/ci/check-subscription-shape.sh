#!/usr/bin/env bash
# Story 4.3 (FR136, FR58): interest management is only as good as the
# subscriptions the client can issue, so the shape of every one is a rule.
#
#   1. `.subscribe(` appears only in net/connection.ts and
#      net/region-subscription.ts.
#   2. No `SELECT` literal under client/src outside the generated bindings
#      (comment lines excepted): queries are built with the typed builder.
#   3. The whole-table set is exactly the three global singletons --
#      `tables.demoPing`, `tables.moduleVersion` and `tables.worldClock` --
#      and the per-sender view `tables.myCharacter` (story 4.5: one row, the
#      caller's own character, never spatial), each `.build()` with no
#      predicate. Any other table subscribed whole
#      fails; adding one to the allowlist below is a reviewed decision.
#      Every other use of `tables` must be `tables.<name>.where(` on one
#      line, so splitting, aliasing or destructuring a table is no way round.
#   4. Story 4.8: every connection is supervised (it reconnects by itself).
#      `DbConnection.builder` appears only in net/connection.ts (the one
#      everyday connection) and net/link.ts (the short-lived link
#      connection, never supervised), and `connect` from net/connection is
#      called and imported only by net/supervised-connect.ts.
#
# An optional first argument overrides the scanned directory, for
# scripts/ci/tests/test-check-subscription-shape.sh.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"
[ -d "$SRC_DIR" ] || { echo "check-subscription-shape: $SRC_DIR not found" >&2; exit 1; }

ALLOWED_WHOLE_TABLES="demoPing moduleVersion worldClock myCharacter"
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

# 3. The whole-table set, and no way round it. Every use of the generated
#    `tables` object outside the imports must be exactly one of
#    `tables.<singleton>.build()` or `tables.<name>.where(` on one line: a
#    table split from its `.build()` across lines, aliased
#    (`const t = tables.placedObject`) or destructured never names a
#    predicate on the same line, so it fails here.
STRIPPED="$(printf '%s\n' "$LINES" | grep -vE '^[^:]+:[0-9]+:[[:space:]]*import\b' | sed -E \
  -e 's/tables\.(demoPing|moduleVersion|worldClock|myCharacter)\.build\(\)//g' \
  -e 's/tables\.[A-Za-z0-9_]+\.where\(//g')"
BAD="$(printf '%s\n' "$STRIPPED" | grep -E '\btables\b' || true)"
[ -z "$BAD" ] || fail "the generated 'tables' object is used other than as tables.<singleton>.build() or tables.<name>.where( on one line (a whole-table subscription, or a way round the guard):
$BAD"
USED="$(printf '%s\n' "$LINES" | grep -oE 'tables\.[A-Za-z0-9_]+\.build\(\)' | sed -E 's/tables\.([A-Za-z0-9_]+)\.build\(\)/\1/' | sort -u || true)"
for t in $USED; do
  case " $ALLOWED_WHOLE_TABLES " in
    *" $t "*) ;;
    *) fail "table '$t' is subscribed whole (no predicate); only $ALLOWED_WHOLE_TABLES may be" ;;
  esac
done
# A here-string, never `printf | grep -q`: under pipefail a `grep -q` that quits
# at its first match can SIGPIPE the still-writing `printf` and report a
# false "no match" on a large enough input.
CONNECTION_LINES="$(printf '%s\n' "$LINES" | grep -E "^net/connection\.ts:" || true)"
for t in $ALLOWED_WHOLE_TABLES; do
  grep -qF "tables.$t.build()" <<<"$CONNECTION_LINES" \
    || fail "net/connection.ts no longer subscribes the global singleton '$t'"
done

# 4. Connections open in one place, and only the supervisor calls `connect`.
BAD="$(printf '%s\n' "$LINES" | grep -F 'DbConnection.builder' | grep -vE '^net/(connection|link)\.ts:' || true)"
[ -z "$BAD" ] || fail "DbConnection.builder outside net/connection.ts and net/link.ts:
$BAD"
BAD="$(printf '%s\n' "$LINES" | grep -vE '^net/(connection|supervised-connect)\.ts:'   | grep -E '(^|[^A-Za-z0-9_.])connect\(|import .*[{, ]connect[ ,}].* from "[./a-z-]*connection"' || true)"
[ -z "$BAD" ] || fail "connect() from net/connection used outside net/supervised-connect.ts (a connection nothing supervises):
$BAD"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-subscription-shape: .subscribe( only in the two net/ files, no SELECT literal, whole-table set is exactly: $ALLOWED_WHOLE_TABLES; connections open only in the supervised paths"
