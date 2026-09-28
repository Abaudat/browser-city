#!/usr/bin/env bash
# scripts/ci/check-no-frame-rate-reducers.sh's own fast, no-real-source-
# tree coverage (story 4.2 AC2): plants each banned construct in a
# throwaway temp tree and asserts exit 1, plus clean files expecting
# exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-frame-rate-reducers.sh"

plant() { # <subpath> <content> -- writes content to a fresh fake tree's <subpath>
  local d="$1" subpath="$2" content="$3"
  mkdir -p "$(dirname "$d/$subpath")"
  printf '%s\n' "$content" > "$d/$subpath"
}

d="$(fake_dir)"
plant "$d" "net/connection.ts" 'conn.reducers.sendPing("hi");'
check "a reducer call under net/ passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "render/scene.ts" 'conn.reducers.sendPing("hi");'
check "a reducer call under render/ is banned" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "world/movement.ts" 'conn.reducers.sendPing("hi");'
check "a reducer call under world/ is banned" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "test-street/scene.ts" 'conn.reducers.sendPing("hi");'
check "a reducer call under test-street/ is banned" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "render/highlight.ts" 'this.ticker.add(this.onTick);'
check "a ticker.add callback with no reducer call, under render/, passes -- ticker.add itself is not banned" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "debug/panel.ts" 'app.ticker.add(() => { doSomethingHarmless(); });'
check "a ticker.add callback with no reducer call, outside render/world/test-street, passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "debug/panel.ts" 'app.ticker.add((ticker) => {
  conn.reducers.sendPing("hi");
});'
check "a reducer call inside a ticker.add callback is banned, even outside render/world/test-street" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
plant "$d" "debug/panel.ts" 'conn.reducers.sendPing("hi");
app.ticker.add(() => { doSomethingHarmless(); });'
check "a reducer call outside any ticker.add callback, outside render/world/test-street, passes" 0 bash "$CHECK" "$d"

summary
exit $?
