#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-spike-pin.sh (generalised
# from story 1.3's check-sched-timing-pin.sh -- Tim's direction for story
# 1.4). Every fixture is a scratch directory standing in for the repo root
# -- never the live repo's own docs/pins. Exercised against two different
# report paths/marker names to prove it is actually generic, not just
# renamed.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK_SRC="$TEST_DIR/../../../scripts/ci/check-spike-pin.sh"

# fresh_repo <report_rel_path> <marker> <report_version> <arch_pin> <cargo_pin> <install_version>
fresh_repo() {
  local report_rel="$1" marker="$2"
  local report_version="${3:-2.9.0}" arch_pin="${4:-2.9.x}" cargo_pin="${5:-2.9.*}" install_version="${6:-2.9.0}"
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/scripts/ci" "$d/$(dirname "$report_rel")" "$d/server"
  cp "$CHECK_SRC" "$d/scripts/ci/check-spike-pin.sh"

  cat > "$d/$report_rel" <<EOF
# Spike report
<!-- bc:${marker} $report_version -->
EOF

  cat > "$d/docs/architecture.md" <<EOF
| Server, database, replication | SpacetimeDB $arch_pin -- the \`spacetimedb\` crate |
EOF

  cat > "$d/server/Cargo.toml" <<EOF
[dependencies]
spacetimedb = { version = "$cargo_pin" }
EOF

  cat > "$d/scripts/ci/install-spacetimedb-cli.sh" <<EOF
VERSION="$install_version"
EOF

  printf '%s' "$d"
}

run_check() { # <dir> <report_rel_path> <marker>
  ( cd "$1" && bash scripts/ci/check-spike-pin.sh "$2" "$3" )
}

for CASE in "docs/spikes/1.3-scheduled-reducer-timing.md sched-timing-spacetimedb-version" \
            "docs/spikes/1.4-backup-restore.md backup-spacetimedb-version"; do
  set -- $CASE
  REPORT_REL="$1"; MARKER="$2"
  echo "=== $REPORT_REL / $MARKER ==="

  echo "green: report, architecture, Cargo pin and installer all agree at 2.9"
  D="$(fresh_repo "$REPORT_REL" "$MARKER")"
  check "all agree -> exit 0" 0 run_check "$D" "$REPORT_REL" "$MARKER"

  echo
  echo "red: report was measured against a version the pin has since moved past"
  D="$(fresh_repo "$REPORT_REL" "$MARKER" 2.9.0 2.10.x 2.10.* 2.10.0)"
  OUT="$(run_check "$D" "$REPORT_REL" "$MARKER" 2>&1)"; CODE=$?
  check "stale report -> exit 1" 1 bash -c "exit $CODE"
  check_out "stale report message names the mismatch" 0 "yes" bash -c "printf '%s' \"\$1\" | grep -qF 'measured version' && echo yes" _ "$OUT"

  echo
  echo "red: architecture.md drifted from the Cargo pin even though the report agrees with Cargo"
  D="$(fresh_repo "$REPORT_REL" "$MARKER" 2.9.0 2.8.x 2.9.* 2.9.0)"
  check "architecture drifted -> exit 1" 1 run_check "$D" "$REPORT_REL" "$MARKER"

  echo
  echo "red: the pinned installer drifted from the Cargo pin"
  D="$(fresh_repo "$REPORT_REL" "$MARKER" 2.9.0 2.9.x 2.9.* 2.8.0)"
  check "installer drifted -> exit 1" 1 run_check "$D" "$REPORT_REL" "$MARKER"

  echo
  echo "red: report has no version marker at all"
  D="$(fresh_repo "$REPORT_REL" "$MARKER")"
  printf '# Spike report\nno marker here\n' > "$D/$REPORT_REL"
  check "missing marker -> exit 1" 1 run_check "$D" "$REPORT_REL" "$MARKER"

  echo
  echo "red: a patch-only difference against the installer is still a mismatch"
  D="$(fresh_repo "$REPORT_REL" "$MARKER" 2.9.0 2.9.x 2.9.* 2.9.1)"
  OUT="$(run_check "$D" "$REPORT_REL" "$MARKER" 2>&1)"; CODE=$?
  check "patch bump alone -> exit 1" 1 bash -c "exit $CODE"
  check_out "message names the exact mismatch" 0 "yes" bash -c "printf '%s' \"\$1\" | grep -qF 'measured on 2.9.0' && echo yes" _ "$OUT"

  echo
  echo "green: report matches the installer's exact patch, even though Cargo/architecture only express minor"
  D="$(fresh_repo "$REPORT_REL" "$MARKER" 2.9.7 2.9.x 2.9.* 2.9.7)"
  check "exact patch match -> exit 0" 0 run_check "$D" "$REPORT_REL" "$MARKER"
  echo
done

echo "red: a report's marker does not leak into a check run against a different marker name"
D="$(fresh_repo "docs/spikes/1.4-backup-restore.md" "backup-spacetimedb-version")"
check "wrong marker name -> exit 1" 1 run_check "$D" "docs/spikes/1.4-backup-restore.md" "sched-timing-spacetimedb-version"

echo
echo "red: missing report path argument entirely"
D="$(fresh_repo "docs/spikes/1.4-backup-restore.md" "backup-spacetimedb-version")"
check "wrong arg count -> exit 1" 1 bash -c "cd '$D' && bash scripts/ci/check-spike-pin.sh docs/spikes/1.4-backup-restore.md"

summary
