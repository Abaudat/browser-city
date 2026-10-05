#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-trace-matrix.sh's full
# (cargo) mode -- a scratch two-crate Cargo workspace (never the live
# repo's own) so `cargo test --workspace --exclude browser_city --
# --list` has something real to run against. Complements
# test-check-trace-matrix.sh, which drives the Guard-section lookup
# itself (fn/title/case/prefix resolution, discovery, statuses) without
# cargo -- this file's own job is the pieces that need a real Rust test
# suite: the covered/deferred Test-column symmetry, the INV_
# constant<->matrix registry, and the AC3 proof that the Guard-section
# lookup genuinely runs in full mode too, not only under --client-only.
# One fixture directory is built once and reused across cases below
# (only docs/trace-matrix.md changes between runs), since neither crate
# has any source for a rebuild to pick up.
#
# Not a cp of the script into a fake `scripts/ci/`: the positional root
# argument this story added exists precisely so a self-test never has to
# fake its own copy of the tree layout around the script it is testing.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../check-trace-matrix.sh"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo on PATH"; exit 0; }

D="$(fake_dir)"
rm -rf "$D"
mkdir -p "$D/docs" "$D/server/sim/src" "$D/server/sim/tests" "$D/server/browser_city/src" "$D/client/tests/unit"

cat > "$D/server/Cargo.toml" <<'TOML'
[workspace]
members = ["sim", "browser_city"]
resolver = "2"
TOML
cat > "$D/server/sim/Cargo.toml" <<'TOML'
[package]
name = "sim"
version = "0.1.0"
edition = "2021"
TOML
cat > "$D/server/sim/src/lib.rs" <<'RS'
#[cfg(test)]
mod tests {
    #[test]
    fn dummy() {}
}
RS
printf 'pub const INV_SOMETHING_NEVER_STARVES: &str = "something never starves";\n' \
  > "$D/server/sim/tests/invariants.rs"
cat > "$D/server/browser_city/Cargo.toml" <<'TOML'
[package]
name = "browser_city"
version = "0.1.0"
edition = "2021"
TOML
: > "$D/server/browser_city/src/lib.rs"

git -C "$D" init -q
git -C "$D" config user.email t@t.com
git -C "$D" config user.name t
git -C "$D" add -A
git -C "$D" commit -q -m base

# write_matrix -- one guard table ("## Schema permanence", named for no
# reason but precedent -- discovery does not care what it is called), a
# single `covered` row whose Guard cell is a bare path with no name to
# resolve. [extra-id-table-row] extends the first (inv_*) table only.
write_matrix() { # [extra-id-table-row]
  cat > "$D/docs/trace-matrix.md" <<EOF
# Trace matrix

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| \`inv_something_never_starves\` | something never starves | deferred | | someday |
${1:-}

## Schema permanence

| Requirement | Status | Guard |
| --- | --- | --- |
| A Schema permanence requirement | covered | \`docs/trace-matrix.md\` |
EOF
}

run_check() { # [extra-arg...]
  bash "$CHECK" "$@" "$D"
}

# write_client_test <relative-path-under-client/tests/unit> <inv-name...>
write_client_test() {
  local rel="$1"; shift
  mkdir -p "$D/client/tests/unit/$(dirname "$rel")"
  {
    echo "import { it } from \"vitest\";"
    for name in "$@"; do
      echo "it(\"$name\", () => {});"
    done
  } > "$D/client/tests/unit/$rel"
}

clear_client_tests() {
  rm -rf "$D/client/tests/unit"
  mkdir -p "$D/client/tests/unit"
}

echo "green: the guard table present, its Guard path real (warms cargo's build cache)"
write_matrix
check "the fixture matrix -> exit 0" 0 run_check

echo
echo "red: a Guard path that does not exist"
write_matrix
sed -i 's#`docs/trace-matrix.md`#`docs/does-not-exist.md`#' "$D/docs/trace-matrix.md"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing path" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does-not-exist.md'" _ "$OUT"

echo
echo "green: a guard table under a heading this file never named before is still checked (discovery, not a fixed list -- the full-cargo-mode proof scripts/ci/tests/test-check-trace-matrix.sh's own fixtures cannot give, since they never run cargo at all)"
write_matrix
{
  cat <<'EXTRA'

## A section invented for this run alone

| Requirement | Status | Guard |
| --- | --- | --- |
| A requirement under a never-before-seen heading | covered | `docs/trace-matrix.md` |
EXTRA
} >> "$D/docs/trace-matrix.md"
check "an extra, unregistered guard table still passes when its own Guard path is real" 0 run_check
sed -i '/## A section invented for this run alone/,$ s#`docs/trace-matrix.md`#`docs/does-not-exist.md`#' "$D/docs/trace-matrix.md"
OUT="$(run_check 2>&1)"; CODE=$?
check "and still fails when that same table's own Guard path is not (discovery, not decoration)" 1 bash -c "exit $CODE"
check "names the missing path under the never-before-seen heading" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does-not-exist.md'" _ "$OUT"

echo
echo "red (AC3): a dangling Guard-cell name fails in full (cargo) mode too, not only under --client-only"
write_matrix
sed -i 's#`docs/trace-matrix.md`#`server/sim/src/lib.rs` -- `totally_gone_fn`#' "$D/docs/trace-matrix.md"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the dangling token" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'totally_gone_fn'" _ "$OUT"

echo
echo "red: a client inv_* test with no matrix row fails"
write_matrix
clear_client_tests
write_client_test "render/sort-key.test.ts" "inv_client_only_no_row"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unregistered client test" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"client test 'inv_client_only_no_row' has no row\"" _ "$OUT"

echo
echo "red: a matrix row claims a client inv_* test that does not exist, full run"
write_matrix '| `inv_client_ghost` | a client invariant nothing implements | covered | `inv_client_ghost` | -- |'
clear_client_tests
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing test" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"claims coverage via 'inv_client_ghost', but no such test exists\"" _ "$OUT"

echo
echo "red: a deferred row whose client test now exists fails"
write_matrix '| `inv_client_now_exists` | a client invariant now covered | deferred | | someday |'
clear_client_tests
write_client_test "demo/player-step.test.ts" "inv_client_now_exists"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "says to flip the row to covered" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'inv_client_now_exists' is 'deferred' but a test named 'inv_client_now_exists' now exists\"" _ "$OUT"

echo
echo "green: --client-only exits 0 on an agreeing fixture, and never invokes cargo"
write_matrix
clear_client_tests
CARGO_SENTINEL_DIR="$(fake_dir)"
rm -rf "$CARGO_SENTINEL_DIR"
mkdir -p "$CARGO_SENTINEL_DIR"
CARGO_SENTINEL="$CARGO_SENTINEL_DIR/cargo-called"
cat > "$CARGO_SENTINEL_DIR/cargo" <<SH
#!/usr/bin/env bash
touch "$CARGO_SENTINEL"
exit 1
SH
chmod +x "$CARGO_SENTINEL_DIR/cargo"
check "client-only exits 0 without cargo on PATH" 0 bash -c \
  "PATH=\"$CARGO_SENTINEL_DIR:$PATH\" bash '$CHECK' --client-only '$D'"
check "cargo was never invoked" 1 bash -c "[ -e '$CARGO_SENTINEL' ]"

echo
echo "red: --client-only still catches a client-symmetry failure, without cargo on PATH"
write_matrix
clear_client_tests
write_client_test "render/sort-key.test.ts" "inv_client_only_no_row"
rm -f "$CARGO_SENTINEL"
check "client-only exits non-zero on the same fixture" 1 bash -c \
  "PATH=\"$CARGO_SENTINEL_DIR:$PATH\" bash '$CHECK' --client-only '$D'"
check "cargo still was never invoked" 1 bash -c "[ -e '$CARGO_SENTINEL' ]"
clear_client_tests

echo
echo "green: a Requirement cell with an apostrophe in a guard table still passes (PR #288 cycle 2: the trimming step used to be xargs, which aborts on an unmatched quote -- any natural-English apostrophe there crashed the whole check)"
write_matrix
sed -i "s#A Schema permanence requirement#A Schema permanence requirement -- Quentin's direction#" "$D/docs/trace-matrix.md"
check "an apostrophe in a covered Requirement cell -> exit 0" 0 run_check

summary
