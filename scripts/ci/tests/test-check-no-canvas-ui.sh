#!/usr/bin/env bash
# scripts/ci/check-no-canvas-ui.sh's own fast, no-real-source-tree coverage
# (Quentin's direction, story 1.11): plants each banned construct in a
# throwaway temp directory and asserts exit 1, plus clean files expecting
# exit 0 -- a guard nobody has seen fail is not a guard.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-canvas-ui.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.ts file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/scene.ts"
  printf '%s' "$d"
}

d="$(plant 'export const clean = 1;')"
check "a file with none of the banned constructs passes" 0 bash "$CHECK" "$d"

d="$(plant 'import { Text } from "pixi.js";')"
check "importing Text from pixi.js" 1 bash "$CHECK" "$d"

d="$(plant 'import { Sprite, BitmapText } from "pixi.js";')"
check "importing BitmapText from pixi.js alongside another import" 1 bash "$CHECK" "$d"

d="$(plant 'import { HTMLText } from "pixi.js";')"
check "importing HTMLText from pixi.js" 1 bash "$CHECK" "$d"

d="$(plant 'import { SplitText } from "pixi.js";')"
check "importing SplitText from pixi.js" 1 bash "$CHECK" "$d"

d="$(plant 'const label = new Text({ text: "hi" });')"
check "new Text(...) construction" 1 bash "$CHECK" "$d"

d="$(plant 'const label = new BitmapText({ text: "hi" });')"
check "new BitmapText(...) construction" 1 bash "$CHECK" "$d"

d="$(plant 'alert("hi");')"
check "alert(...) call" 1 bash "$CHECK" "$d"

d="$(plant 'if (confirm("sure?")) { doIt(); }')"
check "confirm(...) call" 1 bash "$CHECK" "$d"

d="$(plant 'const name = prompt("name?");')"
check "prompt(...) call" 1 bash "$CHECK" "$d"

d="$(plant 'const el = document.createElement("h2"); el.textContent = "Options";')"
check "textContent is never a false positive" 0 bash "$CHECK" "$d"

d="$(plant 'import { Sprite, TextStyle } from "pixi.js";')"
check "importing TextStyle from pixi.js (Tim's addition to the import list)" 1 bash "$CHECK" "$d"

d="$(plant 'import { TextStyleOptions } from "pixi.js";')"
check "importing TextStyleOptions from pixi.js" 1 bash "$CHECK" "$d"

summary
exit $?
