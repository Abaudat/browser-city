#!/usr/bin/env bash
# Wraps scripts/ci/extract-windows-install.sh: asserts the README's
# Windows install block's first line is exactly the one
# windows-install-check.yml substitutes a headless installer step for
# (story 4.20), then prints every line after it -- the two pinned-version
# lines the workflow runs verbatim. Failing that assertion, rather than
# silently dropping whatever the first line happens to be, is what keeps
# "skip line 1" honest: if server/README.md's first line ever changes,
# this fails by name instead of quietly substituting the wrong line.
#
# Usage: extract-windows-install-pin.sh [README] [expected-first-line]
#   [README]              defaults the same way extract-windows-install.sh
#                          does.
#   [expected-first-line] defaults to the line the workflow's installer
#                          step actually substitutes for.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
README="${1:-$(cd -- "$SCRIPT_DIR/../.." && pwd)/server/README.md}"
EXPECTED_FIRST_LINE="${2:-iwr https://windows.spacetimedb.com -useb | iex}"

BLOCK="$(bash "$SCRIPT_DIR/extract-windows-install.sh" "$README")"
FIRST_LINE="$(printf '%s\n' "$BLOCK" | head -n1)"

if [ "$FIRST_LINE" != "$EXPECTED_FIRST_LINE" ]; then
  echo "extract-windows-install-pin: $README's Windows install block's first line is '$FIRST_LINE', expected exactly '$EXPECTED_FIRST_LINE' -- windows-install-check.yml substitutes a headless installer step for that exact line, so the two must change together" >&2
  exit 1
fi

REST="$(printf '%s\n' "$BLOCK" | tail -n +2)"
if [ -z "$(printf '%s' "$REST" | tr -d '[:space:]')" ]; then
  echo "extract-windows-install-pin: $README's Windows install block has nothing after its first line" >&2
  exit 1
fi

printf '%s\n' "$REST"
