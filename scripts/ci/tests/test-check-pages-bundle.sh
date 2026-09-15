#!/usr/bin/env bash
# scripts/ci/check-pages-bundle.sh's own fast, no-real-build coverage: a
# good dist, an absolute /assets/ reference in index.html, one baked into
# the emitted JS, and the ws://127.0.0.1 dev fallback leaking into
# production -- Quentin's direction naming exactly these three fixtures.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-pages-bundle.sh"
BASE="/browser-city/"

# good_dist -- a minimal, correctly-based build: index.html references
# assets under the base, and the JS carries the real production URI.
good_dist() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/assets"
  cat > "$d/index.html" <<EOF
<!doctype html>
<html><head><script type="module" src="${BASE}assets/index-abc.js"></script></head><body></body></html>
EOF
  printf 'console.log("connect", "wss://maincloud.example/ws");\n' > "$d/assets/index-abc.js"
  printf '%s' "$d"
}

d="$(good_dist)"
check "a correctly-based build with the real production URI passes" 0 bash "$CHECK" "$d" "$BASE"

d="$(good_dist)"
sed -i "s#${BASE}assets/index-abc.js#/assets/index-abc.js#" "$d/index.html"
check "an absolute /assets/ src in index.html fails" 1 bash "$CHECK" "$d" "$BASE"

d="$(good_dist)"
printf 'const u = new URL("/assets/parts/body.png", import.meta.url);\n' >> "$d/assets/index-abc.js"
check "an absolute /assets/ string baked into the emitted JS fails" 1 bash "$CHECK" "$d" "$BASE"

d="$(good_dist)"
printf 'const fallback = "ws://127.0.0.1:3000";\n' >> "$d/assets/index-abc.js"
check "the ws://127.0.0.1 local-dev fallback leaking into production fails" 1 bash "$CHECK" "$d" "$BASE"

d="$(fake_dir)"
check "a dist directory with no index.html fails" 1 bash "$CHECK" "$d" "$BASE"

check "missing arguments fail" 1 bash "$CHECK"

summary
exit $?
