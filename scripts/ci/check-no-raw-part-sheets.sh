#!/usr/bin/env bash
# Story 2.7 (Tim's direction): the Epic 1 shortcut is removed, not
# bypassed -- production client code reads no vendor character-part PNG
# at runtime ever again. `Character_Generator` (the one vendor folder
# every part sheet this game uses lives under) must never appear anywhere
# under `client/src/` -- a mechanical grep, the same idiom
# `check-no-masks.sh` uses for a construct Biome's own import ban cannot
# see.
#
# Scoped to `client/src/` only, deliberately never `client/tests/`:
# Quentin's own direction has `client/tests/e2e/appearance.spec.ts`
# assert that *zero* real network requests name `Character_Generator` --
# proving the shortcut's absence at runtime necessarily names the string
# it is proving absent. That is a regression guard, not a reintroduction
# of the shortcut, so it is out of this script's scope; the runtime
# assertion is what actually proves it.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-no-raw-part-sheets.sh`'s own use, so it can
# plant the banned string in a throwaway temp file rather than the real
# `client/src/`. `client-check` itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"

[ -d "$SRC_DIR" ] || {
  echo "check-no-raw-part-sheets: $SRC_DIR not found" >&2
  exit 1
}

MATCHES="$(
  grep -rn 'Character_Generator' \
    "$SRC_DIR" \
    --include='*.ts' --exclude-dir=bindings 2>/dev/null || true
)"

if [ -n "$MATCHES" ]; then
  echo "check-no-raw-part-sheets: FAIL -- 'Character_Generator' (a raw vendor character-part sheet, the Epic 1 shortcut) was found under client/src/:" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-raw-part-sheets: no reference to 'Character_Generator' under client/src/ (story 2.7)" >&2
exit 0
