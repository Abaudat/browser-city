#!/usr/bin/env bash
# Story 15.18 (NFR51): a client property explores the size it states. The one
# setup file sets fast-check's `defaultSizeToMaxWhenMaxSpecified`, so a stated
# maxLength/maxDepth/maxKeys is the size drawn; nothing may override or dodge
# it. Line-based; comment lines are ignored. Under client/tests and client/src:
#   1. tests/unit/setup/property-seed.ts sets `defaultSizeToMaxWhenMaxSpecified: true`.
#      When it does not, every maxLength/maxDepth/maxKeys line in a file
#      importing fast-check is reported, because none of them is honoured.
#   2. `baseSize` appears nowhere.
#   3. A file importing fast-check has no `size`/`depthSize` key whose value is
#      not a number (a literal, an identifier, a template, or shorthand).
#   4. A file importing fast-check has no fc.array/uniqueArray/string/
#      dictionary/anything/json/jsonValue/object call that opens and closes on
#      one line without its own maxLength (array, uniqueArray, string), maxKeys (dictionary)
#      or maxDepth/maxKeys (anything, json, jsonValue, object); a maximum on a
#      nested arbitrary does not count.
# Files under tests/unit/setup/ are exempt from 4 only (the canary draws
# unbounded arbitraries on purpose). It cannot see that a multi-line
# fc.array( carries a maxLength; the probes (size-probe.ts) cover that.
#
# Usage: check-client-property-size.sh [client dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT="${1:-$REPO_ROOT/client}"
SETUP_REL="tests/unit/setup/property-seed.ts"
cd "$CLIENT" # relative paths keep file:line output free of the checkout's own colons

FAILED=0
fail() { echo "check-client-property-size: FAIL -- $1" >&2; FAILED=1; }

# hits <message> <extended regex> <file>...: fail "file:line message" for each
# non-comment line of the files that matches.
hits() {
  local msg="$1" re="$2" hit
  shift 2
  [ "$#" -gt 0 ] || return 0
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    fail "${hit%%:*}:$(echo "${hit#*:}" | cut -d: -f1) $msg"
  done < <(grep -nHE -- "$re" "$@" 2>/dev/null | tr -d '\r' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*)' || true)
}

SWITCH=0
if [ -f "$SETUP_REL" ]; then
  if grep -vE '^[[:space:]]*(//|/\*|\*)' "$SETUP_REL" \
    | grep -qE 'defaultSizeToMaxWhenMaxSpecified[[:space:]]*:[[:space:]]*true'; then SWITCH=1; fi
else
  fail "$SETUP_REL is missing"
fi
[ "$SWITCH" -eq 1 ] || fail "$SETUP_REL does not set defaultSizeToMaxWhenMaxSpecified: true -- no stated maximum below is honoured"

mapfile -t ALL < <(find tests src -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' 2>/dev/null | sort)
[ "${#ALL[@]}" -gt 0 ] || { [ "$FAILED" -eq 0 ] || exit 1; exit 0; }
mapfile -t PROPS < <(grep -lE "from ['\"]fast-check['\"]|require\(['\"]fast-check['\"]\)" "${ALL[@]}" 2>/dev/null || true)
mapfile -t OUTSIDE < <(printf '%s\n' "${PROPS[@]}" | grep -v "^tests/unit/setup/" || true)

hits "sets baseSize -- a stated maximum is the size, never a base size" '\<baseSize\>' "${ALL[@]}"
if [ "$SWITCH" -eq 0 ]; then
  hits "states a maximum that is not honoured" '\<(maxLength|maxDepth|maxKeys)\>' "${PROPS[@]}"
fi
# Rule 3 holds everywhere fast-check is imported, the setup directory included:
# a size/depthSize key may only carry a number, never a literal, identifier or
# shorthand.
hits "sets a fast-check size -- lower the stated maximum instead"   '\<(size|depthSize)[[:space:]]*:[[:space:]]*[^-0-9[:space:]]|[{,][[:space:]]*(size|depthSize)[[:space:]]*[,}]' "${PROPS[@]}"

# Rule 4: a one-line call of a sized arbitrary must state a maximum.
if [ "${#OUTSIDE[@]}" -gt 0 ]; then
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    fail "$hit draws a sized arbitrary with no stated maximum"
  done < <(awk '
    { sub(/\r$/, "") }
    /^[[:space:]]*(\/\/|\/\*|\*)/ { next }
    {
      line = $0; rest = line
      while (match(rest, /fc\.(array|uniqueArray|string|dictionary|anything|json|jsonValue|object)\(/)) {
        start = RSTART
        kind = substr(rest, start + 3, RLENGTH - 4)
        depth = 0; end = 0; own = ""
        for (i = start + RLENGTH - 1; i <= length(rest); i++) {
          c = substr(rest, i, 1)
          if (c == "(") depth++
          else if (c == ")") { depth--; if (depth == 0) { end = i; break } }
          if (depth == 1) own = own c
        }
        want = (kind == "dictionary") ? "maxKeys" : (kind ~ /^(anything|json|jsonValue|object)$/) ? "max(Depth|Keys)" : "maxLength"
        if (end > 0 && own !~ want) { print FILENAME ":" FNR; break }
        rest = substr(rest, start + RLENGTH)
      }
    }' "${OUTSIDE[@]}" 2>/dev/null | sort -u)
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "check-client-property-size: every client property explores the size it states (story 15.18)" >&2
exit 0
