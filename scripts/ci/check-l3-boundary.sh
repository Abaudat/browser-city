#!/usr/bin/env bash
# Story 5.1 (FR63, FR64, NFR23): `client/src/l3/**` can reach nothing but
# itself and the defs types. A module specifier under `l3/` is `./...` or
# `../defs/types`; anything else -- a bare package, the network, the renderer,
# the DOM, the player's movement code, a clock -- fails. L3 cannot write to the
# ledger because it has no import path to anything that does (NFR23), performs
# no sub-tile collision because it cannot reach the resolver (FR63), and is a
# pure function of the time it is handed because it cannot read one.
#
# It also fails if anything under `client/src/net/` imports `l3/`, and if
# `client/biome.json` loses its `src/l3/**` override or its ban on importing
# `l3/` from `src/net/**` (the fast feedback a developer gets).
#
# Story 5.24 (D-L3): the L3 solve runs in a worker, wired by `client/src/
# l3-worker/`. That adapter may import only itself, `l3/`, the defs types, the
# pure world modules (`body-zone`, `chunk`, `region`, `walk-mirror`) and the two
# pure fixture modules the solve is built on (`test-street/street-life`,
# `test-street/timetable`); never Pixi, `net/`, `render/`, the DOM, a timer or
# randomness. `worker.ts` alone may read the clock and the worker's `self`.
#
# Usage: check-l3-boundary.sh [l3 dir] [net dir] [adapter dir]   (the test plants violations)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/client/src/l3"}"
NET_DIR="${2:-"$REPO_ROOT/client/src/net"}"
ADAPTER_DIR="${3:-"$REPO_ROOT/client/src/l3-worker"}"

[ -d "$SRC_DIR" ] || { echo "check-l3-boundary: $SRC_DIR not found" >&2; exit 1; }

FAILED=0
fail() { echo "check-l3-boundary: FAIL -- $1" >&2; FAILED=1; }

# Every module specifier: static, side-effect, type-only, re-export, dynamic,
# require.
Q="[\"']"
SPEC_PATTERN="(from|import|require)[[:space:]]*\(?[[:space:]]*${Q}[^\"']+${Q}"
BAD=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  spec="$(printf '%s' "$hit" | sed -E "s/^.*[\"']([^\"']+)[\"']\$/\\1/")"
  case "$spec" in
    ../defs/types) ;;
    *..*) BAD+="$hit"$'\n' ;;
    ./*) ;;
    *) BAD+="$hit"$'\n' ;;
  esac
done < <(grep -rnoE "$SPEC_PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null | tr -d '\r' || true)
# L3 has no reason to import dynamically, and a computed specifier cannot be read.
DYNAMIC="$(grep -rnE "(^|[^A-Za-z0-9_.\$])import[[:space:]]*\(" "$SRC_DIR" --include='*.ts' 2>/dev/null \
  | tr -d '\r' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
if [ -n "$DYNAMIC" ]; then
  fail "client/src/l3/ must not import dynamically:"
  echo "$DYNAMIC" >&2
fi
if [ -n "$BAD" ]; then
  fail "client/src/l3/ may import only ./... and ../defs/types (NFR23, FR63):"
  printf '%s' "$BAD" >&2
fi

# Globals that reach the DOM, the network, storage, a clock, a timer or
# randomness, outside comment lines.
NAMES='performance|Date|window|document|globalThis|self|navigator|fetch|WebSocket|XMLHttpRequest|localStorage|sessionStorage|crypto|requestAnimationFrame|setTimeout|setInterval|Math\.random'
GLOBAL_PATTERN="(^|[^A-Za-z0-9_.\$])(${NAMES})([^A-Za-z0-9_]|\$)"
GLOBALS="$(grep -rnE "$GLOBAL_PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null \
  | tr -d '\r' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
if [ -n "$GLOBALS" ]; then
  fail "client/src/l3/ must not use the DOM, the network, storage, timers, a clock or randomness (time is an argument):"
  echo "$GLOBALS" >&2
fi

# Story 5.2 (NFR26): a number two clients must agree on comes from the one seed
# module and from arithmetic every engine rounds the same way. `Math` is used
# only through the correctly rounded allowlist -- no alias, no destructuring,
# no computed member -- and the integer mixer and its hash constants live in
# `seed.ts` alone, so a second hand-rolled hash cannot slip in.
MATH_ALLOWED='abs|floor|ceil|round|trunc|min|max|sqrt|imul|sign'
CODE_LINES="$(grep -rnE 'Math|Reflect|Object\.' "$SRC_DIR" --include='*.ts' 2>/dev/null \
  | tr -d '\r' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
MATH_BAD="$(printf '%s\n' "$CODE_LINES" \
  | grep -P "(?<![A-Za-z0-9_\$.])Math(?![A-Za-z0-9_\$])(?!\.(?:${MATH_ALLOWED})(?![A-Za-z0-9_\$]))" || true)"
if [ -n "$MATH_BAD" ]; then
  fail "client/src/l3/ may use only Math.{${MATH_ALLOWED}}, called directly (no alias, destructuring or computed member):"
  echo "$MATH_BAD" >&2
fi
REFLECT="$(printf '%s\n' "$CODE_LINES" | grep -E '(Reflect|Object)\.[a-zA-Z]+\(.*Math' || true)"
if [ -n "$REFLECT" ]; then
  fail "client/src/l3/ must not reach Math through Reflect or Object:"
  echo "$REFLECT" >&2
fi
HASH="$(grep -rnE 'Math\.imul|0x[0-9a-fA-F]{8}([^0-9a-fA-F]|$)' "$SRC_DIR" --include='*.ts' 2>/dev/null \
  | tr -d '\r' | grep -vE '/seed\.ts:' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
if [ -n "$HASH" ]; then
  fail "client/src/l3/ may mix integers and hold hash constants only in seed.ts:"
  echo "$HASH" >&2
fi

# The L3 worker's adapter reaches only the pure modules it is built on.
if [ -d "$ADAPTER_DIR" ]; then
  ADAPTER_BAD=""
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    spec="$(printf '%s' "$hit" | sed -E "s/^.*[\"']([^\"']+)[\"']\$/\1/")"
    case "$spec" in
      ./*) ;;
      ../l3/*|../defs/types) ;;
      ../world/body-zone|../world/chunk|../world/region|../world/walk-mirror) ;;
      ../test-street/street-life|../test-street/timetable) ;;
      *) ADAPTER_BAD+="$hit"$'\n' ;;
    esac
  done < <(grep -rnoE "$SPEC_PATTERN" "$ADAPTER_DIR" --include='*.ts' 2>/dev/null | tr -d '\r' || true)
  if [ -n "$ADAPTER_BAD" ]; then
    fail "client/src/l3-worker/ may import only itself, l3/, the defs types, world/{body-zone,chunk,region,walk-mirror} and test-street/{street-life,timetable}:"
    printf '%s' "$ADAPTER_BAD" >&2
  fi
  ADAPTER_DYNAMIC="$(grep -rnE "(^|[^A-Za-z0-9_.\$])import[[:space:]]*\(" "$ADAPTER_DIR" --include='*.ts' 2>/dev/null \
    | tr -d '\r' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
  if [ -n "$ADAPTER_DYNAMIC" ]; then
    fail "client/src/l3-worker/ must not import dynamically:"
    echo "$ADAPTER_DYNAMIC" >&2
  fi
  # No DOM, network, storage, timer or randomness anywhere in it; the clock
  # and the worker's own scope only in worker.ts.
  ADAPTER_NAMES='Date|window|document|globalThis|navigator|fetch|WebSocket|XMLHttpRequest|localStorage|sessionStorage|crypto|requestAnimationFrame|setTimeout|setInterval|Math\.random'
  ADAPTER_GLOBALS="$(grep -rnE "(^|[^A-Za-z0-9_.\$])(${ADAPTER_NAMES})([^A-Za-z0-9_]|\$)" "$ADAPTER_DIR" --include='*.ts' 2>/dev/null \
    | tr -d '\r' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
  if [ -n "$ADAPTER_GLOBALS" ]; then
    fail "client/src/l3-worker/ must not use the DOM, the network, storage, timers or randomness:"
    echo "$ADAPTER_GLOBALS" >&2
  fi
  CLOCK="$(grep -rnE "(^|[^A-Za-z0-9_.\$])(performance|self)([^A-Za-z0-9_]|\$)" "$ADAPTER_DIR" --include='*.ts' 2>/dev/null \
    | tr -d '\r' | grep -vE '/worker\.ts:' | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
  if [ -n "$CLOCK" ]; then
    fail "client/src/l3-worker/ reads the clock or self only in worker.ts:"
    echo "$CLOCK" >&2
  fi
fi

# Nothing under net/ reaches l3/ or its worker.
if [ -d "$NET_DIR" ]; then
  NET_HITS="$(grep -rnE "(from|import|require)[[:space:]]*\(?[[:space:]]*${Q}(\.\./)+l3(-worker)?(/|${Q})" "$NET_DIR" --include='*.ts' 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$NET_HITS" ]; then
    fail "client/src/net/ must not import l3/ or l3-worker/:"
    echo "$NET_HITS" >&2
  fi
fi

BIOME_CONFIG="$REPO_ROOT/client/biome.json"
if [ -f "$BIOME_CONFIG" ]; then
  grep -q '"src/l3/\*\*"' "$BIOME_CONFIG" || fail "client/biome.json has no src/l3/** override left"
  grep -q '"\.\./l3/\*\*"' "$BIOME_CONFIG" || fail "client/biome.json has no ban on importing l3/ from src/net/**"
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "check-l3-boundary: client/src/l3/ reaches only itself and the defs types; net/ never reaches l3/ (FR63, NFR23)" >&2
exit 0
