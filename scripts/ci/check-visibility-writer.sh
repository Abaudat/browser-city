#!/usr/bin/env bash
# What an actor looks like when seen through the floor rules is decided in one
# place (FR120-FR122): under client/src/ a `.visible =` or `.alpha =`
# assignment appears only in render/pixi-visibility.ts, `VisibilityApplier`.
# Anything else that must write one (a highlight overlay, which is no actor)
# is named in ALLOW as <file>:<exact trimmed line>. A mechanical grep, run by
# `client-check`.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the client directory --
# `scripts/ci/tests/test-check-visibility-writer.sh`'s own use.
CLIENT_DIR="${1:-"$REPO_ROOT/client"}"
SRC="$CLIENT_DIR/src"

[ -d "$SRC" ] || { echo "check-visibility-writer: $SRC not found" >&2; exit 1; }

ALLOW=(
  "render/pixi-highlight.ts:overlay.alpha = spec.alpha;"
)

HITS=""
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  text="$(printf '%s' "${rest#*:}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  rel="${file#./}"
  [ "$rel" = "render/pixi-visibility.ts" ] && continue
  allowed=0
  for a in "${ALLOW[@]}"; do
    [ "$a" = "$rel:$text" ] && allowed=1
  done
  [ "$allowed" = 1 ] || HITS+="$rel:$text"$'\n'
done < <(cd "$SRC" && grep -rnE '\.(visible|alpha)[[:space:]]*=[^=]' . --include='*.ts' || true)

if [ -n "$HITS" ]; then
  echo "check-visibility-writer: FAIL -- a sprite's visible/alpha is written outside render/pixi-visibility.ts (VisibilityApplier owns it):" >&2
  printf '%s' "$HITS" >&2
  exit 1
fi
echo "check-visibility-writer: one visibility writer" >&2
exit 0
