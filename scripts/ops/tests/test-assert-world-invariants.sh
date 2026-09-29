#!/usr/bin/env bash
# Failure-path coverage for scripts/ops/assert-world-invariants.sh with a
# stub `spacetime sql`: the stub answers each `SELECT .. FROM <t>` with
# $STUB/<t> data lines (default: one row; `0` = none).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ops/assert-world-invariants.sh"

make_stub() { # -> prints the stub dir; rows per table are files in $d/rows
  local d
  d="$(fake_dir)"
  mkdir -p "$d/rows"
  cat > "$d/spacetime" <<STUB
#!/usr/bin/env bash
[ "\$1" = "sql" ] || { echo "stub: unhandled \$*" >&2; exit 1; }
q="\${@: -1}"
[ -f "$d/fail" ] && { echo "Error: boom" >&2; exit 1; }
t="\${q##* FROM }"
col="\${q#SELECT }"; col="\${col%% *}"
echo " \$col "
echo "-------"
if [ -f "$d/rows/\$t" ]; then cat "$d/rows/\$t"; else echo " 1 "; fi
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

run() { # <stubdir>
  ( PATH="$1:$PATH" bash "$CHECK" some-db --server http://127.0.0.1:1 2>&1 )
}

D="$(make_stub)"
OUT="$(run "$D")"; CODE=$?
check "a consistent world passes" 0 bash -c "exit $CODE"

D="$(make_stub)"; : > "$D/rows/world_clock"
OUT="$(run "$D")"; CODE=$?
check "an empty world_clock fails" 1 bash -c "exit $CODE"
check_contains "names world_clock" "world_clock" "$OUT"

D="$(make_stub)"; : > "$D/rows/metrics_sample_schedule"
OUT="$(run "$D")"; CODE=$?
check "an unarmed cadence fails" 1 bash -c "exit $CODE"
check_contains "names the schedule" "metrics_sample_schedule" "$OUT"

D="$(make_stub)"; printf ' 1 \n 2 \n' > "$D/rows/maintenance_schedule"
OUT="$(run "$D")"; CODE=$?
check "two pending rows fail" 1 bash -c "exit $CODE"

D="$(make_stub)"; : > "$D/rows/unit"
OUT="$(run "$D")"; CODE=$?
check "an empty code table fails" 1 bash -c "exit $CODE"

D="$(make_stub)"; echo ' 0 ' > "$D/rows/cadence_liveness"
OUT="$(run "$D")"; CODE=$?
check "a liveness row with fires=0 fails" 1 bash -c "exit $CODE"

D="$(make_stub)"; : > "$D/rows/cadence_liveness"
OUT="$(run "$D")"; CODE=$?
check "an empty cadence_liveness is tolerated" 0 bash -c "exit $CODE"

D="$(make_stub)"; touch "$D/fail"
OUT="$(run "$D")"; CODE=$?
check "a failed query is a hard failure" 1 bash -c "exit $CODE"

summary
