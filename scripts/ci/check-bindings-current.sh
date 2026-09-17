#!/usr/bin/env bash
# "Generated, never hand-written" (architecture.md) is a rule that can be
# made mechanical, so this makes it mechanical: regenerates
# client/src/net/bindings from the module that is actually in `server/`
# and fails on any diff. Drift between the module's schema and the
# committed bindings is exactly the bug story 1.1 can leave behind for
# every later story to trip over.
#
# Story 2.8: also regenerates the two `protocol_version` artefacts
# (scripts/gen-protocol-version.sh) in the same run and diffs those too --
# they move together (the hash is over the bindings themselves), so one
# check catches drift in either, not two.
#
# This is a check, not a generator: on any non-success exit it restores
# every artefact this script regenerates to exactly what was committed, so
# a local run never leaves the working tree silently mutated. Regenerating
# for real is still the command named in the failure message, run by hand.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
BINDINGS_DIR="$REPO_ROOT/client/src/net/bindings"
PROTOCOL_RS="$REPO_ROOT/server/src/generated/protocol_version.rs"
PROTOCOL_TS="$REPO_ROOT/client/src/net/protocol-version.ts"

[ -d "$BINDINGS_DIR" ] || {
  echo "check-bindings-current: $BINDINGS_DIR not found" >&2
  exit 1
}
for f in "$PROTOCOL_RS" "$PROTOCOL_TS"; do
  [ -f "$f" ] || {
    echo "check-bindings-current: $f not found" >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
SUCCEEDED=0
cleanup() {
  if [ "$SUCCEEDED" -ne 1 ]; then
    rm -rf "$BINDINGS_DIR"
    cp -r "$WORK/committed-bindings" "$BINDINGS_DIR"
    cp "$WORK/committed-protocol.rs" "$PROTOCOL_RS"
    cp "$WORK/committed-protocol.ts" "$PROTOCOL_TS"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

cp -r "$BINDINGS_DIR" "$WORK/committed-bindings"
cp "$PROTOCOL_RS" "$WORK/committed-protocol.rs"
cp "$PROTOCOL_TS" "$WORK/committed-protocol.ts"

if ! spacetime generate --lang typescript --out-dir "$BINDINGS_DIR" --module-path "$REPO_ROOT/server" >&2; then
  echo "check-bindings-current: 'spacetime generate' failed" >&2
  exit 1
fi

if ! diff -rq "$WORK/committed-bindings" "$BINDINGS_DIR" >&2; then
  echo "check-bindings-current: FAIL -- client/src/net/bindings is stale; run the generate command above and commit the result" >&2
  exit 1
fi

if ! bash "$REPO_ROOT/scripts/gen-protocol-version.sh" >&2; then
  echo "check-bindings-current: 'scripts/gen-protocol-version.sh' failed" >&2
  exit 1
fi

if ! diff -u "$WORK/committed-protocol.rs" "$PROTOCOL_RS" >&2 \
  || ! diff -u "$WORK/committed-protocol.ts" "$PROTOCOL_TS" >&2; then
  echo "check-bindings-current: FAIL -- protocol_version is stale; run scripts/gen-protocol-version.sh and commit the result" >&2
  exit 1
fi

SUCCEEDED=1
echo "check-bindings-current: committed bindings and protocol_version both match the module" >&2
exit 0
