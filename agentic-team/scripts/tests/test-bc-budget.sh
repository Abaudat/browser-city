#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-budget.sh.
#
# The three exits are the point of this script, and two of them are
# indistinguishable from the outside: a spent budget and a broken gate both
# stop the team dead. So every case below asserts the printed line as well as
# the exit code -- the line is what a watchdog, or Adrian, actually reads.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BUDGET="$SCRIPTS_DIR/bc-budget.sh"
. "$TEST_DIR/harness.sh"

F="$(fake_dir)"

# Reset epochs: session 2026-08-30T21:00:00Z, weekly 2026-09-04T09:00:00Z.
SESSION_RESET=1788123600
WEEKLY_RESET=1788512400

rate() { # <overallStatus> <session util> <weekly util> -- the monitor's real shape
  printf '{"overallStatus":"%s","session":{"utilization":%s,"reset":"%s","status":"%s"},"weekly":{"utilization":%s,"reset":"%s","status":"%s"},"overageStatus":"rejected"}\n' \
    "$1" "$2" "$SESSION_RESET" "$1" "$3" "$WEEKLY_RESET" "$1"
}

# gate <fixture-json> [env assignments...] -- one `check` against that fixture.
# Each case gets its own fake dir so the fixture is unambiguous.
gate() {
  local json="$1"; shift
  local d; d="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-budget.XXXXXX")"
  printf '%s' "$json" > "$d/rate_monitor.json"
  env BC_FAKE="$d" "$@" bash "$BUDGET" check
}

# gate_nofixture -- a fake dir with no rate_monitor.json at all: the monitor
# could not answer.
gate_nofixture() {
  local d; d="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-budget.XXXXXX")"
  env BC_FAKE="$d" bash "$BUDGET" check
}

echo "exit 0 -- there is budget, and the line says how much"
check_out "well under both caps" 0 \
  "available session=0.23 weekly=0.38 caps=0.85/0.80" \
  gate "$(rate allowed 0.23 0.38)"
# jq's `//` treats 0 as falsy, so a real zero is the case a `// ""` default
# silently turns into "MISSING" -- Monday morning read as a broken gate.
check_out "a genuine zero is not a missing field" 0 \
  "available session=0 weekly=0 caps=0.85/0.80" \
  gate "$(rate allowed 0 0)"
check_out "just under both caps" 0 \
  "available session=0.84 weekly=0.79 caps=0.85/0.80" \
  gate "$(rate allowed 0.84 0.79)"

echo
echo "exit 1 -- the budget is spent: quiet, and it says when the team is back"
check_out "session at the cap is already spent" 1 \
  "spent session=0.85 cap=0.85 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate allowed 0.85 0.10)"
check_out "session over the cap" 1 \
  "spent session=0.92 cap=0.85 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate allowed 0.92 0.10)"
# The weekly skip must name the weekly reset, not the 5-hour one: they are
# days apart, and the wrong one tells Adrian the team is back this evening.
check_out "weekly at the cap names the weekly reset" 1 \
  "spent weekly=0.80 cap=0.80 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate allowed 0.10 0.80)"
check_out "overallStatus not allowed beats both utilisations" 1 \
  "spent status=rejected session=0.10 weekly=0.10 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate rejected 0.10 0.10)"
# Adrian's own sessions spend the same account-wide budget. Nothing here
# distinguishes his usage from the team's, and that is the mechanism: high
# utilisation the team did not cause still stops the team.
check_out "utilisation the team did not cause still stops it" 1 \
  "spent session=0.90 cap=0.85 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate allowed 0.90 0.05)"
check_out "the caps are overridable" 1 \
  "spent session=0.23 cap=0.20 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate allowed 0.23 0.38)" BC_SESSION_CAP=0.20
check_out "a missing reset says unknown rather than lying" 1 \
  "spent session=0.90 cap=0.85 resumes=unknown" \
  gate '{"overallStatus":"allowed","session":{"utilization":0.90},"weekly":{"utilization":0.1}}'

echo
echo "exit 2 -- the gate is broken, which is NOT a spent budget"
check_out "no answer from the monitor at all" 2 \
  "broken claude-rate-monitor unavailable" \
  gate_nofixture
# The real resolution path, unfaked: BC_RATE_MONITOR pointed at nothing that
# exists. The line has to name the tool -- "the gate is broken" with no cause
# is a fortnight of guessing.
check_out "a monitor that is not installed names itself" 2 \
  "broken rate_monitor_json: claude-rate-monitor not found (looked under %APPDATA%/npm and PATH)" \
  env BC_RATE_MONITOR="$TEST_DIR/no-such-rate-monitor" bash "$BUDGET" check
check "an unparseable response" 2 gate 'not json at all'
check "a response missing the utilisations" 2 \
  gate '{"overallStatus":"allowed"}'
check "a response missing overallStatus" 2 \
  gate '{"session":{"utilization":0.1},"weekly":{"utilization":0.1}}'
# `[ "lots" -ge 0.85 ]` is not an error in bash, it is a different answer --
# and the answer it gives is "there is budget".
check "a utilisation that is not a number" 2 \
  gate '{"overallStatus":"allowed","session":{"utilization":"lots"},"weekly":{"utilization":0.1}}'
check "a weekly utilisation that is not a number" 2 \
  gate '{"overallStatus":"allowed","session":{"utilization":0.1},"weekly":{"utilization":"lots"}}'

echo
echo "the broken cases say which, rather than only that"
for bad in 'not json at all' '{"overallStatus":"allowed"}'; do
  out="$(gate "$bad" 2>/dev/null)"
  case "$out" in
    broken\ ?*) printf '  ok   %s\n' "broken line names a cause: ${out:0:48}"; pass=$((pass + 1)) ;;
    *)          printf '  FAIL broken line said nothing: %q\n' "$out"; fail=$((fail + 1)) ;;
  esac
done

echo
echo "usage"
check "no command is a usage error" 2 bash "$BUDGET"
check "an unknown command is a usage error" 2 bash "$BUDGET" nonsense

rm -rf "$F"
summary
