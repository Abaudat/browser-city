#!/usr/bin/env bash
# NFR31: `defs/` is the only source of truth; neither generated artefact
# is ever edited by hand. Modelled directly on check-bindings-current.sh:
# regenerates both of tools/defs-build's outputs from the `defs/` that is
# actually committed, and fails on any diff.
#
# This is a check, not a generator: on any non-success exit it restores
# both output paths, and the whole `client/public/atlas/` directory, to
# exactly what was committed, so a local run never leaves the working tree
# silently mutated. Regenerating for real is still the command named in
# the failure message, run by hand.
#
# Usage: check-defs-current.sh [repo-root] [regen-cmd]
#   [repo-root]  defaults to the real repository root -- overridden by
#                scripts/ci/tests/test-check-defs-current.sh's own fake
#                trees, so this suite never needs cargo.
#   [regen-cmd]  defaults to the real `cargo run ...` invocation --
#                overridden by the same test suite with a stub that
#                mutates a fake tree's output paths directly.
set -euo pipefail
REPO_ROOT="${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"
REGEN_CMD="${2:-"cd '$REPO_ROOT/tools/defs-build' && cargo run --bin defs-build"}"
RUST_OUT="$REPO_ROOT/server/sim/src/generated/defs.rs"
JSON_OUT="$REPO_ROOT/client/public/defs/defs.json"
MANIFEST_OUT="$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"
# Story 2.6: the atlas pages the same `defs-build` run writes -- this
# directory is wholly owned by that run (`fsio::sync_binary_dir`), so
# "current" also means "nothing here that this run did not just emit".
ATLAS_DIR="$REPO_ROOT/client/public/atlas"

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
    rm -rf "$ATLAS_DIR"
    if [ -d "$WORK/atlas.committed" ]; then
      cp -R "$WORK/atlas.committed" "$ATLAS_DIR"
    fi
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

cp "$RUST_OUT" "$WORK/rust.committed"
cp "$JSON_OUT" "$WORK/json.committed"
cp "$MANIFEST_OUT" "$WORK/manifest.committed"
mkdir -p "$WORK/atlas.committed"
[ -d "$ATLAS_DIR" ] && cp -R "$ATLAS_DIR/." "$WORK/atlas.committed/"

if ! ( eval "$REGEN_CMD" ) >&2; then
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
if ! diff -rq "$WORK/atlas.committed" "$ATLAS_DIR" >&2; then
  echo "check-defs-current: FAIL -- $ATLAS_DIR is stale (a page was hand-edited, added or is a leftover this run no longer writes)" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "check-defs-current: run \`cargo run --manifest-path tools/defs-build/Cargo.toml --bin defs-build\` and commit the result" >&2
  exit 1
fi

SUCCEEDED=1
echo "check-defs-current: committed generated defs (pages included) match tools/defs-build's output" >&2
exit 0
