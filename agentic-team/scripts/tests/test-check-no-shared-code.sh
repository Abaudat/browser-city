#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-no-shared-code.sh. Never
# reads the live repo tree -- every fixture is a scratch dir built here.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-no-shared-code.sh"

# write_good_fixture <dir> -- a client/ and server/ that don't touch each other.
write_good_fixture() {
  local d="$1"
  mkdir -p "$d/client/src/net" "$d/server/src"
  cat > "$d/client/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "rootDir": "src"
  }
}
JSON
  echo 'export const x = 1;' > "$d/client/src/net/config.ts"
  echo 'pub fn f() {}' > "$d/server/src/lib.rs"
  git -C "$d" init -q 2>/dev/null || true
  git -C "$d" add -A 2>/dev/null || true
}

fresh_fixture() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  write_good_fixture "$d"
  printf '%s' "$d"
}

# The script always resolves paths off its own location, not off a
# fixture argument, so we run it *from inside* the fixture and pass no
# args -- REPO_ROOT is derived from $BASH_SOURCE, which stays pointed at
# the real repo. To make that safe, symlink the real script into a fixture
# whose relative layout (scripts/ci/<name>.sh under a repo root two levels
# above client/server) matches what the script expects.
run_check() {
  local d="$1"
  local scripts_dir="$d/scripts/ci"
  mkdir -p "$scripts_dir"
  cp "$CHECK" "$scripts_dir/check-no-shared-code.sh"
  ( cd "$d" && bash scripts/ci/check-no-shared-code.sh )
}

echo "green: client and server don't touch each other"
GOOD="$(fresh_fixture)"
check "a clean fixture passes" 0 run_check "$GOOD"

echo
echo "red: rootDir is not \"src\""
D1="$(fresh_fixture)"
sed -i 's/"rootDir": "src"/"rootDir": "."/' "$D1/client/tsconfig.json"
OUT="$(run_check "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing rootDir guard" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does not set rootDir'" _ "$OUT"

echo
echo "red: server/ references client/ from a .rs file"
D2="$(fresh_fixture)"
echo '// see client/src/net/config.ts' >> "$D2/server/src/lib.rs"
OUT="$(run_check "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the offending file" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'references client/'" _ "$OUT"

echo
echo "red: server/ references client/dist as a build artefact"
D3="$(fresh_fixture)"
echo '// build output at client/dist/index.js' >> "$D3/server/src/lib.rs"
OUT="$(run_check "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "red: client/src references server/target as a build artefact"
D4="$(fresh_fixture)"
echo '// path("../../server/target/wasm32-unknown-unknown/release/x.wasm")' >> "$D4/client/src/net/config.ts"
OUT="$(run_check "$D4" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the offending reference" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'references a server/ build artefact'" _ "$OUT"

echo
echo "red: a symlink crosses from client/ into server/"
D5="$(fresh_fixture)"
ln -s "$D5/server/src/lib.rs" "$D5/client/src/net/leak.rs" 2>/dev/null
if [ -L "$D5/client/src/net/leak.rs" ]; then
  git -C "$D5" add -A 2>/dev/null || true
  OUT="$(run_check "$D5" 2>&1)"; CODE=$?
  check "exits non-zero" 1 bash -c "exit $CODE"
  check "names the crossing symlink" 0 bash -c \
    "printf '%s' \"\$1\" | grep -qF 'resolves outside its own tree'" _ "$OUT"
else
  echo "  (skipped -- this platform/filesystem would not create the symlink)"
fi

summary
