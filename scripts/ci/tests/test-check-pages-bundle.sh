#!/usr/bin/env bash
# scripts/ci/check-pages-bundle.sh's own fast, no-real-build coverage.
# Quentin's cycle-1 direction (PR #288): the check is generalised to every
# top-level dist entry, not just /assets/, so the fixtures cover exactly
# what that generalisation was for -- the real /defs/defs.json bug this
# story found (a root-absolute reference to a *different* top-level
# entry, quoted as a plain string, not a src=/href= attribute), an
# unquoted CSS url(...), a single-quoted reference, and the positive
# "the expected URI must actually be present" assertion.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-pages-bundle.sh"
BASE="/browser-city/"
URI="wss://maincloud.example/ws"

# good_dist -- a minimal, correctly-based build: index.html references
# assets and defs under the base, and the JS carries the real production
# URI. Two top-level directories (assets/, defs/) so a fixture can target
# either one, exactly like the real build client-build produces.
good_dist() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/assets" "$d/defs"
  cat > "$d/index.html" <<EOF
<!doctype html>
<html><head><script type="module" src="${BASE}assets/index-abc.js"></script></head><body></body></html>
EOF
  printf 'console.log("connect", "%s");\n' "$URI" > "$d/assets/index-abc.js"
  printf '{}' > "$d/defs/defs.json"
  printf '%s' "$d"
}

d="$(good_dist)"
check "a correctly-based build with the real production URI passes" 0 bash "$CHECK" "$d" "$BASE" "$URI"

d="$(good_dist)"
sed -i "s#${BASE}assets/index-abc.js#/assets/index-abc.js#" "$d/index.html"
check "an absolute /assets/ src in index.html fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

d="$(good_dist)"
printf 'const u = new URL("/assets/parts/body.png", import.meta.url);\n' >> "$d/assets/index-abc.js"
check "an absolute /assets/ string baked into the emitted JS fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

# The real bug (main.ts's fetchDefs("/defs/defs.json")): a root-absolute
# reference to a top-level entry that is not /assets/ at all, as a plain
# double-quoted fetch argument, not an index.html src=/href=.
d="$(good_dist)"
printf 'fetch("/defs/defs.json").then(r=>r.json());\n' >> "$d/assets/index-abc.js"
check "the real bug: a root-absolute /defs/defs.json string fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

# Single-quoted form of the same shape.
d="$(good_dist)"
printf "fetch('/defs/defs.json');\n" >> "$d/assets/index-abc.js"
check "a single-quoted root-absolute /defs/ reference fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

# Backtick template-literal form.
d="$(good_dist)"
printf 'fetch(`/defs/defs.json`);\n' >> "$d/assets/index-abc.js"
check "a backtick-template root-absolute /defs/ reference fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

# Unquoted CSS url(...) -- never matched by a quote-anchored pattern.
d="$(good_dist)"
printf 'body{background:url(/assets/bg.png)}\n' > "$d/assets/style.css"
check "an unquoted CSS url(/assets/...) fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

d="$(good_dist)"
printf 'const fallback = "ws://127.0.0.1:3000";\n' >> "$d/assets/index-abc.js"
check "the ws://127.0.0.1 local-dev fallback leaking into production fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

# The positive assertion: "no localhost fallback" alone would still pass
# a build that baked in some other wrong URI entirely.
d="$(good_dist)"
check "the expected production URI missing from the bundle fails" 1 bash "$CHECK" "$d" "$BASE" "wss://a-different-uri.example/ws"

d="$(fake_dir)"
check "a dist directory with no index.html fails" 1 bash "$CHECK" "$d" "$BASE" "$URI"

check "missing arguments fail" 1 bash "$CHECK"

summary
exit $?
