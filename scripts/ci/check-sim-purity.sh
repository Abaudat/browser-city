#!/usr/bin/env bash
# NFR28: sim/ is pure. sim has exactly zero normal/build dependencies today,
# and that is the property worth defending -- a denylist of crate names
# ages badly (it protects against the mistakes we already thought of, not
# the next one), so this is an allowlist: fail if sim's normal+build
# dependency graph contains anything beyond sim itself and this explicit,
# commented allowlist.
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]}")/../../server"

# Nothing is allowed here today. Add a crate only with the same care as a
# new entry in sim/Cargo.toml's [dependencies] -- this list exists so that
# decision is visible in one place, not spread across a dependency tree.
ALLOWED=(sim)

TREE="$(cargo tree --manifest-path sim/Cargo.toml --edges normal,build --prefix none --no-dedupe 2>&1)" || {
  echo "check-sim-purity: 'cargo tree' failed:" >&2
  echo "$TREE" >&2
  exit 1
}

FAILED=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  name="${line%% v*}"
  allowed=0
  for a in "${ALLOWED[@]}"; do
    if [ "$name" = "$a" ]; then
      allowed=1
      break
    fi
  done
  if [ "$allowed" -ne 1 ]; then
    echo "check-sim-purity: FAIL -- '$name' is in sim's normal/build dependency graph and is not on the allowlist (NFR28): $line" >&2
    FAILED=1
  fi
done <<< "$TREE"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-sim-purity: sim's dependency graph is exactly the allowlist" >&2
exit 0
