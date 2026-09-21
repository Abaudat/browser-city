#!/usr/bin/env bash
# scripts/ci/check-trace-matrix.sh's own fast, no-cargo coverage (story
# 3.17): every case here runs with `--client-only` -- the `scripts-tests`
# job has no toolchain, which is exactly why the Guard-section lookup must
# not live behind cargo (AC3). That the lookup genuinely runs in full
# (cargo) mode too, not only here, is proven behaviourally by
# test-check-trace-matrix-cargo.sh instead of by grepping the script's own
# source: a dangling name in a real cargo run there is the only proof that
# cannot be defeated by moving the call inside a `CLIENT_ONLY` branch.
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
# typo, a blank line inside a table, a zero-row table) need a
# differently-shaped matrix file, so they build their own small fixture
# instead of mutating the shared tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-trace-matrix.sh"

git_track() { # <dir> -- makes a fake tree a real git work tree
  (cd "$1" && git init -q && git -c user.email=t@t -c user.name=t add -A)
}

# --- shared source files, used by both the clean tree and the holes tree ---
plant_common_files() { # <dir>
  local d="$1"
  mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit" \
    "$d/src/dir" "$d/scripts" "$d/defs/rules"
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
// it("old_ts_case", () => {});
EOF
  cat > "$d/scripts/widget.sh" <<'EOF'
#!/usr/bin/env bash
check "widget_case_label" 0 true
EOF
  cat > "$d/scripts/old-case.sh" <<'EOF'
#!/usr/bin/env bash
# was: check "old_case_name" 0 true
EOF
  cat > "$d/defs/rules/old.toml" <<'EOF'
# key = "old_rule_id"
EOF
  cat > "$d/defs/rules/mid.toml" <<'EOF'
xreal_rule_something = true
EOF
  cat > "$d/docs/notes.md" <<'EOF'
totally_gone_test is written about here, but Markdown is never a guard.
EOF
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
# `deferred` and one `planned` row citing a name that resolves nowhere
# (exempt), and one `partial` row citing a name that does resolve
# (checked exactly like `covered`, so it must stay green here). Every row
# here genuinely resolves -- `plant_holes_tree` below, sharing the same
# source files, is where every row is deliberately dangling instead.
plant_clean_tree() {
  local d
  d="$(fake_dir)"
  plant_common_files "$d"

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
| A partial row is checked exactly like covered | partial | `src/widget.rs` -- `widget_creates_ok` |
EOF
  git_track "$d"
  printf '%s' "$d"
}

# --- the shared holes tree -----------------------------------------------
# The same source files as plant_clean_tree, but every guard row is
# deliberately dangling: a literal extra "|" inside a Guard cell with a
# real token after it, an `inv_*` id whose own invariant row is
# `deferred` (must not resolve via the matrix-id shortcut), a Markdown
# path that is never a guard even though it happens to quote the name
# it's cited for, a name surviving only in a `#`/`//` comment in three
# different file kinds, and a prefix occurring only mid-word. One run,
# checked exit 1 once and `check_contains` once per hole -- every hole is
# independent of every other (Quentin's direction).
plant_holes_tree() {
  local d
  d="$(fake_dir)"
  plant_common_files "$d"

  cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| `inv_widget_not_covered` | placeholder | deferred | | someday |

## Widgets

| Requirement | Status | Guard |
| --- | --- | --- |
| A literal extra pipe inside the Guard cell is still real data | covered | `src/widget.rs` -- `widget_creates_ok` | `dangling_after_pipe` |
| An inv_* id whose own invariant row is not covered must not resolve via the shortcut | covered | `src/widget.rs` -- `inv_widget_not_covered` |
| Markdown is never a guard, even when it quotes the name itself | covered | `docs/notes.md` -- `totally_gone_test` |
| A name surviving only in a hash comment does not resolve (whole-word tier) | covered | `defs/rules/old.toml` -- `old_rule_id` |
| A name surviving only in a hash comment does not resolve (.sh title tier) | covered | `scripts/old-case.sh` -- `old_case_name` |
| A title surviving only in a slash comment does not resolve (.ts title tier) | covered | `src/widget.test.ts` -- `old_ts_case` |
| A prefix occurring only mid-word does not resolve | covered | `defs/rules/mid.toml` -- `real_rule_*` |
EOF
  git_track "$d"
  printf '%s' "$d"
}

d="$(plant_clean_tree)"
check "a clean tree -- every resolver green, two exempt statuses, partial checked -- passes" 0 \
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
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a fn deleted but its name left in a // comment still fails" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the failure names the survives-as-comment row" "A Rust fn survives as a comment once deleted" "$out"

# --- name exists in the repo but not under the cell's own paths ------------
d="$(plant_clean_tree)"
sed -i "s#\`src/widget.rs\` -- \`widget_creates_ok\`#\`src/extra.rs\` -- \`widget_creates_ok\`#" "$d/docs/trace-matrix.md"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a name that exists elsewhere in the repo, but not under this cell's own paths, fails" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the failure names the token, scoped to the cited path" "widget_creates_ok" "$out"

# --- client title changed ---------------------------------------------------
d="$(plant_clean_tree)"
sed -i "s/doesn't fail, even with a comma/renders fine/" "$d/src/widget.test.ts"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a client title changed fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the changed title" "widget doesn't fail, even with a comma" "$out"

# --- .sh case removed --------------------------------------------------------
d="$(plant_clean_tree)"
sed -i 's/widget_case_label/widget_case_removed/' "$d/scripts/widget.sh"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check ".sh case cited and removed fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the removed case label" "widget_case_label" "$out"

# --- prefix_* with zero matches, then with one match ------------------------
d="$(plant_clean_tree)"
sed -i 's/fn widget_prefix_match_case_alpha/fn widget_unrelated_case_alpha/' "$d/src/widget.rs"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "prefix_* with zero matches fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the prefix" "widget_prefix_match_case_*" "$out"

d="$(plant_clean_tree)"
check "prefix_* with one real match passes (part of the clean tree)" 0 \
  bash "$CHECK" --client-only "$d"

# --- second path missing, first present -------------------------------------
d="$(plant_clean_tree)"
rm "$d/src/extra.rs"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a cell's second path missing (first present) fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the missing second path" "src/extra.rs" "$out"

# --- a name that is a prefix of a longer real fn (word boundary) -----------
d="$(plant_clean_tree)"
printf '| A bare name must not match a longer fn as a substring | covered | `src/widget.rs` -- `widget_creates` |\n' >> "$d/docs/trace-matrix.md"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "an exact candidate that is only a prefix of a real, longer fn name fails (word boundary)" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the failure names the bare candidate, not the longer fn" "cites 'widget_creates'" "$out"

# --- two dangling names in two rows: both reported, accumulate-then-fail ---
d="$(plant_clean_tree)"
sed -i 's/fn widget_creates_ok/fn widget_creates_renamed/' "$d/src/widget.rs"
sed -i 's/fn extra_only_fn/fn extra_only_renamed/' "$d/src/extra.rs"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "two dangling names in two rows fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the first dangling name is reported" "widget_creates_ok" "$out"
check_contains "the second dangling name is reported too, in the same run" "extra_only_fn" "$out"

# --- the holes tree: every row above deliberately dangles in one specific
# way, one run, one exit-1 assertion, and one check_contains per hole --
# every hole independent of every other (Quentin's direction).
d="$(plant_holes_tree)"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "the holes tree fails (every row in it is deliberately dangling)" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "a literal extra pipe's own token, after the pipe, is still checked" \
  "dangling_after_pipe" "$out"
check_contains "a non-covered inv_* id cited by a covered cell is named dangling" \
  "inv_widget_not_covered" "$out"
check_contains "a name that appears only inside a cited .md file is still dangling" \
  "totally_gone_test" "$out"
check_contains "a name left only in a # comment (whole-word tier, .toml) is dangling" \
  "old_rule_id" "$out"
check_contains "a name left only in a # comment (.sh title tier) is dangling" \
  "old_case_name" "$out"
check_contains "a title left only in a // comment (.ts title tier) is dangling" \
  "old_ts_case" "$out"
check_contains "a prefix that only occurs mid-word never resolves" \
  "real_rule_*" "$out"

# --- a dangling name on a partial row fails, exactly like covered ----------
d="$(plant_clean_tree)"
sed -i "s#| A partial row is checked exactly like covered | partial | \`src/widget.rs\` -- \`widget_creates_ok\` |#| A partial row is checked exactly like covered | partial | \`src/widget.rs\` -- \`widget_gone_entirely\` |#" "$d/docs/trace-matrix.md"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a dangling name on a partial row fails, exactly like covered" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the partial row's own dangling token" "widget_gone_entirely" "$out"

# --- a .sh title resolves, and stops resolving once its own case is
# renamed (Tim's own fixture shape, dedicated so the title-in-.sh support
# is pinned unambiguously) ---------------------------------------------------
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit" "$d/scripts/ci/tests"
: > "$d/server/sim/tests/invariants.rs"
cat > "$d/scripts/ci/tests/test-x.sh" <<'EOF'
#!/usr/bin/env bash
check "a dangling name goes red" 0 true
EOF
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## Sh titles

| Requirement | Status | Guard |
| --- | --- | --- |
| A .sh case title resolves | covered | `scripts/ci/tests/test-x.sh` -- `a dangling name goes red` |
EOF
git_track "$d"
check "a .sh case title resolves" 0 bash "$CHECK" --client-only "$d"
sed -i 's/a dangling name goes red/a dangling name goes green instead/' "$d/scripts/ci/tests/test-x.sh"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "the same .sh case title, once its own case is renamed, fails" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the now-missing .sh case title" "a dangling name goes red" "$out"

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
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a guard table under a never-registered heading is still checked (discovery, not a list)" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the failure names the dangling name found under the new heading" "nowhere_to_be_found" "$out"

# no guard table at all
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
printf '# Trace matrix\n\nNothing here is a guard table.\n' > "$d/docs/trace-matrix.md"
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
check "a matrix with no guard table at all fails" 1 bash "$CHECK" --client-only "$d"

# a header typo, alongside one real, resolving guard table -- the fixture
# is deliberately never all-red-because-no-table-exists-at-all: with the
# closed-set header check disabled, this fixture would pass (the real
# section is genuinely clean, and the mistyped section's own row is
# simply invisible), so this case is the one that actually kills that
# mutant, not merely looking like it does.
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
cat > "$d/docs/real.md" <<'EOF'
real
EOF
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## Real section

| Requirement | Status | Guard |
| --- | --- | --- |
| A real resolvable row | covered | `docs/real.md` |

## Typo section

| Requirment | Status | Guard |
| --- | --- | --- |
| A row under a mistyped header | covered | `docs/real.md` |
EOF
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a '| Requirment |' header (typo) alongside one real, valid guard table still fails" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the failure names the exact mistyped header line" "Requirment" "$out"

# a blank line between a table's separator row and its first data row
# must never be mistaken for the table's own end -- the row after it is
# still checked, not silently dropped.
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## A table with a blank line before its first row

| Requirement | Status | Guard |
| --- | --- | --- |

| A row that must not be silently dropped | covered | `does/not/exist.rs` |
EOF
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a blank line right after a table's header/separator never hides the row after it" 1 \
  bash "$CHECK" --client-only "$d"
check_contains "the row after the blank line was actually seen and checked" "does/not/exist.rs" "$out"

# a guard table with zero rows at all (header + separator, nothing else)
d="$(fake_dir)"
mkdir -p "$d/docs" "$d/server/sim/tests" "$d/client/tests/unit"
cat > "$d/docs/trace-matrix.md" <<'EOF'
# Trace matrix

## An empty guard table

| Requirement | Status | Guard |
| --- | --- | --- |

## The next section
EOF
: > "$d/server/sim/tests/invariants.rs"
git_track "$d"
out="$(bash "$CHECK" --client-only "$d" 2>&1)"
check "a guard table with zero rows fails, naming the section" 1 bash "$CHECK" --client-only "$d"
check_contains "the failure names the empty section" "An empty guard table" "$out"

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

summary
exit $?
