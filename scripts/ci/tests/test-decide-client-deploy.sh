#!/usr/bin/env bash
# scripts/ci/decide-client-deploy.sh's own fast coverage against a real
# temp git repo (Quentin's direction, PR #288 cycle 2) -- the stamp
# parsing, the `/**` path stripping and the git-diff-exit-code mapping
# all get real commits and a real `git diff`, never a stubbed git.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/decide-client-deploy.sh"

D="$(fake_dir)"
rm -rf "$D"
mkdir -p "$D/client/src" "$D/ModernTileset/moderninteriors-win/2_Characters/Character_Generator" "$D/server/src"
git -C "$D" init -q
git -C "$D" config user.email t@t.com
git -C "$D" config user.name t

echo base > "$D/client/src/a.ts"
echo base > "$D/server/src/lib.rs"
echo base > "$D/ModernTileset/moderninteriors-win/2_Characters/Character_Generator/x.png"
git -C "$D" add -A
git -C "$D" commit -q -m base
LIVE_SHA="$(git -C "$D" rev-parse HEAD)"

# The exact shape deploy-client's own `sed` writes into dist/index.html.
STAMP_HTML="$D/live.html"
printf '<!doctype html><html><head><meta name="bc-build" content="%s" /></head></html>' "$LIVE_SHA" > "$STAMP_HTML"
NO_STAMP_HTML="$D/no-stamp.html"
printf '<!doctype html><html><head></head></html>' > "$NO_STAMP_HTML"

cat > "$D/paths.txt" <<'EOF'
client/**
ModernTileset/moderninteriors-win/2_Characters/Character_Generator/**
EOF

run_check() { # <sha> <live-source>
  ( cd "$D" && bash "$CHECK" "$1" "$2" "$D/paths.txt" )
}

echo "green: no live stamp at all -- unreachable or the very first deploy, always deploy"
OUT="$(run_check "$LIVE_SHA" "$NO_STAMP_HTML")"; CODE=$?
check "no stamp -> exit 0" 0 bash -c "exit $CODE"
check_contains "no stamp -> true" "true" "$OUT"

echo
echo "green: a stamp naming the exact commit being deployed, nothing changed -- skip"
OUT="$(run_check "$LIVE_SHA" "$STAMP_HTML")"; CODE=$?
check "identical sha -> exit 0" 0 bash -c "exit $CODE"
check_contains "identical sha -> false" "false" "$OUT"

echo
echo "green: a server-only change since the live deploy -- skip"
echo "server change" >> "$D/server/src/lib.rs"
git -C "$D" add -A
git -C "$D" commit -q -m "server only"
SERVER_SHA="$(git -C "$D" rev-parse HEAD)"
OUT="$(run_check "$SERVER_SHA" "$STAMP_HTML")"; CODE=$?
check "server-only change -> exit 0" 0 bash -c "exit $CODE"
check_contains "server-only change -> false" "false" "$OUT"

echo
echo "red (deploy): a client/ change since the live deploy"
echo "client change" >> "$D/client/src/a.ts"
git -C "$D" add -A
git -C "$D" commit -q -m "client change"
CLIENT_SHA="$(git -C "$D" rev-parse HEAD)"
OUT="$(run_check "$CLIENT_SHA" "$STAMP_HTML")"; CODE=$?
check "client/ change -> exit 0" 0 bash -c "exit $CODE"
check_contains "client/ change -> true" "true" "$OUT"

echo
echo "red (deploy): a change only under a nested ModernTileset/... path -- pins the /** stripping past one path segment"
echo "art change" >> "$D/ModernTileset/moderninteriors-win/2_Characters/Character_Generator/x.png"
git -C "$D" add -A
git -C "$D" commit -q -m "art change"
ART_SHA="$(git -C "$D" rev-parse HEAD)"
OUT="$(run_check "$ART_SHA" "$STAMP_HTML")"; CODE=$?
check "nested ModernTileset change -> exit 0" 0 bash -c "exit $CODE"
check_contains "nested ModernTileset change -> true" "true" "$OUT"

echo
echo "red (deploy): a stamp naming a SHA that is not in this repo's history at all"
UNKNOWN_STAMP="$D/unknown.html"
printf '<meta name="bc-build" content="0000000000000000000000000000000000000f" />' > "$UNKNOWN_STAMP"
OUT="$(run_check "$SERVER_SHA" "$UNKNOWN_STAMP")"; CODE=$?
check "unknown live sha -> exit 0" 0 bash -c "exit $CODE"
check_contains "unknown live sha -> true" "true" "$OUT"

echo
echo "usage errors"
check "missing sha argument fails" 1 bash "$CHECK"
check "missing live-source argument fails" 1 bash "$CHECK" "$LIVE_SHA"
check "a missing paths-file fails" 1 bash "$CHECK" "$LIVE_SHA" "$STAMP_HTML" "$D/nope.txt"
check "a missing live-source file fails" 1 bash "$CHECK" "$LIVE_SHA" "$D/nope.html" "$D/paths.txt"

summary
exit $?
