#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-defs-version-bump.sh. Every
# fixture is a scratch git repo with a "base" tag standing in for the PR's
# merge base -- never the live repo's own defs/ or generated defs.rs.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-defs-version-bump.sh"

DEFS_RS="server/sim/src/generated/defs.rs"

# fresh_repo -- a scratch git repo with one defs/objects/ file, a
# generated defs.rs at DEFS_VERSION "v1", tagged "base".
fresh_repo() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/defs/objects" "$d/$(dirname "$DEFS_RS")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-defs-version-bump.sh"
  printf '[[object]]\nid = 1\nkey = "a"\n' > "$d/defs/objects/a.toml"
  printf 'pub const DEFS_VERSION: &str = "v1";\n' > "$d/$DEFS_RS"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.com
  git -C "$d" config user.name t
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  git -C "$d" tag base
  printf '%s' "$d"
}

run_check() { # <dir> [base-ref]
  ( cd "$1" && bash scripts/ci/check-defs-version-bump.sh "${2:-base}" )
}

commit_changes() {
  git -C "$1" add -A
  git -C "$1" commit -q -m change
}

echo "green: nothing changed"
D="$(fresh_repo)"
check "no defs/ touched -> exit 0" 0 run_check "$D"

echo
echo "green: defs/ changes alongside a DEFS_VERSION bump"
D="$(fresh_repo)"
printf '[[object]]\nid = 1\nkey = "b"\n' > "$D/defs/objects/a.toml"
printf 'pub const DEFS_VERSION: &str = "v2";\n' > "$D/$DEFS_RS"
commit_changes "$D"
check "bumped together -> exit 0" 0 run_check "$D"

echo
echo "red: defs/ changes with no DEFS_VERSION bump"
D="$(fresh_repo)"
printf '[[object]]\nid = 1\nkey = "b"\n' > "$D/defs/objects/a.toml"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing bump" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'no defs_version bump'" _ "$OUT"

echo
echo "red: defs.rs changes but not the DEFS_VERSION line itself"
D="$(fresh_repo)"
printf '[[object]]\nid = 1\nkey = "b"\n' > "$D/defs/objects/a.toml"
printf '%s\n// a comment, not a version bump\n' "$(cat "$D/$DEFS_RS")" > "$D/$DEFS_RS"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unmoved DEFS_VERSION" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'DEFS_VERSION did not'" _ "$OUT"

echo
echo "red: a defs/ path outside a known kind directory has no version rule"
D="$(fresh_repo)"
mkdir -p "$D/defs/mystery"
printf 'x = 1\n' > "$D/defs/mystery/x.toml"
printf 'pub const DEFS_VERSION: &str = "v2";\n' > "$D/$DEFS_RS"
commit_changes "$D"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unclassified path" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'has no version rule, add one'" _ "$OUT"

echo
echo "hard fail: unresolvable base under GITHUB_ACTIONS"
D="$(fresh_repo)"
OUT="$(cd "$D" && GITHUB_ACTIONS=true bash scripts/ci/check-defs-version-bump.sh no-such-ref 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "soft skip: unresolvable base outside GITHUB_ACTIONS"
D="$(fresh_repo)"
OUT="$(cd "$D" && GITHUB_ACTIONS= bash scripts/ci/check-defs-version-bump.sh no-such-ref 2>&1)"; CODE=$?
check "exits zero" 0 bash -c "exit $CODE"

summary
