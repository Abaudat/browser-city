#!/usr/bin/env bash
# Mechanically checks story 1.1's `spacetime dev` acceptance criterion:
# editing a Rust source file rebuilds and republishes without a manual
# step. One command, one exit code, no eyeballs -- this cannot run in
# GitHub CI (nothing there can watch a filesystem across a real `spacetime
# dev` process), so it is a standalone dev-machine script instead, run by
# hand. No `sleep`-as-readiness: every wait below polls a real signal
# against a bounded deadline.
#
# Brings up its own disposable local SpacetimeDB instance and `spacetime
# dev`, on a fresh port and a throwaway database, so it never touches a
# developer's own `spacetime start`. Appends a uniquely-named reducer to
# server/src/lib.rs, waits for `spacetime describe` (a real schema query,
# not a build artifact's mtime) to report it, then restores the file --
# always, even on failure.
set -u
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB_RS="$REPO_ROOT/server/src/lib.rs"
DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-hot-reload.XXXXXX")"
DB_NAME="bc-hot-reload-$$"
MARKER="__hot_reload_check_$$"
START_LOG="$DATA_DIR/start.log"
DEV_LOG="$DATA_DIR/dev.log"
HEALTH_DEADLINE_S=20
REPUBLISH_DEADLINE_S=90
POLL_INTERVAL_S=1
NUDGE_INTERVAL_S=10

START_PID=""
DEV_PID=""
APPENDED=0

# Kills a process by its MSYS pid, resolving to the real Windows PID via
# `ps -l` first when `taskkill` is available -- MSYS's own pid and the
# Windows PID are different numbers, and `taskkill //PID` needs the latter.
kill_tree() {
  local pid="$1" winpid=""
  [ -n "$pid" ] || return 0
  if command -v taskkill >/dev/null 2>&1; then
    # MSYS's own pid for a process and its Windows PID are different
    # numbers; `taskkill //PID` needs the latter. `ps -l` prints both.
    winpid="$(ps -l 2>/dev/null | awk -v p="$pid" '$1 == p { print $4 }')"
    taskkill //F //T //PID "${winpid:-$pid}" >/dev/null 2>&1
  fi
  kill "$pid" 2>/dev/null
}

cleanup() {
  if [ "$APPENDED" -eq 1 ]; then
    # Removes exactly the block this script appended -- the marker name is
    # unique to this run (pid-suffixed), so nothing else can match it.
    sed -i "/BEGIN $MARKER/,/END $MARKER/d" "$LIB_RS"
  fi
  kill_tree "$DEV_PID"
  kill_tree "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# Reuses a free port each run rather than a fixed one, so this never
# collides with a developer's own local instance.
PORT="$(python3 - <<'PY' 2>/dev/null || node -e "const n=require('node:net').createServer();n.listen(0,'127.0.0.1',()=>{console.log(n.address().port);n.close()})"
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
if [ -z "$PORT" ]; then
  echo "check-hot-reload: could not find a free port (need python3 or node)" >&2
  exit 1
fi
SERVER_URL="http://127.0.0.1:$PORT"

spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$PORT" >"$START_LOG" 2>&1 &
START_PID=$!

deadline=$((SECONDS + HEALTH_DEADLINE_S))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -sf -o /dev/null "$SERVER_URL/v1/ping"; then
    healthy=1
    break
  fi
  sleep "$POLL_INTERVAL_S"
done
if [ "$healthy" -ne 1 ]; then
  echo "check-hot-reload: FAIL -- SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" >&2
  cat "$START_LOG" >&2
  exit 1
fi

(
  cd "$REPO_ROOT/server" || exit 1
  # `exec` replaces this subshell's process image with `spacetime` itself,
  # rather than running it as a further child -- so $! below is the real
  # process, not an intermediary that can exit out from under it and leave
  # `spacetime` orphaned and unkillable by pid.
  exec spacetime dev --project-path . --module-path . --server-only --skip-generate --no-config \
    --server "$SERVER_URL" --yes "$DB_NAME"
) >"$DEV_LOG" 2>&1 &
DEV_PID=$!

describe() {
  spacetime describe --no-config --server "$SERVER_URL" --json "$DB_NAME" 2>/dev/null
}

deadline=$((SECONDS + REPUBLISH_DEADLINE_S))
published=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if describe >/dev/null; then
    published=1
    break
  fi
  sleep "$POLL_INTERVAL_S"
done
if [ "$published" -ne 1 ]; then
  echo "check-hot-reload: FAIL -- initial publish never completed within ${REPUBLISH_DEADLINE_S}s" >&2
  cat "$DEV_LOG" >&2
  exit 1
fi

{
  echo "// BEGIN $MARKER -- appended by scripts/dev/check-hot-reload.sh, removed on exit"
  echo "#[spacetimedb::reducer]"
  echo "pub fn $MARKER(_ctx: &spacetimedb::ReducerContext) -> Result<(), String> { Ok(()) }"
  echo "// END $MARKER"
} >>"$LIB_RS"
APPENDED=1

deadline=$((SECONDS + REPUBLISH_DEADLINE_S))
reloaded=0
next_nudge=$((SECONDS + NUDGE_INTERVAL_S))
while [ "$SECONDS" -lt "$deadline" ]; do
  if describe | grep -qF "$MARKER"; then
    reloaded=1
    break
  fi
  # The watcher can miss the file-change event that lands while it is
  # still arming right after the initial publish -- a re-touch (same
  # content, new mtime) costs nothing and is not a substitute for the
  # bounded poll above it, only a nudge inside it.
  if [ "$SECONDS" -ge "$next_nudge" ]; then
    touch "$LIB_RS"
    next_nudge=$((SECONDS + NUDGE_INTERVAL_S))
  fi
  sleep "$POLL_INTERVAL_S"
done

if [ "$reloaded" -ne 1 ]; then
  echo "check-hot-reload: FAIL -- edit was not republished within ${REPUBLISH_DEADLINE_S}s" >&2
  cat "$DEV_LOG" >&2
  exit 1
fi

echo "check-hot-reload: OK -- spacetime dev rebuilt and republished the edit without a manual step" >&2
exit 0
