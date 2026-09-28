#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/extract-windows-install-pin.sh.
# Never reads the live repo tree -- every fixture is a scratch README
# built here.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
EXTRACT_PIN="$TEST_DIR/../extract-windows-install-pin.sh"
DEFAULT_FIRST_LINE="iwr https://windows.spacetimedb.com -useb | iex"

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

echo "green: the first line matches, prints everything after it"
GOOD="$(fake_dir)/README.md"
write_good_readme "$GOOD"
EXPECTED='spacetime version install 2.9.0
spacetime version use 2.9.0'
check "prints exactly the two pinned-version lines" 0 bash -c \
  '[ "$(bash "$1" "$2")" = "$3" ]' _ "$EXTRACT_PIN" "$GOOD" "$EXPECTED"

echo
echo "green: an explicit expected-first-line argument is honoured"
check "still just the remaining lines" 0 bash -c \
  '[ "$(bash "$1" "$2" "$3")" = "$4" ]' _ "$EXTRACT_PIN" "$GOOD" "$DEFAULT_FIRST_LINE" "$EXPECTED"

echo
echo "red: the README's first line has drifted from what the workflow substitutes"
D1="$(fake_dir)/README.md"
cat > "$D1" <<'MD'
<!-- bc:windows-install:start -->
```powershell
curl https://windows.spacetimedb.com -o install.ps1 ; .\install.ps1
spacetime version install 2.9.0
spacetime version use 2.9.0
```
<!-- bc:windows-install:end -->
MD
OUT="$(bash "$EXTRACT_PIN" "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the drift" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'first line is'" _ "$OUT"
check "names what the workflow substitutes for" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'windows-install-check.yml substitutes'" _ "$OUT"

echo
echo "red: only the first line -- nothing left to run after it"
D2="$(fake_dir)/README.md"
cat > "$D2" <<MD
<!-- bc:windows-install:start -->
\`\`\`powershell
$DEFAULT_FIRST_LINE
\`\`\`
<!-- bc:windows-install:end -->
MD
OUT="$(bash "$EXTRACT_PIN" "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the empty remainder" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'nothing after its first line'" _ "$OUT"

echo
echo "red: propagates extract-windows-install.sh's own failures (e.g. no markers)"
D3="$(fake_dir)/README.md"
printf 'no markers here\n' > "$D3"
OUT="$(bash "$EXTRACT_PIN" "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing start marker" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'missing the <!-- bc:windows-install:start -->'" _ "$OUT"

summary
exit $?
