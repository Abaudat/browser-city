#!/usr/bin/env bash
# scripts/ci/check-defs-current.sh's own fast, no-cargo coverage
# (Quentin's direction): a fake repo root plus a stub regen command
# (overridable via this script's own [repo-root] [regen-cmd] arguments)
# stands in for a real `cargo run --bin defs-build`, so this suite never
# needs the Rust toolchain. Four drift cases plus a clean tree, and for
# every failing case, that `cleanup` actually restores the committed
# `client/public/atlas/` directory byte-for-byte -- a guard that leaves
# the working tree mutated on failure is its own bug.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-defs-current.sh"

# fake_repo -- a minimal tree with the three generated files plus an
# atlas/ directory holding one page ("a.png"), and a canonical/ directory
# holding what a "real" regen would produce: identical content by
# default. Each case below mutates either the committed tree or the
# canonical output before running the check.
fake_repo() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/server/sim/src/generated" "$d/client/public/defs" \
    "$d/tools/defs-build/goldens" "$d/client/public/atlas" \
    "$d/canonical/atlas"
  printf 'rust v1\n' > "$d/server/sim/src/generated/defs.rs"
  printf '{"v":1}' > "$d/client/public/defs/defs.json"
  printf 'object 1 a\n' > "$d/tools/defs-build/goldens/defs-manifest.golden"
  printf 'page-a-v1\n' > "$d/client/public/atlas/a.png"

  printf 'rust v1\n' > "$d/canonical/defs.rs"
  printf '{"v":1}' > "$d/canonical/defs.json"
  printf 'object 1 a\n' > "$d/canonical/manifest.golden"
  printf 'page-a-v1\n' > "$d/canonical/atlas/a.png"

  cat > "$d/regen.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp "$d/canonical/defs.rs" "$d/server/sim/src/generated/defs.rs"
cp "$d/canonical/defs.json" "$d/client/public/defs/defs.json"
cp "$d/canonical/manifest.golden" "$d/tools/defs-build/goldens/defs-manifest.golden"
rm -rf "$d/client/public/atlas"
mkdir -p "$d/client/public/atlas"
cp "$d/canonical/atlas/." -r "$d/client/public/atlas/" 2>/dev/null || cp -R "$d/canonical/atlas/." "$d/client/public/atlas/"
EOF
  chmod +x "$d/regen.sh"
  printf '%s' "$d"
}

# check_eq <name> <a> <b> -- exact string equality, used for the
# byte-for-byte restore assertion (harness.sh's own check_contains is a
# substring test, too loose for "restored exactly").
check_eq() {
  local name="$1" a="$2" b="$3"
  if [ "$a" = "$b" ]; then
    printf '  ok   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  FAIL %s -- snapshots differ\n' "$name"
    fail=$((fail + 1))
  fi
}

snapshot_atlas() {
  # A stable, order-independent fingerprint of every file's name and
  # content under $1/client/public/atlas/.
  (cd "$1/client/public/atlas" && find . -type f -exec sh -c 'echo "$1:"; cat "$1"' _ {} \; | sort)
}

# --- clean tree: passes -----------------------------------------------------
d="$(fake_repo)"
check "a clean tree (committed matches canonical) passes" 0 \
  bash "$CHECK" "$d" "bash '$d/regen.sh'"

# --- case 1: one byte of a committed page changed ---------------------------
d="$(fake_repo)"
printf 'page-a-CORRUPTED\n' > "$d/client/public/atlas/a.png"
before="$(snapshot_atlas "$d")"
check "one byte of a committed page changed fails" 1 \
  bash "$CHECK" "$d" "bash '$d/regen.sh'"
after="$(snapshot_atlas "$d")"
check_eq "case 1: cleanup restores the committed atlas dir byte-for-byte" "$before" "$after"

# --- case 2: a stray extra .png in client/public/atlas/ ---------------------
d="$(fake_repo)"
printf 'stray\n' > "$d/client/public/atlas/stray.png"
before="$(snapshot_atlas "$d")"
check "a stray extra page in the committed atlas dir fails" 1 \
  bash "$CHECK" "$d" "bash '$d/regen.sh'"
after="$(snapshot_atlas "$d")"
check_eq "case 2: cleanup restores the committed atlas dir byte-for-byte" "$before" "$after"

# --- case 3: a committed page deleted ---------------------------------------
d="$(fake_repo)"
rm "$d/client/public/atlas/a.png"
before="$(snapshot_atlas "$d")"
check "a committed page missing from disk fails" 1 \
  bash "$CHECK" "$d" "bash '$d/regen.sh'"
after="$(snapshot_atlas "$d")"
check_eq "case 3: cleanup restores the committed atlas dir byte-for-byte" "$before" "$after"

# --- non-atlas drift still works (regression guard on the pre-existing
# rust/json/manifest diffs, now sharing this script's own arguments) -------
d="$(fake_repo)"
printf 'rust DRIFTED\n' > "$d/server/sim/src/generated/defs.rs"
check "a stale generated Rust artefact still fails" 1 \
  bash "$CHECK" "$d" "bash '$d/regen.sh'"

summary
exit $?
