#!/usr/bin/env bash
# Story 4.14 (FR172): the live-connection mirror has one writer. The
# `connected_client` accessor is named only in tables/metrics.rs, and
# `record_connect` / `record_disconnect` are called only from the two
# lifecycle reducers in lib.rs (`identity_connected`, `identity_disconnected`),
# so no other reducer can add or remove a connection row. Comment lines are
# skipped.
#
# Usage: check-connected-client-path.sh [src-dir]   (default: server/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-connected-client-path: $SRC_DIR not found" >&2; exit 1; }
METRICS="$SRC_DIR/tables/metrics.rs"
LIB="$SRC_DIR/lib.rs"
[ -f "$METRICS" ] && [ -f "$LIB" ] || { echo "check-connected-client-path: FAIL -- $METRICS or $LIB not found (the scan matched nothing)" >&2; exit 1; }

code() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r'; }

BAD=""
while IFS= read -r f; do
  [ "$f" = "$METRICS" ] && continue
  if code "$f" | grep -Eq '(^|[^_[:alnum:]])connected_client([^_[:alnum:]]|$)'; then
    BAD="$BAD$f names the connected_client accessor"$'\n'
  fi
  [ "$f" = "$LIB" ] && continue
  if code "$f" | grep -Eq 'record_(connect|disconnect)[[:space:]]*\('; then
    BAD="$BAD$f calls record_connect/record_disconnect"$'\n'
  fi
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

# lib.rs: each call sits inside its own lifecycle reducer.
body() { # <fn name> <next fn name> -- the lines between the two declarations
  code "$LIB" | awk -v a="fn $1" -v b="fn $2" 'index($0, a) { on = 1; next } index($0, b) { on = 0 } on'
}
CONNECT_BODY="$(body identity_connected identity_disconnected)"
DISCONNECT_BODY="$(code "$LIB" | awk 'index($0, "fn identity_disconnected") { on = 1; next } on')"
grep -Eq 'record_connect[[:space:]]*\(' <<<"$CONNECT_BODY" || BAD="${BAD}identity_connected does not call record_connect"$'\n'
grep -Eq 'record_disconnect[[:space:]]*\(' <<<"$DISCONNECT_BODY" || BAD="${BAD}identity_disconnected does not call record_disconnect"$'\n'
grep -Eq 'record_disconnect[[:space:]]*\(' <<<"$CONNECT_BODY" && BAD="${BAD}identity_connected calls record_disconnect"$'\n'
grep -Eq 'record_connect[[:space:]]*\(' <<<"$DISCONNECT_BODY" && BAD="${BAD}identity_disconnected calls record_connect"$'\n'
[ "$(code "$LIB" | grep -Ec 'record_(connect|disconnect)[[:space:]]*\(')" -eq 2 ] \
  || BAD="${BAD}lib.rs calls record_connect/record_disconnect other than once each in the lifecycle reducers"$'\n'

if [ -n "$BAD" ]; then
  echo "check-connected-client-path: FAIL -- connected_client has one writer (story 4.14):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-connected-client-path: connected_client is written only by the two lifecycle reducers through tables/metrics.rs" >&2
