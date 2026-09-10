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
# Pinned "now", 48h before the weekly reset: far outside the endgame window,
# so every case that is not about the endgame reads the plain 0.80 cap. It is
# pinned rather than left to the wall clock because the lift is a question
# about the distance to the reset, and an unpinned clock makes half this file
# answer differently depending on the day it runs.
NOW_MIDWEEK=1788339600
# ...and 6h before it, inside the default 12h window.
NOW_ENDGAME=1788490800

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
  env BC_FAKE="$d" BC_NOW="$NOW_MIDWEEK" "$@" bash "$BUDGET" check
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
# allowed_warning is what the account reads from the moment weekly crosses
# 7d-surpassed-threshold (0.75) -- most of a normal week, once the team is
# working. It means approaching, not stopped, and reading it as a stop parked
# the team until the week turned over with neither cap ever reached.
check_out "allowed_warning is still budget" 0 \
  "available session=0.01 weekly=0.76 caps=0.85/0.80" \
  gate "$(rate allowed_warning 0.01 0.76)"
# ...and the caps still apply above it. The warning does not open the gate,
# it just stops it closing early.
check_out "allowed_warning over the weekly cap is spent on the cap" 1 \
  "spent weekly=0.81 cap=0.80 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.81)"

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
# The account can be cut off while both utilisations still read below their
# caps. The reset named is the weekly one: the account-level status follows
# the seven-day claim, and the 5-hour reset would promise the team back this
# evening for a stop that lasts until the week turns over.
check_out "overallStatus rejected beats both utilisations" 1 \
  "spent status=rejected session=0.10 weekly=0.10 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate rejected 0.10 0.10)"
check_out "a blocked account is a stop too" 1 \
  "spent status=blocked session=0.10 weekly=0.10 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate blocked 0.10 0.10)"
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
echo "the endgame -- the last hours of the week, where the weekly cap lifts"
# Budget still unspent when the seven-day window rolls over is budget nobody
# ever gets. Inside 12h of the weekly reset the team may run to the real
# limit instead of stopping at 0.80.
check_out "inside the window the weekly cap is lifted" 0 \
  "available session=0.10 weekly=0.92 caps=0.85/1.00 endgame=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.92)" BC_NOW="$NOW_ENDGAME"
# 12h01m out is still the middle of the week: the same utilisation is a skip.
check_out "just outside the window it is the ordinary cap" 1 \
  "spent weekly=0.92 cap=0.80 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.92)" BC_NOW="$((WEEKLY_RESET - 43260))"
check_out "one second inside the window lifts it" 0 \
  "available session=0.10 weekly=0.92 caps=0.85/1.00 endgame=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.92)" BC_NOW="$((WEEKLY_RESET - 43199))"
# The lift is not a licence to overspend: 1.00 is the real limit, and the
# team stops there like it stops anywhere else.
check_out "a genuinely exhausted week still stops inside the window" 1 \
  "spent weekly=1 cap=1.00 resumes=2026-09-04T09:00:00Z endgame=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 1)" BC_NOW="$NOW_ENDGAME"
# ...and neither does it touch the 5-hour window, which resets several times
# a day and has nothing to leave behind.
check_out "the session cap is untouched by the endgame" 1 \
  "spent session=0.90 cap=0.85 resumes=2026-08-30T21:00:00Z" \
  gate "$(rate allowed 0.90 0.92)" BC_NOW="$NOW_ENDGAME"
# A rejection is still a rejection. The lift moves a cap Adrian set; it
# cannot spend quota Anthropic has already refused.
check_out "a rejected account is not rescued by the endgame" 1 \
  "spent status=rejected session=0.10 weekly=0.92 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate rejected 0.10 0.92)" BC_NOW="$NOW_ENDGAME"
check_out "the window is overridable" 0 \
  "available session=0.10 weekly=0.92 caps=0.85/1.00 endgame=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.92)" BC_NOW="$NOW_MIDWEEK" BC_WEEKLY_ENDGAME_HOURS=72
check_out "zero hours turns the lift off entirely" 1 \
  "spent weekly=0.92 cap=0.80 resumes=2026-09-04T09:00:00Z" \
  gate "$(rate allowed_warning 0.10 0.92)" BC_NOW="$NOW_ENDGAME" BC_WEEKLY_ENDGAME_HOURS=0
# A reset the monitor did not give us must not read as "the week is nearly
# over, spend it all" -- an absent field is the one case where guessing wrong
# empties the account.
check_out "a missing weekly reset never opens the lift" 1 \
  "spent weekly=0.92 cap=0.80 resumes=unknown" \
  gate '{"overallStatus":"allowed","session":{"utilization":0.1},"weekly":{"utilization":0.92}}' \
    BC_NOW="$NOW_ENDGAME"

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
