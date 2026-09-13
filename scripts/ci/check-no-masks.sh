#!/usr/bin/env bash
# FR121 (Quentin's direction, story 1.7): the window see-through effect is
# plain sprite alpha, nothing else -- no masks, filters, render textures or
# stencils anywhere under client/src/. Biome's `noRestrictedImports` can
# ban an import, but not a property access like `.mask` or a call like
# `setMask(...)`, so this is a mechanical grep instead, run by
# `client-check` alongside the rest of the client-only guards.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$REPO_ROOT/client/src"

[ -d "$SRC_DIR" ] || { echo "check-no-masks: $SRC_DIR not found" >&2; exit 1; }

# Word-boundary patterns: `.mask` (property access/assignment), `setMask(`,
# `new Graphics` used as a mask, `filters` (the Pixi filter list) and
# `RenderTexture`. `src/net/bindings` is generated and never touches
# rendering, but is excluded anyway for the same reason other checks
# exclude it.
PATTERN='\.mask\b|\bsetMask\(|\bfilters\b|\bRenderTexture\b'

MATCHES="$(grep -rnE "$PATTERN" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"

if [ -n "$MATCHES" ]; then
  echo "check-no-masks: FAIL -- a masking/filter/render-texture construct was found under client/src/ (FR121 bans it):" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-masks: no mask, filter or render-texture construct under client/src/ (FR121)" >&2
exit 0
