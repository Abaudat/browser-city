#!/usr/bin/env bash
# Story 3.4 (Tim's direction): the generator must stay as content-blind as
# the rule engine itself -- it sees building-type ids, tag ids and
# integers, never "depot". The same discipline `check-rule-engine-no-
# content-keys.sh` holds `server/sim/src/rules/` to (AC3, story 2.10),
# applied to `server/sim/src/generation/` and (PR #317 cycle 2, Tim's
# direction: the evidence renderer branching on a tag name is the same
# class of bug even though it never touches a real seed) `server/bounds/
# src/generation_evidence.rs`: fails if any key column 3 of `tools/
# defs-build/goldens/defs-manifest.golden` names appears as a quoted
# string literal anywhere under either -- the generator's own hand-
# written source, never the machine-generated `server/sim/src/generated/
# defs.rs` a real key legitimately reaches as data.
#
# Matches a key only when it is quoted (`"cafe"` or `'cafe'`) -- the shape
# an actual hardcoded branch (`if key == "cafe"`) would take, never a bare
# identifier or ordinary prose, following `check-rule-engine-no-content-
# keys.sh`'s own precedent for avoiding that false-positive class.
#
# Each of `$2.. ` may be a file or a directory (`generation_evidence.rs`
# is one file, `server/sim/src/generation/` is a tree); defaults to both
# real call sites when none are given, so a bare invocation still covers
# everything this check exists to hold.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

MANIFEST="${1:-"$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"}"
shift || true
if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=(
    "$REPO_ROOT/server/sim/src/generation"
    "$REPO_ROOT/server/bounds/src/generation_evidence.rs"
  )
fi

[ -f "$MANIFEST" ] || {
  echo "check-generator-no-content-keys: $MANIFEST not found" >&2
  exit 1
}

for TARGET in "${TARGETS[@]}"; do
  if [ ! -e "$TARGET" ]; then
    echo "check-generator-no-content-keys: FAIL -- $TARGET not found" >&2
    exit 1
  fi
done

FAILED=0
while IFS=' ' read -r _kind _id key; do
  [ -n "${key:-}" ] || continue
  PATTERN="[\"']${key}[\"']"
  for TARGET in "${TARGETS[@]}"; do
    MATCHES="$(grep -rnE "$PATTERN" "$TARGET" --include='*.rs' 2>/dev/null || true)"
    if [ -n "$MATCHES" ]; then
      echo "check-generator-no-content-keys: FAIL -- content key '$key' (from $MANIFEST) appears as a literal under $TARGET:" >&2
      echo "$MATCHES" >&2
      FAILED=1
    fi
  done
done < "$MANIFEST"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-generator-no-content-keys: no manifest key appears as a literal under ${TARGETS[*]}" >&2
exit 0
