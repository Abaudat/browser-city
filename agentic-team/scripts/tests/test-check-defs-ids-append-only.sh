#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-defs-ids-append-only.sh.
# Every fixture is a scratch git repo with a "base" tag standing in for
# the PR's merge base -- never the live repo's own defs-manifest.golden.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-defs-ids-append-only.sh"

GOLDEN_PATH="tools/defs-build/goldens/defs-manifest.golden"

# fresh_repo <golden-content> -- a scratch git repo with $GOLDEN_PATH
# committed as given, tagged "base".
fresh_repo() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/$(dirname "$GOLDEN_PATH")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-defs-ids-append-only.sh"
  printf '%s' "$1" > "$d/$GOLDEN_PATH"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.com
  git -C "$d" config user.name t
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  git -C "$d" tag base
  printf '%s' "$d"
}

run_check() { # <dir> [base-ref]
  ( cd "$1" && bash scripts/ci/check-defs-ids-append-only.sh "${2:-base}" )
}

commit_changes() {
  git -C "$1" add -A
  git -C "$1" commit -q -m change
}

echo "green: nothing changed"
D="$(fresh_repo "object 1 trash-bin")"
check "no golden touched -> exit 0" 0 run_check "$D"

echo
echo "green: a new line is appended"
D="$(fresh_repo "object 1 trash-bin")"
printf 'object 1 trash-bin\nobject 2 park-bench\n' > "$D/$GOLDEN_PATH"
commit_changes "$D"
check "append-only -> exit 0" 0 run_check "$D"

echo
echo "red: an existing line is renumbered"
D="$(fresh_repo "object 1 trash-bin")"
printf 'object 2 trash-bin\n' > "$D/$GOLDEN_PATH"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the moved line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'object 1 trash-bin'" _ "$OUT"

echo
echo "red: an existing line disappears"
D="$(fresh_repo "object 1 trash-bin
item 1 bottle")"
printf 'object 1 trash-bin\n' > "$D/$GOLDEN_PATH"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'item 1 bottle'" _ "$OUT"

echo
echo "green: no golden at the merge base -- this PR introduces it"
D="$(fake_dir)"
rm -rf "$D"
mkdir -p "$D/scripts/ci"
cp "$CHECK" "$D/scripts/ci/check-defs-ids-append-only.sh"
git -C "$D" init -q
git -C "$D" config user.email t@t.com
git -C "$D" config user.name t
git -C "$D" commit -q --allow-empty -m base
git -C "$D" tag base
mkdir -p "$D/$(dirname "$GOLDEN_PATH")"
printf 'object 1 trash-bin\n' > "$D/$GOLDEN_PATH"
commit_changes "$D"
check "introduced fresh -> exit 0" 0 run_check "$D"

echo
echo "hard fail: unresolvable base under GITHUB_ACTIONS"
D="$(fresh_repo "object 1 trash-bin")"
OUT="$(cd "$D" && GITHUB_ACTIONS=true bash scripts/ci/check-defs-ids-append-only.sh no-such-ref 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "soft skip: unresolvable base outside GITHUB_ACTIONS"
D="$(fresh_repo "object 1 trash-bin")"
OUT="$(cd "$D" && GITHUB_ACTIONS= bash scripts/ci/check-defs-ids-append-only.sh no-such-ref 2>&1)"; CODE=$?
check "exits zero" 0 bash -c "exit $CODE"

summary
