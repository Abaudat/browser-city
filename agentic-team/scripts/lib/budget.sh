#!/usr/bin/env bash
# LEVEL 1 -- the one `claude-rate-monitor` call, plus pure parsing of what it
# answers. Wraps `claude-rate-monitor --json`, which surfaces Anthropic's
# anthropic-ratelimit-unified-* headers. The one rule, as everywhere in lib/:
# one external call, fake-aware, and nothing here decides anything -- the
# caps are applied by bc-budget.sh.
#
# The tool is resolved here rather than in bc_init because it is the gate's
# alone. Every other script sources config.sh and must keep working while the
# monitor is missing; the gate must not, and says so as exit 2.

_BC_BUDGET_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_BUDGET_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_BUDGET_LIB_DIR/fake.sh"

# rate_monitor_json -> the monitor's raw JSON on stdout.
#   0  answered
#   1  no answer (tool missing, or it failed) -- the message is on stderr
# Under BC_FAKE this replays $BC_FAKE/rate_monitor.json. A fake dir with no
# such fixture returns 1, exactly like a missing tool: the gate is never
# silently open just because a test forgot to say what the budget was.
rate_monitor_json() {
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read rate_monitor; return; }
  local monitor out
  monitor="${BC_RATE_MONITOR:-$(resolve_rate_monitor || true)}"
  if [ -z "$monitor" ] || ! _bc_is_executable "$monitor"; then
    echo "rate_monitor_json: claude-rate-monitor not found (looked under %APPDATA%/npm and PATH)" >&2
    return 1
  fi
  # stderr is folded into $out deliberately: when the monitor fails, what it
  # printed is the only diagnosis available, and it goes into the reason line
  # rather than to a terminal nobody is watching.
  out="$("$monitor" --json 2>&1)" || {
    echo "rate_monitor_json: claude-rate-monitor failed: $out" >&2
    return 1
  }
  printf '%s' "$out"
}

# rate_parse -- JSON on stdin -> five tab-separated fields on stdout:
#   overallStatus  session.utilization  weekly.utilization  session.reset  weekly.reset
# Returns 1 if the input does not parse at all. One parse in one place, so a
# response that changes shape is caught here rather than as four separate
# empty strings downstream. `// "MISSING"` rather than `// ""` because jq
# treats 0 as falsy for `//`, and a genuine 0.00 utilisation -- the state the
# gate sees every Monday morning -- must not read as an absent field.
rate_parse() {
  "$JQ" -r '
    [ (.overallStatus       // "MISSING"),
      (.session.utilization // "MISSING"),
      (.weekly.utilization  // "MISSING"),
      (.session.reset       // "MISSING"),
      (.weekly.reset        // "MISSING") ] | @tsv' 2>/dev/null
}

# rate_is_number <value> -- exit 0 if jq can read it as a number. Guards the
# comparison below: `[ "lots" -ge 0.85 ]` is not an error in bash, it is a
# different answer, and the gate would open on it.
rate_is_number() {
  "$JQ" -n --arg v "$1" -e 'try ($v | tonumber | type == "number") catch false' >/dev/null 2>&1
}

# rate_at_or_over <utilisation> <cap> -- exit 0 when utilisation >= cap.
# Done in jq because these are decimals and bash has no float comparison.
rate_at_or_over() {
  "$JQ" -n --argjson u "$1" --argjson c "$2" -e '$u >= $c' >/dev/null 2>&1
}

# rate_reset_at <epoch> -- the reset as a readable UTC stamp, or "unknown".
# Exhaustion is a hard stop rather than an overage charge, so the reason line
# has to say when the team comes back: "resumes=19:00" reads as healthy,
# where a bare "budget spent" reads the same as "stuck since Tuesday".
rate_reset_at() {
  case "${1:-}" in
    ''|*[!0-9]*) printf 'unknown' ;;
    *)           date -u -d "@$1" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || printf '%s' "$1" ;;
  esac
}
