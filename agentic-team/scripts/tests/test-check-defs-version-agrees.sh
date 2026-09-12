#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-defs-version-agrees.sh --
# never the live repo's own generated defs.rs/defs.json.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-defs-version-agrees.sh"

DEFS_RS="server/sim/src/generated/defs.rs"
DEFS_JSON="client/public/defs/defs.json"

# fresh_dir <rust-version> <json-version> -- a scratch dir with both
# generated artefacts carrying the given versions.
fresh_dir() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/$(dirname "$DEFS_RS")" "$d/$(dirname "$DEFS_JSON")" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-defs-version-agrees.sh"
  printf 'pub const DEFS_VERSION: &str = "%s";\n' "$1" > "$d/$DEFS_RS"
  printf '{\n  "defs_version": "%s"\n}\n' "$2" > "$d/$DEFS_JSON"
  printf '%s' "$d"
}

run_check() {
  ( cd "$1" && bash scripts/ci/check-defs-version-agrees.sh )
}

echo "green: both artefacts carry the same version"
D="$(fresh_dir abc123 abc123)"
check "agree -> exit 0" 0 run_check "$D"

echo
echo "red: the two artefacts disagree"
D="$(fresh_dir abc123 def456)"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names both versions" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'abc123'\" && printf '%s' \"\$1\" | grep -qF \"'def456'\"" _ "$OUT"

echo
echo "red: the rust artefact is missing"
D="$(fresh_dir abc123 abc123)"
rm "$D/$DEFS_RS"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'defs.rs'" _ "$OUT"

summary
