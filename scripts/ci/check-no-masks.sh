#!/usr/bin/env bash
# FR121 (Quentin's direction, story 1.7): the window see-through effect is
# plain sprite alpha, nothing else -- no masks, filters, render textures or
# stencils anywhere under client/src/. Biome's `noRestrictedImports` can
# ban an import, but not a property access like `.mask` or a call like
# `setMask(...)`, so this is a mechanical grep instead, run by
# `client-check` alongside the rest of the client-only guards.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-no-masks.sh`'s own use, so it can plant
# each banned construct in a throwaway temp file rather than the real
# `client/src/`. `client-check` itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"

[ -d "$SRC_DIR" ] || { echo "check-no-masks: $SRC_DIR not found" >&2; exit 1; }

# Word-boundary, case-sensitive patterns on identifiers only (Tim's
# direction, story 1.7 cycle 2 -- the original pattern missed a `{ mask: g
# }` constructor option, any `*Filter` class, `filterArea` and `stencil`):
# `mask =`/`mask:` and `filters =`/`filters:` (an assignment or
# object-literal option -- deliberately not `mask\b`/`filters?\b` alone,
# which would also flag this script's own legitimate `view.mask === null`
# read proving the opposite (that nothing sets one) and every ordinary
# `Array.prototype.filter(...)` call in the codebase), `setMask(`, any
# Pixi filter class (`AlphaFilter`, `BlurFilter`, ...), `filterArea`,
# `RenderTexture` and `stencil`. `src/net/bindings` is generated and never
# touches rendering, but is excluded anyway for the same reason other
# checks exclude it.
PATTERN='\bmask\s*=[^=]|\bmask\s*:|\bfilters\s*=[^=]|\bfilters\s*:|\bsetMask\(|\w*Filter\b|\bfilterArea\b|\bRenderTexture\b|\bstencil\b'

MATCHES="$(grep -rnE "$PATTERN" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"

# FR173/FR121 (Tim's direction, story 1.15): a Pixi v8 blend mode is either
# one of the four renderer-native basic modes (`normal`/`add`/`multiply`/
# `screen`, `render/highlight.ts`'s own `BASIC_BLEND_MODES`) or an
# "advanced" one implemented as a filter under the hood -- which FR121 bans
# and the pattern above cannot see, because a blend mode is neither a mask
# nor a named `*Filter` class. What actually makes "a blend mode is not a
# filter" true by construction in Pixi v8 is the import ban below: an
# advanced mode does nothing at all unless `pixi.js/advanced-blend-modes`
# has been imported to register it, so banning that import is the real
# guarantee. The literal-assignment check that follows is kept alongside it
# as the earlier, more readable failure for the common case -- a direct
# `.blendMode = "<mode>"` or `{ blendMode: "<mode>" }` naming anything but
# the four basic modes -- never a ban on the mode names as bare strings
# (`"overlay"` and `"color"` are also legitimate identifiers elsewhere in
# this codebase, story 1.12's debug overlays included, and would false-
# positive).
ADVANCED_IMPORT_MATCHES="$(grep -rnE "from[[:space:]]*[\"']pixi\.js/advanced-blend-modes[\"']" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"

BLEND_ASSIGN_MATCHES="$(grep -rnoE "blendMode[[:space:]]*[=:][[:space:]]*[\"'][a-zA-Z-]+[\"']" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"
BAD_BLEND_MATCHES=""
if [ -n "$BLEND_ASSIGN_MATCHES" ]; then
  while IFS= read -r line; do
    mode="$(printf '%s\n' "$line" | grep -oE "[a-zA-Z-]+[\"']$" | tr -d "\"'")"
    case "$mode" in
      normal | add | multiply | screen) ;;
      *) BAD_BLEND_MATCHES="$BAD_BLEND_MATCHES
$line" ;;
    esac
  done <<EOF
$BLEND_ASSIGN_MATCHES
EOF
fi

if [ -n "$MATCHES" ] || [ -n "$ADVANCED_IMPORT_MATCHES" ] || [ -n "$BAD_BLEND_MATCHES" ]; then
  echo "check-no-masks: FAIL -- a masking/filter/render-texture/advanced-blend-mode construct was found under client/src/ (FR121 bans it):" >&2
  [ -n "$MATCHES" ] && echo "$MATCHES" >&2
  [ -n "$ADVANCED_IMPORT_MATCHES" ] && echo "$ADVANCED_IMPORT_MATCHES" >&2
  [ -n "$BAD_BLEND_MATCHES" ] && echo "$BAD_BLEND_MATCHES" >&2
  exit 1
fi

echo "check-no-masks: no mask, filter, render-texture or advanced-blend-mode construct under client/src/ (FR121)" >&2
exit 0
