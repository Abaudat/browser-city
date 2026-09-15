#!/usr/bin/env bash
# Injects the `<meta name="bc-build">` commit stamp into a built
# `index.html`, just before `</head>` -- `.github/workflows/deploy.yml`'s
# `deploy-client` job's own step, extracted out of an inline `sed` (PR
# #288 cycle 2, Quentin's direction: the format was written here and
# parsed independently in two other places; now all three read
# `scripts/ci/lib/bc-build-stamp.sh`).
#
# Usage: stamp-build.sh <index.html> <sha>
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bc-build-stamp.sh
. "$SCRIPT_DIR/lib/bc-build-stamp.sh"

INDEX_HTML="${1:-}"
SHA="${2:-}"

[ -n "$INDEX_HTML" ] || { echo "stamp-build: missing <index.html> argument" >&2; exit 1; }
[ -n "$SHA" ] || { echo "stamp-build: missing <sha> argument" >&2; exit 1; }
[ -f "$INDEX_HTML" ] || { echo "stamp-build: $INDEX_HTML not found" >&2; exit 1; }
grep -q '</head>' "$INDEX_HTML" || { echo "stamp-build: $INDEX_HTML has no </head> to inject before" >&2; exit 1; }

STAMP_LINE="$(bc_build_stamp_line "$SHA")"
TMP="$(mktemp)"
awk -v line="$STAMP_LINE" '{ if ($0 ~ /<\/head>/) print line; print }' "$INDEX_HTML" > "$TMP"
mv "$TMP" "$INDEX_HTML"

echo "stamp-build: stamped $INDEX_HTML with $SHA" >&2
