#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-protocol-version-agrees.sh --
# never the live repo's own generated protocol_version.rs/protocol-version.ts.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-protocol-version-agrees.sh"

RUST_OUT="server/src/generated/protocol_version.rs"
TS_OUT="client/src/net/protocol-version.ts"

# fresh_dir <rust-version> <ts-version> -- a scratch dir with both
# generated artefacts carrying the given versions.
fresh_dir() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/$(dirname "$RUST_OUT")" "$d/$(dirname "$TS_OUT")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-protocol-version-agrees.sh"
  printf 'pub const PROTOCOL_VERSION: &str = "%s";\n' "$1" >"$d/$RUST_OUT"
  printf 'export const PROTOCOL_VERSION = "%s";\n' "$2" >"$d/$TS_OUT"
  printf '%s' "$d"
}

run_check() {
  (cd "$1" && bash scripts/ci/check-protocol-version-agrees.sh)
}

echo "green: both artefacts carry the same version"
D="$(fresh_dir abc123 abc123)"
check "agree -> exit 0" 0 run_check "$D"

echo
echo "red: the two artefacts disagree"
D="$(fresh_dir abc123 def456)"
OUT="$(run_check "$D" 2>&1)"
CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names both versions" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'abc123'\" && printf '%s' \"\$1\" | grep -qF \"'def456'\"" _ "$OUT"

echo
echo "red: the rust artefact is missing"
D="$(fresh_dir abc123 abc123)"
rm "$D/$RUST_OUT"
OUT="$(run_check "$D" 2>&1)"
CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'protocol_version.rs'" _ "$OUT"

summary
