#!/usr/bin/env bash
# Budget gate for Orca automation prechecks. See team-charter.md §8.
#
# Exit 0 -> budget available, the automation may dispatch.
# Exit 1 -> budget exhausted. Normal, expected, quiet.
# Exit 2 -> the gate itself is broken. NOT the same thing, and must be alarmed on.
#
# Absolute paths throughout: the precheck runs under cmd.exe with an environment
# that predates any PATH change, so `jq` and `claude-rate-monitor` are NOT on it.

set -o pipefail

RATE_MONITOR="/c/Users/granb/AppData/Roaming/npm/claude-rate-monitor"
JQ="/c/Users/granb/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq.exe"
REASON="/c/Users/granb/orca/workspaces/BrowserCity/.quota-gate-reason"

SESSION_CAP=0.85
WEEKLY_CAP=0.80

stamp() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

fail_broken() {
  echo "$(stamp) GATE-BROKEN $1" > "$REASON"
  exit 2
}

[ -x "$RATE_MONITOR" ] || fail_broken "rate monitor missing at $RATE_MONITOR"
[ -x "$JQ" ]           || fail_broken "jq missing at $JQ"

JSON="$("$RATE_MONITOR" --json 2>&1)" || fail_broken "rate monitor failed: $JSON"

SESSION="$(printf '%s' "$JSON" | "$JQ" -r '.session.utilization' 2>/dev/null)"
WEEKLY="$(printf '%s' "$JSON" | "$JQ" -r '.weekly.utilization' 2>/dev/null)"
STATUS="$(printf '%s' "$JSON" | "$JQ" -r '.overallStatus' 2>/dev/null)"

case "$SESSION$WEEKLY$STATUS" in
  *null*|"") fail_broken "unparseable response: $JSON" ;;
esac

if [ "$STATUS" != "allowed" ]; then
  echo "$(stamp) SKIP-BUDGET status=$STATUS session=$SESSION weekly=$WEEKLY" > "$REASON"
  exit 1
fi

UNDER="$(printf '%s' "$JSON" | "$JQ" -e \
  --argjson s "$SESSION_CAP" --argjson w "$WEEKLY_CAP" \
  '.session.utilization < $s and .weekly.utilization < $w' 2>/dev/null)"

if [ "$UNDER" = "true" ]; then
  echo "$(stamp) RUN session=$SESSION weekly=$WEEKLY" > "$REASON"
  exit 0
fi

echo "$(stamp) SKIP-BUDGET session=$SESSION weekly=$WEEKLY caps=$SESSION_CAP/$WEEKLY_CAP" > "$REASON"
exit 1
