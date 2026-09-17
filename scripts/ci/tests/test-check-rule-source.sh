#!/usr/bin/env bash
# scripts/ci/check-rule-source.sh's own fast, no-toolchain coverage
# (story 2.11, AC1/AC4): plants fake server trees pointing two consumers
# at different rule sources and asserts a real, non-zero exit -- AC4's
# "deliberately points the two consumers at different sources and asserts
# the build fails" has to be an actual failing build, not a doc line.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-rule-source.sh"

# A minimal, well-formed tree: the two allowed manifests enable
# test-fixtures, the rule engine's own src/rules/ uses for_test and
# RuleKind::, and a generated defs file (exempt from the RuleKind::
# check) also mentions it.
plant_clean_tree() {
  local d
  d="$(fake_dir)/server"
  mkdir -p "$d/sim/src/rules" "$d/sim/src/generated" "$d/bounds/src"
  cat > "$d/sim/Cargo.toml" <<'EOF'
[dev-dependencies]
sim = { path = ".", features = ["test-fixtures"] }
EOF
  cat > "$d/bounds/Cargo.toml" <<'EOF'
[dependencies]
sim = { path = "../sim", features = ["test-fixtures"] }
EOF
  cat > "$d/sim/src/rules/source.rs" <<'EOF'
pub fn for_test() {}
pub enum RuleKind {}
fn uses_it() { let _ = RuleKind::Placement; }
EOF
  cat > "$d/sim/src/generated/defs.rs" <<'EOF'
// @generated
pub const RULES: &[crate::rules::RuleDef] = &[
    crate::rules::RuleDef { kind: crate::rules::RuleKind::Placement { } },
];
EOF
  printf '%s' "$(dirname "$d")"
}

d="$(plant_clean_tree)"
check "a clean tree -- both allowed manifests, engine-only for_test/RuleKind:: -- passes" 0 \
  bash "$CHECK" "$d/server"

d="$(plant_clean_tree)"
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/Cargo.toml" <<'EOF'
[dependencies]
sim = { path = "../sim", features = ["test-fixtures"] }
EOF
check "a third manifest enabling test-fixtures fails" 1 \
  bash "$CHECK" "$d/server"

d="$(plant_clean_tree)"
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/src/lib.rs" <<'EOF'
fn build() {
    let rules: &[sim::rules::RuleDef] = &[];
    let _ = sim::rules::RuleSet::for_test(rules);
}
EOF
check "'for_test' used outside sim/src/rules/ fails" 1 \
  bash "$CHECK" "$d/server"

d="$(plant_clean_tree)"
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/src/lib.rs" <<'EOF'
fn is_placement(kind: &sim::rules::RuleKind) -> bool {
    matches!(kind, sim::rules::RuleKind::Placement { .. })
}
EOF
check "'RuleKind::' matched outside sim/src/rules/ (a second interpreter) fails" 1 \
  bash "$CHECK" "$d/server"

d="$(plant_clean_tree)"
check "a missing server root is a pass, not a crash (nothing to check yet)" 0 \
  bash "$CHECK" "$d/server/does-not-exist"

summary
exit $?
