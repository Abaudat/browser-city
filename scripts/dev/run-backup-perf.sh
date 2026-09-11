#!/usr/bin/env bash
# Re-runnable export/restore throughput measurement (Quentin's direction,
# the same precedent as scripts/dev/run-sched-timing-spike.sh): seeds
# `placed_object` (no Timestamp column, so a plain SQL bulk insert seeds
# it fast) to each row count in $SIZES, then times export-world.sh and
# restore-world.sh against a disposable local instance. Never run as
# part of a PR check (Tim's <2-minute budget) -- a human, or
# backup.yml's dispatch/rehearsal path, runs this deliberately.
#
# Usage: scripts/dev/run-backup-perf.sh [size ...]
#   defaults to 20000 120000
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$#" -gt 0 ]; then
  SIZES=("$@")
else
  SIZES=(20000 120000)
fi

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
  local db="$1" n="$2" batch=1000 start
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

echo "size,seed_s,export_s,restore_s,export_bytes" > "$DATA_DIR/results.csv"
for n in "${SIZES[@]}"; do
  SRC="bc-perf-src-$n"
  DST="bc-perf-dst-$n"
  spacetime publish --server "$SERVER_URL" --no-config -y "$SRC" --module-path "$REPO_ROOT/server" >/dev/null
  t0=$(date +%s.%N)
  seed_bulk "$SRC" "$n"
  t1=$(date +%s.%N)
  bash "$REPO_ROOT/scripts/ops/export-world.sh" "$SRC" "$DATA_DIR/export-$n" --server "$SERVER_URL" >/dev/null 2>&1
  t2=$(date +%s.%N)
  spacetime publish --server "$SERVER_URL" --no-config -y "$DST" --module-path "$REPO_ROOT/server" >/dev/null
  bash "$REPO_ROOT/scripts/ops/restore-world.sh" "$DST" "$DATA_DIR/export-$n" --server "$SERVER_URL" >/dev/null 2>&1
  t3=$(date +%s.%N)
  export_bytes="$(du -sb "$DATA_DIR/export-$n" 2>/dev/null | awk '{print $1}' || echo unknown)"
  seed_s=$(awk -v a="$t0" -v b="$t1" 'BEGIN{printf "%.1f", b-a}')
  export_s=$(awk -v a="$t1" -v b="$t2" 'BEGIN{printf "%.1f", b-a}')
  restore_s=$(awk -v a="$t2" -v b="$t3" 'BEGIN{printf "%.1f", b-a}')
  echo "$n,$seed_s,$export_s,$restore_s,$export_bytes" | tee -a "$DATA_DIR/results.csv" >&2
done

echo "run-backup-perf: results in $DATA_DIR/results.csv" >&2
cat "$DATA_DIR/results.csv"
