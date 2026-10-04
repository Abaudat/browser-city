#!/usr/bin/env bash
# Story 4.4 (NFR32): the reducers and procedures the client calls are an exact
# allow-list. A call anywhere under client/src (bindings excluded) to a name
# not on the list fails, and so does a listed name nobody calls any more --
# a sixth call fails until the list, and NFR32's own reading, are revisited.
# The position write lives under client/src/net/ alone.
#
# Usage: check-client-write-allowlist.sh [client-src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/client/src"}"
[ -d "$SRC_DIR" ] || { echo "check-client-write-allowlist: $SRC_DIR not found" >&2; exit 1; }

ALLOWED="beginLink completeLink createCharacter setPlayerPosition syncClock"

FOUND="$(
  find "$SRC_DIR" -name '*.ts' -not -path '*/bindings/*' -print0 \
    | xargs -0 cat \
    | tr -d '\r' \
    | grep -v '^[[:space:]]*\(//\|\*\|/\*\)' \
    | grep -oE '\.(reducers|procedures)\.[A-Za-z0-9_]+' \
    | sed -E 's/^\.(reducers|procedures)\.//' \
    | sort -u \
    | tr '\n' ' ' \
    | sed 's/ $//' || true
)"
WANT="$(printf '%s\n' $ALLOWED | sort -u | tr '\n' ' ' | sed 's/ $//')"

if [ "$FOUND" != "$WANT" ]; then
  echo "check-client-write-allowlist: FAIL -- the client's reducer/procedure calls moved (NFR32):" >&2
  echo "  allowed: $WANT" >&2
  echo "  found:   $FOUND" >&2
  exit 1
fi

OUTSIDE_NET="$(grep -rlE '\.reducers\.setPlayerPosition' "$SRC_DIR" --include='*.ts' --exclude-dir=bindings | grep -v '/net/' || true)"
if [ -n "$OUTSIDE_NET" ]; then
  echo "check-client-write-allowlist: FAIL -- the position write lives under client/src/net/ alone:" >&2
  echo "$OUTSIDE_NET" >&2
  exit 1
fi
echo "check-client-write-allowlist: the client calls exactly: $WANT (NFR32)" >&2
