#!/usr/bin/env bash
# Story 5.1 (FR63, FR64, NFR23): nothing under `client/src/l3/**` may reach the
# network, the renderer, the DOM, the player's movement code or a clock. L3
# cannot write to the ledger because it has no import path to anything that
# does (NFR23), performs no sub-tile collision because it cannot reach the
# resolver (FR63), and is a pure function of the time it is handed because it
# cannot read one.
#
# `client/biome.json`'s `src/l3/**` override bans the same imports for fast
# feedback; this is the second, independent check, and also fails if the
# override is deleted.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory (the test plants
# each violation in a temp dir).
SRC_DIR="${1:-"$REPO_ROOT/client/src/l3"}"

[ -d "$SRC_DIR" ] || { echo "check-l3-boundary: $SRC_DIR not found" >&2; exit 1; }

# A module specifier naming net/, test-street/, ui/, input/, the player's
# movement or floor-walk modules, or pixi.js -- static, side-effect, type-only
# or dynamic import.
Q='["'"'"']'
IMPORT_PATTERN="(from|import)[[:space:]]*\(?[[:space:]]*${Q}[^\"']*((^|/)(net|test-street|ui|input)(/|${Q})|world/(movement|floor-walk)(\.ts)?${Q}|pixi\.js)"
# DOM globals and ambient clocks/randomness, outside comment lines.
GLOBAL_PATTERN='(^|[^A-Za-z0-9_.])(window|document)[^A-Za-z0-9_]|Math\.random|Date\.now|performance\.now|new Date\('

FAILED=0
IMPORTS="$(grep -rnE "$IMPORT_PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null || true)"
if [ -n "$IMPORTS" ]; then
  echo "check-l3-boundary: FAIL -- client/src/l3/ must not import net/, test-street/, ui/, input/, world/movement, world/floor-walk or pixi.js (NFR23, FR63):" >&2
  echo "$IMPORTS" >&2
  FAILED=1
fi

GLOBALS="$(grep -rnE "$GLOBAL_PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null \
  | grep -vE '\.ts:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
if [ -n "$GLOBALS" ]; then
  echo "check-l3-boundary: FAIL -- client/src/l3/ must not use window, document, Math.random, Date.now, performance.now or new Date (time is an argument):" >&2
  echo "$GLOBALS" >&2
  FAILED=1
fi

BIOME_CONFIG="$REPO_ROOT/client/biome.json"
if [ -f "$BIOME_CONFIG" ] && ! grep -q '"src/l3/\*\*"' "$BIOME_CONFIG"; then
  echo "check-l3-boundary: FAIL -- client/biome.json has no src/l3/** override left (the import ban on L3 was removed)" >&2
  FAILED=1
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "check-l3-boundary: client/src/l3/ reaches no network, renderer, DOM, movement code or clock (FR63, NFR23)" >&2
exit 0
