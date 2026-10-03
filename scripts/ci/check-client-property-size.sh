#!/usr/bin/env bash
# Story 15.18 (NFR51): a client property explores the size it states. The one
# setup file sets fast-check's `defaultSizeToMaxWhenMaxSpecified`, so a stated
# maxLength/maxDepth/maxKeys is the size drawn; nothing may override or dodge
# it. Line-based; comment lines are ignored. Under client/tests and client/src:
#   1. tests/unit/setup/property-seed.ts sets `defaultSizeToMaxWhenMaxSpecified: true`.
#      When it does not, every maxLength/maxDepth/maxKeys line in a file
#      importing fast-check is reported, because none of them is honoured.
#   2. `baseSize` appears nowhere.
#   3. A file importing fast-check has no `size`/`depthSize` key set to a
#      fast-check size literal ("max", "xsmall".."xlarge", "-4".."+4", "=").
#   4. A file importing fast-check has no zero-argument fc.string(),
#      fc.anything(), fc.json(), fc.jsonValue(), fc.object(), and no
#      fc.array(x)/fc.uniqueArray(x) closed on one line with no options.
# Files under tests/unit/setup/ are exempt from 3 and 4 (the canary test there
# pins the defaults). It cannot see that a multi-line fc.array( carries a
# maxLength; the probes in the properties (size-probe.ts) cover that.
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
LITERAL="\"(max|xsmall|small|medium|large|xlarge|[-+][0-4]|=)\"|'(max|xsmall|small|medium|large|xlarge|[-+][0-4]|=)'"
hits "sets a fast-check size -- lower the stated maximum instead" \
  "\<(size|depthSize)[[:space:]]*:[[:space:]]*($LITERAL)" "${OUTSIDE[@]}"
hits "draws an arbitrary with no stated maximum" \
  'fc\.(string|anything|json|jsonValue|object)\(\)' "${OUTSIDE[@]}"
hits "draws an array with no options, so no stated maximum" \
  'fc\.(array|uniqueArray)\((fc\.[A-Za-z]+\([^(){}]*\)|[A-Za-z_][A-Za-z0-9_.]*)\)' "${OUTSIDE[@]}"

[ "$FAILED" -eq 0 ] || exit 1
echo "check-client-property-size: every client property explores the size it states (story 15.18)" >&2
exit 0
