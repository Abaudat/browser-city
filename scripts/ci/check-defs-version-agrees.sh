#!/usr/bin/env bash
# NFR31's AC is "nothing versions independently" -- check-defs-current.sh
# already guarantees the two generated artefacts agree transitively
# (regenerating both from one source would overwrite a hand-forged
# mismatch), but that is an inference from a different check's own
# passing, not a direct assertion. This is the direct pin: compares
# server/sim/src/generated/defs.rs's own DEFS_VERSION against client/
# public/defs/defs.json's own defs_version and fails on any difference,
# naming both values.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_OUT="$REPO_ROOT/server/sim/src/generated/defs.rs"
JSON_OUT="$REPO_ROOT/client/public/defs/defs.json"

[ -f "$RUST_OUT" ] || { echo "check-defs-version-agrees: $RUST_OUT not found" >&2; exit 1; }
[ -f "$JSON_OUT" ] || { echo "check-defs-version-agrees: $JSON_OUT not found" >&2; exit 1; }

rust_version="$(grep -oE 'pub const DEFS_VERSION: &str = "[^"]*"' "$RUST_OUT" | sed -E 's/.*"([^"]*)"$/\1/')"
json_version="$(grep -oE '"defs_version": *"[^"]*"' "$JSON_OUT" | head -n1 | sed -E 's/.*"([^"]*)"$/\1/')"

[ -n "$rust_version" ] || { echo "check-defs-version-agrees: could not find DEFS_VERSION in $RUST_OUT" >&2; exit 1; }
[ -n "$json_version" ] || { echo "check-defs-version-agrees: could not find defs_version in $JSON_OUT" >&2; exit 1; }

if [ "$rust_version" != "$json_version" ]; then
  echo "check-defs-version-agrees: FAIL -- $RUST_OUT has DEFS_VERSION '$rust_version' but $JSON_OUT has defs_version '$json_version'" >&2
  exit 1
fi

echo "check-defs-version-agrees: both generated artefacts carry defs_version '$rust_version'" >&2
exit 0
