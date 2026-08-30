#!/usr/bin/env bash
# Budget gate for Orca automation prechecks. See team-charter.md §8.
#
# Exit 0 -> budget available, the automation may dispatch.
# Exit 1 -> budget exhausted. Normal, expected, quiet.
# Exit 2 -> the gate itself is broken. NOT the same thing, and must be alarmed on.
#
# Every binary is invoked by absolute path: the precheck runs under cmd.exe with
# an environment that predates the tool installs, so PATH holds neither `jq` nor
# `claude-rate-monitor`. Those absolute paths are *derived*, not written down.
# A gate that names one user's home and one worktree stops working the first
# time either moves -- and it stops by exiting non-zero, which reads as an
# ordinary budget skip. Silence is the failure mode this whole file defends
# against, so the gate must not itself be a machine-specific hardcode.

set -o pipefail

# --- paths, derived rather than hardcoded ------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SESSION_CAP="${BC_SESSION_CAP:-0.85}"
WEEKLY_CAP="${BC_WEEKLY_CAP:-0.80}"

# A missing library must exit 2, not die mid-script: bash's own failure exit
# would be 1, and 1 is "budget spent, all is well" -- the exact confusion this
# gate exists to prevent. The reason path is recomputed inline here because
# bc_state_dir lives in the library that is missing.
if [ ! -r "$SCRIPT_DIR/lib/paths.sh" ]; then
  FALLBACK="${BC_QUOTA_REASON:-$HOME/.browsercity/quota-gate-reason}"
  mkdir -p "$(dirname "$FALLBACK")" 2>/dev/null
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') GATE-BROKEN lib/paths.sh missing beside $SCRIPT_DIR" > "$FALLBACK"
  echo "GATE-BROKEN lib/paths.sh missing beside $SCRIPT_DIR" >&2
  exit 2
fi
# shellcheck source=lib/paths.sh
. "$SCRIPT_DIR/lib/paths.sh"

REASON="${BC_QUOTA_REASON:-$(bc_state_dir)/quota-gate-reason}"

# The reason file is the only durable record; the run record's skipReason is
# null even on a precheck skip, so nothing else can say why a tick did nothing.
say() { echo "$(stamp) $*" > "$REASON"; }

fail_broken() {
  say "GATE-BROKEN $1"
  echo "GATE-BROKEN $1" >&2
  exit 2
}

JQ="${BC_JQ:-$(resolve_jq)}"
[ -n "$JQ" ] && [ -x "$JQ" ] \
  || fail_broken "jq not found (looked under %LOCALAPPDATA%/Microsoft/WinGet, chocolatey, /usr/bin, PATH)"

# --- the numbers -------------------------------------------------------------
if [ -n "${BC_RATE_JSON_FIXTURE:-}" ]; then
  JSON="$(cat "$BC_RATE_JSON_FIXTURE" 2>&1)" \
    || fail_broken "rate fixture unreadable: $BC_RATE_JSON_FIXTURE"
else
  RATE_MONITOR="${BC_RATE_MONITOR:-$(resolve_rate_monitor)}"
  [ -n "$RATE_MONITOR" ] && [ -x "$RATE_MONITOR" ] \
    || fail_broken "claude-rate-monitor not found (looked under %APPDATA%/npm and PATH)"
  JSON="$("$RATE_MONITOR" --json 2>&1)" || fail_broken "rate monitor failed: $JSON"
fi

# One parse, tab-separated, so a missing field is caught in one place. jq
# treats 0 as truthy, so a genuine zero utilisation survives the `//` default.
PARSED="$(printf '%s' "$JSON" | "$JQ" -r '
  [ (.overallStatus       // "MISSING"),
    (.session.utilization // "MISSING"),
    (.weekly.utilization  // "MISSING"),
    (.session.reset       // "MISSING"),
    (.weekly.reset        // "MISSING") ] | @tsv' 2>/dev/null)" \
  || fail_broken "unparseable rate monitor response: $JSON"

IFS="$(printf '\t')" read -r STATUS SESSION WEEKLY SESSION_RESET WEEKLY_RESET <<< "$PARSED"

for field in "$STATUS" "$SESSION" "$WEEKLY"; do
  case "$field" in
    ''|MISSING) fail_broken "rate monitor response missing status or utilisation: $JSON" ;;
  esac
done

is_number() { "$JQ" -n --arg v "$1" -e 'try ($v | tonumber | type == "number") catch false' >/dev/null 2>&1; }
is_number "$SESSION" || fail_broken "session utilisation is not a number: $SESSION"
is_number "$WEEKLY"  || fail_broken "weekly utilisation is not a number: $WEEKLY"

# Exhaustion is a hard stop, not an overage charge, so the reason names the
# reset the response itself reported -- the team resumes then, and a human
# reading the file can tell "back at 19:00" from "stuck".
reset_at() {
  case "$1" in
    ''|*[!0-9]*) printf 'unknown' ;;
    *)           date -u -d "@$1" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || printf '%s' "$1" ;;
  esac
}

at_or_over() { "$JQ" -n --argjson u "$1" --argjson c "$2" -e '$u >= $c' >/dev/null 2>&1; }

if [ "$STATUS" != "allowed" ]; then
  say "SKIP-BUDGET status=$STATUS session=$SESSION weekly=$WEEKLY resumes=$(reset_at "$SESSION_RESET")"
  exit 1
fi

if at_or_over "$SESSION" "$SESSION_CAP"; then
  say "SKIP-BUDGET session=$SESSION cap=$SESSION_CAP resumes=$(reset_at "$SESSION_RESET")"
  exit 1
fi

if at_or_over "$WEEKLY" "$WEEKLY_CAP"; then
  say "SKIP-BUDGET weekly=$WEEKLY cap=$WEEKLY_CAP resumes=$(reset_at "$WEEKLY_RESET")"
  exit 1
fi

say "RUN session=$SESSION weekly=$WEEKLY caps=$SESSION_CAP/$WEEKLY_CAP"
exit 0
