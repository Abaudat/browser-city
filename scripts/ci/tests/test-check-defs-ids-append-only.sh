#!/usr/bin/env bash
# scripts/ci/check-defs-ids-append-only.sh's own fast, no-real-history
# coverage (story 2.9, Tim's direction: this PR is the first to add a
# new tag manifest, defs/tags/roles.toml, and a new rules file, and it
# relies on this guard to keep their ids permanent -- a guard nobody has
# seen fail is not a guard). Builds a scratch git repo per case (never
# this repo's own history) with the golden at its real relative path, so
# $2/$3's own testability seam is exercised the same way a real caller
# never uses it.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-defs-ids-append-only.sh"

# <golden-content> -- a fresh scratch git repo with one commit carrying
# the golden at its real relative path, prints its path.
make_repo() {
  local d
  d="$(fake_dir)"
  git -C "$d" init -q
  git -C "$d" config user.email test@example.com
  git -C "$d" config user.name test
  mkdir -p "$d/tools/defs-build/goldens"
  printf '%s\n' "$1" > "$d/tools/defs-build/goldens/defs-manifest.golden"
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  printf '%s' "$d"
}

d="$(make_repo 'tag 6 wall
tag 9 underfoot')"
BASE_SHA="$(git -C "$d" rev-parse HEAD)"
printf '%s\n' 'tag 6 door
tag 9 underfoot' > "$d/tools/defs-build/goldens/defs-manifest.golden"
git -C "$d" add -A
git -C "$d" commit -q -m renumbered
check "a renumbered id in a tag manifest exits non-zero" 1 \
  bash "$CHECK" "$BASE_SHA" "$d"

# The guard is generic over every "kind id key" line, never special-cased
# to tags -- a rule row's own id/key changing in a second rules file
# fails exactly the same way.
d="$(make_repo 'rule 6 road_never_touches_wall
rule 7 road_never_touches_ground')"
BASE_SHA="$(git -C "$d" rev-parse HEAD)"
printf '%s\n' 'rule 6 road_never_touches_wall
rule 7 a_renamed_key' > "$d/tools/defs-build/goldens/defs-manifest.golden"
git -C "$d" add -A
git -C "$d" commit -q -m renumbered-rule
check "a renumbered id in a rules file exits non-zero" 1 \
  bash "$CHECK" "$BASE_SHA" "$d"

d="$(make_repo 'tag 6 wall
tag 9 underfoot')"
BASE_SHA="$(git -C "$d" rev-parse HEAD)"
printf '%s\n' 'tag 6 wall
tag 9 underfoot
tag 16 wall_run' > "$d/tools/defs-build/goldens/defs-manifest.golden"
git -C "$d" add -A
git -C "$d" commit -q -m appended
check "an appended id exits zero" 0 \
  bash "$CHECK" "$BASE_SHA" "$d"

summary
exit $?
