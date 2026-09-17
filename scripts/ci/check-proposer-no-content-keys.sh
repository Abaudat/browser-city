#!/usr/bin/env bash
# Story 2.3, Quentin's direction: a per-object special case is exactly
# the failure mode the proposer must never grow -- it has no ids, keys
# or override tables (AC3: a correction lives in `defs/`, never in the
# tool). Same pattern as check-rule-engine-no-content-keys.sh: fails if
# any committed object key (`tools/defs-build/goldens/defs-manifest.
# golden`'s own `object` column-3 keys) or any tileset sheet filename
# (every `sprite.sheet`/`sheet` basename `defs/` itself names) appears as
# a quoted string literal anywhere under the proposer's own source
# (`tools/defs-build/src/propose.rs`, `tools/defs-build/src/bin/
# defs-propose.rs`).
#
# Matches a literal only when quoted (`"cafe"` or `'cafe'`), never a bare
# identifier or ordinary prose -- the same narrower-than-substring
# reasoning `check-no-walkable-field.sh` already established.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

MANIFEST="${1:-"$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"}"
PROPOSER_DIR="${2:-"$REPO_ROOT/tools/defs-build/src"}"
DEFS_DIR="${3:-"$REPO_ROOT/defs"}"

[ -f "$MANIFEST" ] || {
  echo "check-proposer-no-content-keys: $MANIFEST not found" >&2
  exit 1
}
[ -d "$PROPOSER_DIR" ] || {
  echo "check-proposer-no-content-keys: FAIL -- $PROPOSER_DIR not found" >&2
  exit 1
}
[ -d "$DEFS_DIR" ] || {
  echo "check-proposer-no-content-keys: FAIL -- $DEFS_DIR not found" >&2
  exit 1
}

# The proposer's own source: `propose.rs` and `bin/defs-propose.rs` only
# -- never the whole crate (every other module legitimately quotes all
# sorts of literals).
PROPOSER_FILES=()
[ -f "$PROPOSER_DIR/propose.rs" ] && PROPOSER_FILES+=("$PROPOSER_DIR/propose.rs")
[ -f "$PROPOSER_DIR/bin/defs-propose.rs" ] && PROPOSER_FILES+=("$PROPOSER_DIR/bin/defs-propose.rs")

if [ "${#PROPOSER_FILES[@]}" -eq 0 ]; then
  echo "check-proposer-no-content-keys: FAIL -- neither propose.rs nor bin/defs-propose.rs found under $PROPOSER_DIR" >&2
  exit 1
fi

FAILED=0

while IFS=' ' read -r kind _id key; do
  [ "$kind" = "object" ] || continue
  [ -n "${key:-}" ] || continue
  PATTERN="[\"']${key}[\"']"
  for f in "${PROPOSER_FILES[@]}"; do
    MATCHES="$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)"
    if [ -n "$MATCHES" ]; then
      echo "check-proposer-no-content-keys: FAIL -- object key '$key' (from $MANIFEST) appears as a literal in $f:" >&2
      echo "$MATCHES" >&2
      FAILED=1
    fi
  done
done < "$MANIFEST"

# Every tileset sheet filename `defs/` itself names (`sheet = "..."` or
# `sprite = { sheet = "...", ... }`), basename only -- a full path would
# never match a literal a proposer source has no reason to spell out any
# differently anyway, and basenames are what a hardcoded special case
# would actually key off.
SHEET_BASENAMES="$(grep -rhoE '(sheet|sprite)[^"]*"[^"]*\.png"' "$DEFS_DIR" --include='*.toml' 2>/dev/null \
  | grep -oE '[^/"]+\.png' | sort -u || true)"

while IFS= read -r basename; do
  [ -n "$basename" ] || continue
  PATTERN="[\"']${basename}[\"']"
  for f in "${PROPOSER_FILES[@]}"; do
    MATCHES="$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)"
    if [ -n "$MATCHES" ]; then
      echo "check-proposer-no-content-keys: FAIL -- sheet filename '$basename' appears as a literal in $f:" >&2
      echo "$MATCHES" >&2
      FAILED=1
    fi
  done
done <<< "$SHEET_BASENAMES"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-proposer-no-content-keys: no committed object key or sheet filename appears as a literal under the proposer's own source" >&2
exit 0
