#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-windows-installer-asset.sh.
# No network -- every fixture is a scratch "installer script" file built
# here, never the live https://windows.spacetimedb.com content.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-windows-installer-asset.sh"
ASSET="spacetimedb-update-x86_64-pc-windows-msvc.exe"

echo "green: the asset name is present in the script content"
D="$(fake_dir)/install.ps1"
cat > "$D" <<EOF
\$AssetName = "$ASSET"
\$DownloadUrl = "https://github.com/clockworklabs/SpacetimeDB/releases/latest/download/\$AssetName"
Invoke-WebRequest \$DownloadUrl -OutFile spacetime-install.exe -UseBasicParsing
Start-Process -Wait -FilePath spacetime-install.exe
EOF
check "the good fixture passes" 0 bash "$CHECK" "$ASSET" "$D"

echo
echo "red: the asset name is not present at all -- upstream drift"
D2="$(fake_dir)/install.ps1"
cat > "$D2" <<'EOF'
$AssetName = "spacetimedb-update-x86_64-pc-windows-gnu.exe"
Invoke-WebRequest "https://example.com/$AssetName" -OutFile spacetime-install.exe
EOF
OUT="$(bash "$CHECK" "$ASSET" "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check_contains "names the drift, not just a generic failure" "upstream installer changed" "$OUT"
check_contains "names the asset it expected" "$ASSET" "$OUT"

echo
echo "red: empty script content"
D3="$(fake_dir)/install.ps1"
printf '   \n\n' > "$D3"
OUT="$(bash "$CHECK" "$ASSET" "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check_contains "names the empty content" "content is empty" "$OUT"

echo
echo "red: script file does not exist"
OUT="$(bash "$CHECK" "$ASSET" "$(fake_dir)/nope.ps1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check_contains "names the missing file" "not found" "$OUT"

echo
echo "red: no asset name argument at all"
OUT="$(bash "$CHECK" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check_contains "names the usage" "usage:" "$OUT"

echo
echo "red: an empty asset name argument"
OUT="$(bash "$CHECK" "" "$D" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check_contains "names the empty asset name" "must not be empty" "$OUT"

echo
echo "stdin is read when no file argument is given"
check "reads from stdin" 0 bash -c "cat '$D' | bash '$CHECK' '$ASSET'"

summary
exit $?
