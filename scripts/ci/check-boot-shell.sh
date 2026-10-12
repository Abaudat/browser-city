#!/usr/bin/env bash
# Story 4.6 (FR144, FR145, FR177): the built shell is the name prompt, and
# it must be usable with zero game assets. Asserts, against the *built*
# `dist/index.html` (Vite rewrites the shell, so the source proves nothing):
#   - the prompt's markup (form, input, submit, data-bc-surface) and its CSS
#     are inline in the HTML;
#   - the <head> has nothing render-blocking: no stylesheet link, no classic
#     script, no web font;
#   - <title> is the product's name and the favicon is a data URI;
#   - FR177's ban: no <progress>, no role="progressbar", and nothing named
#     spinner/loading/loader in the shell or in src/ui/ (code, not prose).
# Usage: check-boot-shell.sh [dist-dir] [ui-src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="${1:-$REPO_ROOT/client/dist}"
UI="${2:-$REPO_ROOT/client/src/ui}"
HTML="$DIST/index.html"
[ -f "$HTML" ] || { echo "check-boot-shell: $HTML not found (run 'npm run build')" >&2; exit 1; }

fail=0
bad() { echo "check-boot-shell: FAIL -- $1" >&2; fail=1; }

# One line per tag-ish chunk keeps every grep below simple.
FLAT="$(tr '\r\n' '  ' <"$HTML")"
HEAD="$(printf '%s' "$FLAT" | sed -n 's/.*<head>\(.*\)<\/head>.*/\1/p')"
[ -n "$HEAD" ] || { echo "check-boot-shell: no <head> in $HTML" >&2; exit 1; }

printf '%s' "$FLAT" | grep -q 'data-bc-surface="name-prompt"' || bad "no name-prompt surface in the shell"
printf '%s' "$FLAT" | grep -Eq '<form[^>]*data-bc-surface="name-prompt"' || bad "the name prompt is not a <form>"
printf '%s' "$FLAT" | grep -Eq '<input[^>]*name="name"' || bad "no name <input> in the shell"
printf '%s' "$FLAT" | grep -Eq '<button[^>]*type="submit"' || bad "no submit control in the shell"
printf '%s' "$HEAD" | grep -Eq '<style[^>]*>[^<]*#bc-name-prompt' || bad "the prompt's CSS is not inline in <style>"

printf '%s' "$HEAD" | grep -Eiq '<link[^>]*rel="stylesheet"' && bad "a render-blocking stylesheet link in <head>"
# A classic script in <head> blocks; module/defer/async do not.
if printf '%s' "$HEAD" | grep -Eio '<script[^>]*>' | grep -Eiv 'type="module"|defer|async' | grep -q .; then
  bad "a render-blocking <script> in <head>"
fi
printf '%s' "$FLAT" | grep -Eiq '@font-face|\.(woff2?|ttf|otf)\b' && bad "a web font in the shell"

TITLE="$(printf '%s' "$HEAD" | sed -n 's/.*<title>\([^<]*\)<\/title>.*/\1/p')"
[ "$TITLE" = "BrowserCity" ] || bad "<title> is '$TITLE', not 'BrowserCity'"
printf '%s' "$HEAD" | grep -Eq '<link[^>]*rel="icon"[^>]*href="data:' || bad "the favicon is not an inline data: URI"

printf '%s' "$FLAT" | grep -Eiq '<progress|role="progressbar"' && bad "a progress indicator in the shell (FR177)"
# Names, not prose: class/id/data-* attribute values in the shell...
printf '%s' "$FLAT" | grep -Eiq '(class|id|data-[a-z-]+)="[^"]*(spinner|loading|loader)' && bad "an element named spinner/loading/loader in the shell (FR177)"
# ...and code (not comment lines) under src/ui.
if [ -d "$UI" ]; then
  while IFS= read -r f; do
    if grep -Ev '^\s*(//|\*|/\*)' "$f" | grep -Eiq 'spinner|loader|\bloading\b'; then
      bad "$f names a spinner/loading/loader (FR177)"
    fi
  done < <(find "$UI" -name '*.ts' -type f)
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-boot-shell: the built shell is a usable name prompt with no loading indication" >&2
