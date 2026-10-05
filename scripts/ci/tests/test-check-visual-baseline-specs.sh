#!/usr/bin/env bash
# scripts/ci/check-visual-baseline-specs.sh's own fast, no-real-tree coverage.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-visual-baseline-specs.sh"

# plant <playwright specs> <git add paths> <header names> -- a fake e2e dir
# with a.spec.ts and b.spec.ts (both screenshotting) and c.spec.ts (not),
# plus a fake workflow; prints the dir.
plant() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/e2e"
  printf 'await expect(p).toHaveScreenshot("x.png");\n' > "$d/e2e/a.spec.ts"
  printf 'await expect(p).toHaveScreenshot("y.png");\n' > "$d/e2e/b.spec.ts"
  printf 'await expect(p).toBeVisible();\n' > "$d/e2e/c.spec.ts"
  printf '# baselines: %s\non:\n  workflow_dispatch:\njobs:\n  u:\n    steps:\n      - run: npx playwright test %s --update-snapshots\n      - run: git add %s\n' "$3" "$1" "$2" > "$d/wf.yml"
  printf '%s' "$d"
}

ALL_SPECS='tests/e2e/a.spec.ts tests/e2e/b.spec.ts'
ALL_ADDS="'client/tests/e2e/a.spec.ts-snapshots/**' 'client/tests/e2e/b.spec.ts-snapshots/**'"
ALL_HEADER='a.spec.ts-snapshots b.spec.ts-snapshots'

d="$(plant "$ALL_SPECS" "$ALL_ADDS" "$ALL_HEADER")"
check "every screenshotting spec wired in all three places passes" 0 bash "$CHECK" "$d/e2e" "$d/wf.yml"

d="$(plant 'tests/e2e/a.spec.ts' "$ALL_ADDS" "$ALL_HEADER")"
check "a spec missing from the playwright line fails" 1 bash "$CHECK" "$d/e2e" "$d/wf.yml"

d="$(plant "$ALL_SPECS" "'client/tests/e2e/a.spec.ts-snapshots/**'" "$ALL_HEADER")"
check "a spec missing from the git add fails" 1 bash "$CHECK" "$d/e2e" "$d/wf.yml"

d="$(plant "$ALL_SPECS" "$ALL_ADDS" 'a.spec.ts-snapshots')"
check "a spec missing from the header comment fails" 1 bash "$CHECK" "$d/e2e" "$d/wf.yml"

summary
exit $?
