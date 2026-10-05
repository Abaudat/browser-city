#!/usr/bin/env bash
# Story 4.4 (FR138): one path in, one path out for a player's position.
#   - Server: the `player_position` accessor may be named only in
#     tables/player_position.rs (the one reducer), tables/restore.rs
#     (reproduces a past world by value) and tables/metrics.rs (row-count
#     sampling). Comment lines are skipped.
#   - Client: the position reducer (`setPlayerPosition`) is called only from
#     client/src/net/position-sender.ts.
#
# Usage: check-player-position-path.sh [server-src-dir] [client-src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_SRC="${1:-"$REPO_ROOT/server/src"}"
CLIENT_SRC="${2:-"$REPO_ROOT/client/src"}"
[ -d "$SERVER_SRC" ] || { echo "check-player-position-path: $SERVER_SRC not found" >&2; exit 1; }
[ -d "$CLIENT_SRC" ] || { echo "check-player-position-path: $CLIENT_SRC not found" >&2; exit 1; }
[ -f "$SERVER_SRC/tables/player_position.rs" ] || { echo "check-player-position-path: FAIL -- $SERVER_SRC/tables/player_position.rs not found (the scan matched nothing)" >&2; exit 1; }
[ -f "$CLIENT_SRC/net/position-sender.ts" ] || { echo "check-player-position-path: FAIL -- $CLIENT_SRC/net/position-sender.ts not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
while IFS= read -r f; do
  rel="${f#"$SERVER_SRC"/}"
  case "$rel" in tables/player_position.rs | tables/restore.rs | tables/metrics.rs) continue ;; esac
  if grep -v '^[[:space:]]*//' "$f" | tr -d '\r' | grep -Eq '(^|[^_[:alnum:]])player_position\(\)'; then
    BAD="$BAD$rel"$'\n'
  fi
done < <(find "$SERVER_SRC" -name '*.rs' -not -path '*/generated/*' | sort)
if [ -n "$BAD" ]; then
  echo "check-player-position-path: FAIL -- only tables/player_position.rs, restore.rs and metrics.rs may name the player_position accessor:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi

BAD=""
while IFS= read -r f; do
  rel="${f#"$CLIENT_SRC"/}"
  [ "$rel" = "net/position-sender.ts" ] && continue
  if grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "$f" | tr -d '\r' | grep -q 'setPlayerPosition'; then
    BAD="$BAD$rel"$'\n'
  fi
done < <(find "$CLIENT_SRC" -name '*.ts' -not -path '*/bindings/*' | sort)
if [ -n "$BAD" ]; then
  echo "check-player-position-path: FAIL -- the position reducer is called only from net/position-sender.ts:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-player-position-path: the player_position accessor and the position reducer each have one home (FR138)" >&2
