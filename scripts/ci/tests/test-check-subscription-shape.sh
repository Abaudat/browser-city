#!/usr/bin/env bash
# scripts/ci/check-subscription-shape.sh's own fast coverage (story 4.3):
# plants each violation in a throwaway temp tree and asserts exit 1, plus
# clean trees expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-subscription-shape.sh"

plant() { # <dir> <subpath> <content>
  mkdir -p "$(dirname "$1/$2")"
  printf '%s\n' "$3" > "$1/$2"
}

GLOBALS='.subscribe([tables.demoPing.build(), tables.moduleVersion.build(), tables.worldClock.build()]);'
REGION='conn.subscriptionBuilder().subscribe(queries);'

clean_tree() {
  local d
  d="$(fake_dir)"
  plant "$d" "net/connection.ts" "$GLOBALS"
  plant "$d" "net/region-subscription.ts" "$REGION"
  echo "$d"
}

d="$(clean_tree)"
check "the two net/ files subscribing, the globals exactly the three singletons, passes" 0 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/bindings/index.ts" 'SELECT * FROM generated; builder.subscribe(x);'
check "generated bindings are exempt" 0 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "world/stream.ts" 'conn.subscriptionBuilder().subscribe(q);'
check ".subscribe( outside net/connection.ts and net/region-subscription.ts is banned" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/other.ts" 'conn.subscriptionBuilder().subscribe(q);'
check ".subscribe( in another net/ file is banned" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/region-subscription.ts" 'conn.subscriptionBuilder().subscribe(["SELECT * FROM placed_object"]);'
check "a SELECT literal is banned even in an allowed file" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "ui/panel.ts" 'const q = `SELECT * FROM stock`;'
check "a SELECT literal anywhere under client/src is banned" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/region-subscription.ts" "$REGION
// SELECT is only mentioned in a comment here"
check "SELECT in a comment passes" 0 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/connection.ts" '.subscribe([tables.demoPing.build(), tables.moduleVersion.build(), tables.worldClock.build(), tables.placedObject.build()]);'
check "a whole-table subscription to a fourth table is banned" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/region-subscription.ts" 'const q = tables.placedObject.build();'
check "a whole-table query for a spatial table in the region file is banned" 1 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/region-subscription.ts" 'const q = tables.placedObject.where((r) => r.chunkKey.eq(k)).build();'
check "a predicated query passes" 0 bash "$CHECK" "$d"

d="$(clean_tree)"
plant "$d" "net/connection.ts" '.subscribe([tables.demoPing.build(), tables.worldClock.build()]);'
check "the global set missing one of the three singletons is banned" 1 bash "$CHECK" "$d"

summary
exit $?
