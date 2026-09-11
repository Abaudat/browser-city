#!/usr/bin/env bash
# Generalised from story 1.3's check-sched-timing-pin.sh (Tim's direction
# for story 1.4: extend it into a generic spike-pin check rather than
# cloning it). CI cannot cheaply assert drift itself, so it asserts
# staleness instead: a spike report names, in a machine-readable marker,
# the exact SpacetimeDB version its numbers/findings were measured
# against. This fails the moment that no longer agrees with the three
# other places a version lives -- because the version bump that
# invalidates the finding is exactly the moment we must be forced to
# re-run it.
#
# Usage: check-spike-pin.sh <report-path> <marker-name>
#   e.g. check-spike-pin.sh docs/spikes/1.3-scheduled-reducer-timing.md sched-timing-spacetimedb-version
#        check-spike-pin.sh docs/spikes/1.4-backup-restore.md backup-spacetimedb-version
#
# Two different comparisons, deliberately not the same one three times:
#   - server/Cargo.toml's `spacetimedb` dependency pin (`2.9.*`) and
#     docs/architecture.md's stack table line (`2.9.x`) are minor-version
#     wildcards -- they genuinely cannot express a patch, so they are
#     compared major.minor only.
#   - scripts/ci/install-spacetimedb-cli.sh pins an exact patch release,
#     and a patched scheduled-function drift (v2.7.1, v2.8.3) is exactly
#     the kind of behaviour change a spike's numbers can go stale against.
#     A minor-only comparison here would let 2.9.0 drift to 2.9.5
#     unnoticed. This one is compared full X.Y.Z, exactly.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

[ "$#" -eq 2 ] || { echo "check-spike-pin: usage: check-spike-pin.sh <report-path> <marker-name>" >&2; exit 1; }
REPORT="$REPO_ROOT/$1"
MARKER="$2"
CARGO_TOML="$REPO_ROOT/server/Cargo.toml"
ARCH="$REPO_ROOT/docs/architecture.md"
INSTALL_SCRIPT="$REPO_ROOT/scripts/ci/install-spacetimedb-cli.sh"

for f in "$REPORT" "$CARGO_TOML" "$ARCH" "$INSTALL_SCRIPT"; do
  [ -f "$f" ] || { echo "check-spike-pin: $f not found" >&2; exit 1; }
done

minor_of() { # <x.y.z> -> <x.y>
  printf '%s' "$1" | grep -oE '^[0-9]+\.[0-9]+'
}

REPORT_VERSION="$(grep -oE "<!-- bc:${MARKER} [0-9]+\.[0-9]+\.[0-9]+ -->" "$REPORT" \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
[ -n "$REPORT_VERSION" ] || {
  echo "check-spike-pin: FAIL -- $REPORT has no '<!-- bc:${MARKER} X.Y.Z -->' marker" >&2
  exit 1
}

CARGO_PIN="$(grep -E '^spacetimedb = ' "$CARGO_TOML" | grep -oE '[0-9]+\.[0-9]+\.\*' | grep -oE '^[0-9]+\.[0-9]+' || true)"
[ -n "$CARGO_PIN" ] || {
  echo "check-spike-pin: FAIL -- $CARGO_TOML has no 'spacetimedb = { version = \"X.Y.*\" }' pin to read" >&2
  exit 1
}

ARCH_PIN="$(grep -oE 'SpacetimeDB [0-9]+\.[0-9]+\.x' "$ARCH" | grep -oE '[0-9]+\.[0-9]+' | head -n1 || true)"
[ -n "$ARCH_PIN" ] || {
  echo "check-spike-pin: FAIL -- $ARCH has no 'SpacetimeDB X.Y.x' line to read" >&2
  exit 1
}

INSTALL_PIN="$(grep -oE '^VERSION="[0-9]+\.[0-9]+\.[0-9]+"' "$INSTALL_SCRIPT" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
[ -n "$INSTALL_PIN" ] || {
  echo "check-spike-pin: FAIL -- $INSTALL_SCRIPT has no 'VERSION=\"X.Y.Z\"' pin to read" >&2
  exit 1
}
REPORT_MINOR="$(minor_of "$REPORT_VERSION")"

FAILED=0
check_minor_agrees() { # <label> <minor-value>
  if [ "$2" != "$CARGO_PIN" ]; then
    echo "check-spike-pin: FAIL -- $1 is $2.x, server/Cargo.toml pins spacetimedb $CARGO_PIN.* -- re-measure $REPORT and update it (and docs/architecture.md if the mismatch is theirs)" >&2
    FAILED=1
  fi
}

check_minor_agrees "$REPORT's measured version ($REPORT_VERSION)" "$REPORT_MINOR"
check_minor_agrees "docs/architecture.md's stack line" "$ARCH_PIN"

if [ "$REPORT_VERSION" != "$INSTALL_PIN" ]; then
  echo "check-spike-pin: FAIL -- $REPORT was measured on $REPORT_VERSION, but scripts/ci/install-spacetimedb-cli.sh now pins $INSTALL_PIN -- a patch bump can move platform behaviour, so re-measure $REPORT" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-spike-pin: $REPORT ($REPORT_VERSION) matches the pinned installer ($INSTALL_PIN) exactly, and server/Cargo.toml ($CARGO_PIN.*) / docs/architecture.md ($ARCH_PIN.x) agree with it on minor" >&2
exit 0
