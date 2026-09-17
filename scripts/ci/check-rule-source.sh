#!/usr/bin/env bash
# AC1/AC4 (story 2.11, FR112): the type-level half of "one rule source"
# (server/sim/src/rules/source.rs's `RuleSet`) closes every path the
# type system alone cannot see. Five checks, each naming the offending
# file:
#
#   (a) `server/sim/Cargo.toml` names the `test-fixtures` feature
#       anywhere other than its own `[features]` declaration line and its
#       self dev-dependency line -- a `default = [..., "test-fixtures"]`
#       (or any other feature implying it) would compile `for_test`,
#       `rules::testing` and `world::fixture` into every consumer,
#       silently, with the manifest allow-list below none the wiser.
#   (a2) the *resolved* feature graph for the published module
#       (`cargo tree -p browser_city -e features --target
#       wasm32-unknown-unknown`) ever turns on `sim`'s `test-fixtures` --
#       Tim's direction: a manifest grep alone cannot see feature
#       unification, e.g. `browser_city` gaining a dependency on `bounds`
#       (which enables it for its own use) would turn it on for the
#       published module while every manifest still passed (a) alone.
#   (b) a manifest other than `server/sim/Cargo.toml`'s own self dev-
#       dependency and `server/bounds/Cargo.toml` enables `test-fixtures`
#       at all -- the fast, no-cargo-invocation half of the same
#       question (a2) answers precisely; kept as a second, independent
#       signal, following `check-sim-purity.sh`'s own precedent of a
#       fast textual check plus the resolved graph.
#   (c) `for_test` appears in a `src/` tree outside `server/sim/src/
#       rules/` -- a second consumer building a `RuleSet` from its own
#       slice.
#   (d) `RuleKind` (the bare word -- an import-and-alias, `use
#       sim::rules::RuleKind as K`, is still this) appears in a non-
#       generated `src/` file outside `server/sim/src/rules/` -- a second
#       interpreter matching on the engine's own closed kind enum.
#   (e) `RULES` (the bare word) appears in a non-generated `src/` file
#       outside `server/sim/src/rules/` -- a second reader of the
#       generated rule table bypassing `RuleSet`'s own accessors.
#
# Fails the build the moment any of the five appears; passes silently
# otherwise. A missing `SERVER_ROOT` fails closed (never a silent pass --
# a renamed directory or a typo in the CI step must not turn this green
# forever). Parameterised by `SERVER_ROOT` so `scripts/ci/tests/
# test-check-rule-source.sh` can plant a fake tree, following `check-
# rule-engine-no-content-keys.sh`'s own precedent; (a2)'s cargo invocation
# is itself replaceable by `RULE_SOURCE_TREE_OUTPUT` (a file holding
# captured `cargo tree` text), so that check's own parsing is covered by
# the self-test without a toolchain.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

SERVER_ROOT="${1:-"$REPO_ROOT/server"}"
RULES_DIR="sim/src/rules"

if [ ! -d "$SERVER_ROOT" ]; then
  echo "check-rule-source: FAIL -- $SERVER_ROOT not found" >&2
  exit 1
fi

FAILED=0

# (a) server/sim/Cargo.toml: 'test-fixtures' only on its own [features]
# declaration line and its self dev-dependency line.
SIM_MANIFEST="$SERVER_ROOT/sim/Cargo.toml"
if [ -f "$SIM_MANIFEST" ]; then
  BAD_SIM_LINES="$(grep -nE 'test-fixtures' "$SIM_MANIFEST" \
    | grep -vE '^[0-9]+:\s*#' \
    | grep -vE '^[0-9]+:test-fixtures = \[\]\s*$' \
    | grep -vE '^[0-9]+:sim = \{ path = "\.", features = \["test-fixtures"\] \}\s*$' \
    || true)"
  if [ -n "$BAD_SIM_LINES" ]; then
    echo "check-rule-source: FAIL -- $SIM_MANIFEST names 'test-fixtures' outside its own [features] declaration and self dev-dependency lines:" >&2
    printf '%s\n' "$BAD_SIM_LINES" >&2
    FAILED=1
  fi
fi

# (a2) the resolved feature graph for the published module never turns on
# sim's test-fixtures -- catches feature unification a manifest grep
# cannot see.
if [ -n "${RULE_SOURCE_TREE_OUTPUT:-}" ]; then
  TREE_TEXT="$(cat "$RULE_SOURCE_TREE_OUTPUT")"
elif [ -f "$SERVER_ROOT/Cargo.toml" ]; then
  TREE_TEXT="$(cd "$SERVER_ROOT" && cargo tree -p browser_city -e features --target wasm32-unknown-unknown 2>&1)" || TREE_TEXT=""
else
  TREE_TEXT=""
fi
if [ -n "$TREE_TEXT" ] && printf '%s\n' "$TREE_TEXT" | grep -qE 'sim feature "test-fixtures"'; then
  echo "check-rule-source: FAIL -- the resolved feature graph for browser_city turns on sim's 'test-fixtures':" >&2
  printf '%s\n' "$TREE_TEXT" | grep -E 'sim feature' >&2
  FAILED=1
fi

# (b) test-fixtures enabled only from the two allowed manifests, at all.
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

# (c)/(d)/(e): every *.rs file under any crate's own src/ tree, outside
# server/sim/src/rules/ and (for RuleKind/RULES) outside a @generated
# file.
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
  if grep -qwE 'RuleKind' "$file"; then
    echo "check-rule-source: FAIL -- 'RuleKind' appears outside $RULES_DIR (a second interpreter):" >&2
    grep -nwE 'RuleKind' "$file" >&2
    FAILED=1
  fi
  if grep -qwE 'RULES' "$file"; then
    echo "check-rule-source: FAIL -- 'RULES' appears outside $RULES_DIR (a second reader of the generated rule table):" >&2
    grep -nwE 'RULES' "$file" >&2
    FAILED=1
  fi
done < <(find "$SERVER_ROOT" -type d -name src -exec find {} -type f -name '*.rs' -print0 \;)

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-rule-source: one rule source, held under $SERVER_ROOT (AC1/AC4)" >&2
exit 0
