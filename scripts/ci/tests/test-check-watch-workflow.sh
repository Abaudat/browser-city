#!/usr/bin/env bash
# scripts/ci/check-watch-workflow.sh's own fast coverage (story 4.13): a
# minimal but structurally real watch.yml, then each way it must fail.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-watch-workflow.sh"

# good <path> -- the passing fixture. `__IF__` / `__ENV__` / `__EXTRA__` are
# swapped by the broken variants below.
good() {
  cat > "$1" <<'YAML'
name: watch
on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:
jobs:
  watch:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: maincloud
    steps:
      - id: gate
        env:
          DEPLOY_ENABLED: ${{ vars.DEPLOY_ENABLED }}
        run: |
          if [ "$DEPLOY_ENABLED" != "true" ]; then exit 0; fi
      - env:
          SPACETIME_MAINCLOUD_TOKEN: ${{ secrets.SPACETIME_MAINCLOUD_TOKEN }}
        run: spacetime login --token "$SPACETIME_MAINCLOUD_TOKEN" --no-browser
      - env:
          MAINCLOUD_OWNER_IDENTITY: ${{ vars.MAINCLOUD_OWNER_IDENTITY }}
        run: spacetime login show
      - run: bash scripts/ops/storage-report.sh "$DB" --server maincloud
      - if: failure() || cancelled()
        env:
          GH_TOKEN: ${{ github.token }}
        run: bash scripts/ci/report-scheduled-failure.sh "t" "b"
YAML
}

# variant <sed-expr> -- the good fixture with one edit applied.
variant() {
  local d
  d="$(fake_dir)"
  good "$d/good.yml"
  sed -E "$1" "$d/good.yml" > "$d/watch.yml"
  printf '%s' "$d/watch.yml"
}

d="$(fake_dir)"; good "$d/watch.yml"
check "the passing fixture passes" 0 bash "$CHECK" "$d/watch.yml"
check "the real watch.yml passes" 0 bash "$CHECK"
check "a missing file fails" 1 bash "$CHECK" "$d/nope.yml"

check "no schedule trigger fails" 1 bash "$CHECK" "$(variant 's/^  schedule:/  push:/')"
check "no cron fails" 1 bash "$CHECK" "$(variant 's/^    - cron: .*/    - foo: 1/')"
check "no workflow_dispatch fails" 1 bash "$CHECK" "$(variant 's/^  workflow_dispatch:/  workflow_call:/')"
check "a different environment fails" 1 bash "$CHECK" "$(variant 's/environment: maincloud/environment: staging/')"
check "no environment fails" 1 bash "$CHECK" "$(variant '/environment: maincloud/d')"
check "no timeout-minutes fails" 1 bash "$CHECK" "$(variant '/timeout-minutes/d')"
check "no DEPLOY_ENABLED gate fails" 1 bash "$CHECK" "$(variant 's/DEPLOY_ENABLED/SOMETHING_ELSE/g')"
check "a gate that never compares fails" 1 bash "$CHECK" "$(variant 's/if \[ "\$DEPLOY_ENABLED" != "true" \]; then exit 0; fi/true/')"
check "no owner-identity check fails" 1 bash "$CHECK" "$(variant 's/spacetime login show/echo hi/')"
check "no storage-report.sh fails" 1 bash "$CHECK" "$(variant 's/storage-report\.sh/other.sh/')"

check "a secret interpolated into run: fails" 1 bash "$CHECK" "$(variant 's|--token "\$SPACETIME_MAINCLOUD_TOKEN"|--token ${{ secrets.SPACETIME_MAINCLOUD_TOKEN }}|')"
check "a secret in a step's with: is not an env entry and fails" 1 bash "$CHECK" "$(variant 's|^          GH_TOKEN: .*|          token: ${{ secrets.X }} extra|')"

check "a report step on failure() only fails" 1 bash "$CHECK" "$(variant 's/if: failure\(\) \|\| cancelled\(\)/if: failure()/')"
check "a report step on cancelled() only fails" 1 bash "$CHECK" "$(variant 's/if: failure\(\) \|\| cancelled\(\)/if: cancelled()/')"
check "a report step with no if: fails" 1 bash "$CHECK" "$(variant 's/^      - if: failure\(\) \|\| cancelled\(\)/      - name: report/')"
check "no report-scheduled-failure.sh call fails" 1 bash "$CHECK" "$(variant 's/report-scheduled-failure\.sh/other.sh/')"
check "an inline gh issue create fails" 1 bash "$CHECK" "$(variant 's/^(        run: bash scripts\/ci\/report-scheduled-failure.sh .*)$/\1; gh issue create --title x/')"

summary
exit $?
