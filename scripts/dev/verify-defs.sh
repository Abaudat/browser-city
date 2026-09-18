#!/usr/bin/env bash
# Story 2.12 (AC1, NFR27): the one command an agent runs after touching
# `defs/rules/*.toml` or its own example corpus (`server/sim/tests/
# rule-examples/`). No arguments, no server toolchain beyond `cargo`
# itself, no `spacetime`, no network -- three steps, each mapped to
# exactly one of three exit codes, a tested contract (Tim's direction):
#
#   0 -- everything passed.
#   1 -- at least one named content failure (a `.grid` case's declared
#        violations do not match what the harness actually found).
#   2 -- the harness itself could not run: the `defs/` tree does not
#        build (step 1), or `server/sim`'s own `rule_examples` test
#        binary does not compile (step 2). Never confuse this with "your
#        rule is wrong" -- it means the tool is broken.
#
# Step 1 regenerates both committed artefacts in place, so the corpus
# always sees the rule rows an agent just wrote, never a stale
# `generated/defs.rs`. Nothing else runs here: no clippy, no atlas diff,
# no other test binary -- one command, one contract.
set -u
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
START_S=$(date +%s)

echo "verify-defs: [1/3] regenerating defs/ artefacts..." >&2
if ! cargo run --manifest-path "$REPO_ROOT/tools/defs-build/Cargo.toml" >&2; then
  echo "verify-defs: FAIL -- the defs/ tree itself does not build (exit 2, a harness/build error, never a rule failure)" >&2
  exit 2
fi

echo "verify-defs: [2/3] building the rule-examples harness..." >&2
if ! cargo test --manifest-path "$REPO_ROOT/server/Cargo.toml" -p sim --test rule_examples --no-run >&2; then
  echo "verify-defs: FAIL -- the rule-examples test binary does not build (exit 2, a harness error, never a rule failure)" >&2
  exit 2
fi

echo "verify-defs: [3/3] running the rule-examples corpus..." >&2
if ! cargo test --manifest-path "$REPO_ROOT/server/Cargo.toml" -p sim --test rule_examples >&2; then
  ELAPSED_S=$(( $(date +%s) - START_S ))
  echo "verify-defs: FAIL -- named content failure(s) above (exit 1, elapsed ${ELAPSED_S}s)" >&2
  exit 1
fi

ELAPSED_S=$(( $(date +%s) - START_S ))
echo "verify-defs: ok -- every committed rule row's example passed (elapsed ${ELAPSED_S}s)" >&2
exit 0
