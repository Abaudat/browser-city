#!/usr/bin/env bash
# scripts/ci/check-trace-matrix.sh's own fast, no-cargo coverage (story
# 3.17): every case here runs with `--client-only` -- the `scripts-tests`
# job has no toolchain, which is exactly why the Guard-section lookup must
# not live behind cargo (AC3) -- proven directly by the last case, which
# greps the script's own source for that.
#
# Every fake tree is made a real git work tree by its own builder
# (`git init` + `git add`), never a `find` stand-in: the production code
# path (`git ls-files`) is what this suite exercises, per Quentin's
# direction, rather than a second code path this suite alone would run.
#
# `plant_clean_tree` is shared by every resolution-mechanics case below,
# each mutating exactly one thing before re-running the check -- the same
# pattern `test-check-rule-source.sh` and `test-check-defs-current.sh`
# use. The structural cases (discovery, a missing guard table, a header
# typo, the four statuses) need a differently-shaped matrix file, so they
# build their own small fixture instead of mutating the shared tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-trace-matrix.sh"

git_track() { # <dir> -- makes a fake tree a real git work tree
  (cd "$1" && git init -q && git -c user.email=t@t -c user.name=t add -A)
}

# --- the shared clean tree ---------------------------------------------
# One guard table ("## Widgets") whose rows exercise every resolver:
# a Rust `fn`, a Rust `fn` prefix, a second Rust path searched even
# though the first one does not declare the name, a client test title
# (with an apostrophe and a comma), a `.sh` case label, an `inv_*` id
# resolved against the matrix's own first table (no Rust file needed), a
# `path::symbol` form, a directory searched recursively, a spaced
# code-snippet token that is never mistaken for a title, and a
# glob/flagged token that is never existence-checked as a path. Plus one
# `deferred`, one `planned` and one `partial` row, each citing a name
# that resolves nowhere -- proving the lookup never even runs for them.
plant_clean_tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit" \
    "$d/src/dir" "$d/scripts"
  : > "$d/server/sim/tests/invariants.rs"

  cat > "$d/src/widget.rs" <<'EOF'
fn widget_creates_ok() {}
fn widget_removed_ok() {}
fn widget_prefix_match_case_alpha() {}
EOF
  cat > "$d/src/extra.rs" <<'EOF'
fn extra_only_fn() {}
EOF
  cat > "$d/src/lib.rs" <<'EOF'
pub fn build() {}
EOF
  cat > "$d/src/dir/inner.rs" <<'EOF'
fn nested_dir_fn() {}
EOF
  cat > "$d/src/widget.test.ts" <<'EOF'
it("widget doesn't fail, even with a comma", () => {});
EOF
  cat > "$d/scripts/widget.sh" <<'EOF'
#!/usr/bin/env bash
check "widget_case_label" 0 true
echo "inv_widget_ok"
EOF

  cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| `inv_widget_ok` | placeholder | covered | `inv_widget_ok` | — |

## Widgets

| Requirement | Status | Guard |
| --- | --- | --- |
| A Rust fn resolves | covered | `src/widget.rs` -- `widget_creates_ok` |
| A Rust fn survives as a comment once deleted | covered | `src/widget.rs` -- `widget_removed_ok` |
| A Rust prefix resolves | covered | `src/widget.rs` -- `widget_prefix_match_case_*` |
| A second cited path is searched too | covered | `src/widget.rs`, `src/extra.rs` -- `extra_only_fn` |
| A client title with punctuation resolves | covered | `src/widget.test.ts` -- `widget doesn't fail, even with a comma` |
| A .sh case label resolves | covered | `scripts/widget.sh` -- `widget_case_label` |
| An inv_* id resolves against the matrix's own table | covered | `scripts/widget.sh` -- `inv_widget_ok` |
| A path::symbol form resolves the symbol in that one file | covered | `src/lib.rs::build` |
| A directory is searched recursively | covered | `src/dir/` -- `nested_dir_fn` |
| A spaced code snippet is never a title, in a cell with a title path too | covered | `src/widget.test.ts` -- `some_code(1, 2)` |
| A glob/flagged token is never existence-checked | covered | `src/widget.rs` -- `src/**`, `check-trace-matrix.sh --client-only` |
| A dangling name on a deferred row is exempt | deferred | `src/widget.rs` -- `nowhere_at_all` |
| A dangling name on a planned row is exempt | planned | `src/widget.rs` -- `nowhere_at_all` |
| A dangling name on a partial row is exempt | partial | `src/widget.rs` -- `nowhere_at_all` |
EOF
  git_track "$d"
  printf '%s' "$d"
}

d="$(plant_clean_tree)"
check "a clean tree -- every resolver green, three exempt statuses -- passes" 0 \
  bash "$CHECK" --client-only "$d"

# --- Rust fn renamed --------------------------------------------------------
d="$(plant_clean_tree)"
sed -i 's/fn widget_creates_ok/fn widget_creates_renamed/' "$d/src/widget.rs"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a Rust fn renamed fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the row" "A Rust fn resolves" "$out"
check_contains "the failure names the missing token" "widget_creates_ok" "$out"

# --- Rust fn deleted but the name survives in a comment ---------------------
d="$(plant_clean_tree)"
sed -i 's/^fn widget_removed_ok.*$/\/\/ fn widget_removed_ok() {}/' "$d/src/widget.rs"
check "a fn deleted but its name left in a // comment still fails" 1 \
  bash "$CHECK" --client-only "$d"

# --- name exists in the repo but not under the cell's own paths ------------
d="$(plant_clean_tree)"
sed -i "s#\`src/widget.rs\` -- \`widget_creates_ok\`#\`src/extra.rs\` -- \`widget_creates_ok\`#" "$d/docs/trace-matrix.md"
check "a name that exists elsewhere in the repo, but not under this cell's own paths, fails" 1 \
  bash "$CHECK" --client-only "$d"

# --- client title changed ---------------------------------------------------
d="$(plant_clean_tree)"
sed -i "s/doesn't fail, even with a comma/renders fine/" "$d/src/widget.test.ts"
check "a client title changed fails" 1 bash "$CHECK" --client-only "$d"

# --- .sh case removed --------------------------------------------------------
d="$(plant_clean_tree)"
sed -i 's/widget_case_label/widget_case_removed/' "$d/scripts/widget.sh"
check ".sh case cited and removed fails" 1 bash "$CHECK" --client-only "$d"

# --- prefix_* with zero matches, then with one match ------------------------
d="$(plant_clean_tree)"
sed -i 's/fn widget_prefix_match_case/fn widget_unrelated_case/' "$d/src/widget.rs"
check "prefix_* with zero matches fails" 1 bash "$CHECK" --client-only "$d"

d="$(plant_clean_tree)"
check "prefix_* with one real match passes (part of the clean tree)" 0 \
  bash "$CHECK" --client-only "$d"

# --- second path missing, first present -------------------------------------
d="$(plant_clean_tree)"
rm "$d/src/extra.rs"
check "a cell's second path missing (first present) fails" 1 bash "$CHECK" --client-only "$d"

# --- a name that is a prefix of a longer real fn (word boundary) -----------
d="$(plant_clean_tree)"
printf '| A bare name must not match a longer fn as a substring | covered | `src/widget.rs` -- `widget_creates` |\n' >> "$d/docs/trace-matrix.md"
check "an exact candidate that is only a prefix of a real, longer fn name fails (word boundary)" 1 \
  bash "$CHECK" --client-only "$d"

# --- two dangling names in two rows: both reported, accumulate-then-fail ---
d="$(plant_clean_tree)"
sed -i 's/fn widget_creates_ok/fn widget_creates_renamed/' "$d/src/widget.rs"
sed -i 's/fn extra_only_fn/fn extra_only_renamed/' "$d/src/extra.rs"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "two dangling names in two rows fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the first dangling name is reported" "widget_creates_ok" "$out"
check_contains "the second dangling name is reported too, in the same run" "extra_only_fn" "$out"

# --- structural cases: their own small fixture ------------------------------

# a guard table under a heading the script has never heard of, with a
# dangling name -- proves discovery, never a hardcoded section list.
d="$(fake_dir)"
mkdir -p "$d/docs"
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## A brand-new section nobody registered anywhere

| Requirement | Status | Guard |
| --- | --- | --- |
| A dangling name under an unregistered heading | covered | `server/sim/tests/invariants.rs` -- `nowhere_to_be_found` |
EOF
mkdir -p "$d/server/sim/tests" "$d/client/tests/unit"
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
check "a guard table under a never-registered heading is still checked (discovery, not a list)" 1 \
  bash "$CHECK" --client-only "$d"

# no guard table at all
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
printf '# Trace matrix\n\nNothing here is a guard table.\n' > "$d/docs/trace-matrix.md"
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
check "a matrix with no guard table at all fails" 1 bash "$CHECK" --client-only "$d"

# a header typo -- a near-miss of the guard header vanishing silently is
# exactly the hole the floor check exists to catch.
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## Typo'd section

| Requirement | status | Guard |
| --- | --- | --- |
| A row under a mistyped header | covered | `docs/trace-matrix.md` |
EOF
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
check "a '| Requirement |' header that is not the exact guard header fails" 1 \
  bash "$CHECK" --client-only "$d"

# unknown status
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## Statuses

| Requirement | Status | Guard |
| --- | --- | --- |
| A row with a typo'd status | coverd | `docs/trace-matrix.md` |
EOF
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "an unknown status ('coverd') fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the bad status" "coverd" "$out"

# --- AC3: the lookup runs in both modes, never nested inside a
# CLIENT_ONLY-only branch -- the cheapest real proof is that the source
# line defining check_guard_row is not inside any `[ "$CLIENT_ONLY" -eq 1
# ]`/`if... CLIENT_ONLY` conditional block; grepping the whole function
# body for a CLIENT_ONLY reference is the mechanical check for that.
check "the Guard-section lookup itself never references CLIENT_ONLY (both modes run it, AC3)" 0 \
  bash -c "awk '/^check_guard_row\\(\\)/{f=1} f{print} f && /^}/{exit}' '$CHECK' | grep -qc CLIENT_ONLY; [ \$? -eq 1 ]"

summary
exit $?
