#!/usr/bin/env bash
# scripts/ci/check-debug-boundary.sh's own fast, no-real-source-tree
# coverage (story 1.12): plants each violation in a throwaway tree and
# asserts exit 1, plus the real shape `client/src/` actually has, asserting
# exit 0. A guard nobody has seen fail is not a guard, and one that fails
# on correct code is worse.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-debug-boundary.sh"

GOOD_MAIN='import { Application } from "pixi.js";
import type { DebugWorldView } from "./debug/world-view";

async function start(): Promise<void> {
  if (import.meta.env.DEV) {
    const { mountDebugOverlays } = await import("./debug/overlays");
    mountDebugOverlays({ view: {} as DebugWorldView });
  }
}
'

# tree <main.ts contents> [<other file path> <other file contents>]
tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/debug"
  printf '%s\n' "$1" > "$d/main.ts"
  printf '%s\n' 'export const mountDebugOverlays = () => {};' > "$d/debug/overlays.ts"
  printf '%s\n' 'const el = doc.createElementNS("http://www.w3.org/2000/svg", "svg");' \
    > "$d/debug/svg.ts"
  if [ "$#" -ge 3 ]; then
    mkdir -p "$d/$(dirname "$2")"
    printf '%s\n' "$3" > "$d/$2"
  fi
  printf '%s' "$d"
}

d="$(tree "$GOOD_MAIN")"
check "the real shape: one DEV-gated dynamic import, SVG only under debug/" 0 bash "$CHECK" "$d"

d="$(tree "$GOOD_MAIN" "render/thing.ts" 'import { DEBUG_STYLE } from "../debug/debug-style";')"
check "another module importing debug/" 1 bash "$CHECK" "$d"

d="$(tree "$GOOD_MAIN" "test-street/scene.ts" 'import type { DebugOverlay } from "../debug/overlay-registry";')"
check "a type-only import from outside main.ts is still an import" 1 bash "$CHECK" "$d"

d="$(tree 'import { mountDebugOverlays } from "./debug/overlays";
if (import.meta.env.DEV) {
  const { mountDebugOverlays: m } = await import("./debug/overlays");
  mountDebugOverlays();
}')"
check "a static import of debug/ in main.ts, however well guarded its use" 1 bash "$CHECK" "$d"

d="$(tree 'async function start() {
  const { mountDebugOverlays } = await import("./debug/overlays");
  mountDebugOverlays();
}')"
check "a dynamic import that is not inside an import.meta.env.DEV branch" 1 bash "$CHECK" "$d"

d="$(tree 'async function start() {
  if (import.meta.env.PROD) {
    const { mountDebugOverlays } = await import("./debug/overlays");
  }
}')"
check "a dynamic import gated on something other than DEV" 1 bash "$CHECK" "$d"

d="$(tree "$GOOD_MAIN" "ui/panel.ts" 'const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");')"
check "a second SVG surface outside debug/" 1 bash "$CHECK" "$d"

d="$(tree "$GOOD_MAIN" "world/notes.ts" 'const debugging = true; // debug/ mentioned in prose only')"
check "the word debug in a comment is never a false positive" 0 bash "$CHECK" "$d"

# The real tree, as committed -- the check must pass against it.
check "the repository's own client/src/" 0 bash "$CHECK"

summary
exit $?
