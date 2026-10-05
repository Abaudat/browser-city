#!/usr/bin/env bash
# Extracts the PowerShell fenced block between <!-- bc:windows-install:start
# --> and <!-- bc:windows-install:end --> in server/README.md and prints it
# to stdout, one command per line -- the README's own documented method,
# never a copy of it that can drift. scripts/ci/extract-windows-install-pin.sh
# wraps this to get everything after the block's own first line, the two
# pinned-version commands windows-install-check.yml's "version pin" step
# runs verbatim; the first line itself is what that workflow's "installer"
# step substitutes a headless install for (story 4.20). Fails closed: no
# markers, no fenced block inside them, or an empty block are all errors,
# not an empty success.
set -euo pipefail

README="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/server/README.md}"

[ -f "$README" ] || { echo "extract-windows-install: $README not found" >&2; exit 1; }

if ! grep -qF '<!-- bc:windows-install:start -->' "$README"; then
  echo "extract-windows-install: $README is missing the <!-- bc:windows-install:start --> marker" >&2
  exit 1
fi
if ! grep -qF '<!-- bc:windows-install:end -->' "$README"; then
  echo "extract-windows-install: $README is missing the <!-- bc:windows-install:end --> marker" >&2
  exit 1
fi

BETWEEN="$(awk '
  /<!-- bc:windows-install:start -->/ { inblock = 1; next }
  /<!-- bc:windows-install:end -->/ { inblock = 0 }
  inblock { print }
' "$README")"

BLOCK="$(printf '%s\n' "$BETWEEN" | awk '
  /^```/ { infence = !infence; next }
  infence { print }
')"

if [ -z "$(printf '%s' "$BLOCK" | tr -d '[:space:]')" ]; then
  echo "extract-windows-install: no non-empty fenced code block between the markers" >&2
  exit 1
fi

printf '%s\n' "$BLOCK"
