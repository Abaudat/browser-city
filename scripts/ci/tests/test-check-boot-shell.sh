#!/usr/bin/env bash
# scripts/ci/check-boot-shell.sh's own coverage (story 4.6): a passing shell
# and one failing shell per rule, so the guard has its own red.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-boot-shell.sh"

GOOD_HEAD='<meta charset="UTF-8" /><title>BrowserCity</title><link rel="icon" href="data:image/svg+xml,x" /><style>#bc-name-prompt{display:flex}</style><script type="module" crossorigin src="/assets/index.js"></script><link rel="modulepreload" href="/assets/a.js">'
GOOD_BODY='<div id="test-street"></div><form id="bc-name-prompt" data-bc-surface="name-prompt"><input name="name" type="text"><button type="submit" aria-label="Enter"></button></form><script>(function(){})();</script>'

shell() { # <head> <body> -> a dist dir holding that index.html
  local d
  d="$(fake_dir)"
  printf '<!doctype html><html><head>%s</head><body>%s</body></html>\n' "$1" "$2" >"$d/index.html"
  printf '%s' "$d"
}
ui() { # <ts content> -> a src/ui dir
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" >"$d/surface.ts"
  printf '%s' "$d"
}
NOUI="$(ui 'export const clean = 1;')"

check "a shell with the inline prompt and nothing blocking passes" 0 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY")" "$NOUI"
check "no built index.html" 1 bash "$CHECK" "$(fake_dir)" "$NOUI"
check "no prompt surface" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" '<div id="test-street"></div>')" "$NOUI"
check "the prompt is not a form" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" '<div data-bc-surface="name-prompt"><input name="name"><button type="submit"></button></div>')" "$NOUI"
check "no submit control" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" '<form data-bc-surface="name-prompt"><input name="name"></form>')" "$NOUI"
NOCSS_HEAD='<meta charset="UTF-8" /><title>BrowserCity</title><link rel="icon" href="data:image/svg+xml,x" /><style>body{margin:0}</style>'
check "the prompt CSS is not inline" 1 bash "$CHECK" "$(shell "$NOCSS_HEAD" "$GOOD_BODY")" "$NOUI"
check "a stylesheet link in the head" 1 bash "$CHECK" "$(shell "$GOOD_HEAD"'<link rel="stylesheet" href="/a.css">' "$GOOD_BODY")" "$NOUI"
check "a classic script in the head" 1 bash "$CHECK" "$(shell "$GOOD_HEAD"'<script src="/a.js"></script>' "$GOOD_BODY")" "$NOUI"
check "a deferred script in the head is fine" 0 bash "$CHECK" "$(shell "$GOOD_HEAD"'<script defer src="/a.js"></script>' "$GOOD_BODY")" "$NOUI"
check "a web font" 1 bash "$CHECK" "$(shell "$GOOD_HEAD"'<style>@font-face{font-family:x;src:url(a.woff2)}</style>' "$GOOD_BODY")" "$NOUI"
check "a title that is not the product's name" 1 bash "$CHECK" "$(shell "${GOOD_HEAD/BrowserCity/Somewhere}" "$GOOD_BODY")" "$NOUI"
check "a favicon that is a file" 1 bash "$CHECK" "$(shell "${GOOD_HEAD/data:image\/svg+xml,x//favicon.svg}" "$GOOD_BODY")" "$NOUI"
check "a <progress> element" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY<progress></progress>")" "$NOUI"
check "role=progressbar" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY<div role=\"progressbar\"></div>")" "$NOUI"
check "an element classed spinner" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY<div class=\"app-spinner\"></div>")" "$NOUI"
check "src/ui naming a loader" 1 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY")" "$(ui 'el.className = "loader";')"
check "src/ui mentioning loading only in a comment" 0 bash "$CHECK" "$(shell "$GOOD_HEAD" "$GOOD_BODY")" "$(ui '// never a loading screen')"

summary
