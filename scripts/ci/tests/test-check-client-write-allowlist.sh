#!/usr/bin/env bash
# scripts/ci/check-client-write-allowlist.sh's own fast coverage (story 4.4, NFR32).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-client-write-allowlist.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/net"
  printf '%s\n' 'conn.reducers.createCharacter({});' > "$d/main.ts"
  {
    printf '%s\n' 'conn.reducers.beginLink({ code });'
    printf '%s\n' 'connection.reducers.completeLink({ code });'
    printf '%s\n' 'await conn.procedures.syncClock({});'
    printf '%s\n' 'conn.reducers.setPlayerPosition(p);'
  } > "$d/net/a.ts"
  printf '%s' "$d"
}

d="$(tree)"
check "exactly the five allowed calls pass" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'conn.reducers.sendPing({});' >> "$d/net/a.ts"
check "a sixth call fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'conn.procedures.somethingNew({});' > "$d/main.ts"
check "a new procedure fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' '// conn.reducers.sendPing({}) is not called' >> "$d/net/a.ts"
check "a comment naming a call passes" 0 bash "$CHECK" "$d"

d="$(tree)"
sed -i '/setPlayerPosition/d' "$d/net/a.ts"
check "a listed call nobody makes fails until the list is revisited" 1 bash "$CHECK" "$d"

d="$(tree)"
mkdir -p "$d/world"
printf '%s\n' 'conn.reducers.setPlayerPosition(p);' > "$d/world/x.ts"
check "the position write outside net/ fails" 1 bash "$CHECK" "$d"

summary
