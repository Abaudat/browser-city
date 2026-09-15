#!/usr/bin/env bash
# FR150/FR152 (Quentin's direction, story 1.11): all UI is DOM except
# transient, object-bound container views drawn in canvas -- nothing
# persistent, global or abstract is ever drawn into the canvas, and this
# story adds no in-world information object at all yet, so there is no
# canvas text anywhere under client/src/ today. Modelled on
# check-no-masks.sh: a mechanical grep, run by `client-check` alongside
# the other client-only guards, because Biome's `noRestrictedImports` can
# ban an import but not every property/namespace access this bans.
#
# Bans, under client/src/ (bindings excluded, same as check-no-masks.sh):
#   - Pixi `Text`, `BitmapText`, `HTMLText` and `SplitText`, both as
#     imports from "pixi.js" and as `new` constructions -- canvas text is
#     exactly the kind of abstract, persistent readout FR150/NFR22 ban.
#   - `alert(`, `confirm(` and `prompt(` -- this game never blocks with a
#     native dialog (options-menu.ts's own header makes the same claim
#     for itself; this is the mechanical, repo-wide version of it).
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-no-canvas-ui.sh`'s own use, so it can plant
# each banned construct in a throwaway temp file rather than the real
# `client/src/`. `client-check` itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"

[ -d "$SRC_DIR" ] || { echo "check-no-canvas-ui: $SRC_DIR not found" >&2; exit 1; }

FAILED=0

# --- Pixi canvas-text classes: import or `new`, never a bare word so a
# comment or an unrelated identifier containing "Text" never false-
# positives (e.g. `textContent`, `ACTION_LABELS`). The import list also
# bans `TextStyle`/`TextStyleOptions` (Tim's direction) -- the
# construction list stays the four drawable classes only (Quentin's
# direction): a style object alone draws nothing. ---------------------------
TEXT_PATTERN='\bnew\s+(Text|BitmapText|HTMLText|SplitText)\b|\bimport\b[^;]*\b(Text|BitmapText|HTMLText|SplitText|TextStyle|TextStyleOptions)\b[^;]*["'"'"']pixi\.js["'"'"']'
TEXT_MATCHES="$(grep -rnE "$TEXT_PATTERN" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"
if [ -n "$TEXT_MATCHES" ]; then
  echo "check-no-canvas-ui: FAIL -- a Pixi canvas-text construct was found under client/src/ (FR150/FR152 ban it -- there is no fiction object to draw text for yet):" >&2
  echo "$TEXT_MATCHES" >&2
  FAILED=1
fi

# --- native blocking dialogs -------------------------------------------------
DIALOG_PATTERN='\balert\(|\bconfirm\(|\bprompt\('
DIALOG_MATCHES="$(grep -rnE "$DIALOG_PATTERN" "$SRC_DIR" --include='*.ts' --exclude-dir=bindings 2>/dev/null || true)"
if [ -n "$DIALOG_MATCHES" ]; then
  echo "check-no-canvas-ui: FAIL -- a native blocking dialog (alert/confirm/prompt) was found under client/src/:" >&2
  echo "$DIALOG_MATCHES" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-no-canvas-ui: no canvas-text construct or native dialog under client/src/ (FR150/FR152/FR151)" >&2
exit 0
