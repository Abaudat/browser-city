#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/extract-windows-install.sh. Never
# reads the live repo tree -- every fixture is a scratch README built here.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
EXTRACT="$TEST_DIR/../../../scripts/ci/extract-windows-install.sh"

write_good_readme() {
  cat > "$1" <<'MD'
# The SpacetimeDB module

Some prose before.

<!-- bc:windows-install:start -->
```powershell
iwr https://windows.spacetimedb.com -useb | iex
spacetime version install 2.9.0
spacetime version use 2.9.0
```
<!-- bc:windows-install:end -->

Some prose after.
MD
}

echo "green: extracts the fenced block's contents, nothing else"
GOOD="$(fake_dir)/README.md"
write_good_readme "$GOOD"
check_out "extracts exactly the three commands" 0 \
  'iwr https://windows.spacetimedb.com -useb | iex
spacetime version install 2.9.0
spacetime version use 2.9.0' \
  bash "$EXTRACT" "$GOOD"

echo
echo "red: no start marker"
D1="$(fake_dir)/README.md"
write_good_readme "$D1"
sed -i '/<!-- bc:windows-install:start -->/d' "$D1"
OUT="$(bash "$EXTRACT" "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing start marker" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'missing the <!-- bc:windows-install:start -->'" _ "$OUT"

echo
echo "red: no end marker"
D2="$(fake_dir)/README.md"
write_good_readme "$D2"
sed -i '/<!-- bc:windows-install:end -->/d' "$D2"
OUT="$(bash "$EXTRACT" "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing end marker" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'missing the <!-- bc:windows-install:end -->'" _ "$OUT"

echo
echo "red: markers present but no fenced block between them"
D3="$(fake_dir)/README.md"
cat > "$D3" <<'MD'
<!-- bc:windows-install:start -->
just prose, no code fence
<!-- bc:windows-install:end -->
MD
OUT="$(bash "$EXTRACT" "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the empty block" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'no non-empty fenced code block'" _ "$OUT"

echo
echo "red: the file does not exist"
OUT="$(bash "$EXTRACT" "$(fake_dir)/nope.md" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'not found'" _ "$OUT"

summary
