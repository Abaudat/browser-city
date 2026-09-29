#!/usr/bin/env bash
# scripts/ci/check-explore-workflow.sh's own coverage: a minimal but
# structurally real explore.yml, then each way it must fail.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-explore-workflow.sh"

good() {
  cat > "$1" <<'YAML'
name: explore
on:
  schedule:
    - cron: "23 4 * * 1"
  workflow_dispatch:
jobs:
  explore:
    runs-on: ubuntu-latest
    env:
      PROPTEST_RNG_SEED: ${{ github.run_id }}
    steps:
      - run: echo "PROPTEST_RNG_SEED=$PROPTEST_RNG_SEED"
      - run: cargo test -p sim --release --test invariants
      - if: failure() || cancelled()
        run: bash scripts/ci/report-scheduled-failure.sh "t" "b"
YAML
}

variant() {
  local d; d="$(fake_dir)"
  good "$d/good.yml"
  sed -E "$1" "$d/good.yml" > "$d/explore.yml"
  printf '%s' "$d/explore.yml"
}

d="$(fake_dir)"; good "$d/explore.yml"
check "the passing fixture passes" 0 bash "$CHECK" "$d/explore.yml"
check "the real explore.yml passes" 0 bash "$CHECK"
check "a missing file fails" 1 bash "$CHECK" "$d/nope.yml"
check "no schedule fails" 1 bash "$CHECK" "$(variant 's/^  schedule:/  workflow_call:/')"
check "no workflow_dispatch fails" 1 bash "$CHECK" "$(variant 's/^  workflow_dispatch:/  workflow_call:/')"
check "a push trigger fails" 1 bash "$CHECK" "$(variant 's/^  workflow_dispatch:/  push:/')"
check "a pull_request trigger fails" 1 bash "$CHECK" "$(variant 's/^  workflow_dispatch:/  pull_request:/')"
check "no seed fails" 1 bash "$CHECK" "$(variant 's/PROPTEST_RNG_SEED: /OTHER: /')"
check "a seed never echoed fails" 1 bash "$CHECK" "$(variant 's/echo "PROPTEST_RNG_SEED=.*/echo hi/')"
check "no report call fails" 1 bash "$CHECK" "$(variant 's/report-scheduled-failure\.sh/other.sh/')"
check "an environment fails" 1 bash "$CHECK" "$(variant 's/^    runs-on: ubuntu-latest/    environment: maincloud/')"
check "a secret fails" 1 bash "$CHECK" "$(variant 's/^      - run: cargo test.*/      - run: echo ${{ secrets.X }}/')"

summary
exit $?
