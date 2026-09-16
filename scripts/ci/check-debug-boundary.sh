#!/usr/bin/env bash
# FR168 (Tim's direction, story 1.12): the debug tooling's gate is
# structural, not a sprinkling of `if (!import.meta.env.DEV) return`.
# Three things have to stay true for that to mean anything, and none of
# them is visible to a type checker:
#
#   1. `client/src/debug/` is imported from exactly one place --
#      `client/src/main.ts` -- so there is one gate rather than N.
#   2. That import is dynamic and sits inside an `import.meta.env.DEV`
#      branch, which is what makes Rollup drop the whole chunk from a
#      production build instead of shipping it switched off.
#   3. No SVG element is created anywhere under `client/src/` outside
#      `debug/`: the overlays are the only thing allowed to draw over the
#      canvas, and nothing else may grow a second, ungated way to do it.
#
# `client/biome.json`'s own override bans the import direction too, and is
# the fast feedback a developer gets; this is the second, independent
# check, for what a lint rule cannot promise -- that the override still
# exists at all, and that the one permitted import is still shaped the way
# the dead-code elimination depends on.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned client directory --
# `scripts/ci/tests/test-check-debug-boundary.sh`'s own use, so it can
# plant each violation in a throwaway tree rather than the real
# `client/src/`. CI itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"

[ -d "$SRC_DIR" ] || { echo "check-debug-boundary: $SRC_DIR not found" >&2; exit 1; }

# Every grep below runs from inside the scanned tree and reports relative
# paths. Deliberately, and not a style preference: on Windows an absolute
# path is `C:\Users\...`, and feeding one to `grep -v` as a *pattern*
# silently turns `\U`/`\A`/`\T` into regex escapes, so the exclusions
# quietly stop excluding anything (this check's own tests caught exactly
# that).
cd "$SRC_DIR"

FAILED=0

# --- 1. nothing but main.ts may import debug/ -------------------------------
# Matches a static, side-effect, type-only or dynamic import whose path
# names the `debug/` directory. `main.ts` is excluded by name: it is the
# one gate.
IMPORT_PATTERN='(from|import)[[:space:]]*\(?[[:space:]]*["'"'"'][^"'"'"']*(^|/)debug/'
IMPORTERS="$(grep -rnE "$IMPORT_PATTERN" . --include='*.ts' 2>/dev/null |
  grep -vE '^\./main\.ts:' |
  grep -vE '^\./debug/' || true)"
if [ -n "$IMPORTERS" ]; then
  echo "check-debug-boundary: FAIL -- only client/src/main.ts may import client/src/debug/ (FR168: one DEV-gated entry point, not N):" >&2
  echo "$IMPORTERS" >&2
  FAILED=1
fi

# --- 2. main.ts's own import is dynamic, and DEV-gated ----------------------
MAIN="./main.ts"
if [ ! -f "$MAIN" ]; then
  echo "check-debug-boundary: FAIL -- $MAIN not found (the one permitted importer)" >&2
  FAILED=1
else
  # A *static* import of debug/ would be emitted into the production
  # bundle whatever guard surrounded its use.
  STATIC="$(grep -nE '^[[:space:]]*import[[:space:]]+[^(]*["'"'"'][^"'"'"']*(^|/|\.)debug/' "$MAIN" |
    grep -vE '^[0-9]+:[[:space:]]*import[[:space:]]+type[[:space:]]' || true)"
  if [ -n "$STATIC" ]; then
    echo "check-debug-boundary: FAIL -- client/src/main.ts imports debug/ statically; only a dynamic import inside an import.meta.env.DEV branch is dropped from a production build:" >&2
    echo "$STATIC" >&2
    FAILED=1
  fi

  # `perl -0777`: the guard and the import it guards are on different
  # lines by construction, so this has to read the file as one string.
  # Requires an `import.meta.env.DEV` test textually just before the
  # dynamic `import("./debug/...")` -- close enough that the import is
  # plainly inside that branch, not merely somewhere later in the file.
  # Deliberately not `[^}]*`: the real call destructures
  # (`const { mountDebugOverlays } = await import(...)`), so a brace-free
  # window would reject exactly the shape this demands.
  if ! perl -0777 -ne 'exit(/import\.meta\.env\.DEV.{0,400}?await\s+import\(\s*["\x27][^"\x27]*debug\//s ? 0 : 1)' "$MAIN"; then
    echo "check-debug-boundary: FAIL -- client/src/main.ts has no 'if (import.meta.env.DEV) { ... await import(\"./debug/...\") }' branch; that exact shape is what makes Rollup drop the debug chunk entirely (AC1)" >&2
    FAILED=1
  fi
fi

# --- 3. SVG creation lives only under debug/ --------------------------------
# The overlays are the one thing allowed to draw over the canvas. A second
# module creating SVG elements would be a second, ungated overlay surface
# -- and one that FR151's DOM-surface allowlist would never see either.
SVG_CREATORS="$(grep -rn 'createElementNS' . --include='*.ts' --exclude-dir=bindings 2>/dev/null |
  grep -vE '^\./debug/' || true)"
if [ -n "$SVG_CREATORS" ]; then
  echo "check-debug-boundary: FAIL -- createElementNS outside client/src/debug/: SVG over the canvas is the debug overlays' surface alone (story 1.12):" >&2
  echo "$SVG_CREATORS" >&2
  FAILED=1
fi

# --- the Biome override is the other half of (1) ----------------------------
BIOME_CONFIG="$REPO_ROOT/client/biome.json"
if [ -f "$BIOME_CONFIG" ] && ! grep -q '\.\./debug/\*\*' "$BIOME_CONFIG"; then
  echo "check-debug-boundary: FAIL -- client/biome.json no longer bans '../debug/**' anywhere (the import ban on the debug directory was removed)" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-debug-boundary: debug/ is reached only by main.ts's DEV-gated dynamic import, and owns every SVG element under client/src/" >&2
exit 0
