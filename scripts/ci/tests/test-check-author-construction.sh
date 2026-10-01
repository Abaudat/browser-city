#!/usr/bin/env bash
# scripts/ci/check-author-construction.sh's own fast coverage (story 6.3,
# FR89): plants each violation in a throwaway tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-author-construction.sh"

tree() { # -- a clean tree: the type and the match in stock.rs
  local d
  d="$(fake_dir)"
  mkdir -p "$d/server/src/tables" "$d/server/sim/src"
  printf '%s\n' 'pub enum Cause { ProcedureStep, Consumption }
impl Author { pub fn new(c: u64, k: Cause) -> Self { Self { c, k } } }' > "$d/server/sim/src/author.rs"
  printf '%s\n' 'fn permit(by: Author) { match by.cause() { Cause::ProcedureStep => {} Cause::Consumption => {} } }' > "$d/server/sim/src/stock.rs"
  printf '%s\n' 'pub fn tick() {}' > "$d/server/src/lib.rs"
  printf '%s' "$d"
}

plant() { # <relative file> <content>
  local d
  d="$(tree)"
  mkdir -p "$(dirname "$d/$1")"
  printf '%s\n' "$2" > "$d/$1"
  printf '%s' "$d"
}

d="$(tree)"
check "author.rs and the match in stock.rs pass" 0 bash "$CHECK" "$d"

d="$(plant server/src/tables/economy.rs 'fn run_economy_tick() { let by = Author::new(1, Cause::ProcedureStep); }')"
check "a scheduled reducer minting an author fails" 1 bash "$CHECK" "$d"
check_contains "names the file" "server/src/tables/economy.rs" "$(bash "$CHECK" "$d" 2>&1)"

d="$(plant server/src/tables/economy.rs 'use sim::author::Author;
fn f() { let by = Author
    ::new(1, k); }')"
check "an author built across lines fails" 1 bash "$CHECK" "$d"

d="$(plant server/sim/src/other.rs 'fn f() -> Cause { Cause::Consumption }')"
check "another sim module naming a cause variant fails" 1 bash "$CHECK" "$d"

d="$(plant server/sim/src/other.rs 'use crate::author::Cause::*;')"
check "a glob of the variants fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'fn sneak() { let _ = Author::new(1, k); }' >> "$d/server/sim/src/stock.rs"
check "stock.rs may match on Cause but never build an Author" 1 bash "$CHECK" "$d"

d="$(plant server/sim/src/other.rs 'pub fn f() {}
#[cfg(test)]
mod tests { fn t() { let a = Author::new(1, Cause::Consumption); } }')"
check "a test module is not scanned" 0 bash "$CHECK" "$d"

d="$(plant server/sim/src/other.rs '// Author::new(1, Cause::Consumption) is banned here
/// see Cause::ProcedureStep')"
check "a comment naming them passes" 0 bash "$CHECK" "$d"

d="$(tree)"
mkdir -p "$d/server/src/generated"
printf '%s\n' 'fn g() { Author::new(1, Cause::Consumption); }' > "$d/server/src/generated/skip.rs"
check "generated/ is excluded" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
mkdir -p "$d/server/src"
printf '%s\n' 'pub fn nothing() {}' > "$d/server/src/lib.rs"
check "a tree with no author module fails (the scan found nothing)" 1 bash "$CHECK" "$d"

check "the real tree passes" 0 bash "$CHECK"

summary
exit $?
