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

# The real hole Tim's direction (cycle 2) found: a formatter-wrapped
# multi-line import, exactly the shape Biome's own 100-column line width
# produces for any non-trivial pixi.js import (test-street/scene.ts is
# one real example).
d="$(plant 'import {
  Container,
  Text,
} from "pixi.js";')"
check "a multi-line import with Text on its own line" 1 bash "$CHECK" "$d"

d="$(plant 'import {
  Container,
  Sprite,
  BitmapText,
} from "pixi.js";')"
check "a multi-line import with BitmapText on its own line, alongside others" 1 bash "$CHECK" "$d"

# Tim's direction, cycle 2: the multi-line report used to name no
# identifier at all -- `s/\s+/ /g` on the flattened clause reset `$1`
# before it was interpolated into the message, so "(bans )" printed
# regardless of which name actually tripped it.
d="$(plant 'import {
  Container,
  Text,
} from "pixi.js";')"
check_contains "the multi-line report names the actual banned identifier, not a blank" \
  "(bans Text)" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant 'import {
  Container,
  Sprite,
} from "pixi.js";')"
check "a multi-line import with none of the banned names passes" 0 bash "$CHECK" "$d"

summary
exit $?
