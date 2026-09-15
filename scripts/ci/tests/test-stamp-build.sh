#!/usr/bin/env bash
# scripts/ci/stamp-build.sh's own fast coverage -- and the pin Quentin's
# cycle-2 direction asked for: this is the exact line
# scripts/ci/decide-client-deploy.sh's own fixtures build by hand, so a
# format change breaks a test rather than a deploy.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/stamp-build.sh"

write_index() { # <path>
  cat > "$1" <<'HTML'
<!doctype html>
<html>
  <head>
    <script type="module" src="/assets/index.js"></script>
  </head>
  <body></body>
</html>
HTML
}

D="$(fake_dir)"
write_index "$D/index.html"
check "stamps a real index.html -> exit 0" 0 bash "$CHECK" "$D/index.html" "abc1234"
check_contains "the exact line is injected" '<meta name="bc-build" content="abc1234" />' "$(cat "$D/index.html")"
check_contains "still has </head>" '</head>' "$(cat "$D/index.html")"

D2="$(fake_dir)"
write_index "$D2/index.html"
bash "$CHECK" "$D2/index.html" "abc1234" >/dev/null 2>&1
check_contains "the stamp lands before </head>, not after" \
  "$(printf '<meta name="bc-build" content="abc1234" />\n  </head>')" \
  "$(cat "$D2/index.html")"

D3="$(fake_dir)"
cat > "$D3/index.html" <<'HTML'
<!doctype html>
<html><body>no head element here</body></html>
HTML
check "an index.html with no </head> fails" 1 bash "$CHECK" "$D3/index.html" "abc1234"

check "a missing index.html fails" 1 bash "$CHECK" "$(fake_dir)/nope.html" "abc1234"
check "missing arguments fail" 1 bash "$CHECK"

summary
exit $?
