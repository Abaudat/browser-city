#!/usr/bin/env bash
# scripts/ci/check-golden-version-bump.sh's own coverage: a throwaway git
# repo holding the three version constants and a golden, one planted
# violation per case.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK_SRC="$REPO_ROOT/scripts/ci/check-golden-version-bump.sh"

repo() { # -- a committed base: all three versions at 5, one golden each
  local d
  d="$(fake_dir)"
  (
    cd "$d" || exit 1
    git init -q . && git config user.email t@t && git config user.name t
    git config core.autocrlf false
    mkdir -p scripts/ci server/sim/src/generation server/sim/tests/goldens
    cp "$CHECK_SRC" scripts/ci/
    printf '%s\n' 'pub const RNG_VERSION: u32 = 5;' > server/sim/src/rng.rs
    printf '%s\n' 'pub const APPEARANCE_VERSION: u32 = 5;' > server/sim/src/appearance.rs
    printf '%s\n' 'pub const GENERATION_VERSION: u32 = 5;' > server/sim/src/generation/mod.rs
    printf '%s\n' 'a' > server/sim/tests/goldens/rng_v5.golden
    printf '%s\n' 'a' > server/sim/tests/goldens/generation_v5.golden
    git add -A && git commit -qm base && git tag base
  ) >/dev/null 2>&1
  printf '%s' "$d"
}

run() { # <dir> -- the check against the base tag
  ( cd "$1" && bash scripts/ci/check-golden-version-bump.sh base )
}

edit() { # <dir> <file> <sed-expr> -- edit and commit
  ( cd "$1" && sed -i "$3" "$2" && git commit -qam edit ) >/dev/null 2>&1
}

d="$(repo)"
check "an unchanged tree passes" 0 run "$d"

d="$(repo)"
edit "$d" server/sim/src/rng.rs 's/= 5;/= 6;/'
check "a raised version passes" 0 run "$d"

d="$(repo)"
edit "$d" server/sim/src/rng.rs 's/= 5;/= 4;/'
check "a lowered version fails" 1 run "$d"
check_contains "names the constant" "RNG_VERSION" "$(run "$d" 2>&1)"

d="$(repo)"
edit "$d" server/sim/src/generation/mod.rs 's/= 5;/= 3;/'
check "a lowered GENERATION_VERSION fails" 1 run "$d"

d="$(repo)"
edit "$d" server/sim/src/appearance.rs 's/= 5;/= 1;/'
check "a lowered APPEARANCE_VERSION fails" 1 run "$d"

d="$(repo)"
edit "$d" server/sim/src/rng.rs 's/u32 = 5;/u64 = 6;/'
check "a constant retyped so it cannot be read fails" 1 run "$d"
check_contains "says it cannot be read" "cannot be read at HEAD" "$(run "$d" 2>&1)"

d="$(repo)"
edit "$d" server/sim/src/generation/mod.rs 's/GENERATION_VERSION/GEN_VERSION/'
check "a renamed constant fails" 1 run "$d"

d="$(repo)"
edit "$d" server/sim/tests/goldens/rng_v5.golden 's/a/b/'
check "a golden moved without a version change fails" 1 run "$d"

d="$(repo)"
edit "$d" server/sim/tests/goldens/generation_v5.golden 's/a/b/'
check "a generation golden moved without a version change fails" 1 run "$d"

d="$(repo)"
edit "$d" server/sim/tests/goldens/rng_v5.golden 's/a/b/'
edit "$d" server/sim/src/rng.rs 's/= 5;/= 6;/'
check "a golden moved with a raised version passes" 0 run "$d"

summary
exit $?
