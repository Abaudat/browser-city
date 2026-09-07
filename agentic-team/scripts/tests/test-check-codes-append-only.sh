#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-codes-append-only.sh. Every
# fixture is a scratch git repo with a "base" tag standing in for the PR's
# merge base -- never the live repo's own codes golden.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-codes-append-only.sh"

GOLDEN_PATH="server/sim/tests/goldens/codes_v1.golden"

# fresh_repo <golden-content> -- a scratch git repo with $GOLDEN_PATH
# committed as given, tagged "base".
fresh_repo() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/$(dirname "$GOLDEN_PATH")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-codes-append-only.sh"
  printf '%s' "$1" > "$d/$GOLDEN_PATH"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.com
  git -C "$d" config user.name t
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  git -C "$d" tag base
  printf '%s' "$d"
}

# set_new <dir> <content> -- overwrites the working tree's golden (HEAD, in
# effect) without committing -- the script reads the working tree file for
# the "new" side and `git show base:...` for the "old" side.
set_new() {
  printf '%s' "$2" > "$1/$GOLDEN_PATH"
}

run_check() { # <dir> [base-ref]
  ( cd "$1" && bash scripts/ci/check-codes-append-only.sh "${2:-base}" )
}

BASE_CONTENT='matter_kind 0 sanitation
matter_kind 1 budget
'

echo "green: nothing changed"
D="$(fresh_repo "$BASE_CONTENT")"
check "identical golden -> exit 0" 0 run_check "$D"

echo
echo "green: a new code appended"
D="$(fresh_repo "$BASE_CONTENT")"
set_new "$D" "$BASE_CONTENT"'matter_kind 2 housing
'
check "appended code -> exit 0" 0 run_check "$D"

echo
echo "green: a new golden this PR introduces has no history to violate"
D="$(fresh_repo "$BASE_CONTENT")"
rm -rf "$D/server/sim/tests/goldens"
git -C "$D" add -A
git -C "$D" commit -q -m "remove golden at base" >/dev/null
git -C "$D" tag -f base
mkdir -p "$D/$(dirname "$GOLDEN_PATH")"
set_new "$D" 'matter_kind 0 sanitation
'
check "no prior golden -> exit 0" 0 run_check "$D"

echo
echo "red: an existing code renumbered"
D="$(fresh_repo "$BASE_CONTENT")"
set_new "$D" 'matter_kind 5 sanitation
matter_kind 1 budget
'
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the vanished line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'matter_kind 0 sanitation'" _ "$OUT"

echo
echo "red: an existing code renamed, same number"
D="$(fresh_repo "$BASE_CONTENT")"
set_new "$D" 'matter_kind 0 waste
matter_kind 1 budget
'
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the vanished line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'matter_kind 0 sanitation'" _ "$OUT"

echo
echo "red: an existing code removed outright"
D="$(fresh_repo "$BASE_CONTENT")"
set_new "$D" 'matter_kind 0 sanitation
'
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the removed line" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'matter_kind 1 budget'" _ "$OUT"

echo
echo "hard fail: unresolvable base under GITHUB_ACTIONS"
D="$(fresh_repo "$BASE_CONTENT")"
OUT="$(cd "$D" && GITHUB_ACTIONS=true bash scripts/ci/check-codes-append-only.sh no-such-ref 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "soft skip: unresolvable base outside GITHUB_ACTIONS"
D="$(fresh_repo "$BASE_CONTENT")"
# GITHUB_ACTIONS is explicitly cleared, not just left unset -- this suite
# itself runs inside GitHub Actions, which sets it to "true" ambiently, and
# an inherited value here would silently exercise the hard-fail branch
# instead of the one this case actually tests.
OUT="$(cd "$D" && GITHUB_ACTIONS= bash scripts/ci/check-codes-append-only.sh no-such-ref 2>&1)"; CODE=$?
check "exits zero" 0 bash -c "exit $CODE"

summary
