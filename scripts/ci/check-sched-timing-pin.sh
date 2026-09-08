#!/usr/bin/env bash
# Story 1.3's one automated obligation: CI cannot cheaply assert drift
# itself, so it asserts staleness instead. The spike report
# (docs/spikes/1.3-scheduled-reducer-timing.md) names, in a machine-
# readable marker, the exact SpacetimeDB version its numbers were
# measured against. This fails the moment that no longer agrees with the
# three other places a version lives -- server/Cargo.toml's `spacetimedb`
# dependency pin, docs/architecture.md's stack table line, and
# scripts/ci/install-spacetimedb-cli.sh's pinned VERSION -- because the
# version bump that invalidates the finding is exactly the moment we must
# be forced to re-run it (Tim's direction).
#
# Compares major.minor only: a patch bump (2.9.0 -> 2.9.1) is not the
# "different scheduler line" the report's finding is about, and the pin
# itself (`2.9.*`) is a minor-version wildcard, not a literal patch.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

REPORT="$REPO_ROOT/docs/spikes/1.3-scheduled-reducer-timing.md"
CARGO_TOML="$REPO_ROOT/server/Cargo.toml"
ARCH="$REPO_ROOT/docs/architecture.md"
INSTALL_SCRIPT="$REPO_ROOT/scripts/ci/install-spacetimedb-cli.sh"

for f in "$REPORT" "$CARGO_TOML" "$ARCH" "$INSTALL_SCRIPT"; do
  [ -f "$f" ] || { echo "check-sched-timing-pin: $f not found" >&2; exit 1; }
done

minor_of() { # <x.y.z> -> <x.y>
  printf '%s' "$1" | grep -oE '^[0-9]+\.[0-9]+'
}

REPORT_VERSION="$(grep -oE '<!-- bc:sched-timing-spacetimedb-version [0-9]+\.[0-9]+\.[0-9]+ -->' "$REPORT" \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
[ -n "$REPORT_VERSION" ] || {
  echo "check-sched-timing-pin: FAIL -- $REPORT has no '<!-- bc:sched-timing-spacetimedb-version X.Y.Z -->' marker" >&2
  exit 1
}

CARGO_PIN="$(grep -E '^spacetimedb = ' "$CARGO_TOML" | grep -oE '[0-9]+\.[0-9]+\.\*' | grep -oE '^[0-9]+\.[0-9]+' || true)"
[ -n "$CARGO_PIN" ] || {
  echo "check-sched-timing-pin: FAIL -- $CARGO_TOML has no 'spacetimedb = { version = \"X.Y.*\" }' pin to read" >&2
  exit 1
}

ARCH_PIN="$(grep -oE 'SpacetimeDB [0-9]+\.[0-9]+\.x' "$ARCH" | grep -oE '[0-9]+\.[0-9]+' | head -n1 || true)"
[ -n "$ARCH_PIN" ] || {
  echo "check-sched-timing-pin: FAIL -- $ARCH has no 'SpacetimeDB X.Y.x' line to read" >&2
  exit 1
}

INSTALL_PIN="$(grep -oE '^VERSION="[0-9]+\.[0-9]+\.[0-9]+"' "$INSTALL_SCRIPT" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
[ -n "$INSTALL_PIN" ] || {
  echo "check-sched-timing-pin: FAIL -- $INSTALL_SCRIPT has no 'VERSION=\"X.Y.Z\"' pin to read" >&2
  exit 1
}
INSTALL_PIN="$(minor_of "$INSTALL_PIN")"
REPORT_MINOR="$(minor_of "$REPORT_VERSION")"

FAILED=0
check_agrees() { # <label> <value>
  if [ "$2" != "$CARGO_PIN" ]; then
    echo "check-sched-timing-pin: FAIL -- $1 is $2.x, server/Cargo.toml pins spacetimedb $CARGO_PIN.* -- re-run scripts/dev/run-sched-timing-spike.sh and update $REPORT (and docs/architecture.md / the pinned installer if the mismatch is theirs)" >&2
    FAILED=1
  fi
}

check_agrees "the spike report's measured version ($REPORT_VERSION)" "$REPORT_MINOR"
check_agrees "docs/architecture.md's stack line" "$ARCH_PIN"
check_agrees "scripts/ci/install-spacetimedb-cli.sh's pinned VERSION" "$INSTALL_PIN"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-sched-timing-pin: report ($REPORT_VERSION), server/Cargo.toml ($CARGO_PIN.*), docs/architecture.md ($ARCH_PIN.x) and the pinned installer ($INSTALL_PIN.*) all agree" >&2
exit 0
