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
mkdir -p "$D/docs" "$D/server/sim/src" "$D/server/sim/tests" "$D/server/browser_city/src" "$D/scripts/ci"
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

write_matrix() { # <second-section-heading>
  cat > "$D/docs/trace-matrix.md" <<EOF
# Trace matrix

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| \`inv_something_never_starves\` | something never starves | deferred | | someday |

## Round trip and client/server boundary

| Requirement | Status | Guard |
| --- | --- | --- |
| A round-trip requirement | covered | \`docs/trace-matrix.md\` |

## $1

| Requirement | Status | Guard |
| --- | --- | --- |
| A schema-permanence requirement | covered | \`docs/trace-matrix.md\` |

## Definitions

| Requirement | Status | Guard |
| --- | --- | --- |
| A definitions requirement | covered | \`docs/trace-matrix.md\` |

## World addressing

| Requirement | Status | Guard |
| --- | --- | --- |
| A world-addressing requirement | covered | \`docs/trace-matrix.md\` |

## Scheduled-reducer timing

| Requirement | Status | Guard |
| --- | --- | --- |
| A scheduled-reducer-timing requirement | covered | \`docs/trace-matrix.md\` |

## Backup and restore

| Requirement | Status | Guard |
| --- | --- | --- |
| A backup/restore requirement | covered | \`docs/trace-matrix.md\` |
EOF
}

run_check() {
  ( cd "$D" && bash scripts/ci/check-trace-matrix.sh )
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

summary
