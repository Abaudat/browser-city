#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-sched-timing-pin.sh. Every
# fixture is a scratch directory standing in for the repo root -- never
# the live repo's own docs/pins.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-sched-timing-pin.sh"

# fresh_repo <report_version> <arch_pin> <cargo_pin> <install_version> --
# a scratch repo with all four sources agreeing at 2.9 by default.
fresh_repo() {
  local report_version="${1:-2.9.0}" arch_pin="${2:-2.9.x}" cargo_pin="${3:-2.9.*}" install_version="${4:-2.9.0}"
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/scripts/ci" "$d/docs/spikes" "$d/server"
  cp "$CHECK" "$d/scripts/ci/check-sched-timing-pin.sh"

  cat > "$d/docs/spikes/1.3-scheduled-reducer-timing.md" <<EOF
# Spike report
<!-- bc:sched-timing-spacetimedb-version $report_version -->
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

run_check() { # <dir>
  ( cd "$1" && bash scripts/ci/check-sched-timing-pin.sh )
}

echo "green: report, architecture, Cargo pin and installer all agree at 2.9"
D="$(fresh_repo)"
check "all agree -> exit 0" 0 run_check "$D"

echo
echo "red: report was measured against a version the pin has since moved past"
D="$(fresh_repo 2.9.0 2.10.x 2.10.* 2.10.0)"
OUT="$(run_check "$D" 2>&1)"; CODE=$?
check "stale report -> exit 1" 1 bash -c "exit $CODE"
check_out "stale report message names the mismatch" 0 "yes" bash -c "printf '%s' \"\$1\" | grep -qF 'measured version' && echo yes" _ "$OUT"

echo
echo "red: architecture.md drifted from the Cargo pin even though the report agrees with Cargo"
D="$(fresh_repo 2.9.0 2.8.x 2.9.* 2.9.0)"
check "architecture drifted -> exit 1" 1 run_check "$D"

echo
echo "red: the pinned installer drifted from the Cargo pin"
D="$(fresh_repo 2.9.0 2.9.x 2.9.* 2.8.0)"
check "installer drifted -> exit 1" 1 run_check "$D"

echo
echo "red: report has no version marker at all"
D="$(fresh_repo)"
printf '# Spike report\nno marker here\n' > "$D/docs/spikes/1.3-scheduled-reducer-timing.md"
check "missing marker -> exit 1" 1 run_check "$D"

echo
echo "green: a patch-only difference (2.9.0 vs 2.9.1) is not a mismatch"
D="$(fresh_repo 2.9.1 2.9.x 2.9.* 2.9.0)"
check "patch bump alone -> exit 0" 0 run_check "$D"

summary
