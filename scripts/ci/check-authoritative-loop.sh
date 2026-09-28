#!/usr/bin/env bash
# Story 4.2: proves, against a real disposable local SpacetimeDB instance
# (own port, 3991 -- 3987/3988/3989 are check-live-migration.sh/
# check-backup-restore.sh/check-view-live-refresh.sh's own, 3990 the 1.3
# timing spike's), that the authoritative loop this story ships actually
# fires, with zero clients connected, survives a rebuild, and cannot be
# invoked directly. Same fail-loud discipline as the other live-instance
# checks: every failure path aborts loudly and immediately, never folded
# into a pass/fail count.
#
# Legs, in order (Quentin's direction):
#   (a) Zero clients (AC1, FR3, NFR3): publish the real module, subscribe
#       to nothing, wait a fixed window, then read cadence_liveness and
#       maintenance_schedule through `spacetime sql` alone. Fire count is
#       floor-asserted within one of window/period on both sides; the
#       schedule table holds exactly one pending row.
#   (b) Drift (AC5): a second window, polled periodically (never held
#       open as a subscription -- the durable row is the oracle, per
#       Quentin's own "lateness is a query, not an anecdote"). Every
#       observed fire's drift (fired - target) must clear the 2.5s
#       per-fire budget; the last observed fire's drift minus the first's
#       must be at most twice the worst single-fire drift in the run
#       (the non-compounding half).
#   (c) Clean abort, no partial write (AC3): calls `run_maintenance`
#       directly, as the CLI's own logged-in (owner) identity -- NOT
#       `--anonymous`: SpacetimeDB 2.9 refuses an anonymous caller's HTTP
#       call to a *scheduled* reducer at the routing layer itself ("No
#       such procedure", confirmed empirically against a real instance
#       during this story), before `require_scheduler` ever runs, so an
#       anonymous call would prove the platform's own routing, not this
#       module's guard. The owner identity is not `ctx.database_identity()`
#       either, so it reaches `require_scheduler` and is rejected by it --
#       the first time that guard is exercised against a running module.
#       Both tables' own meaningful columns must be unchanged before and
#       after (retried against the live cadence's own background fires,
#       never a raw diff of the whole SQL response -- see below).
#   (d) Rebuild is idempotent: republish the unchanged module, then call
#       `rearm_schedules` twice as owner. After the republish and after
#       each call: still exactly one pending row, and its target still
#       phase-aligned to the original anchor (the phase is preserved).
set -uo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$REPO_ROOT/scripts/ci/lib/spacetime-instance.sh"
. "$REPO_ROOT/scripts/ops/lib.sh"

DATA_DIR="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-authoritative-loop.XXXXXX")"
PORT=3991
SERVER_URL="http://127.0.0.1:$PORT"
SERVER_ARGS=(--server "$SERVER_URL")
DB_NAME=bc-authoritative-loop
START_LOG="$DATA_DIR/start.log"
HEALTH_DEADLINE_S=30

# Ten city minutes at REAL_MS_PER_CITY_MINUTE=2500ms
# (sim::cadence::MAINTENANCE_PERIOD_MS) -- pinned here as a plain constant
# rather than read from the module, so a change to either drifts this
# script's own assertions loudly (a wrong window/period ratio) rather
# than silently.
PERIOD_S=25
MAINTENANCE_CADENCE=1

START_PID=""
cleanup() {
  if [ -n "${BC_KEEP_DATA_DIR:-}" ]; then
    echo "check-authoritative-loop: BC_KEEP_DATA_DIR set -- leaving $DATA_DIR and the instance on $SERVER_URL running" >&2
    return
  fi
  [ -n "$START_PID" ] && kill "$START_PID" 2>/dev/null
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

fail() { # <message> [log-file]
  echo "check-authoritative-loop: FAIL -- $1" >&2
  [ -n "${2:-}" ] && [ -f "$2" ] && cat "$2" >&2
  exit 1
}
ok() { echo "check-authoritative-loop: ok -- $1" >&2; }

START_PID="$(bc_start_spacetime "$DATA_DIR/data" "$PORT" "$START_LOG")"
bc_wait_spacetime_healthy "$SERVER_URL" "$HEALTH_DEADLINE_S" \
  || fail "SpacetimeDB did not become healthy within ${HEALTH_DEADLINE_S}s" "$START_LOG"

publish() { # <log-file>
  spacetime publish --server "$SERVER_URL" --no-config -y "$DB_NAME" --module-path "$REPO_ROOT/server" >"$1" 2>&1
}
sql_json() { # <query> -- prints the response JSON on stdout
  bc_sql_json "check-authoritative-loop" "$DB_NAME" "${SERVER_ARGS[@]}" "$1"
}
column_field() { # <resp.json> <column> -- the first row's own value for
                 # <column>, whichever table <resp.json> queried.
  bc_wb column-values "$1" "$2" 2>/dev/null | head -n1
}
micros_of() { # <a Timestamp field, "[1234]", or a ScheduleAt::Time field,
              # "[1,[1234]]" (SATS tags a sum value as [variant_index,
              # payload] -- 1 is "Time"'s own index in scheduled_at's
              # schema; confirmed empirically against a real instance
              # while writing this check) -- the bare micros integer
              # either way: the *last* digit run, never the first (which
              # would be the variant tag for a ScheduleAt::Time value).
  printf '%s' "$1" | grep -oE '[0-9]+' | tail -n1
}

echo "check-authoritative-loop: publishing the real module" >&2
publish "$DATA_DIR/publish.log" || fail "could not publish the real module" "$DATA_DIR/publish.log"

# --- (a) zero clients: no subscriber, a fixed wait, then one query -----------
# 60s (Tim's own deadline for this leg): comfortably more than one period
# (25s) even under a slow/contended runner, since the module has to
# actually build and publish before the sleep below even starts.
WINDOW_A_S=60
echo "check-authoritative-loop: (a) waiting ${WINDOW_A_S}s with zero clients connected" >&2
sleep "$WINDOW_A_S"

RESP_A="$DATA_DIR/cadence-a.json"
sql_json "SELECT * FROM cadence_liveness WHERE cadence = $MAINTENANCE_CADENCE" >"$RESP_A"
FIRES_A="$(column_field "$RESP_A" fires)"
[ -n "$FIRES_A" ] || fail "cadence_liveness has no row for cadence $MAINTENANCE_CADENCE after ${WINDOW_A_S}s with zero clients -- the loop never fired (AC1, NFR3)" "$RESP_A"
MISSED_A="$(column_field "$RESP_A" missed)"

# floor-asserted, within one of window/period on both sides (Quentin's
# direction): a stalled scheduler (0 fires) or a double-speed one must
# both read as FAIL, never as "an empty table happened to look fine".
EXPECTED_A=$((WINDOW_A_S / PERIOD_S))
[ "$EXPECTED_A" -ge 1 ] || EXPECTED_A=1
LOWER_A=$((EXPECTED_A - 1))
[ "$LOWER_A" -ge 1 ] || LOWER_A=1
UPPER_A=$((EXPECTED_A + 1))
[ "$FIRES_A" -ge "$LOWER_A" ] && [ "$FIRES_A" -le "$UPPER_A" ] \
  || fail "cadence_liveness.fires is $FIRES_A after ${WINDOW_A_S}s with zero clients, expected within one of $EXPECTED_A (window/period, ${WINDOW_A_S}s/${PERIOD_S}s) -- a stalled or double-speed scheduler" "$RESP_A"
[ "$MISSED_A" = "0" ] \
  || fail "cadence_liveness.missed is $MISSED_A after ${WINDOW_A_S}s idle, expected 0 -- a missed target with zero clients and no pause means the loop itself is unsound" "$RESP_A"
ok "cadence_liveness.fires=$FIRES_A (expected within one of $EXPECTED_A), missed=0, with zero clients connected"

RESP_SCHED_A="$DATA_DIR/sched-a.json"
sql_json "SELECT * FROM maintenance_schedule" >"$RESP_SCHED_A"
PENDING_A="$(bc_wb row-count "$RESP_SCHED_A")"
[ "$PENDING_A" = "1" ] \
  || fail "maintenance_schedule holds $PENDING_A pending row(s), expected exactly 1 -- 0 is a dead world, 2+ is a double-armed one" "$RESP_SCHED_A"
ok "maintenance_schedule holds exactly one pending row"

# --- (b) drift: poll periodically, never a held-open subscription ------------
WINDOW_B_S=65
POLL_INTERVAL_S=3
echo "check-authoritative-loop: (b) polling cadence_liveness for ${WINDOW_B_S}s to observe per-fire drift" >&2
declare -a DRIFTS_MS=()
LAST_FIRES="$FIRES_A"
deadline=$((SECONDS + WINDOW_B_S))
while [ "$SECONDS" -lt "$deadline" ]; do
  sleep "$POLL_INTERVAL_S"
  resp="$DATA_DIR/cadence-poll-$SECONDS.json"
  sql_json "SELECT * FROM cadence_liveness WHERE cadence = $MAINTENANCE_CADENCE" >"$resp"
  fires="$(column_field "$resp" fires)"
  [ -n "$fires" ] || continue
  if [ "$fires" -gt "$LAST_FIRES" ]; then
    target_bracketed="$(column_field "$resp" last_target_at)"
    fired_bracketed="$(column_field "$resp" last_fired_at)"
    target_us="$(micros_of "$target_bracketed")"
    fired_us="$(micros_of "$fired_bracketed")"
    drift_ms=$(( (fired_us - target_us) / 1000 ))
    DRIFTS_MS+=("$drift_ms")
    [ "$drift_ms" -le 2500 ] \
      || fail "a single fire's drift was ${drift_ms}ms, over the 2.5s per-fire budget (docs/architecture.md's Scheduled reducers section)" "$resp"
    LAST_FIRES="$fires"
  fi
done

N="${#DRIFTS_MS[@]}"
[ "$N" -ge 2 ] \
  || fail "observed only $N fire(s) in ${WINDOW_B_S}s at a ${PERIOD_S}s period -- too few to assert non-compounding; the loop may have stalled"
MAX_DRIFT=0
for d in "${DRIFTS_MS[@]}"; do
  [ "$d" -gt "$MAX_DRIFT" ] && MAX_DRIFT="$d"
done
FIRST_DRIFT="${DRIFTS_MS[0]}"
LAST_DRIFT="${DRIFTS_MS[$((N - 1))]}"
DELTA=$((LAST_DRIFT - FIRST_DRIFT))
NEG_DELTA=$((-DELTA))
[ "$DELTA" -ge "$NEG_DELTA" ] || DELTA="$NEG_DELTA" # abs()
BOUND=$((2 * MAX_DRIFT))
[ "$BOUND" -ge 1 ] || BOUND=1 # a run with 0ms drift throughout still allows 0 delta, never a negative bound
[ "$DELTA" -le "$BOUND" ] \
  || fail "cumulative slip: first fire drifted ${FIRST_DRIFT}ms, last drifted ${LAST_DRIFT}ms (delta ${DELTA}ms) -- over twice the worst single-fire drift (${MAX_DRIFT}ms) observed in this run, which reads as compounding"

# median/p95/max, printed for visibility (Quentin's direction) -- never a
# hand reduction: sorted once, indexed.
SORTED_DRIFTS=($(printf '%s\n' "${DRIFTS_MS[@]}" | sort -n))
MEDIAN_IDX=$((N / 2))
MEDIAN="${SORTED_DRIFTS[$MEDIAN_IDX]}"
P95_IDX=$(( (N * 95) / 100 ))
[ "$P95_IDX" -lt "$N" ] || P95_IDX=$((N - 1))
P95="${SORTED_DRIFTS[$P95_IDX]}"
MAXV="${SORTED_DRIFTS[$((N - 1))]}"
ok "drift over $N observed fire(s): median ${MEDIAN}ms, p95 ${P95}ms, max ${MAXV}ms (budget 2500ms); cumulative slip ${DELTA}ms (bound ${BOUND}ms, twice the worst single-fire drift)"

# --- (c) clean abort, no partial write ---------------------------------------
echo "check-authoritative-loop: (c) calling run_maintenance directly -- must be rejected" >&2
REJECTION_PATTERN="this reducer may only be invoked by the scheduler"
# Retried, not a single before/after pair (Quentin's own "pair proven
# transactional" claim is about *this rejected call*, never about the
# live cadence pausing for the test): the real scheduler keeps firing
# every ${PERIOD_S}s in the background throughout this whole script, so a
# legitimate fire can land in the narrow gap between the "before" and
# "after" snapshot by sheer bad luck -- confirmed empirically while
# writing this check. Retrying until a clean (no legitimate fire
# interleaved) attempt is observed is the standard fix for exactly this
# shape of race, not a weaker assertion: every attempt still proves the
# *rejected call itself* changed nothing, the loop only discards an
# attempt a *different*, legitimate write landed inside.
CLEAN_ATTEMPT=0
for attempt in 1 2 3 4 5; do
  BEFORE_LIVENESS="$DATA_DIR/before-liveness-$attempt.json"
  BEFORE_SCHED="$DATA_DIR/before-sched-$attempt.json"
  sql_json "SELECT * FROM cadence_liveness" >"$BEFORE_LIVENESS"
  sql_json "SELECT * FROM maintenance_schedule" >"$BEFORE_SCHED"
  BEFORE_FIRES="$(column_field "$BEFORE_LIVENESS" fires)"

  DIRECT_CALL_LOG="$DATA_DIR/direct-call-$attempt.log"
  # Not --anonymous (see this file's own header): the CLI's logged-in
  # identity is the module owner, itself not the scheduler
  # (ctx.database_identity()), so this reaches require_scheduler.
  if spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y run_maintenance '[999999,{"Time":[0]}]' >"$DIRECT_CALL_LOG" 2>&1; then
    fail "run_maintenance accepted a direct call; it must be rejected (require_scheduler)" "$DIRECT_CALL_LOG"
  fi
  grep -qF "$REJECTION_PATTERN" "$DIRECT_CALL_LOG" \
    || fail "run_maintenance rejected the direct call, but not with require_scheduler's own message -- expected to find '$REJECTION_PATTERN'" "$DIRECT_CALL_LOG"

  AFTER_LIVENESS="$DATA_DIR/after-liveness-$attempt.json"
  AFTER_SCHED="$DATA_DIR/after-sched-$attempt.json"
  sql_json "SELECT * FROM cadence_liveness" >"$AFTER_LIVENESS"
  sql_json "SELECT * FROM maintenance_schedule" >"$AFTER_SCHED"
  AFTER_FIRES="$(column_field "$AFTER_LIVENESS" fires)"

  if [ "$BEFORE_FIRES" != "$AFTER_FIRES" ]; then
    echo "check-authoritative-loop: (c) attempt $attempt: the live cadence fired between the before/after snapshot ($BEFORE_FIRES -> $AFTER_FIRES fires) -- retrying" >&2
    continue
  fi
  # Compared by extracted column values, never a raw diff of the whole
  # SQL response file: `total_duration_micros` (and `stats`) are per-query
  # metadata that legitimately differs between any two calls, identical
  # table content included -- a raw `diff` here would fail on every
  # attempt, always, confirmed empirically while writing this check.
  liveness_sig() { # <resp.json>
    printf '%s|%s|%s|%s' \
      "$(column_field "$1" last_target_at)" "$(column_field "$1" last_fired_at)" \
      "$(column_field "$1" fires)" "$(column_field "$1" missed)"
  }
  sched_sig() { # <resp.json>
    printf '%s|%s' "$(bc_wb row-count "$1")" "$(column_field "$1" scheduled_at)"
  }
  BEFORE_LIVENESS_SIG="$(liveness_sig "$BEFORE_LIVENESS")"
  AFTER_LIVENESS_SIG="$(liveness_sig "$AFTER_LIVENESS")"
  BEFORE_SCHED_SIG="$(sched_sig "$BEFORE_SCHED")"
  AFTER_SCHED_SIG="$(sched_sig "$AFTER_SCHED")"
  [ "$BEFORE_LIVENESS_SIG" = "$AFTER_LIVENESS_SIG" ] \
    || fail "cadence_liveness changed across a rejected direct call with no legitimate fire in between ($BEFORE_LIVENESS_SIG -> $AFTER_LIVENESS_SIG) -- a rejected call must not touch data" "$AFTER_LIVENESS"
  [ "$BEFORE_SCHED_SIG" = "$AFTER_SCHED_SIG" ] \
    || fail "maintenance_schedule changed across a rejected direct call with no legitimate fire in between ($BEFORE_SCHED_SIG -> $AFTER_SCHED_SIG) -- a rejected call must not touch data" "$AFTER_SCHED"
  CLEAN_ATTEMPT="$attempt"
  break
done
[ "$CLEAN_ATTEMPT" -gt 0 ] \
  || fail "could not observe a clean (no legitimate fire interleaved) direct-call attempt in 5 tries"
ok "a direct call to run_maintenance was rejected by require_scheduler, and neither table changed (attempt $CLEAN_ATTEMPT)"

# --- (d) rebuild is idempotent ------------------------------------------------
echo "check-authoritative-loop: (d) republishing the unchanged module, then rearm_schedules twice" >&2
# Phase-aligned, never byte-identical (Quentin's own wording: "the next
# target is still congruent to the original anchor"): the live cadence
# keeps firing every ${PERIOD_S}s throughout this whole script, so a
# legitimate fire landing between two checks below can legitimately
# advance the pending target by a whole number of periods -- congruence
# mod the period is what actually must hold, and holds whether zero or
# several such fires happened in between.
PERIOD_MICROS=$((PERIOD_S * 1000 * 1000))
target_before_republish_us="$(micros_of "$(column_field "$AFTER_SCHED" scheduled_at)")"

REPUBLISH_LOG="$DATA_DIR/republish.log"
publish "$REPUBLISH_LOG" || fail "could not republish the unchanged module" "$REPUBLISH_LOG"

assert_still_one_pending_phase_aligned() { # <label>
  local label="$1" resp
  resp="$DATA_DIR/sched-$label.json"
  sql_json "SELECT * FROM maintenance_schedule" >"$resp"
  local pending
  pending="$(bc_wb row-count "$resp")"
  [ "$pending" = "1" ] || fail "$label: maintenance_schedule holds $pending pending row(s), expected exactly 1" "$resp"
  local target target_us delta
  target="$(column_field "$resp" scheduled_at)"
  target_us="$(micros_of "$target")"
  delta=$(( (target_us - target_before_republish_us) % PERIOD_MICROS ))
  [ "$delta" -eq 0 ] \
    || fail "$label: maintenance_schedule's pending target is not phase-aligned to the original anchor (delta ${delta}us, period ${PERIOD_MICROS}us) -- the rebuild must preserve phase" "$resp"
  ok "$label: still exactly one pending row, phase-aligned to the original anchor (target=$target)"
}

assert_still_one_pending_phase_aligned "after republish"

REARM_LOG_1="$DATA_DIR/rearm-1.log"
spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y rearm_schedules >"$REARM_LOG_1" 2>&1 \
  || fail "rearm_schedules (call 1) failed as owner" "$REARM_LOG_1"
assert_still_one_pending_phase_aligned "after rearm_schedules call 1"

REARM_LOG_2="$DATA_DIR/rearm-2.log"
spacetime call "$DB_NAME" "${SERVER_ARGS[@]}" --no-config -y rearm_schedules >"$REARM_LOG_2" 2>&1 \
  || fail "rearm_schedules (call 2) failed as owner" "$REARM_LOG_2"
assert_still_one_pending_phase_aligned "after rearm_schedules call 2"

echo "check-authoritative-loop: the authoritative loop fires with zero clients, holds its per-fire and non-compounding drift budget, rejects a direct call cleanly, and rebuilds idempotently" >&2
exit 0
