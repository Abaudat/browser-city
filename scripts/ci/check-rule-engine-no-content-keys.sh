#!/usr/bin/env bash
# AC3 (story 2.10, FR111/FR112): a rule per special case is the known
# failure mode -- the engine must never grow a bespoke branch keyed on a
# specific object/def key ("cafe", "dwelling"). `sim::rules`'s own
# `match` on the closed `RuleKind` enum is the compile-time half of that
# guarantee; this is the mechanical, second-source half Quentin's
# direction asks for: fails if any key column 3 of `tools/defs-build/
# goldens/defs-manifest.golden` names appears as a quoted string literal
# anywhere under `server/sim/src/rules/` -- the engine's own hand-written
# source, never the machine-generated `server/sim/src/generated/defs.rs`
# a real key legitimately reaches as data.
#
# Matches a key only when it is quoted (`"cafe"` or `'cafe'`) -- the
# shape an actual hardcoded branch (`if key == "cafe"`) would take, never
# a bare identifier (a test fixture constant named `WASTE` is not a
# content-keyed branch) or ordinary prose (a doc comment explaining "a
# wall run" is not a reference to the `wall` tag). This is deliberately
# narrower than a bare substring search, following `check-no-walkable-
# field.sh`'s own precedent for avoiding exactly that false-positive
# class.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

MANIFEST="${1:-"$REPO_ROOT/tools/defs-build/goldens/defs-manifest.golden"}"
ENGINE_DIR="${2:-"$REPO_ROOT/server/sim/src/rules"}"

[ -f "$MANIFEST" ] || {
  echo "check-rule-engine-no-content-keys: $MANIFEST not found" >&2
  exit 1
}

if [ ! -d "$ENGINE_DIR" ]; then
  echo "check-rule-engine-no-content-keys: $ENGINE_DIR not found -- nothing to check" >&2
  exit 0
fi

FAILED=0
while IFS=' ' read -r _kind _id key; do
  [ -n "${key:-}" ] || continue
  PATTERN="[\"']${key}[\"']"
  MATCHES="$(grep -rnE "$PATTERN" "$ENGINE_DIR" --include='*.rs' 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-rule-engine-no-content-keys: FAIL -- content key '$key' (from $MANIFEST) appears as a literal under $ENGINE_DIR:" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
done < "$MANIFEST"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-rule-engine-no-content-keys: no manifest key appears as a literal under $ENGINE_DIR (AC3)" >&2
exit 0
