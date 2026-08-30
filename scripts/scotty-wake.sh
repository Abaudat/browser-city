#!/usr/bin/env bash
# Scotty's wake classifier. See team-charter.md sections 3 and 5.
#
# Decides which branch of the cycle applies, with no agent reasoning, and
# prints the answer as JSON on stdout. Intended to run in the automation
# precheck after quota-gate.sh, so a do-nothing tick never starts an agent.
#
# Exit 0 -> there is work. Dispatch Scotty. The JSON says what to do.
# Exit 1 -> nothing to do. Normal, expected, quiet.
# Exit 2 -> the classifier itself is broken. NOT the same thing. Alarm on it.

set -o pipefail

# --- paths, derived rather than hardcoded -----------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REASON="$(cd -- "$WORKTREE/.." && pwd)/.scotty-wake-reason"

GH="$(command -v gh || true)"
JQ="$(command -v jq || true)"
ORCA="$(command -v orca || true)"

# Crew is "working" if its terminal produced output more recently than this.
CREW_IDLE_MS="${CREW_IDLE_MS:-300000}"
CYCLE_LIMIT="${CYCLE_LIMIT:-8}"

stamp() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

fail_broken() {
  echo "$(stamp) WAKE-BROKEN $1" > "$REASON"
  printf '{"branch":"broken","reason":"%s"}\n' "$(printf '%s' "$1" | tr -d '"')"
  exit 2
}

nothing_to_do() {
  echo "$(stamp) IDLE $1" > "$REASON"
  printf '{"branch":"c.3","reason":"%s"}\n' "$1"
  exit 1
}

[ -n "$GH" ]   || fail_broken "gh not found on PATH"
[ -n "$JQ" ]   || fail_broken "jq not found on PATH"
[ -n "$ORCA" ] || fail_broken "orca not found on PATH"

# --- is Crew working? -------------------------------------------------------
# The signal is the age of lastOutputAt. terminal wait --for tui-idle is not
# used: it returns timeout for an idle shell and a busy Claude TUI alike.
crew_state() {
  local json
  json="$("$ORCA" terminal list --worktree "path:$WORKTREE" --json 2>&1)" || {
    printf '{"busy":null,"error":"orca terminal list failed"}'
    return
  }
  printf '%s' "$json" | "$JQ" -c --argjson limit "$CREW_IDLE_MS" '
    ([.[]? | select(.title == "bc-crew")] | first) as $t
    | if $t == null then {busy:false, terminal:null, idle_ms:null}
      else (((now * 1000) - ($t.lastOutputAt // 0)) | floor) as $age
        | {busy: ($age < $limit), terminal: $t.title, idle_ms: $age}
      end' 2>/dev/null || printf '{"busy":null,"error":"unparseable terminal list"}'
}

CREW="${BC_CREW_OVERRIDE:-$(crew_state)}"
printf '%s' "$CREW" | "$JQ" -e '.busy != null' >/dev/null 2>&1 \
  || fail_broken "could not determine Crew state"
CREW_BUSY="$(printf '%s' "$CREW" | "$JQ" -r '.busy')"

# --- find the open story PR -------------------------------------------------
# Filters on the story label, so the sprint-review PR sitting open over a
# weekend never reads as "the story cycle is busy".
if [ -n "${BC_PRS_FIXTURE:-}" ]; then
  PRS="$(cat "$BC_PRS_FIXTURE")"
else
  PRS="$("$GH" pr list --state open --label story --json number,title,headRefName 2>&1)" \
    || fail_broken "gh pr list failed"
fi

printf '%s' "$PRS" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
  || fail_broken "gh pr list did not return an array"

PR_COUNT="$(printf '%s' "$PRS" | "$JQ" 'length')"

if [ "$PR_COUNT" -gt 1 ]; then
  fail_broken "$PR_COUNT open PRs labelled story; the cycle assumes at most one"
fi

if [ "$PR_COUNT" -eq 0 ]; then
  if [ "$CREW_BUSY" = "true" ]; then
    nothing_to_do "no open story PR, Crew is working"
  fi
  echo "$(stamp) RUN c.2 no open story PR, Crew idle" > "$REASON"
  printf '{"branch":"c.2","reason":"no open story PR, Crew idle","crew":%s}\n' "$CREW"
  exit 0
fi

PR="$(printf '%s' "$PRS" | "$JQ" -r '.[0].number')"

# --- read the structured comments ------------------------------------------
if [ -n "${BC_COMMENTS_FIXTURE:-}" ]; then
  COMMENTS="$(cat "$BC_COMMENTS_FIXTURE")"
else
  COMMENTS="$("$GH" api --paginate "repos/{owner}/{repo}/issues/$PR/comments" 2>&1)" \
    || fail_broken "could not read comments on PR $PR"
fi

printf '%s' "$COMMENTS" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
  || fail_broken "comment list for PR $PR is not an array"

# Machine fields live in HTML comments, so parsing never depends on prose.
STATE="$(printf '%s' "$COMMENTS" | "$JQ" -c --argjson pr "$PR" '
  def field($body; $name):
    ($body | capture("<!-- bc:" + $name + " (?<v>[^>]*?) -->") | .v | gsub("^\\s+|\\s+$"; ""))?  // null;

  ([.[] | select(.body | test("<!-- bc:status -->"))] | last)   as $status
  | [.[] | select(.body | test("<!-- bc:lead:"))]               as $leads
  | {
      pr: $pr,
      has_status: ($status != null),
      story: (if $status then field($status.body; "story") else null end),
      cycle: (if $status then ((field($status.body; "cycle") // "0") | tonumber) else 0 end),
      scope: (if $status
              then ((field($status.body; "scope") // "") | split(",")
                    | map(gsub("\\s"; "")) | map(select(length > 0)))
              else [] end),
      leads: ($leads | map({
        role:    (.body | capture("<!-- bc:lead:(?<r>[a-z]+) -->") | .r),
        id:      .id,
        verdict: (field(.body; "verdict") // "PENDING"),
        session: (field(.body; "session") // "-")
      }))
    }' 2>/dev/null)" || fail_broken "could not parse comments on PR $PR"

[ -n "$STATE" ] || fail_broken "empty parse result for PR $PR"

emit() { # $1 branch, $2 reason
  echo "$(stamp) RUN $1 PR$PR $2" > "$REASON"
  printf '%s' "$STATE" | "$JQ" -c --arg b "$1" --arg r "$2" --argjson crew "$CREW" \
    '. + {branch:$b, reason:$r, crew:$crew}'
  exit 0
}

HAS_STATUS="$(printf '%s' "$STATE" | "$JQ" -r '.has_status')"

# c.0 - Crew opened a PR and Scotty has not set it up yet. The absence of the
# status comment IS the signal; there is no other new-PR flag.
if [ "$HAS_STATUS" != "true" ]; then
  emit "c.0" "new PR, no status comment yet; create status and one stub per lead in scope"
fi

SCOPE_N="$(printf '%s' "$STATE" | "$JQ" '.scope | length')"
[ "$SCOPE_N" -gt 0 ] || fail_broken "PR $PR status comment declares no leads in scope"

# Every lead in scope must have a comment. A missing one is a defect, not a
# PENDING - guessing here is how a lead silently stops being consulted.
MISSING="$(printf '%s' "$STATE" | "$JQ" -r \
  '[.scope[] as $s | select([.leads[].role] | index($s) | not) | $s] | join(",")')"
[ -z "$MISSING" ] || fail_broken "PR $PR has no comment for leads in scope: $MISSING"

BAD="$(printf '%s' "$STATE" | "$JQ" -r \
  '[.leads[] | select(.verdict | test("^(PENDING|APPROVED|CHANGES)$") | not) | .role] | join(",")')"
[ -z "$BAD" ] || fail_broken "PR $PR has unreadable verdicts for: $BAD"

PENDING="$(printf '%s' "$STATE" | "$JQ" -r \
  '[.scope[] as $s | .leads[] | select(.role==$s and .verdict=="PENDING") | .role] | join(",")')"
CHANGES="$(printf '%s' "$STATE" | "$JQ" -r \
  '[.scope[] as $s | .leads[] | select(.role==$s and .verdict=="CHANGES") | .role] | join(",")')"
CYCLE="$(printf '%s' "$STATE" | "$JQ" -r '.cycle')"

# c.1 - approved by every lead in scope. Merge, then clean up.
if [ -z "$PENDING" ] && [ -z "$CHANGES" ]; then
  emit "c.1" "approved by every lead in scope; merge and clean up the task terminals and sessions"
fi

# c.6 - the circuit breaker. Checked before turn-taking, so an unresolved PR
# at the limit halts rather than starting a ninth cycle.
if [ "$CYCLE" -ge "$CYCLE_LIMIT" ]; then
  emit "c.6" "cycle $CYCLE of $CYCLE_LIMIT reached without approval; halt everything and escalate to Adrian"
fi

# c.4 before c.5 - let every lead have its say, then Crew addresses the lot in
# one pass rather than one lead at a time.
[ -z "$PENDING" ] || emit "c.4" "awaiting review from: $PENDING"
[ -z "$CHANGES" ] || emit "c.5" "changes requested by: $CHANGES"

fail_broken "PR $PR fell through classification; verdicts were not exhaustive"
