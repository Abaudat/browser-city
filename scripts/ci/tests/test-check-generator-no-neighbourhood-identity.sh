#!/usr/bin/env bash
# scripts/ci/check-generator-no-neighbourhood-identity.sh's own coverage
# (story 3.7): fast, no real tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-generator-no-neighbourhood-identity.sh"

d="$(fake_dir)"
mkdir -p "$d/generation"
cat > "$d/generation/mod.rs" <<'RS'
// Character comes from the four dials only.
pub fn author(age: i32, affluence: i32) -> i32 { age + affluence }
RS
check "a generator that reads only the dials passes" 0 bash "$CHECK" "$d/generation"

d="$(fake_dir)"
mkdir -p "$d/generation"
cat > "$d/generation/mod.rs" <<'RS'
fn dock_weight(neighbourhood_id: u32) -> i32 { if neighbourhood_id == 3 { 9 } else { 1 } }
RS
check "branching on a neighbourhood id fails" 1 bash "$CHECK" "$d/generation"

d="$(fake_dir)"
mkdir -p "$d/rules"
printf '# the old_town gets more cafes\n' > "$d/rules/generation.toml"
check "a named archetype in a rule file fails" 1 bash "$CHECK" "$d/rules"

d="$(fake_dir)"
printf 'let region_key = 2;\n' > "$d/balance.toml"
check "a region key in a balance file fails" 1 bash "$CHECK" "$d/balance.toml"

check "a missing target fails closed" 1 bash "$CHECK" "$REPO_ROOT/does/not/exist"

check "the real tree is clean" 0 bash "$CHECK"

summary
exit $?
