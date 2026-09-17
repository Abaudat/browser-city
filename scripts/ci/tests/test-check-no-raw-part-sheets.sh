#!/usr/bin/env bash
# scripts/ci/check-no-raw-part-sheets.sh's own fast, no-real-source-tree
# coverage (story 2.7): plants the banned string in a throwaway temp
# directory standing in for `client/src/`, asserts exit 1; a clean tree
# expects exit 0. Scoped to `client/src/` only -- the argument this
# script takes stands in for that directory directly, never a `client/`
# root with `src/`/`tests/` subdirectories.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-raw-part-sheets.sh"

d="$(fake_dir)"
printf 'export const clean = 1;\n' > "$d/scene.ts"
check "a clean tree passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf 'export const sheet = "ModernTileset/.../Character_Generator/Bodies/16x16/Body_01.png";\n' > "$d/part-sheets.ts"
check "a direct reference fails" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '// mentions Character_Generator only in a comment -- still fails, comments included\n' > "$d/notes.ts"
check "a reference inside a comment still fails (no code/comment distinction)" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
check "an empty tree passes" 0 bash "$CHECK" "$d"

check "a missing directory is a named error" 1 bash "$CHECK" "/nonexistent/bc-ci-fake-dir"

summary
exit $?
