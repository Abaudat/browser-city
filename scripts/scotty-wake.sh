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
#
# Two phases. The task phase (t.*) runs on a GitHub Issue and produces the
# lead directions; the review phase (c.*) runs on the PR. One writer per
# comment in both, which is the whole reason neither is a shared document.

set -o pipefail

# --- paths, derived rather than hardcoded -----------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REASON="$(cd -- "$WORKTREE/.." && pwd)/.scotty-wake-reason"

GH="$(command -v gh || true)"
JQ="$(command -v jq || true)"
ORCA="$(command -v orca || true)"

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

# jq helper: machine fields are HTML comments, so nothing parses prose.
FIELD_DEF='def field($body; $name):
    ($body | capture("<!-- bc:" + $name + " (?<v>[^>]*?) -->") | .v | gsub("^\\s+|\\s+$"; ""))? // null;'

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

comments_for() { # $1 issue-or-pr number, $2 fixture env value
  if [ -n "$2" ]; then cat "$2"; else
    "$GH" api --paginate "repos/{owner}/{repo}/issues/$1/comments" 2>&1
  fi
}

# =============================================================================
# Review phase: is there an open PR labelled `story`?
# =============================================================================
if [ -n "${BC_PRS_FIXTURE:-}" ]; then
  PRS="$(cat "$BC_PRS_FIXTURE")"
else
  PRS="$("$GH" pr list --state open --label story --json number,title,headRefOid 2>&1)" \
    || fail_broken "gh pr list failed"
fi

printf '%s' "$PRS" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
  || fail_broken "gh pr list did not return an array"

PR_COUNT="$(printf '%s' "$PRS" | "$JQ" 'length')"
[ "$PR_COUNT" -le 1 ] \
  || fail_broken "$PR_COUNT open PRs labelled story; the cycle assumes at most one"

if [ "$PR_COUNT" -eq 1 ]; then
  PR="$(printf '%s' "$PRS" | "$JQ" -r '.[0].number')"
  HEAD="$(printf '%s' "$PRS" | "$JQ" -r '.[0].headRefOid // ""')"
  [ -n "$HEAD" ] || fail_broken "PR $PR reports no head commit"

  COMMENTS="$(comments_for "$PR" "${BC_COMMENTS_FIXTURE:-}")" \
    || fail_broken "could not read comments on PR $PR"
  printf '%s' "$COMMENTS" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
    || fail_broken "comment list for PR $PR is not an array"

  STATE="$(printf '%s' "$COMMENTS" | "$JQ" -c --argjson pr "$PR" --arg head "$HEAD" "
    $FIELD_DEF
    ([.[] | select(.body | test(\"<!-- bc:status -->\"))] | last) as \$status
    | [.[] | select(.body | test(\"<!-- bc:lead:\"))]           as \$leads
    | {
        pr: \$pr, head: \$head,
        has_status: (\$status != null),
        story: (if \$status then field(\$status.body; \"story\") else null end),
        cycle: (if \$status then ((field(\$status.body; \"cycle\") // \"0\") | tonumber) else 0 end),
        scope: (if \$status
                then ((field(\$status.body; \"scope\") // \"\") | split(\",\")
                      | map(gsub(\"\\\\s\"; \"\")) | map(select(length > 0)))
                else [] end),
        leads: (\$leads | map({
          role:     (.body | capture(\"<!-- bc:lead:(?<r>[a-z]+) -->\") | .r),
          id:       .id,
          verdict:  (field(.body; \"verdict\")  // \"-\"),
          reviewed: (field(.body; \"reviewed\") // \"-\"),
          session:  (field(.body; \"session\")  // \"-\")
        }))
      }" 2>/dev/null)" || fail_broken "could not parse comments on PR $PR"
  [ -n "$STATE" ] || fail_broken "empty parse result for PR $PR"

  emit() { # $1 branch, $2 reason
    echo "$(stamp) RUN $1 PR$PR $2" > "$REASON"
    printf '%s' "$STATE" | "$JQ" -c --arg b "$1" --arg r "$2" --argjson crew "$CREW" \
      '. + {branch:$b, reason:$r, crew:$crew}'
    exit 0
  }

  # c.0 - Crew opened a PR and Scotty has not set it up. The absence of the
  # status comment IS the signal; there is no other new-PR flag.
  [ "$(printf '%s' "$STATE" | "$JQ" -r '.has_status')" = "true" ] \
    || emit "c.0" "new PR, no status comment yet; create status and one stub per lead in scope"

  [ "$(printf '%s' "$STATE" | "$JQ" '.scope | length')" -gt 0 ] \
    || fail_broken "PR $PR status comment declares no leads in scope"

  MISSING="$(printf '%s' "$STATE" | "$JQ" -r \
    '[.scope[] as $s | select([.leads[].role] | index($s) | not) | $s] | join(",")')"
  [ -z "$MISSING" ] || fail_broken "PR $PR has no comment for leads in scope: $MISSING"

  # There are exactly two verdicts. A verdict means nothing without the commit
  # it was reached on, and a reviewed commit means nothing without a verdict;
  # either alone is incoherent, so it breaks rather than being assumed.
  BAD="$(printf '%s' "$STATE" | "$JQ" -r \
    '[.leads[] | select(.reviewed != "-")
      | select(.verdict | test("^(APPROVED|CHANGES)$") | not) | .role] | join(",")')"
  [ -z "$BAD" ] || fail_broken "PR $PR has a reviewed commit with no readable verdict for: $BAD"

  ORPHAN="$(printf '%s' "$STATE" | "$JQ" -r \
    '[.leads[] | select(.reviewed == "-" and .verdict != "-") | .role] | join(",")')"
  [ -z "$ORPHAN" ] || fail_broken "PR $PR has a verdict with no reviewed commit for: $ORPHAN"

  # A lead owes a review when the commit it recorded is not the current head.
  # A stub records "-", so "has never reviewed" needs no state of its own -
  # which is why there are only two verdicts and neither is ever reset.
  STALE="$(printf '%s' "$STATE" | "$JQ" -r \
    '[.scope[] as $s | .leads[] | select(.role==$s and .reviewed != $head) | .role] | join(",")' \
    --arg head "$HEAD")"
  CHANGES="$(printf '%s' "$STATE" | "$JQ" -r \
    '[.scope[] as $s | .leads[] | select(.role==$s and .verdict=="CHANGES") | .role] | join(",")')"
  CYCLE="$(printf '%s' "$STATE" | "$JQ" -r '.cycle')"

  # c.1 - every lead in scope approved, and approved THIS commit.
  if [ -z "$STALE" ] && [ -z "$CHANGES" ]; then
    emit "c.1" "approved at $HEAD by every lead in scope; merge and clean up the task terminals and sessions"
  fi

  # c.6 - the circuit breaker, checked before turn-taking so an unresolved PR
  # at the limit halts rather than starting a ninth cycle.
  [ "$CYCLE" -lt "$CYCLE_LIMIT" ] \
    || emit "c.6" "cycle $CYCLE of $CYCLE_LIMIT reached without approval; halt everything and escalate to Adrian"

  # c.4 before c.5 - every lead has its say, then Crew addresses the lot in one
  # pass rather than one lead at a time.
  [ -z "$STALE" ]   || emit "c.4" "awaiting review at $HEAD from: $STALE"
  [ -z "$CHANGES" ] || emit "c.5" "changes requested by: $CHANGES"

  fail_broken "PR $PR fell through classification; verdicts were not exhaustive"
fi

# =============================================================================
# Task phase: no PR, so we are before one exists. Directions live on an Issue.
# =============================================================================
if [ -n "${BC_ISSUES_FIXTURE:-}" ]; then
  ISSUES="$(cat "$BC_ISSUES_FIXTURE")"
else
  ISSUES="$("$GH" issue list --state open --label task --json number,title 2>&1)" \
    || fail_broken "gh issue list failed"
fi

printf '%s' "$ISSUES" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
  || fail_broken "gh issue list did not return an array"

ISSUE_COUNT="$(printf '%s' "$ISSUES" | "$JQ" 'length')"
[ "$ISSUE_COUNT" -le 1 ] \
  || fail_broken "$ISSUE_COUNT open issues labelled task; the cycle assumes at most one"

if [ "$ISSUE_COUNT" -eq 0 ]; then
  if [ "$CREW_BUSY" = "true" ]; then
    nothing_to_do "no open story PR and no open task issue, Crew is working"
  fi
  echo "$(stamp) RUN t.1 no open task issue, Crew idle" > "$REASON"
  printf '{"branch":"t.1","reason":"no open task issue, Crew idle; open the next task and stub its lead directions","crew":%s}\n' "$CREW"
  exit 0
fi

ISSUE="$(printf '%s' "$ISSUES" | "$JQ" -r '.[0].number')"
ICOMMENTS="$(comments_for "$ISSUE" "${BC_ISSUE_COMMENTS_FIXTURE:-}")" \
  || fail_broken "could not read comments on issue $ISSUE"
printf '%s' "$ICOMMENTS" | "$JQ" -e 'type == "array"' >/dev/null 2>&1 \
  || fail_broken "comment list for issue $ISSUE is not an array"

TSTATE="$(printf '%s' "$ICOMMENTS" | "$JQ" -c --argjson issue "$ISSUE" "
  $FIELD_DEF
  ([.[] | select(.body | test(\"<!-- bc:task -->\"))] | last) as \$task
  | [.[] | select(.body | test(\"<!-- bc:lead:\"))]         as \$leads
  | {
      issue: \$issue,
      has_task: (\$task != null),
      story: (if \$task then field(\$task.body; \"story\") else null end),
      scope: (if \$task
              then ((field(\$task.body; \"scope\") // \"\") | split(\",\")
                    | map(gsub(\"\\\\s\"; \"\")) | map(select(length > 0)))
              else [] end),
      leads: (\$leads | map({
        role:      (.body | capture(\"<!-- bc:lead:(?<r>[a-z]+) -->\") | .r),
        id:        .id,
        direction: (field(.body; \"direction\") // \"PENDING\"),
        session:   (field(.body; \"session\")   // \"-\")
      }))
    }" 2>/dev/null)" || fail_broken "could not parse comments on issue $ISSUE"
[ -n "$TSTATE" ] || fail_broken "empty parse result for issue $ISSUE"

temit() { # $1 branch, $2 reason
  echo "$(stamp) RUN $1 ISSUE$ISSUE $2" > "$REASON"
  printf '%s' "$TSTATE" | "$JQ" -c --arg b "$1" --arg r "$2" --argjson crew "$CREW" \
    '. + {branch:$b, reason:$r, crew:$crew}'
  exit 0
}

[ "$(printf '%s' "$TSTATE" | "$JQ" -r '.has_task')" = "true" ] \
  || fail_broken "issue $ISSUE is labelled task but carries no bc:task comment"

[ "$(printf '%s' "$TSTATE" | "$JQ" '.scope | length')" -gt 0 ] \
  || fail_broken "issue $ISSUE declares no leads in scope"

IMISSING="$(printf '%s' "$TSTATE" | "$JQ" -r \
  '[.scope[] as $s | select([.leads[].role] | index($s) | not) | $s] | join(",")')"
[ -z "$IMISSING" ] || fail_broken "issue $ISSUE has no comment for leads in scope: $IMISSING"

IBAD="$(printf '%s' "$TSTATE" | "$JQ" -r \
  '[.leads[] | select(.direction | test("^(PENDING|READY)$") | not) | .role] | join(",")')"
[ -z "$IBAD" ] || fail_broken "issue $ISSUE has unreadable direction states for: $IBAD"

OUTSTANDING="$(printf '%s' "$TSTATE" | "$JQ" -r \
  '[.scope[] as $s | .leads[] | select(.role==$s and .direction=="PENDING") | .role] | join(",")')"

# t.2 - leads still owe their directions. They write in parallel without
# racing, because each owns one comment and edits nobody else's.
[ -z "$OUTSTANDING" ] || temit "t.2" "awaiting directions from: $OUTSTANDING"

# t.3 - every direction is in. Dispatch Crew.
if [ "$CREW_BUSY" = "true" ]; then
  nothing_to_do "directions complete on issue $ISSUE, Crew is already working"
fi
temit "t.3" "all directions ready; dispatch Crew to implement against issue $ISSUE"
