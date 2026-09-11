#!/usr/bin/env bash
# Re-runnable export/restore throughput measurement (Quentin's direction,
# the same precedent as scripts/dev/run-sched-timing-spike.sh): seeds
# `placed_object` (no Timestamp column, so a plain SQL bulk insert seeds
# it fast) to each row count in $SIZES, then times export-world.sh and
# restore-world.sh against a disposable local instance, and verifies
# every leg byte-for-byte with verify-world.sh (Quentin's direction: a
# timing-only harness that never checks correctness could regress
# silently). Also runs one additional "gappy" leg (Tim's direction) --
# roughly half the seeded rows deleted, plus one further contiguous
# ~100,000-id gap -- so the auto_inc gap-fill loop's own cost at a real,
# not merely a ~2,000-id CI-budgeted, scale is measured and recorded, not
# assumed to scale linearly from the dense legs. Never run as part of a
# PR check (Tim's <2-minute budget) -- a human, or backup.yml's
# dispatch/rehearsal path, runs this deliberately. "Roughly half the
# rows deleted" and "one further ~100,000-id gap" collapse into one
# contiguous mid-range deletion sized at least 100,000 ids and at least
# half the leg's own row count -- see `make_gappy` below.
#
# Usage: scripts/dev/run-backup-perf.sh [size ...]
#   defaults to 20000 120000; the gappy leg's own row count is
#   BC_PERF_GAPPY_N (default 200000), independent of $SIZES.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$#" -gt 0 ]; then
  SIZES=("$@")
else
  SIZES=(20000 120000)
fi
GAPPY_N="${BC_PERF_GAPPY_N:-200000}"

PORT=3995
SERVER_URL="http://127.0.0.1:$PORT"
DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-backup-perf.XXXXXX")"
trap 'kill "$START_PID" 2>/dev/null; rm -rf "$DATA_DIR"' EXIT

spacetime start --data-dir "$DATA_DIR/data" --listen-addr "127.0.0.1:$PORT" >"$DATA_DIR/start.log" 2>&1 &
START_PID=$!
deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$deadline" ]; do
  curl -sf -o /dev/null "$SERVER_URL/v1/ping" && break
  sleep 1
done

seed_bulk() { # <db> <n>
  # batch=200, not 1000: confirmed empirically (this story's own gap
  # testing) that a 1000-row batch of an 8-column INSERT trips Windows'
  # `CreateProcess` argv-length limit (`Argument list too long`/
  # `WinError 206`) on this dev box; 200 rows does not.
  local db="$1" n="$2" batch=200 start
  for ((start = 0; start < n; start += batch)); do
    local tuples="" i
    for ((i = start; i < start + batch && i < n; i++)); do
      [ -n "$tuples" ] && tuples="$tuples,"
      tuples="$tuples(0,$((i % 1000)),$i,$i,0,0,0,$i)"
    done
    spacetime sql "$db" --server "$SERVER_URL" --no-config -y \
      "INSERT INTO placed_object (object_id, def_id, x, y, floor, layer, orientation, chunk_key) VALUES $tuples" >/dev/null
  done
}

# make_gappy <db> <n> -- deletes one contiguous middle range covering
# roughly half of the n sequentially-seeded rows, sized at least 100,000
# ids (a real, not merely a CI-budgeted-small, auto_inc gap) -- leaving
# low ids, a genuine gap with nothing in it at all, and high ids, so
# restore's gap-fill loop must skip through the whole gap in one call to
# reach the surviving high ids. One range, not "every other id": SQL's
# `%`/`/` operators are not supported by this SpacetimeDB version
# (confirmed: `Error: Unsupported binary operator: %`), and a single
# range already covers both "roughly half deleted" and "a real ~100k
# gap" at once.
make_gappy() { # <db> <n>
  local db="$1" n="$2"
  local gap_width=$((n / 2))
  [ "$gap_width" -lt 100000 ] && gap_width=100000
  local gap_start=$((n / 4))
  local gap_end=$((gap_start + gap_width))
  spacetime sql "$db" --server "$SERVER_URL" --no-config -y \
    "DELETE FROM placed_object WHERE object_id > $gap_start AND object_id < $gap_end" >/dev/null
}

run_leg() { # <label> <n> <seed-fn>
  local label="$1" n="$2" seed_fn="$3"
  local src="bc-perf-src-$label-$n" dst="bc-perf-dst-$label-$n"
  spacetime publish --server "$SERVER_URL" --no-config -y "$src" --module-path "$REPO_ROOT/server" >/dev/null
  local t0 t1 t2 t3
  t0=$(date +%s.%N)
  seed_bulk "$src" "$n"
  "$seed_fn" "$src" "$n"
  t1=$(date +%s.%N)
  bash "$REPO_ROOT/scripts/ops/export-world.sh" "$src" "$DATA_DIR/export-$label-$n" --server "$SERVER_URL" >/dev/null 2>&1
  t2=$(date +%s.%N)
  spacetime publish --server "$SERVER_URL" --no-config -y "$dst" --module-path "$REPO_ROOT/server" >/dev/null
  bash "$REPO_ROOT/scripts/ops/restore-world.sh" "$dst" "$DATA_DIR/export-$label-$n" --server "$SERVER_URL" >/dev/null 2>&1
  t3=$(date +%s.%N)
  local verified=fail
  bash "$REPO_ROOT/scripts/ops/export-world.sh" "$dst" "$DATA_DIR/export-$label-$n-verify" --server "$SERVER_URL" >/dev/null 2>&1
  bash "$REPO_ROOT/scripts/ops/verify-world.sh" "$DATA_DIR/export-$label-$n" "$DATA_DIR/export-$label-$n-verify" >/dev/null 2>&1 && verified=ok
  local export_bytes
  export_bytes="$(du -sb "$DATA_DIR/export-$label-$n" 2>/dev/null | awk '{print $1}' || echo unknown)"
  local seed_s export_s restore_s
  seed_s=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.1f", b-a}')
  export_s=$(awk -v a="$t1" -v b="$t2" 'BEGIN{printf "%.1f", b-a}')
  restore_s=$(awk -v a="$t2" -v b="$t3" 'BEGIN{printf "%.1f", b-a}')
  echo "$label,$n,$seed_s,$export_s,$restore_s,$export_bytes,$verified" | tee -a "$DATA_DIR/results.csv" >&2
  [ "$verified" = "ok" ] || { echo "run-backup-perf: FAIL -- '$label' leg at $n rows did not verify byte-for-byte after restore" >&2; exit 1; }
}

no_gap() { :; } # seed_bulk alone already leaves ids 1..n contiguous

echo "scenario,size,seed_s,export_s,restore_s,export_bytes,verified" > "$DATA_DIR/results.csv"
for n in "${SIZES[@]}"; do
  run_leg dense "$n" no_gap
done
run_leg gappy "$GAPPY_N" make_gappy

echo "run-backup-perf: results in $DATA_DIR/results.csv" >&2
cat "$DATA_DIR/results.csv"
