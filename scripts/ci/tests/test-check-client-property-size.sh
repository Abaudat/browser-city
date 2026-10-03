#!/usr/bin/env bash
# scripts/ci/check-client-property-size.sh's own coverage: a minimal client
# tree that passes, then one red fixture per rule (story 15.18, NFR51).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-client-property-size.sh"

# tree <dir>: a client/ that passes.
tree() {
  mkdir -p "$1/tests/unit/setup" "$1/tests/unit/world" "$1/src"
  cat > "$1/tests/unit/setup/property-seed.ts" <<'TS'
import fc from "fast-check";
fc.configureGlobal({ seed: 1, defaultSizeToMaxWhenMaxSpecified: true });
TS
  cat > "$1/tests/unit/world/a.test.ts" <<'TS'
import fc from "fast-check";
// size: "max", baseSize: "large", fc.string() and fc.array(fc.integer()) in a comment
fc.assert(
  fc.property(fc.array(fc.integer(), { maxLength: 40 }), fc.string({ maxLength: 5 }), () => true),
  { numRuns: 20 },
);
const fixture = { size: 3, depthSize: undefined };
TS
}

# red <name> <relative file> <content>: the passing tree plus one bad file.
red() {
  local d; d="$(fake_dir)"; tree "$d"
  mkdir -p "$(dirname "$d/$2")"
  printf '%s\n' "$3" > "$d/$2"
  check "$1" 1 bash "$CHECK" "$d"
}

# red_names <name> <relative file> <content> <needle>: as red, and the
# failure names <needle> (a file:line).
red_names() {
  local d out; d="$(fake_dir)"; tree "$d"
  mkdir -p "$(dirname "$d/$2")"
  printf '%s\n' "$3" > "$d/$2"
  out="$(bash "$CHECK" "$d" 2>&1)"
  check_contains "$1" "$4" "$out"
}

d="$(fake_dir)"; tree "$d"
check "the passing tree passes" 0 bash "$CHECK" "$d"
check "the real client passes" 0 bash "$CHECK"

# Rule 1: the setup file sets the switch.
d="$(fake_dir)"; tree "$d"
printf 'import fc from "fast-check";\nfc.configureGlobal({ seed: 1 });\n' > "$d/tests/unit/setup/property-seed.ts"
check "a setup file without the switch fails" 1 bash "$CHECK" "$d"
out="$(bash "$CHECK" "$d" 2>&1)"
check_contains "without the switch, every stated maximum is listed with file:line" \
  "tests/unit/world/a.test.ts:4" "$out"
d="$(fake_dir)"; tree "$d"
printf 'import fc from "fast-check";\n// defaultSizeToMaxWhenMaxSpecified: true\nfc.configureGlobal({ seed: 1 });\n' > "$d/tests/unit/setup/property-seed.ts"
check "the switch only in a comment fails" 1 bash "$CHECK" "$d"
d="$(fake_dir)"; tree "$d"
printf 'import fc from "fast-check";\nfc.configureGlobal({ seed: 1, defaultSizeToMaxWhenMaxSpecified: false });\n' > "$d/tests/unit/setup/property-seed.ts"
check "the switch set to false fails" 1 bash "$CHECK" "$d"
d="$(fake_dir)"; rm -rf "$d"; mkdir -p "$d/tests/unit/world"
check "a missing setup file fails" 1 bash "$CHECK" "$d"

# Rule 2: no baseSize anywhere under client/.
red_names "baseSize in a test fails, naming file:line" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
fc.configureGlobal({ baseSize: "large" });' "tests/unit/world/b.test.ts:2"
red "baseSize in src fails" src/x.ts 'const o = { baseSize: "large" };'
red "baseSize in the setup file fails" tests/unit/setup/property-seed.ts \
  'import fc from "fast-check";
fc.configureGlobal({ defaultSizeToMaxWhenMaxSpecified: true, baseSize: "large" });'

# Rule 3: no fast-check size literal on a size/depthSize key.
red_names "size: max on one line fails, naming file:line" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.array(fc.integer(), { maxLength: 9, size: "max" });' "tests/unit/world/b.test.ts:2"
red "size in a multi-line options object fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.array(fc.integer(), {
  maxLength: 9,
  size: "small",
});'
red "depthSize fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.object({ maxDepth: 2, depthSize: "xsmall" });'
red "a relative size literal fails" tests/unit/world/b.test.ts \
  "import fc from \"fast-check\";
const a = fc.array(fc.integer(), { maxLength: 9, size: '+2' });"
red "the = size literal fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.array(fc.integer(), { maxLength: 9, size: "=" });'
d="$(fake_dir)"; tree "$d"
cat > "$d/tests/unit/world/ok.test.ts" <<'TS'
const row = { size: "max", depthSize: "small" };
export default row;
TS
check "a size key in a file that never imports fast-check passes" 0 bash "$CHECK" "$d"

# Rule 4: no unbounded length arbitrary.
zero() { red_names "$1" tests/unit/world/b.test.ts "import fc from \"fast-check\";
const a = $2;" "tests/unit/world/b.test.ts:2"; }
zero "fc.string() with no options fails, naming file:line" 'fc.string()'
zero "fc.anything() with no options fails, naming file:line" 'fc.anything()'
zero "fc.json() with no options fails, naming file:line" 'fc.json()'
zero "fc.jsonValue() with no options fails, naming file:line" 'fc.jsonValue()'
zero "fc.object() with no options fails, naming file:line" 'fc.object()'
red "a one-line fc.array(x) with no options fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.array(fc.integer());'
red "a one-line fc.uniqueArray(x) with no options fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.uniqueArray(fc.integer());'
red "a one-line fc.array(name) with no options fails" tests/unit/world/b.test.ts \
  'import fc from "fast-check";
const a = fc.array(cellArb);'
d="$(fake_dir)"; tree "$d"
cat > "$d/tests/unit/world/ok.test.ts" <<'TS'
import fc from "fast-check";
const a = fc.string({ maxLength: 8 });
const b = fc.anything({ maxDepth: 2, maxKeys: 4 });
const c = fc.array(fc.integer(), { maxLength: 8 });
const d = fc.shuffledSubarray([1, 2, 3]);
TS
check "bounded arbitraries pass" 0 bash "$CHECK" "$d"
d="$(fake_dir)"; tree "$d"
cat > "$d/tests/unit/setup/canary.test.ts" <<'TS'
import fc from "fast-check";
const a = fc.array(fc.integer());
const b = fc.array(fc.integer(), { maxLength: 400, size: "max" });
TS
check "the setup directory is exempt from the size and unbounded rules" 0 bash "$CHECK" "$d"

summary
exit $?
