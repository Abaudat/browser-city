#!/usr/bin/env bash
# Extracts the PowerShell fenced block between <!-- bc:windows-install:start
# --> and <!-- bc:windows-install:end --> in server/README.md and prints it
# to stdout, one command per line, so windows-install-check.yml can execute
# the README's own documented method verbatim rather than a copy of it that
# can drift. Fails closed: no markers, no fenced block inside them, or an
# empty block are all errors, not an empty success.
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
