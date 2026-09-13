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

if [ -n "$MATCHES" ]; then
  echo "check-no-masks: FAIL -- a masking/filter/render-texture construct was found under client/src/ (FR121 bans it):" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-masks: no mask, filter or render-texture construct under client/src/ (FR121)" >&2
exit 0
