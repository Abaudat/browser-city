#!/usr/bin/env bash
# Story 3.7 (FR113, "no fifth mechanism"): a neighbourhood is an area, never
# an identity. Anything that differs by place reads one of the four dials
# (density, building age, affluence, land-use mix); a rule, a type or the
# generator that names a neighbourhood or a region -- an id, a key, a name,
# an archetype or preset ("old town", "docks") -- is a fifth mechanism.
# Fails if any such identifier appears in the generator's own Rust or in the
# generation content under defs/ (rules, building types, generation balance).
#
# Usage: check-generator-no-neighbourhood-identity.sh [path ...]
#   Each path is a file or a directory; defaults to the real call sites.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=(
    "$REPO_ROOT/server/sim/src/generation"
    "$REPO_ROOT/defs/rules"
    "$REPO_ROOT/defs/building-types"
    "$REPO_ROOT/defs/balance/generation.toml"
  )
fi

PATTERN='neighbourhood_(id|key|name)|hood_(id|key|name)|region_(id|key|name)|old_town|docks|archetype|preset'

for TARGET in "${TARGETS[@]}"; do
  [ -e "$TARGET" ] || {
    echo "check-generator-no-neighbourhood-identity: FAIL -- $TARGET not found" >&2
    exit 1
  }
done

MATCHES="$(grep -rniE "$PATTERN" "${TARGETS[@]}" 2>/dev/null || true)"
if [ -n "$MATCHES" ]; then
  echo "check-generator-no-neighbourhood-identity: FAIL -- a neighbourhood or region identity appears where only the four dials may decide character:" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi

echo "check-generator-no-neighbourhood-identity: no neighbourhood or region identity under ${TARGETS[*]}"
