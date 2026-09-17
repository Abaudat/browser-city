#!/usr/bin/env bash
# AC1/AC4 (story 2.11, FR112): the type-level half of "one rule source"
# (server/sim/src/rules/source.rs's `RuleSet`) closes every path the
# type system alone cannot see. Three checks, each naming the offending
# file:
#
#   (a) a manifest other than server/sim/Cargo.toml's own self dev-
#       dependency and server/bounds/Cargo.toml enables the
#       `test-fixtures` feature -- the only two places `RuleSet::for_test`
#       and `rules::testing` are meant to be reachable from at all.
#   (b) `for_test` appears in a `src/` tree outside `server/sim/src/
#       rules/` -- a second consumer building a `RuleSet` from its own
#       slice.
#   (c) `RuleKind::` appears in a non-generated `src/` file outside
#       `server/sim/src/rules/` -- a second interpreter matching on the
#       engine's own closed kind enum.
#
# Fails the build the moment any of the three appears; passes silently
# otherwise. Parameterised by `SERVER_ROOT` so `scripts/ci/tests/
# test-check-rule-source.sh` can plant a fake tree, following `check-
# rule-engine-no-content-keys.sh`'s own precedent.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

SERVER_ROOT="${1:-"$REPO_ROOT/server"}"
RULES_DIR="sim/src/rules"

if [ ! -d "$SERVER_ROOT" ]; then
  echo "check-rule-source: $SERVER_ROOT not found -- nothing to check" >&2
  exit 0
fi

FAILED=0

# (a) test-fixtures enabled only from the two allowed manifests.
while IFS= read -r -d '' manifest; do
  if grep -qE 'test-fixtures' "$manifest"; then
    rel="${manifest#"$SERVER_ROOT"/}"
    if [ "$rel" != "sim/Cargo.toml" ] && [ "$rel" != "bounds/Cargo.toml" ]; then
      echo "check-rule-source: FAIL -- $manifest enables 'test-fixtures' outside sim/Cargo.toml's own self dev-dependency and bounds/Cargo.toml:" >&2
      grep -nE 'test-fixtures' "$manifest" >&2
      FAILED=1
    fi
  fi
done < <(find "$SERVER_ROOT" -type f -name 'Cargo.toml' -print0)

# (b)/(c): every *.rs file under any crate's own src/ tree, outside
# server/sim/src/rules/ and (for RuleKind::) outside a @generated file.
while IFS= read -r -d '' file; do
  rel="${file#"$SERVER_ROOT"/}"
  case "$rel" in
    "$RULES_DIR"/*) continue ;;
  esac

  if grep -qF 'for_test' "$file"; then
    echo "check-rule-source: FAIL -- 'for_test' appears outside $RULES_DIR:" >&2
    grep -nF 'for_test' "$file" >&2
    FAILED=1
  fi

  case "$rel" in
    */generated/*) continue ;;
  esac
  if grep -qF 'RuleKind::' "$file"; then
    echo "check-rule-source: FAIL -- 'RuleKind::' appears outside $RULES_DIR (a second interpreter):" >&2
    grep -nF 'RuleKind::' "$file" >&2
    FAILED=1
  fi
done < <(find "$SERVER_ROOT" -type d -name src -exec find {} -type f -name '*.rs' -print0 \;)

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-rule-source: one rule source, held under $SERVER_ROOT (AC1/AC4)" >&2
exit 0
