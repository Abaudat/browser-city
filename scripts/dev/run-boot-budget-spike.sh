#!/usr/bin/env bash
# Story 1.14's one-command re-run entry point (Tim/Quentin's direction,
# same discipline as scripts/dev/run-sched-timing-spike.sh). Builds the
# real *production* client (`npm run build`, never the dev server),
# serves it with `vite preview`, publishes `server` (browser_city) and
# `server/spikes/boot_budget` each to their own disposable local
# SpacetimeDB database, runs the `boot` Playwright project (milestone
# marks/Resource Timing sweep, then D4's row-count decode sweep) against
# them, and reduces the raw JSON it writes into
# docs/spikes/1.14-boot-budget.md via generate-boot-budget-report.mjs.
# Tears every process and database down at the end.
#
# Crew (the implementer role) never deploys to Maincloud and never points
# this at one -- that is CI's job, never a manual step. There is
# deliberately no Maincloud override here (unlike SCHED_TIMING_SERVER):
# NFR1 is about a player's own machine and connection, not the server's,
# so a local SpacetimeDB instance already measures the right thing.
#
# Configuration (every default is what this script's own committed run
# used):
#   BC_BOOT_SAMPLES          cold samples per network/CPU profile for the
#                            milestone sweep (default 20 -- Quentin's floor)
#   BC_BOOT_DECODE_SAMPLES   cold samples per row-count/network/CPU point
#                            for the decode sweep (default 20)
#   BC_BOOT_OUT_DIR          where raw JSON and report.md land (default a
#                            disposable temp dir; point this at
#                            docs/spikes/1.14-boot-budget/ to produce a
#                            committable run)
#   BC_BOOT_HOST_LABEL       overrides the report header's host label
#   BC_BOOT_SKIP_DECODE      set to skip D4's row-count sweep entirely
#                            (faster iteration on the milestone half only)
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT_DIR="$REPO_ROOT/client"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-boot-budget.XXXXXX")"
OUT_DIR="${BC_BOOT_OUT_DIR:-$DATA_DIR/out}"
mkdir -p "$OUT_DIR"
START_LOG="$DATA_DIR/spacetime-start.log"
HEALTH_DEADLINE_S=30
POLL_INTERVAL_S=1

SAMPLES="${BC_BOOT_SAMPLES:-20}"
DECODE_SAMPLES="${BC_BOOT_DECODE_SAMPLES:-20}"

SPACETIME_PORT=""
MAIN_PREVIEW_PORT=""
DECODE_PREVIEW_PORT=""
SPACETIME_PID=""
MAIN_PREVIEW_PID=""
DECODE_PREVIEW_PID=""
MAIN_DB=""
DECODE_DB=""

fail() { # <message> [log-file]
  echo "run-boot-budget-spike: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}

kill_tree() { # <msys-pid>
  local pid="$1" winpid=""
  [ -n "$pid" ] || return 0
  if command -v taskkill >/dev/null 2>&1; then
    winpid="$(ps -l 2>/dev/null | awk -v p="$pid" '$1 == p { print $4 }')"
    taskkill //F //T //PID "${winpid:-$pid}" >/dev/null 2>&1
  fi
  kill "$pid" 2>/dev/null
}

cleanup() {
  kill_tree "$MAIN_PREVIEW_PID"
  kill_tree "$DECODE_PREVIEW_PID"
  if [ -n "$MAIN_DB" ]; then
    spacetime delete "$MAIN_DB" --server "http://127.0.0.1:$SPACETIME_PORT" --no-config -y >/dev/null 2>&1
  fi
  if [ -n "$DECODE_DB" ]; then
    spacetime delete "$DECODE_DB" --server "http://127.0.0.1:$SPACETIME_PORT" --no-config -y >/dev/null 2>&1
  fi
  kill_tree "$SPACETIME_PID"
  rm -rf "$DATA_DIR" "$CLIENT_DIR/dist-boot-budget-decode"
}
trap cleanup EXIT

command -v spacetime >/dev/null 2>&1 || fail "'spacetime' is not on PATH"
command -v node >/dev/null 2>&1 || fail "'node' is not on PATH"

free_port() {
  node -e "
    const net = require('node:net');
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => console.log(port));
    });
  "
}

wait_healthy() { # <url> <label>
  local deadline=$((SECONDS + HEALTH_DEADLINE_S))
  while [ "$SECONDS" -lt "$deadline" ]; do
    curl -sf -o /dev/null "$1" && return 0
    sleep "$POLL_INTERVAL_S"
  done
  return 1
}

VERSION_OUTPUT="$(spacetime --version 2>&1)"
SPACETIME_VERSION="$(printf '%s' "$VERSION_OUTPUT" | grep -oE 'spacetimedb tool version [0-9]+\.[0-9]+\.[0-9]+' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
[ -n "$SPACETIME_VERSION" ] || fail "could not parse a version out of 'spacetime --version':" <(printf '%s' "$VERSION_OUTPUT")
HOST_LABEL="${BC_BOOT_HOST_LABEL:-$(hostname 2>/dev/null || echo unknown-host)}"
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST_INFO_JSON="$DATA_DIR/host-info.json"
node -e "
  const os = require('node:os');
  const cpus = os.cpus();
  console.log(JSON.stringify({
    hostLabel: process.argv[1],
    cpuModel: cpus[0] ? cpus[0].model : 'unknown',
    logicalCores: cpus.length,
    totalMemBytes: os.totalmem(),
    platform: os.platform(),
    release: os.release(),
    ci: process.env.GITHUB_ACTIONS === 'true',
  }));
" "$HOST_LABEL" >"$HOST_INFO_JSON"

# Quentin's direction: pin the measured versions (SpacetimeDB, Pixi,
# browser), not only SpacetimeDB's. `cd` first, then a bare/relative
# `require` -- passing the msys-style path string straight into `require()`
# does not resolve under a Windows-native `node` binary.
PIXI_VERSION="$(cd "$CLIENT_DIR" && node -e "console.log(require('./package.json').dependencies['pixi.js'])")"
PLAYWRIGHT_VERSION="$(cd "$CLIENT_DIR" && node -e "console.log(require('@playwright/test/package.json').version)")"
BROWSER_VERSION="$(cd "$CLIENT_DIR" && node -e "
  const { chromium } = require('playwright-core');
  (async () => {
    const b = await chromium.launch();
    console.log(b.version());
    await b.close();
  })();
")"

echo "run-boot-budget-spike: SpacetimeDB $SPACETIME_VERSION on $HOST_LABEL, started $RUN_DATE" >&2

# Quentin's direction: commit the run's own metadata next to the raw JSON
# so the exact report can be rebuilt from the repo alone -- never
# re-detected fresh on a later regeneration, which would put a new date
# into a diff of otherwise-unchanged numbers.
METADATA_JSON="$OUT_DIR/run-metadata.json"
node -e "
  const hostInfo = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf-8'));
  console.log(JSON.stringify({
    spacetimeVersion: process.argv[2],
    runDate: process.argv[3],
    pixiVersion: process.argv[4],
    browserVersion: process.argv[5],
    playwrightVersion: process.argv[6],
    hostInfo,
  }, null, 2));
" "$HOST_INFO_JSON" "$SPACETIME_VERSION" "$RUN_DATE" "$PIXI_VERSION" "$BROWSER_VERSION" "$PLAYWRIGHT_VERSION" >"$METADATA_JSON"

SPACETIME_PORT="$(free_port)"
SERVER_URL="http://127.0.0.1:$SPACETIME_PORT"
spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$SPACETIME_PORT" >"$START_LOG" 2>&1 &
SPACETIME_PID=$!
wait_healthy "$SERVER_URL/v1/ping" "SpacetimeDB" || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"
echo "run-boot-budget-spike: local SpacetimeDB healthy on $SERVER_URL" >&2

# --- The real client, against the real module (demo_ping only today) ---
MAIN_DB="bc-boot-budget-main-$$"
spacetime publish --server "$SERVER_URL" --no-config -y "$MAIN_DB" --module-path "$REPO_ROOT/server" >"$DATA_DIR/publish-main.log" 2>&1 \
  || fail "could not publish server/ (browser_city)" "$DATA_DIR/publish-main.log"

( cd "$CLIENT_DIR" && VITE_SPACETIME_URI="ws://127.0.0.1:$SPACETIME_PORT" VITE_SPACETIME_DB="$MAIN_DB" npm run build ) >"$DATA_DIR/build-main.log" 2>&1 \
  || fail "'npm run build' (production client) failed" "$DATA_DIR/build-main.log"

MAIN_PREVIEW_PORT="$(free_port)"
( cd "$CLIENT_DIR" && npx vite preview --port "$MAIN_PREVIEW_PORT" ) >"$DATA_DIR/preview-main.log" 2>&1 &
MAIN_PREVIEW_PID=$!
MAIN_PREVIEW_URL="http://127.0.0.1:$MAIN_PREVIEW_PORT"
wait_healthy "$MAIN_PREVIEW_URL/" "production preview" || fail "'vite preview' (production client) did not become healthy" "$DATA_DIR/preview-main.log"
echo "run-boot-budget-spike: production build served at $MAIN_PREVIEW_URL" >&2

# --- D4's decode-only harness, against server/spikes/boot_budget ---
DECODE_ENV=()
if [ -z "${BC_BOOT_SKIP_DECODE:-}" ]; then
  DECODE_DB="bc-boot-budget-decode-$$"
  spacetime publish --server "$SERVER_URL" --no-config -y "$DECODE_DB" --module-path "$REPO_ROOT/server/spikes/boot_budget" >"$DATA_DIR/publish-decode.log" 2>&1 \
    || fail "could not publish server/spikes/boot_budget" "$DATA_DIR/publish-decode.log"

  ( cd "$CLIENT_DIR" && npx vite build --config tests/e2e/boot-budget/vite.decode.config.ts ) >"$DATA_DIR/build-decode.log" 2>&1 \
    || fail "building the decode harness failed" "$DATA_DIR/build-decode.log"

  DECODE_PREVIEW_PORT="$(free_port)"
  ( cd "$CLIENT_DIR" && npx vite preview --config tests/e2e/boot-budget/vite.decode.config.ts --port "$DECODE_PREVIEW_PORT" ) >"$DATA_DIR/preview-decode.log" 2>&1 &
  DECODE_PREVIEW_PID=$!
  DECODE_PREVIEW_URL="http://127.0.0.1:$DECODE_PREVIEW_PORT/decode-harness.html"
  wait_healthy "http://127.0.0.1:$DECODE_PREVIEW_PORT/decode-harness.html" "decode harness preview" \
    || fail "'vite preview' (decode harness) did not become healthy" "$DATA_DIR/preview-decode.log"
  echo "run-boot-budget-spike: decode harness served at $DECODE_PREVIEW_URL, database '$DECODE_DB'" >&2

  DECODE_ENV=(
    "BC_BOOT_DECODE_URL=$DECODE_PREVIEW_URL"
    "BC_BOOT_DECODE_SERVER_URL=$SERVER_URL"
    "BC_BOOT_DECODE_DB_NAME=$DECODE_DB"
    "BC_BOOT_DECODE_SAMPLES=$DECODE_SAMPLES"
  )
else
  echo "run-boot-budget-spike: BC_BOOT_SKIP_DECODE set -- D4's row-count sweep will not run" >&2
fi

# --- Run the harness itself ---
( cd "$CLIENT_DIR" && env \
    BC_BOOT_PREVIEW_URL="$MAIN_PREVIEW_URL" \
    BC_BOOT_SAMPLES="$SAMPLES" \
    BC_BOOT_OUT_DIR="$OUT_DIR" \
    "${DECODE_ENV[@]}" \
    npx playwright test --project=boot ) 2>&1 | tee "$DATA_DIR/playwright.log"
PLAYWRIGHT_STATUS=${PIPESTATUS[0]:-$?}
[ "$PLAYWRIGHT_STATUS" -eq 0 ] || fail "the boot Playwright project failed (see above)" "$DATA_DIR/playwright.log"

# --- Reduce the raw JSON into the committed report ---
node "$REPO_ROOT/scripts/dev/generate-boot-budget-report.mjs" \
  --raw-dir "$OUT_DIR" \
  --out "$OUT_DIR/report.md" \
  --metadata "$METADATA_JSON" \
  || fail "generate-boot-budget-report.mjs failed"

echo "run-boot-budget-spike: wrote $OUT_DIR/report.md" >&2
echo "run-boot-budget-spike: done. Raw JSON and report.md are in $OUT_DIR" >&2
