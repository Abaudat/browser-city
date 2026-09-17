#!/usr/bin/env bash
# Story 2.3, AC4 made absolute: no footprint is ever inferred at runtime.
# `sim` already cannot decode an image at all (check-sim-purity.sh) --
# this is the rest of AC4, mechanical rather than a promise:
#
#   1. the word `archetype` appears in neither generated artefact, nor
#      anywhere under `client/src/` or `server/` -- an archetype is
#      authoring-time only (Tim's direction) and must never reach a
#      runtime artefact or a runtime's own source;
#   2. the proposer module/crate is referenced only by its own bin
#      (`src/bin/defs-propose.rs`) and its own tests -- never from
#      `lib.rs`'s `build` path, and never from `client/src/` or `server/`
#      (a `getImageData`/alpha-coverage identifier under `client/src/`
#      would be the client's own version of the same mistake).
#
# Usage: check-no-runtime-footprint-inference.sh [repo-root]
set -euo pipefail
REPO_ROOT="${1:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"

RUST_OUT="$REPO_ROOT/server/sim/src/generated/defs.rs"
JSON_OUT="$REPO_ROOT/client/public/defs/defs.json"
CLIENT_SRC="$REPO_ROOT/client/src"
SERVER_DIR="$REPO_ROOT/server"
LIB_RS="$REPO_ROOT/tools/defs-build/src/lib.rs"

FAILED=0

# --- 1. "archetype" reaches no runtime artefact and no runtime source --
for f in "$RUST_OUT" "$JSON_OUT"; do
  if [ -f "$f" ] && grep -qiE 'archetype' "$f" 2>/dev/null; then
    echo "check-no-runtime-footprint-inference: FAIL -- '$f' names 'archetype' (AC3: authoring-time only, never a runtime artefact):" >&2
    grep -inE 'archetype' "$f" >&2
    FAILED=1
  fi
done

for dir in "$CLIENT_SRC" "$SERVER_DIR"; do
  [ -d "$dir" ] || continue
  # `test-street/` (docs/architecture.md: "the one hand-laid scene the
  # client is not code-generated from") is a dev-only harness, never a
  # runtime module a real player's session loads -- excluded the same
  # way `check-input-boundary.sh` treats it as its own thing, distinct
  # from the runtime client.
  MATCHES="$(grep -rliE 'archetype' "$dir" --include='*.ts' --include='*.rs' --exclude-dir=bindings --exclude-dir=test-street 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-no-runtime-footprint-inference: FAIL -- 'archetype' appears under $dir (never a runtime source):" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
done

# --- 2. the proposer is never an input to `build` ------------------------
#
# `pub mod propose;` is the module's own required declaration -- this
# looks for a *path* reference (`propose::`), which only a real caller
# ever writes; the declaration line itself never contains `::`.
if [ -f "$LIB_RS" ] && grep -qE 'propose::' "$LIB_RS" 2>/dev/null; then
  echo "check-no-runtime-footprint-inference: FAIL -- $LIB_RS references 'propose::' -- the proposer must never be an input to build()'s own path:" >&2
  grep -nE 'propose::' "$LIB_RS" >&2
  FAILED=1
fi

for dir in "$CLIENT_SRC" "$SERVER_DIR"; do
  [ -d "$dir" ] || continue
  # `test-street/` excluded, same reasoning as above -- it is the one
  # place this repo already has a legitimate `getImageData` call (a
  # dev-only pixel comparison harness), unrelated to footprint inference.
  MATCHES="$(grep -rliE 'propose::|defs[_-]propose|getImageData|alpha[_-]?coverage' "$dir" --include='*.ts' --include='*.rs' --exclude-dir=bindings --exclude-dir=test-street 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-no-runtime-footprint-inference: FAIL -- a footprint-proposer or alpha-coverage identifier appears under $dir:" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-no-runtime-footprint-inference: 'archetype' and the proposer never reach a runtime artefact or a runtime's own source (AC3/AC4)" >&2
exit 0
