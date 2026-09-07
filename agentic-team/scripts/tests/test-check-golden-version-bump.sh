#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-golden-version-bump.sh.
# Every fixture is a scratch git repo with a "base" tag standing in for
# the PR's merge base -- never the live repo's own goldens.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-golden-version-bump.sh"

# fresh_repo -- a scratch git repo with rng.rs at RNG_VERSION 1 and a
# committed rng_v1.golden, tagged "base". The real script is copied in at
# scripts/ci/ so REPO_ROOT resolves inside the fixture.
fresh_repo() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/server/sim/src" "$d/server/sim/tests/goldens" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-golden-version-bump.sh"
  printf 'pub const RNG_VERSION: u32 = 1;\n' > "$d/server/sim/src/rng.rs"
  echo 'version=1' > "$d/server/sim/tests/goldens/rng_v1.golden"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.com
  git -C "$d" config user.name t
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  git -C "$d" tag base
  printf '%s' "$d"
}

run_check() { # <dir> [base-ref]
  ( cd "$1" && bash scripts/ci/check-golden-version-bump.sh "${2:-base}" )
}

# commit_changes <dir> -- the script diffs two *commits* (`git diff
# <base> HEAD`), not the working tree, so every fixture below must commit
# its edit before running the check.
commit_changes() {
  git -C "$1" add -A
  git -C "$1" commit -q -m change
}

echo "green: nothing changed"
D="$(fresh_repo)"
check "no golden touched -> exit 0" 0 run_check "$D"

echo
echo "green: rng golden moves alongside an RNG_VERSION bump"
D="$(fresh_repo)"
sed -i 's/RNG_VERSION: u32 = 1/RNG_VERSION: u32 = 2/' "$D/server/sim/src/rng.rs"
echo 'version=2' > "$D/server/sim/tests/goldens/rng_v1.golden"
commit_changes "$D"
check "bumped together -> exit 0" 0 run_check "$D"

echo
echo "red: rng golden moves with no RNG_VERSION bump"
D="$(fresh_repo)"
echo 'version=2' > "$D/server/sim/tests/goldens/rng_v1.golden"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing bump" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'no RNG_VERSION bump'" _ "$OUT"

echo
echo "red: rng.rs changes but not the RNG_VERSION line itself"
D="$(fresh_repo)"
echo '// a comment, not a version bump' >> "$D/server/sim/src/rng.rs"
echo 'version=2' > "$D/server/sim/tests/goldens/rng_v1.golden"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unmoved RNG_VERSION" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'RNG_VERSION did not'" _ "$OUT"

echo
echo "green: a codes_*.golden change is governed elsewhere, not by this script"
D="$(fresh_repo)"
mkdir -p "$D/server/sim/tests/goldens"
echo 'matter_kind 0 sanitation' > "$D/server/sim/tests/goldens/codes_v1.golden"
git -C "$D" add -A && git -C "$D" commit -q -m "add codes golden"
git -C "$D" tag -f base
echo 'matter_kind 0 sanitation
matter_kind 1 budget' > "$D/server/sim/tests/goldens/codes_v1.golden"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits zero" 0 bash -c "exit $CODE"
check "defers to check-codes-append-only.sh" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'check-codes-append-only.sh'" _ "$OUT"

echo
echo "red: an unrecognised golden name has no permanence rule"
D="$(fresh_repo)"
echo 'v1' > "$D/server/sim/tests/goldens/mystery_v1.golden"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unclassified golden" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'has no permanence rule, add one'" _ "$OUT"

echo
echo "hard fail: unresolvable base under GITHUB_ACTIONS"
D="$(fresh_repo)"
OUT="$(cd "$D" && GITHUB_ACTIONS=true bash scripts/ci/check-golden-version-bump.sh no-such-ref 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "soft skip: unresolvable base outside GITHUB_ACTIONS"
D="$(fresh_repo)"
OUT="$(cd "$D" && bash scripts/ci/check-golden-version-bump.sh no-such-ref 2>&1)"; CODE=$?
check "exits zero" 0 bash -c "exit $CODE"

summary
