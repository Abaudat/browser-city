#!/usr/bin/env bash
# Story 5.3 (FR58): one path in for an actor's chunk. The `actor_location`
# accessor may be named only in tables/actor.rs (`place_actor`, the one
# writer, which goes through `sim::actor_location::plan_move`),
# tables/restore.rs (reproduces a past world by value) and tables/metrics.rs
# (row-count sampling). Comment lines are skipped.
#
# Usage: check-actor-location-path.sh [server-src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_SRC="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SERVER_SRC" ] || { echo "check-actor-location-path: $SERVER_SRC not found" >&2; exit 1; }
[ -f "$SERVER_SRC/tables/actor.rs" ] || { echo "check-actor-location-path: FAIL -- $SERVER_SRC/tables/actor.rs not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
while IFS= read -r f; do
  rel="${f#"$SERVER_SRC"/}"
  case "$rel" in tables/actor.rs | tables/restore.rs | tables/metrics.rs) continue ;; esac
  if grep -v '^[[:space:]]*//' "$f" | tr -d '\r' | grep -Eq '(^|[^_[:alnum:]])actor_location\(\)'; then
    BAD="$BAD$rel"$'\n'
  fi
done < <(find "$SERVER_SRC" -name '*.rs' -not -path '*/generated/*' | sort)
if [ -n "$BAD" ]; then
  echo "check-actor-location-path: FAIL -- only tables/actor.rs, restore.rs and metrics.rs may name the actor_location accessor; place an actor through place_actor:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-actor-location-path: the actor_location accessor has one writer (FR58)" >&2
