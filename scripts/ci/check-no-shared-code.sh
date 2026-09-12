#!/usr/bin/env bash
# NFR30: no code is shared between server/ and client/. "No code is
# shared" is precisely the kind of rule that erodes one convenient import
# at a time, so this is mechanical.
#
# client/'s half of this is already enforced by `tsc --noEmit` today: with
# `rootDir: "src"` in client/tsconfig.json, TypeScript itself refuses
# (TS6059) any import that resolves outside client/src, which subsumes
# resolving outside client/ entirely. This script asserts that guard is
# still wired up (rootDir has not quietly been loosened), then covers the
# two directions tsc cannot see: server/ reaching into client/, and either
# build consuming the other's artefacts. No symlink may cross the trees
# either.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CLIENT_DIR="$REPO_ROOT/client"
SERVER_DIR="$REPO_ROOT/server"
TSCONFIG="$CLIENT_DIR/tsconfig.json"

FAILED=0

# --- client/'s guard against reaching outside itself is still armed ---------
[ -f "$TSCONFIG" ] || { echo "check-no-shared-code: $TSCONFIG not found" >&2; exit 1; }
if ! grep -qE '"rootDir"[[:space:]]*:[[:space:]]*"src"' "$TSCONFIG"; then
  echo "check-no-shared-code: FAIL -- $TSCONFIG does not set rootDir: \"src\" -- that setting is what makes 'tsc --noEmit' reject an import reaching outside client/ (NFR30)" >&2
  FAILED=1
fi

# --- no symlink crosses the two trees ---------------------------------------
# A symlink's own tree (the one it must stay inside) is whichever of
# client/ or server/ it lives under -- not "either tree", which would wave
# through exactly a client/ symlink pointing into server/ or vice versa.
while IFS= read -r -d '' f; do
  [ -L "$REPO_ROOT/$f" ] || continue
  target="$(cd "$REPO_ROOT" && readlink -f -- "$f" 2>/dev/null || true)"
  case "$f" in
    client/*) own_tree="$CLIENT_DIR" ;;
    server/*) own_tree="$SERVER_DIR" ;;
    *) own_tree="" ;;
  esac
  case "$target" in
    "$own_tree"/*) : ;; # stays within its own tree
    *)
      echo "check-no-shared-code: FAIL -- symlink $f resolves outside its own tree ($target) (NFR30)" >&2
      FAILED=1
      ;;
  esac
done < <(cd "$REPO_ROOT" && git ls-files -z -- client server)

# --- server/ never reaches into client/ ---------------------------------------
if [ -d "$SERVER_DIR" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    echo "check-no-shared-code: FAIL -- $f references client/ (NFR30)" >&2
    FAILED=1
  done < <(grep -rlF 'client/' "$SERVER_DIR" --include='*.rs' --include='*.toml' 2>/dev/null || true)
fi

# --- neither build consumes the other's artefacts -----------------------------
if [ -d "$SERVER_DIR" ] && grep -rlE 'client/(dist|node_modules)' "$SERVER_DIR" --include='*.rs' --include='*.toml' 2>/dev/null; then
  echo "check-no-shared-code: FAIL -- server/ references a client/ build artefact (NFR30)" >&2
  FAILED=1
fi
if [ -d "$CLIENT_DIR/src" ] && grep -rlE 'server/target' "$CLIENT_DIR/src" 2>/dev/null; then
  echo "check-no-shared-code: FAIL -- client/src references a server/ build artefact (NFR30)" >&2
  FAILED=1
fi

# --- story 2.1: defs/'s two generated artefacts are explicitly in scope,
# not just caught incidentally by the broader greps above -- the client's
# generated asset (server/ reading it) and the module's generated include
# (client/src reading it) would each be exactly the "one side reads the
# other's generated output" NFR31 forbids alongside NFR30. ------------------
if [ -d "$SERVER_DIR" ] && grep -rlF 'client/public/defs' "$SERVER_DIR" --include='*.rs' --include='*.toml' 2>/dev/null; then
  echo "check-no-shared-code: FAIL -- server/ references client/public/defs, the client's generated defs asset (NFR30, NFR31)" >&2
  FAILED=1
fi
if [ -d "$CLIENT_DIR/src" ] && grep -rlE 'server/sim/src/generated|sim::generated' "$CLIENT_DIR/src" 2>/dev/null; then
  echo "check-no-shared-code: FAIL -- client/src references the module's generated defs include (NFR30, NFR31)" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-no-shared-code: no code or build artefact crosses client/ and server/ (NFR30)" >&2
exit 0
