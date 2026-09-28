#!/usr/bin/env bash
# Shared local-SpacetimeDB-instance bring-up for scripts/ci/'s live-
# instance checks (Tim's direction, story 4.2: one factoring, not a
# fourth copy) -- check-live-migration.sh, check-backup-restore.sh,
# check-view-live-refresh.sh and check-authoritative-loop.sh all source
# this rather than each starting/stopping their own instance by hand.
# Sourced, never executed directly.

# bc_start_spacetime <data-dir> <port> <log-file> -- starts a disposable
# local instance in the background; echoes its PID on stdout.
bc_start_spacetime() {
  local data_dir="$1" port="$2" log="$3"
  spacetime start --data-dir "$data_dir" --listen-addr "127.0.0.1:$port" >"$log" 2>&1 &
  echo $!
}

# bc_wait_spacetime_healthy <url> <deadline-s> -- polls <url>/v1/ping at a
# 1s interval; returns 0 once healthy, 1 if the deadline passes first.
bc_wait_spacetime_healthy() {
  local url="$1" deadline_s="$2"
  local deadline=$((SECONDS + deadline_s))
  while [ "$SECONDS" -lt "$deadline" ]; do
    curl -sf -o /dev/null "$url/v1/ping" && return 0
    sleep 1
  done
  return 1
}

# bc_stop_spacetime <pid> -- stops a disposable instance started by
# bc_start_spacetime; a no-op if <pid> is empty (the instance was never
# started, or was already stopped). Callers still own their own `trap
# ... EXIT` cleanup and data-dir removal -- this only ever stops the
# process.
bc_stop_spacetime() {
  local pid="$1"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null
  return 0
}
