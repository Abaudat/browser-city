#!/usr/bin/env bash
# LEVEL 2 -- the budget gate (budget-available in
# agentic-team/high-level-agentic-flow.mmd). Composes lib/budget.sh only.
#
# Three outcomes, and keeping them apart is the whole point of the file. A
# spent budget and a broken gate both stop the team, and if they exit the
# same way the team stopping for a week looks exactly like the team behaving
# correctly:
#
#   0  there is budget -- the wake may go on to do real work
#   1  the budget is spent. Normal, expected, quiet, and it says when it is back.
#   2  the gate itself is broken. NOT the same thing, and it must be alarmed on.
#
# Every exit prints one line on stdout saying which and why, in the same
# shape the orchestrator's wake reason uses, so whatever reads it -- the
# orchestrator, a watchdog, a human -- never has to infer the cause from a
# bare exit code.
set -u
_BC_BUDGET_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_BUDGET_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/budget.sh
. "$_BC_BUDGET_DIR/lib/budget.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-budget.sh <command>
  check  -- exit 0 budget available, 1 budget spent, 2 gate broken;
            one line on stdout either way
EOF
}

broken() { printf 'broken %s\n' "$*"; exit 2; }

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in

check)
  json="$(rate_monitor_json 2>&1)" || broken "${json:-claude-rate-monitor unavailable}"

  parsed="$(printf '%s' "$json" | rate_parse)" || broken "unparseable rate monitor response: $json"
  [ -n "$parsed" ] || broken "unparseable rate monitor response: $json"

  IFS="$(printf '\t')" read -r status session weekly session_reset weekly_reset <<< "$parsed"

  for field in "$status" "$session" "$weekly"; do
    case "$field" in
      ''|MISSING) broken "rate monitor response missing status or utilisation: $json" ;;
    esac
  done
  rate_is_number "$session" || broken "session utilisation is not a number: $session"
  rate_is_number "$weekly"  || broken "weekly utilisation is not a number: $weekly"

  # overallStatus first: the account can be cut off while both utilisations
  # still read below their caps, and that is a stop, not a rounding question.
  if [ "$status" != "allowed" ]; then
    printf 'spent status=%s session=%s weekly=%s resumes=%s\n' \
      "$status" "$session" "$weekly" "$(rate_reset_at "$session_reset")"
    exit 1
  fi

  if rate_at_or_over "$session" "$BC_SESSION_CAP"; then
    printf 'spent session=%s cap=%s resumes=%s\n' \
      "$session" "$BC_SESSION_CAP" "$(rate_reset_at "$session_reset")"
    exit 1
  fi

  if rate_at_or_over "$weekly" "$BC_WEEKLY_CAP"; then
    printf 'spent weekly=%s cap=%s resumes=%s\n' \
      "$weekly" "$BC_WEEKLY_CAP" "$(rate_reset_at "$weekly_reset")"
    exit 1
  fi

  printf 'available session=%s weekly=%s caps=%s/%s\n' \
    "$session" "$weekly" "$BC_SESSION_CAP" "$BC_WEEKLY_CAP"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
