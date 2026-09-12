#!/usr/bin/env bash
# NFR31: `defs/` is the only source of truth; neither generated artefact
# is ever edited by hand. Modelled directly on check-bindings-current.sh:
# regenerates both of tools/defs-build's outputs from the `defs/` that is
# actually committed, and fails on any diff.
#
# This is a check, not a generator: on any non-success exit it restores
# both output paths to exactly what was committed, so a local run never
# leaves the working tree silently mutated. Regenerating for real is still
# the command named in the failure message, run by hand.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_OUT="$REPO_ROOT/server/sim/src/generated/defs.rs"
JSON_OUT="$REPO_ROOT/client/public/defs/defs.json"
MANIFEST_OUT="$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"
REGEN_CMD="cargo run --manifest-path tools/defs-build/Cargo.toml --bin defs-build"

for f in "$RUST_OUT" "$JSON_OUT" "$MANIFEST_OUT"; do
  [ -f "$f" ] || {
    echo "check-defs-current: $f not found" >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
SUCCEEDED=0
cleanup() {
  if [ "$SUCCEEDED" -ne 1 ]; then
    cp "$WORK/rust.committed" "$RUST_OUT"
    cp "$WORK/json.committed" "$JSON_OUT"
    cp "$WORK/manifest.committed" "$MANIFEST_OUT"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

cp "$RUST_OUT" "$WORK/rust.committed"
cp "$JSON_OUT" "$WORK/json.committed"
cp "$MANIFEST_OUT" "$WORK/manifest.committed"

if ! ( cd "$REPO_ROOT/tools/defs-build" && cargo run --bin defs-build ) >&2; then
  echo "check-defs-current: 'defs-build' failed" >&2
  exit 1
fi

FAILED=0
if ! diff -u "$WORK/rust.committed" "$RUST_OUT" >&2; then
  echo "check-defs-current: FAIL -- $RUST_OUT is stale" >&2
  FAILED=1
fi
if ! diff -u "$WORK/json.committed" "$JSON_OUT" >&2; then
  echo "check-defs-current: FAIL -- $JSON_OUT is stale" >&2
  FAILED=1
fi
if ! diff -u "$WORK/manifest.committed" "$MANIFEST_OUT" >&2; then
  echo "check-defs-current: FAIL -- $MANIFEST_OUT is stale" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "check-defs-current: run \`$REGEN_CMD\` and commit the result" >&2
  exit 1
fi

SUCCEEDED=1
echo "check-defs-current: committed generated defs match tools/defs-build's output" >&2
exit 0
