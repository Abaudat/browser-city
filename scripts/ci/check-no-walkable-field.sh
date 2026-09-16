#!/usr/bin/env bash
# FR128 (story 2.2): absence of a collider is walkability -- there is no
# separate `walkable` field anywhere in the schema. `deny_unknown_fields`
# (server) and `checkKnownKeys` (client) already refuse an authored
# `walkable` key at parse time; this is the cheap, second-source guard
# Quentin's direction asks for -- a mechanical grep, not a behavioural
# test, so a `walkable` field can never creep back in as a field name
# under `defs/**` or either generated artefact.
#
# Matches `walkable` only as a key -- `walkable =` (TOML), `walkable:`
# (Rust struct-literal field) or `"walkable":` (JSON) -- never as ordinary
# English prose ("an ordinary walkable cell"), which `defs/objects/
# city-props.toml`'s own comments legitimately use.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

DEFS_DIR="${1:-"$REPO_ROOT/defs"}"
RUST_OUT="${2:-"$REPO_ROOT/server/sim/src/generated/defs.rs"}"
JSON_OUT="${3:-"$REPO_ROOT/client/public/defs/defs.json"}"

PATTERN='\bwalkable"?[[:space:]]*[=:]'

MATCHES=""
if [ -d "$DEFS_DIR" ]; then
  MATCHES="$(grep -rnE "$PATTERN" "$DEFS_DIR" --include='*.toml' 2>/dev/null || true)"
fi
for f in "$RUST_OUT" "$JSON_OUT"; do
  if [ -f "$f" ]; then
    FOUND="$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)"
    [ -n "$FOUND" ] && MATCHES="$MATCHES
$f: $FOUND"
  fi
done

if [ -n "$MATCHES" ]; then
  echo "check-no-walkable-field: FAIL -- a 'walkable' field was found (FR128: there is no separate walkable field; absence of a collider is walkability):" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "check-no-walkable-field: no 'walkable' field under defs/** or either generated artefact (FR128)" >&2
exit 0
