#!/usr/bin/env bash
# scripts/ci/check-container-view-path.sh's own fast coverage (story 6.10).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-container-view-path.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/src/render"
  printf '%s\n' 'export class FloorStacks { attachTransient(floor, view) {} }' > "$d/src/render/floor-stacks.ts"
  printf '%s\n' 'const v = new PixiContainerView(o);
options.stacks.attachTransient(0, v.root);' > "$d/src/render/pixi-container-view.ts"
  printf '%s' "$d"
}

plant() { # <file> <content>
  local d
  d="$(tree)"
  mkdir -p "$(dirname "$d/src/$1")"
  printf '%s\n' "$2" > "$d/src/$1"
  printf '%s' "$d"
}

d="$(tree)"
check "the view module alone building and attaching passes" 0 bash "$CHECK" "$d"

d="$(plant render/other.ts 'const v = new PixiContainerView(opts);')"
check "constructing a view elsewhere fails" 1 bash "$CHECK" "$d"
check_contains "names the file" "render/other.ts" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant render/other.ts 'stacks.attachTransient(0, container);')"
check "attaching a transient view elsewhere fails" 1 bash "$CHECK" "$d"

d="$(plant main.ts 'app.stage.addChild(view); stacks.attachTransient (1, view);')"
check "attachTransient with a space before the paren fails" 1 bash "$CHECK" "$d"

d="$(plant render/other.ts '// new PixiContainerView(x) and .attachTransient(f, v) are banned here')"
check "the constructs in a comment pass" 0 bash "$CHECK" "$d"

check "the real client/src passes" 0 bash "$CHECK"

summary
exit $?
