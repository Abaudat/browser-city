#!/usr/bin/env bash
# scripts/ci/check-no-crlf-committed.sh's own fast, no-real-tree coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-no-crlf-committed.sh"

# plant <dir/file> <printf content> -- a fresh git repo with one committed file.
plant() {
  local d
  d="$(fake_dir)"
  git -C "$d" init -q
  git -C "$d" config core.autocrlf false
  mkdir -p "$d/$(dirname "$1")"
  printf "$2" > "$d/$1"
  git -C "$d" add -A
  printf '%s' "$d"
}

d="$(plant docs/a.md 'one\ntwo\n')"
check "an LF file under docs/ passes" 0 bash "$CHECK" "$d"

d="$(plant docs/a.md 'one\r\ntwo\r\n')"
check "a CRLF file under docs/ fails" 1 bash "$CHECK" "$d"

d="$(plant .github/workflows/x.yml 'a: 1\r\n')"
check "a CRLF file under .github/ fails" 1 bash "$CHECK" "$d"

d="$(plant other/a.txt 'one\r\n')"
check "a CRLF file outside the checked trees passes" 0 bash "$CHECK" "$d"

d="$(plant docs/b.png 'a\0b\r\n')"
check "a binary file is ignored" 0 bash "$CHECK" "$d"

summary
exit $?
