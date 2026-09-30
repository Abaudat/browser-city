#!/usr/bin/env bash
# scripts/ci/check-client-property-seed.sh's own coverage: a minimal client
# tree that passes, then one red fixture per rule (story 6.17, NFR50).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-client-property-seed.sh"

# tree <dir>: a client/ that passes.
tree() {
  mkdir -p "$1/tests/unit/setup" "$1/tests/unit/world" "$1/tests/e2e" "$1/src"
  cat > "$1/vitest.config.ts" <<'TS'
export default defineConfig({
  test: {
    setupFiles: ["tests/unit/setup/property-seed.ts"],
  },
});
TS
  cat > "$1/tests/unit/setup/property-seed.ts" <<'TS'
import fc from "fast-check";
fc.configureGlobal({ seed: 1 });
TS
  cat > "$1/tests/unit/world/a.test.ts" <<'TS'
import fc from "fast-check";
// seed: 5 in a comment, fc.sample( too
fc.assert(
  fc.property(fc.integer(), () => true),
  { numRuns: 20 },
);
TS
  echo 'import { test } from "@playwright/test";' > "$1/tests/e2e/a.spec.ts"
}

# red <name> <relative file> <content>: the passing tree plus one bad file.
red() {
  local d; d="$(fake_dir)"; tree "$d"
  mkdir -p "$(dirname "$d/$2")"
  printf '%s\n' "$3" > "$d/$2"
  check "$1" 1 bash "$CHECK" "$d"
}

d="$(fake_dir)"; tree "$d"
check "the passing tree passes" 0 bash "$CHECK" "$d"
check "the real client passes" 0 bash "$CHECK"

red "a seed key on one line fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check"; fc.assert(p, { seed: 4 });'
red "a seed key in a multi-line params object fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.assert(
  fc.property(fc.integer(), () => true),
  {
    numRuns: 5,
    seed: 4,
  },
);'
red "a shorthand seed key fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const seed = 3;
fc.assert(p, { numRuns: 2, seed });'
red "a path key fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.assert(p, {
  path: "0:1",
});'
red "configureGlobal in a test fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.configureGlobal({ numRuns: 5 });'
red "resetConfigureGlobal in a test fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.resetConfigureGlobal();'
red "configureGlobal in src fails, even without a fast-check import" src/x.ts \
  'configureGlobal({ numRuns: 5 });'
red "interruptAfterTimeLimit fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.assert(p, { interruptAfterTimeLimit: 50 });'
red "skipAllAfterTimeLimit fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.assert(p, { skipAllAfterTimeLimit: 50 });'
red "fc.sample fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.sample(fc.integer(), 1);'
red "fc.check fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.check(p);'
red "fc.statistics fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.statistics(p, String);'
red "a fast-check import under e2e fails" tests/e2e/b.spec.ts \
  'import fc from "fast-check";'

d="$(fake_dir)"; tree "$d"; rm "$d/tests/unit/setup/property-seed.ts"
check "a missing setup file fails" 1 bash "$CHECK" "$d"
d="$(fake_dir)"; tree "$d"; sed -i 's/setupFiles/other/' "$d/vitest.config.ts"
check "a setup file missing from vitest.config.ts fails" 1 bash "$CHECK" "$d"
d="$(fake_dir)"; tree "$d"; printf 'export default {};\n' > "$d/vitest.config.ts"
check "a config with no setupFiles fails" 1 bash "$CHECK" "$d"
d="$(fake_dir)"; tree "$d"
cat > "$d/tests/unit/world/ok.test.ts" <<'TS'
const seed = 1;
export const o = { seed };
TS
check "a seed key in a file that never imports fast-check passes" 0 bash "$CHECK" "$d"

summary
exit $?
