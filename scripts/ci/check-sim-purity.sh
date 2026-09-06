#!/usr/bin/env bash
# NFR28: sim/ is pure and never reads a table. Structurally, sim's Cargo.toml
# has no spacetimedb dependency and never will -- this script is the one
# cheap check that nobody quietly re-adds it (directly or transitively), and
# that nothing that would break "property tests run with no database"
# (tokio, a network client, a filesystem crate) sneaks in either.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/../../server"

FORBIDDEN=(spacetimedb spacetimedb-lib spacetimedb-sats spacetimedb-bindings-sys tokio)

TREE="$(cargo tree --manifest-path sim/Cargo.toml --edges normal,build 2>&1)" || {
  echo "check-sim-purity: 'cargo tree' failed:" >&2
  echo "$TREE" >&2
  exit 1
}

FAILED=0
for crate in "${FORBIDDEN[@]}"; do
  # Tree lines look like "|   |-- spacetimedb v2.9.0" -- match the crate name
  # as a whole tree node (preceded by start-of-line or a non-identifier
  # character, e.g. the box-drawing/space prefix cargo tree renders).
  if printf '%s\n' "$TREE" | grep -qE "(^|[^a-zA-Z0-9_-])${crate} v[0-9]"; then
    echo "check-sim-purity: FAIL -- '$crate' found in sim's dependency graph (NFR28):" >&2
    printf '%s\n' "$TREE" | grep -E "${crate} v[0-9]" >&2
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-sim-purity: sim's dependency graph is clean" >&2
exit 0
