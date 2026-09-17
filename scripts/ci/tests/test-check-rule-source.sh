#!/usr/bin/env bash
# scripts/ci/check-rule-source.sh's own fast, no-toolchain coverage
# (story 2.11, AC1/AC4): plants fake server trees pointing two consumers
# at different rule sources and asserts a real, non-zero exit -- AC4's
# "deliberately points the two consumers at different sources and asserts
# the build fails" has to be an actual failing build, not a doc line. The
# resolved-feature-graph half (a2) is fed captured `cargo tree` text via
# `RULE_SOURCE_TREE_OUTPUT`, so its own parsing is covered here without a
# toolchain.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-rule-source.sh"

# A minimal, well-formed tree: sim/Cargo.toml declares the feature and
# names it again on its own self dev-dependency line (plus an unrelated
# comment mentioning the word, which must never trip the check), bounds/
# Cargo.toml enables it for its own dependency, the rule engine's own
# src/rules/ uses for_test/RuleKind/RULES, and a generated defs file
# (exempt from the RuleKind/RULES checks) also mentions them.
plant_clean_tree() {
  local d
  d="$(fake_dir)/server"
  mkdir -p "$d/sim/src/rules" "$d/sim/src/generated" "$d/bounds/src"
  cat > "$d/sim/Cargo.toml" <<'EOF'
[features]
# a comment naming test-fixtures must never trip this check
test-fixtures = []

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
pub const RULES: &[u8] = &[];
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
check "a clean tree -- both allowed manifests, engine-only for_test/RuleKind/RULES -- passes" 0 \
  bash "$CHECK" "$d/server"

# --- (a): server/sim/Cargo.toml's own two allowed lines only ------------

d="$(plant_clean_tree)"
cat >> "$d/server/sim/Cargo.toml" <<'EOF'

[features]
default = ["test-fixtures"]
EOF
check "sim/Cargo.toml naming test-fixtures on any line but its own two fails" 1 \
  bash "$CHECK" "$d/server"

# --- (a2): the resolved feature graph, fed captured cargo tree text -----

d="$(plant_clean_tree)"
clean_tree_output="$(fake_dir)/clean-tree.txt"
cat > "$clean_tree_output" <<'EOF'
browser_city v0.1.0
├── sim feature "default"
│   └── sim v0.1.0
EOF
check "a resolved graph naming only sim's default feature passes" 0 \
  env RULE_SOURCE_TREE_OUTPUT="$clean_tree_output" bash "$CHECK" "$d/server"

d="$(plant_clean_tree)"
dirty_tree_output="$(fake_dir)/dirty-tree.txt"
cat > "$dirty_tree_output" <<'EOF'
browser_city v0.1.0
├── sim feature "default"
│   └── sim v0.1.0
├── bounds feature "default"
│   └── sim feature "test-fixtures"
EOF
check "a resolved graph naming sim's test-fixtures feature for the published module fails" 1 \
  env RULE_SOURCE_TREE_OUTPUT="$dirty_tree_output" bash "$CHECK" "$d/server"

# --- (b): a third manifest enabling test-fixtures at all -----------------

d="$(plant_clean_tree)"
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/Cargo.toml" <<'EOF'
[dependencies]
sim = { path = "../sim", features = ["test-fixtures"] }
EOF
check "a third manifest enabling test-fixtures fails" 1 \
  bash "$CHECK" "$d/server"

# --- (c): for_test outside sim/src/rules/ --------------------------------

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

# --- (d): RuleKind, including an import-and-alias, outside sim/src/rules/ -

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
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/src/lib.rs" <<'EOF'
use sim::rules::RuleKind as K;

fn is_placement(kind: &K) -> bool {
    matches!(kind, K::Placement { .. })
}
EOF
check "an import-and-alias of RuleKind still fails (a bare-word match, not a literal 'RuleKind::')" 1 \
  bash "$CHECK" "$d/server"

# --- (e): RULES outside sim/src/rules/ -----------------------------------

d="$(plant_clean_tree)"
mkdir -p "$d/server/generator/src"
cat > "$d/server/generator/src/lib.rs" <<'EOF'
fn count() -> usize {
    sim::generated::defs::RULES.len()
}
EOF
check "'RULES' read outside sim/src/rules/ (a second reader of the rule table) fails" 1 \
  bash "$CHECK" "$d/server"

# --- a missing server root fails closed -----------------------------------

d="$(plant_clean_tree)"
check "a missing server root fails closed, never a silent pass" 1 \
  bash "$CHECK" "$d/server/does-not-exist"

summary
exit $?
