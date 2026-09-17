#!/usr/bin/env bash
# Story 2.8 (FR147): the direct pin between the two generated
# protocol-version artefacts -- compares server/src/generated/
# protocol_version.rs's own PROTOCOL_VERSION against client/src/net/
# protocol-version.ts's own PROTOCOL_VERSION and fails on any difference,
# naming both values. Same idiom as check-defs-version-agrees.sh.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_OUT="$REPO_ROOT/server/src/generated/protocol_version.rs"
TS_OUT="$REPO_ROOT/client/src/net/protocol-version.ts"

[ -f "$RUST_OUT" ] || { echo "check-protocol-version-agrees: $RUST_OUT not found" >&2; exit 1; }
[ -f "$TS_OUT" ] || { echo "check-protocol-version-agrees: $TS_OUT not found" >&2; exit 1; }

rust_version="$(grep -oE 'pub const PROTOCOL_VERSION: &str = "[^"]*"' "$RUST_OUT" | sed -E 's/.*"([^"]*)"$/\1/')"
ts_version="$(grep -oE 'PROTOCOL_VERSION = "[^"]*"' "$TS_OUT" | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"

[ -n "$rust_version" ] || { echo "check-protocol-version-agrees: could not find PROTOCOL_VERSION in $RUST_OUT" >&2; exit 1; }
[ -n "$ts_version" ] || { echo "check-protocol-version-agrees: could not find PROTOCOL_VERSION in $TS_OUT" >&2; exit 1; }

if [ "$rust_version" != "$ts_version" ]; then
  echo "check-protocol-version-agrees: FAIL -- $RUST_OUT has PROTOCOL_VERSION '$rust_version' but $TS_OUT has '$ts_version'" >&2
  exit 1
fi

echo "check-protocol-version-agrees: both generated artefacts carry protocol_version '$rust_version'" >&2
exit 0
