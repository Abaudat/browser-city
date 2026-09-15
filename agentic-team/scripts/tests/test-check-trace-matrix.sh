#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-trace-matrix.sh's
# GUARD_SECTIONS loop (every section named in that array) -- a scratch
# two-crate Cargo workspace
# (never the live repo's own) so `cargo test --workspace --exclude
# browser_city -- --list` has something real to run against. One fixture
# directory is built once and reused across cases below (only
# docs/trace-matrix.md changes between runs), since neither crate has any
# source for a rebuild to pick up.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-trace-matrix.sh"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo on PATH"; exit 0; }

D="$(fake_dir)"
rm -rf "$D"
mkdir -p "$D/docs" "$D/server/sim/src" "$D/server/sim/tests" "$D/server/browser_city/src" "$D/scripts/ci" "$D/client/tests/unit"
cp "$CHECK" "$D/scripts/ci/check-trace-matrix.sh"

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

# Every section name check-trace-matrix.sh's own GUARD_SECTIONS array
# lists, read from the script itself rather than restated here -- a
# section added to that array must never be able to break this test's own
# green fixture (it did once: story 1.9's "Input and intents").
guard_sections() {
  # Only the leading indent and the surrounding quotes come off: a
  # section name's own internal spaces are part of the heading.
  sed -n '/^GUARD_SECTIONS=(/,/^)/p' "$CHECK" | sed -nE 's/^[[:space:]]+"(.+)"$/\1/p'
}

write_matrix() { # <heading to use in place of "Schema permanence"> [extra-id-table-row]
  {
    cat <<EOF
# Trace matrix

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| \`inv_something_never_starves\` | something never starves | deferred | | someday |
${2:-}
EOF
    # One Guard table per section the checker requires, in its own order.
    # "Schema permanence" is the one case names, so it is the one \$1
    # renames -- that is how the "a renamed section must fail" case is
    # built.
    while IFS= read -r section; do
      [ -n "$section" ] || continue
      [ "$section" = "Schema permanence" ] && section="$1"
      cat <<EOF

## $section

| Requirement | Status | Guard |
| --- | --- | --- |
| A $section requirement | covered | \`docs/trace-matrix.md\` |
EOF
    done < <(guard_sections)
  } > "$D/docs/trace-matrix.md"
}

run_check() { # [extra-arg...]
  ( cd "$D" && bash scripts/ci/check-trace-matrix.sh "$@" )
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

echo "green: both sections present, every Guard path real (warms cargo's build cache)"
write_matrix "Schema permanence"
check "both sections valid -> exit 0" 0 run_check

echo
echo "red: a Guard path that does not exist"
write_matrix "Schema permanence"
sed -i '/## Schema permanence/,$ s#`docs/trace-matrix.md`#`docs/does-not-exist.md`#' "$D/docs/trace-matrix.md"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing path" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does-not-exist.md'" _ "$OUT"

echo
echo "red: the Schema permanence section renamed -- must fail, not pass by finding nothing"
write_matrix "Schema permanence (renamed)"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing section" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"no '## Schema permanence' section found\"" _ "$OUT"

echo
echo "red: a client inv_* test with no matrix row fails"
write_matrix "Schema permanence"
clear_client_tests
write_client_test "render/sort-key.test.ts" "inv_client_only_no_row"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unregistered client test" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"client test 'inv_client_only_no_row' has no row\"" _ "$OUT"

echo
echo "red: a matrix row claims a client inv_* test that does not exist, full run"
write_matrix "Schema permanence" '| `inv_client_ghost` | a client invariant nothing implements | covered | `inv_client_ghost` | -- |'
clear_client_tests
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing test" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"claims coverage via 'inv_client_ghost', but no such test exists\"" _ "$OUT"

echo
echo "red: a deferred row whose client test now exists fails"
write_matrix "Schema permanence" '| `inv_client_now_exists` | a client invariant now covered | deferred | | someday |'
clear_client_tests
write_client_test "demo/player-step.test.ts" "inv_client_now_exists"
OUT="$(run_check 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "says to flip the row to covered" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'inv_client_now_exists' is 'deferred' but a test named 'inv_client_now_exists' now exists\"" _ "$OUT"

echo
echo "green: --client-only exits 0 on an agreeing fixture, and never invokes cargo"
write_matrix "Schema permanence"
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
  "cd '$D' && PATH=\"$CARGO_SENTINEL_DIR:$PATH\" bash scripts/ci/check-trace-matrix.sh --client-only"
check "cargo was never invoked" 1 bash -c "[ -e '$CARGO_SENTINEL' ]"

echo
echo "red: --client-only still catches a client-symmetry failure, without cargo on PATH"
write_matrix "Schema permanence"
clear_client_tests
write_client_test "render/sort-key.test.ts" "inv_client_only_no_row"
rm -f "$CARGO_SENTINEL"
check "client-only exits non-zero on the same fixture" 1 bash -c \
  "cd '$D' && PATH=\"$CARGO_SENTINEL_DIR:$PATH\" bash scripts/ci/check-trace-matrix.sh --client-only"
check "cargo still was never invoked" 1 bash -c "[ -e '$CARGO_SENTINEL' ]"
clear_client_tests

echo
echo "green: a Requirement cell with an apostrophe in a monitored section still passes (PR #288 cycle 2: the trimming step used to be xargs, which aborts on an unmatched quote -- any natural-English apostrophe there crashed the whole check)"
write_matrix "Schema permanence"
sed -i "s#A World addressing requirement#A World addressing requirement -- Quentin's direction#" "$D/docs/trace-matrix.md"
check "an apostrophe in a covered Requirement cell -> exit 0" 0 run_check

summary
