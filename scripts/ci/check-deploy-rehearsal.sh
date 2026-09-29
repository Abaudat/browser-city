#!/usr/bin/env bash
# Rehearses a deploy against the shape the live database actually has: a
# world whose `init` belonged to an older module than the one being
# published (a republish never re-runs `init`).
#   1. publishes the module from LIVE_DATABASE_BORN_AT (its `server/`,
#      extracted with `git archive`) onto a disposable local instance;
#   2. publishes HEAD's `server/` over it;
#   3. runs every post-publish `spacetime call` step of `deploy.yml`'s
#      `publish-module` job, parsed out of the workflow (never a
#      hand-copied list, so a step added later is rehearsed
#      automatically), twice -- each must exit 0, and the second run must
#      leave the epoch byte-identical to the first;
#   4. runs scripts/ops/assert-world-invariants.sh;
#   5. asserts the epoch a legacy world was repaired to is a moment inside
#      the post-publish sequence (dawn at repair time), and that an
#      anonymous `finish_publish` is rejected with the owner-check message.
#
# Assumption: additivity is transitive for the adds NFR33 allows, so
# born-sha straight to HEAD stands in for every generation in between.
#
# Runs in CI's `migrate` job (needs full history for `git archive`), on its
# own port, 3994.
set -uo pipefail

# The commit whose `init` ran on Maincloud: the headSha of the first
# successful `deploy.yml` run (`gh run list --workflow deploy.yml`). It
# changes only if the live database is ever recreated via restore-world.sh.
LIVE_DATABASE_BORN_AT=a4288f294e7ca9f8caabeb4711e918b8d788faa1

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bc-deploy-rehearsal.XXXXXX")"
PORT=3994
SERVER_URL="http://127.0.0.1:$PORT"
DB=bc-deploy-rehearsal
WORKFLOW="$REPO_ROOT/.github/workflows/deploy.yml"
START_LOG="$DATA_DIR/start.log"
OWNER_REJECTION_PATTERN="this reducer may only be invoked by the module owner"
START_PID=""

cleanup() {
  bc_stop_spacetime "$START_PID"
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-deploy-rehearsal: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

# The post-publish `spacetime call` commands of publish-module, in order,
# retargeted at the local instance.
POST_PUBLISH_CALLS="$(awk '
  /^  publish-module:$/ { inblock = 1; next }
  inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
  inblock && /^ +run: spacetime call / { sub(/^ +run: /, ""); print }
' "$WORKFLOW" | sed "s#--server maincloud#--server $SERVER_URL#")"
[ -n "$POST_PUBLISH_CALLS" ] || fail "found no 'spacetime call' step in $WORKFLOW's publish-module job"

git -C "$REPO_ROOT" cat-file -e "$LIVE_DATABASE_BORN_AT^{commit}" 2>/dev/null \
  || fail "commit $LIVE_DATABASE_BORN_AT is not in this clone -- the checkout must have full history (fetch-depth: 0)"
BORN_DIR="$DATA_DIR/born"
mkdir -p "$BORN_DIR"
git -C "$REPO_ROOT" archive "$LIVE_DATABASE_BORN_AT" server | tar -x -C "$BORN_DIR" \
  || fail "could not extract server/ at $LIVE_DATABASE_BORN_AT"

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" 30 || fail "SpacetimeDB did not become healthy within 30s" "$START_LOG"

publish() { # <module-dir> <log>
  spacetime publish --server "$SERVER_URL" --no-config -y "$DB" --module-path "$1" >"$2" 2>&1
}

echo "check-deploy-rehearsal: publishing the module the live database was born at ($LIVE_DATABASE_BORN_AT)" >&2
publish "$BORN_DIR/server" "$DATA_DIR/born.log" || fail "could not publish the born-at module" "$DATA_DIR/born.log"
echo "check-deploy-rehearsal: publishing HEAD over it" >&2
publish "$REPO_ROOT/server" "$DATA_DIR/head.log" || fail "could not publish HEAD's server/ over the born-at world" "$DATA_DIR/head.log"

epoch_micros() { # prints world_clock.epoch_at as-is (an ISO timestamp), empty if no row
  local log="$DATA_DIR/epoch.log"
  spacetime sql "$DB" --server "$SERVER_URL" --no-config -y "SELECT epoch_at FROM world_clock" >"$log" 2>&1 \
    || fail "could not query world_clock" "$log"
  awk '/^[- +]+$/ { seen=1; next } seen && NF' "$log" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?' | head -n1
}
epoch_seconds() { date -u -d "${1%%.*}" +%s; }

run_post_publish() { # <tag>
  local i=0 cmd
  while IFS= read -r cmd; do
    i=$((i + 1))
    BACKUP_DATABASE="$DB" bash -c "$cmd" >"$DATA_DIR/post-$1-$i.log" 2>&1 \
      || fail "post-publish step '$cmd' exited non-zero ($1 run)" "$DATA_DIR/post-$1-$i.log"
  done <<<"$POST_PUBLISH_CALLS"
}

# Wall-clock bounds for the repaired epoch, in seconds (this machine's
# clock is the instance's). One second of slack either side.
BEFORE_S=$(( $(date +%s) - 1 ))
run_post_publish first
AFTER_S=$(( $(date +%s) + 1 ))

EPOCH_FIRST="$(epoch_micros)"
[ -n "$EPOCH_FIRST" ] || fail "world_clock is still empty after the post-publish steps -- a world born before the table existed is never repaired"
EPOCH_FIRST_S="$(epoch_seconds "$EPOCH_FIRST")"
{ [ "$EPOCH_FIRST_S" -ge "$BEFORE_S" ] && [ "$EPOCH_FIRST_S" -le "$AFTER_S" ]; } \
  || fail "the repaired epoch ($EPOCH_FIRST) is not dawn at repair time (expected within [$BEFORE_S, $AFTER_S] epoch seconds)"

bash "$REPO_ROOT/scripts/ops/assert-world-invariants.sh" "$DB" --server "$SERVER_URL" \
  || fail "the world is inconsistent after the post-publish steps"

sleep 2
run_post_publish second
EPOCH_SECOND="$(epoch_micros)"
[ "$EPOCH_SECOND" = "$EPOCH_FIRST" ] || fail "the epoch changed across a second post-publish run ($EPOCH_FIRST -> $EPOCH_SECOND) -- the sequence is not idempotent"
bash "$REPO_ROOT/scripts/ops/assert-world-invariants.sh" "$DB" --server "$SERVER_URL" \
  || fail "the world is inconsistent after a second post-publish run"

if spacetime call "$DB" --server "$SERVER_URL" --no-config -y --anonymous finish_publish >"$DATA_DIR/anon.log" 2>&1; then
  fail "finish_publish accepted an anonymous caller; it must be rejected" "$DATA_DIR/anon.log"
fi
grep -qF "$OWNER_REJECTION_PATTERN" "$DATA_DIR/anon.log" \
  || fail "finish_publish rejected the anonymous call, but not with the owner-check message" "$DATA_DIR/anon.log"

echo "check-deploy-rehearsal: ok -- a world born at $LIVE_DATABASE_BORN_AT survives a HEAD deploy: repaired epoch $EPOCH_FIRST, idempotent, owner-only" >&2
