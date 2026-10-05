#!/usr/bin/env bash
# scripts/ci/check-e2e-shards.sh's own fast coverage (NFR49): a minimal but
# structurally real ci.yml, then each way the e2e sharding must fail.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-e2e-shards.sh"

good() {
  cat > "$1" <<'YAML'
jobs:
  changes:
    runs-on: ubuntu-latest
  e2e:
    name: e2e (shard ${{ matrix.shard }}/4)
    needs: [changes]
    if: needs.changes.outputs.e2e == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - run: npm run test:e2e -- --shard=${{ matrix.shard }}/4
      - uses: actions/upload-artifact@x
        with:
          name: review-shots-shard-${{ matrix.shard }}
      - uses: actions/upload-artifact@x
        with:
          name: walk-records-shard-${{ matrix.shard }}-${{ github.run_attempt }}
  e2e-perf:
    needs: [changes]
    if: needs.changes.outputs.e2e == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: node tests/e2e/serve-for-deploy-smoke.mjs
      - run: npm run test:e2e:perf
  ci:
    needs: [changes, e2e, e2e-perf]
YAML
}
CFG_GOOD='  workers: process.env.CI ? 1 : undefined,'

# variant <sed-expr> -- the good workflow with one edit applied.
variant() {
  local d; d="$(fake_dir)"
  good "$d/g.yml"
  sed -E "$1" "$d/g.yml" > "$d/ci.yml"
  printf '%s' "$d/ci.yml"
}
cfg() { local d; d="$(fake_dir)"; printf '%s\n' "$1" > "$d/playwright.config.ts"; printf '%s' "$d/playwright.config.ts"; }

d="$(fake_dir)"; good "$d/ci.yml"
GCFG="$(cfg "$CFG_GOOD")"
check "the passing fixture passes" 0 bash "$CHECK" "$d/ci.yml" "$GCFG"
check "the real ci.yml and config pass" 0 bash "$CHECK"
check "a missing file fails" 1 bash "$CHECK" "$d/nope.yml" "$GCFG"

check "matrix with a gap fails" 1 bash "$CHECK" "$(variant 's/shard: \[1, 2, 3, 4\]/shard: [1, 2, 4]/')" "$GCFG"
check "matrix longer than the denominator fails" 1 bash "$CHECK" "$(variant 's/shard: \[1, 2, 3, 4\]/shard: [1, 2, 3, 4, 5]/')" "$GCFG"
check "matrix shorter than the denominator fails" 1 bash "$CHECK" "$(variant 's/shard: \[1, 2, 3, 4\]/shard: [1, 2, 3]/')" "$GCFG"
check "matrix starting at 0 fails" 1 bash "$CHECK" "$(variant 's/shard: \[1, 2, 3, 4\]/shard: [0, 1, 2, 3]/')" "$GCFG"
check "a single shard fails" 1 bash "$CHECK" "$(variant 's/shard: \[1, 2, 3, 4\]/shard: [1]/; s/--shard=(.*)\/4/--shard=\1\/1/')" "$GCFG"
check "no --shard flag fails" 1 bash "$CHECK" "$(variant 's/ -- --shard=.*//')" "$GCFG"
check "a hard-coded shard index fails" 1 bash "$CHECK" "$(variant 's/--shard=\$\{\{ matrix.shard \}\}/--shard=1/')" "$GCFG"
check "fail-fast true fails" 1 bash "$CHECK" "$(variant 's/fail-fast: false/fail-fast: true/')" "$GCFG"
check "no fail-fast fails" 1 bash "$CHECK" "$(variant '/fail-fast/d')" "$GCFG"
check "e2e timeout 11 fails" 1 bash "$CHECK" "$(variant '0,/timeout-minutes: 10/s//timeout-minutes: 11/')" "$GCFG"
check "no e2e timeout fails" 1 bash "$CHECK" "$(variant '0,/timeout-minutes: 10/{/timeout-minutes/d}')" "$GCFG"
check "e2e-perf timeout 25 fails" 1 bash "$CHECK" "$(variant 's/^(    timeout-minutes: )10$/\1X/; 0,/X/s//10/; s/X/25/')" "$GCFG"
check "perf inside the shard job fails" 1 bash "$CHECK" "$(variant 's|^(      - run: npm run test:e2e -- .*)$|\1\n      - run: npm run test:e2e:perf|')" "$GCFG"
check "deploy smoke inside the shard job fails" 1 bash "$CHECK" "$(variant 's|^(      - run: npm run test:e2e -- .*)$|\1\n      - run: node serve-for-deploy-smoke.mjs|')" "$GCFG"
check "e2e-perf without perf fails" 1 bash "$CHECK" "$(variant 's|^      - run: npm run test:e2e:perf$|      - run: echo skipped|')" "$GCFG"
check "e2e-perf without the deploy-smoke rehearsal fails" 1 bash "$CHECK" "$(variant 's|^      - run: node tests/e2e/serve-for-deploy-smoke.mjs$|      - run: echo skipped|')" "$GCFG"
check "an unsharded artifact name fails" 1 bash "$CHECK" "$(variant 's/name: review-shots-shard-\$\{\{ matrix.shard \}\}/name: review-shots/')" "$GCFG"
check "no e2e-perf job fails" 1 bash "$CHECK" "$(variant 's/^  e2e-perf:/  other:/')" "$GCFG"
check "workers other than 1 on CI fails" 1 bash "$CHECK" "$d/ci.yml" "$(cfg '  workers: process.env.CI ? 4 : undefined,')"
check "no workers setting fails" 1 bash "$CHECK" "$d/ci.yml" "$(cfg '  retries: 0,')"

summary
exit $?
