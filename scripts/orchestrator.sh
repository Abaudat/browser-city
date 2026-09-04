#!/usr/bin/env bash
# LEVEL 3 -- the wake. One entry point, one wake, one decision, one action,
# exit. Walks agentic-team/high-level-agentic-flow.mmd top to bottom every
# time it runs: it reads state through the level-2 scripts (bc-issue.sh,
# bc-comment.sh, bc-pr.sh, bc-sprint.sh, bc-session.sh) as subprocesses --
# never sources gh-cli.sh/project.sh/orca.sh/claude.sh and never calls
# gh/orca/claude directly -- picks the single branch of the flowchart the
# facts select, does the one thing at the end of it, and exits. It reads
# state; it never remembers it, so a crash mid-tick just means the next tick
# re-derives where things stand and finishes the job (stubs are re-created
# idempotently at "To analyze" and "Leads review" before anything is judged,
# and session ids are derived from role + issue, so nothing is ever lost).
#
# Node names in comments and in the one-line wake reason are
# agentic-team/high-level-agentic-flow.mmd's, verbatim -- the flowchart is
# the index. This file covers every node in it except integrating-feedback,
# which stays manual.
#
# Exit contract: 0 acted, 1 slept (nothing to do), 2 broken. Every exit
# writes exactly one line "<node> <verb> <details>" to $BC_WAKE_REASON
# (default: a file beside the other durable state, see bc_state_dir in
# lib/paths.sh) AND to stdout -- that line is the whole report of what this
# tick did. Everything else is diagnostics, on stderr.
set -u
_BC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_DIR/lib/config.sh"
bc_init

# --- the level-2 scripts, invoked as subprocesses only ----------------------
bc_budget()  { bash "$_BC_DIR/bc-budget.sh" "$@"; }
bc_issue()   { bash "$_BC_DIR/bc-issue.sh" "$@"; }
bc_comment() { bash "$_BC_DIR/bc-comment.sh" "$@"; }
bc_pr()      { bash "$_BC_DIR/bc-pr.sh" "$@"; }
bc_sprint()  { bash "$_BC_DIR/bc-sprint.sh" "$@"; }
bc_session() { bash "$_BC_DIR/bc-session.sh" "$@"; }

_BC_PROMPTS="$_BC_DIR/prompts"

# --- the wake reason ---------------------------------------------------------
_BC_REASON_FILE="${BC_WAKE_REASON:-$(bc_state_dir 2>/dev/null)/wake-reason.txt}"
[ -n "$_BC_REASON_FILE" ] || _BC_REASON_FILE="${TMPDIR:-${TEMP:-/tmp}}/bc-wake-reason.txt"

# finish <exit-code> <node> <verb> <details...> -- writes the one-line
# report to $_BC_REASON_FILE and stdout, then exits. Nothing after this call
# ever runs -- every branch below ends its work by calling it exactly once.
finish() {
  local code="$1"; shift
  local line="$*"
  printf '%s\n' "$line" > "$_BC_REASON_FILE" 2>/dev/null
  printf '%s\n' "$line"
  exit "$code"
}

_join() { local sep="$1"; shift; local IFS="$sep"; printf '%s' "$*"; } # <sep> <items...>

# render_prompt <file> key=value... -- the only templating this script does:
# a literal {{key}} -> value substitution, plus {{scripts}} -> this
# directory's absolute Windows-form path (posix2win, so a PowerShell-run
# Claude session can use it in a `bash <path>/bc-x.sh` command).
render_prompt() {
  local file="$1"; shift
  local scripts_win sed_args=() kv key val
  scripts_win="$(posix2win "$_BC_DIR")"
  sed_args+=(-e "s#{{scripts}}#${scripts_win//&/\\&}#g")
  for kv in "$@"; do
    key="${kv%%=*}"
    val="${kv#*=}"
    val="${val//&/\\&}"
    sed_args+=(-e "s#{{${key}}}#${val}#g")
  done
  sed "${sed_args[@]}" "$file"
}

# _nudge_send <role> <issue> <worktree> <uuid> <promptfile> [pr] -- the
# ensure+send half of the story, for a caller that already knows the uuid
# (just spawned it, or is holding it from the role=uuid pairs it just built)
# -- skips the `bc-comment sessions` lookup, so dispatching right after
# creating a stub never depends on reading that same write back from
# GitHub's comment API inside the same tick. `bc-session ensure` reconciles
# absent/idle/working; "working" means do nothing (return 1, nothing sent),
# anything else means send the rendered prompt (return 0, sent). Return 2
# means a hard failure -- callers treat that as broken and finish
# immediately.
_nudge_send() {
  local role="$1" issue="$2" worktree="$3" uuid="$4" promptfile="$5" pr="${6:-}"
  local scope rendered out rc

  scope="$(bc_issue scope "$issue" 2>/dev/null)"
  rendered="$(render_prompt "$promptfile" issue="$issue" pr="$pr" role="$role" scope="$scope" worktree="$worktree")"

  out="$(bc_session ensure "$role" "$issue" "$uuid" "$worktree")"; rc=$?
  if [ "$rc" -eq 0 ] && [ "$out" = "working" ]; then
    echo "orchestrator: nudge: skipped $role (working)" >&2
    return 1
  fi

  if ! bc_session send "$uuid" "$worktree" "$rendered" >/dev/null 2>&1; then
    echo "orchestrator: nudge: send failed for $role on #$issue" >&2
    return 2
  fi
  return 0
}

# _nudge <role> <issue> <worktree> <promptfile> [pr] -- the whole restart/
# rejoin story. Session ids are derived from role + issue (`bc-comment
# sessions` hands them out; nothing is recorded anywhere), so this is just:
# make sure the role's session is up, then send it the prompt unless busy.
_nudge() {
  local role="$1" issue="$2" worktree="$3" promptfile="$4" pr="${5:-}"
  local sessions uuid
  sessions="$(bc_comment sessions "$issue" 2>/dev/null)"
  uuid="$(printf '%s' "$sessions" | "$JQ" -r --arg r "$role" '.[$r] // empty' 2>/dev/null)"
  if [ -z "$uuid" ] || [ "$uuid" = "null" ]; then
    echo "orchestrator: nudge: no session id for $role on #$issue" >&2
    return 2
  fi
  _nudge_send "$role" "$issue" "$worktree" "$uuid" "$promptfile" "$pr"
}

# _nudge_all <node> <issue> <worktree> <promptfile> <pr> <role-csv> -- runs
# _nudge (uuid looked up per role) for every role in the csv, aborting the
# whole tick as broken on a hard failure. Prints the comma-joined roles
# actually sent to on stdout. For leads-analysed and leads-reviewed-head,
# whose roles come from a pending/stale-leads query rather than a just-built
# pairs list.
#
# NB: every caller invokes this via a `sent="$(_nudge_all ...)"` command
# substitution, which runs in its own subshell -- so `finish`'s bare `exit`
# here would only kill that subshell, not the tick. The reason text would
# leak onto stdout, get captured into $sent, and the caller would go on to
# treat a real "broken" failure as a successful dispatch (this happened live
# during the e2e run: "starting-dev-cycle started dev cycle, dispatched
# starting-dev-cycle broken nudge failed for quentin on #12 on #12", exit 0).
# So on a hard failure this prints only the failed role name and returns 2;
# the caller, which is NOT itself in a subshell, checks $? and calls finish.
_nudge_all() {
  local node="$1" issue="$2" worktree="$3" promptfile="$4" pr="$5" roles_csv="$6"
  local roles role rc sent=()
  local IFS=','
  read -ra roles <<< "$roles_csv"
  for role in "${roles[@]}"; do
    [ -n "$role" ] || continue
    _nudge "$role" "$issue" "$worktree" "$promptfile" "$pr"; rc=$?
    if [ "$rc" -eq 2 ]; then
      printf '%s' "$role"
      return 2
    fi
    [ "$rc" -eq 0 ] && sent+=("$role")
  done
  _join ',' "${sent[@]}"
}

# =============================================================================
# budget-available -- the first branch of the flow, and the cheapest. Nothing
# below this line runs without budget for it: not a dispatch, not a merge,
# not the `gh` calls that read the board. The caps are 85% of the 5-hour
# window and 80% of the week, so there is always a margin left for Adrian to
# use Claude himself -- and since the rate-limit headers are account-wide,
# his own sessions spend the same budget and the team's share shrinks on its
# own, with nobody coordinating.
#
# The gate fails closed and loudly. A spent budget is exit 1, quiet and
# expected, naming the reset the response itself reported; a gate that
# cannot answer -- no monitor, no parse -- is exit 2, because a broken gate
# that skipped like a spent one would make a team stopped for a week look
# exactly like a team behaving correctly.
# =============================================================================
budget_line="$(bc_budget check)"; budget_rc=$?
case "$budget_rc" in
  0) : ;;   # "available session=... weekly=... caps=..." -- carry on.
  1) finish 1 "budget-available" "sleep" "${budget_line#spent }" ;;
  # An empty line here means bc-budget.sh died before it could say anything
  # -- bc_init's own exit 2, most likely. Still broken, and the reason must
  # still read as a sentence rather than as a bare node name.
  *) budget_why="${budget_line#broken }"
     finish 2 "budget-available" "broken" "${budget_why:-bc-budget check failed with no output}" ;;
esac

# =============================================================================
# demo-active / demo-has-feedback / closing-sprint / starting-next-sprint --
# the Sprint Demo. integrating-feedback is the one node left unscripted:
# Adrian does it by hand and moves the Demo issue to Reviewed himself, which
# is what closing-sprint/starting-next-sprint below react to.
# =============================================================================
demo_json="$(bc_issue demo-current)"; demo_rc=$?
if [ "$demo_rc" -eq 2 ]; then
  finish 2 "demo-active" "broken" "demo-current failed"
fi
if [ "$demo_rc" -eq 0 ]; then
  dnum="$(printf '%s' "$demo_json" | "$JQ" -r '.number')"
  dstatus="$(printf '%s' "$demo_json" | "$JQ" -r '.status')"
  case "$dstatus" in
    "In progress")
      if bc_issue demo-commented "$dnum" >/dev/null 2>&1; then
        finish 1 "demo-has-feedback" "sleep" "demo #$dnum awaiting feedback integration; set the Demo issue to Reviewed"
      else
        finish 1 "demo-active" "sleep" "demo #$dnum awaiting feedback"
      fi
      ;;
    "Reviewed")
      bc_sprint close >/dev/null 2>&1; close_rc=$?
      if [ "$close_rc" -ne 0 ]; then
        finish 2 "closing-sprint" "broken" "sprint close failed for demo #$dnum"
      fi
      bc_sprint start >/dev/null 2>&1; start_rc=$?
      if [ "$start_rc" -eq 2 ]; then
        finish 2 "starting-next-sprint" "broken" "sprint start failed after closing for demo #$dnum"
      fi
      finish 0 "starting-next-sprint" "closed the sprint and started the next" "after demo #$dnum"
      ;;
    *)
      finish 1 "demo-active" "sleep" "demo #$dnum in unexpected status $dstatus"
      ;;
  esac
fi
# demo_rc == 1: no active Sprint Demo issue -- fall through to
# sprint-over/creating-demo-issue.

# =============================================================================
# sprint-over / creating-demo-issue -- is the sprint over, and if so has
# today's demo already been created (demo-for guards against creating a
# second one on the same Friday afternoon tick after tick)?
# =============================================================================
if bc_sprint over >/dev/null 2>&1; then
  cur_json="$(bc_sprint current 2>/dev/null)"
  curnum="$(printf '%s' "$cur_json" | "$JQ" -r '.number // empty' 2>/dev/null)"
  if [ -n "$curnum" ] && ! bc_issue demo-for "$curnum" >/dev/null 2>&1; then
    newnum="$(bc_issue create-demo "$curnum")"; rc=$?
    if [ "$rc" -ne 0 ]; then
      finish 2 "creating-demo-issue" "broken" "create-demo failed for sprint $curnum"
    fi
    finish 0 "creating-demo-issue" "created" "demo #$newnum for sprint $curnum"
  fi
  # else: no current sprint to summarise, or a demo already exists for it
  # (sprint-over guarded) -- fall through to subissue-active/subissue-status.
fi

# =============================================================================
# subissue-active / subissue-status -- is a sub-issue in an active status,
# and which one.
# =============================================================================
cur="$(bc_issue current)"; cur_rc=$?
if [ "$cur_rc" -eq 2 ]; then
  finish 2 "subissue-active" "broken" "more than one active sub-issue"
fi

if [ "$cur_rc" -eq 1 ]; then
  # =========================================================================
  # starting-dev-cycle -- no sub-issue active: start a new dev cycle. Status
  # is transitioned BEFORE any side effect it announces (a crash after this
  # claims #n but before the stubs land is healed at "To analyze", which
  # re-creates the missing stubs before judging anything -- not a duplicate
  # pick next tick).
  # =========================================================================
  pick="$(bc_issue next)"; rc=$?
  [ "$rc" -eq 0 ] || finish 1 "starting-dev-cycle" "sleep" "backlog empty"

  n="$(printf '%s' "$pick" | "$JQ" -r '.number')"
  scope="$(printf '%s' "$pick" | "$JQ" -r '.scope')"

  bc_issue transition "$n" "To analyze" || finish 2 "starting-dev-cycle" "broken" "transition to To analyze failed for #$n"
  wt="$(bc_session worktree "$n")" || finish 2 "starting-dev-cycle" "broken" "worktree failed for #$n"

  # One analysis stub per scoped lead (Crew writes nothing on the issue and is
  # only started at dispatching-implementation); then start each lead's session
  # and send the analysis prompt. Session ids are derived from role + issue, so
  # there is nothing to record between the two steps.
  IFS=',' read -ra roles <<< "$scope"
  bc_comment create-analysis-stubs "$n" "${roles[@]}" >/dev/null

  sent="$(_nudge_all "starting-dev-cycle" "$n" "$wt" "$_BC_PROMPTS/dispatch-analysis.md" "" "$scope")"; nrc=$?
  if [ "$nrc" -eq 2 ]; then
    finish 2 "starting-dev-cycle" "broken" "nudge failed for $sent on #$n"
  fi
  if [ -n "$sent" ]; then
    finish 0 "starting-dev-cycle" "started dev cycle, dispatched" "$sent on #$n"
  fi
  finish 0 "starting-dev-cycle" "started dev cycle" "#$n"
fi

# cur_rc == 0: a sub-issue is active.
num="$(printf '%s' "$cur" | "$JQ" -r '.number')"
status="$(printf '%s' "$cur" | "$JQ" -r '.status')"

case "$status" in

"To analyze")
  # ===========================================================================
  # leads-analysed / dispatching-implementation. The scoped leads' analysis
  # stubs are (re)created first, every tick: create-analysis-stubs only adds
  # what is missing, so on a healthy issue this is a no-op, and on one a
  # crashed starting-dev-cycle left half-done it is the repair. A scoped lead
  # with no stub reads as pending, so nothing is judged early even if this
  # tick's own creates are not yet readable.
  # ===========================================================================
  scope="$(bc_issue scope "$num" 2>/dev/null)"
  IFS=',' read -ra roles <<< "$scope"
  bc_comment create-analysis-stubs "$num" "${roles[@]}" >/dev/null 2>&1 \
    || finish 2 "leads-analysed" "broken" "could not create analysis stubs for #$num"

  pending="$(bc_comment pending-leads "$num")"; rc=$?
  wt="$(bc_session worktree "$num")" || finish 2 "leads-analysed" "broken" "worktree lookup failed for #$num"
  if [ "$rc" -eq 1 ]; then
    # dispatching-implementation: every lead in scope is READY.
    bc_issue transition "$num" "In progress" || finish 2 "dispatching-implementation" "broken" "transition to In progress failed for #$num"
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-crew.md"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "dispatching-implementation" "broken" "nudge failed for crew on #$num"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "dispatching-implementation" "marked In progress, dispatched" "crew on #$num"
    fi
    finish 0 "dispatching-implementation" "marked In progress" "#$num"
  elif [ "$rc" -eq 0 ]; then
    # leads-analysed no: nudge exactly the pending leads.
    sent="$(_nudge_all "leads-analysed" "$num" "$wt" "$_BC_PROMPTS/dispatch-analysis.md" "" "$pending")"; nrc=$?
    if [ "$nrc" -eq 2 ]; then
      finish 2 "leads-analysed" "broken" "nudge failed for $sent on #$num"
    fi
    if [ -n "$sent" ]; then
      finish 0 "leads-analysed" "nudged" "$sent on #$num"
    fi
    finish 1 "leads-analysed" "sleep" "waiting on $pending (working) on #$num"
  else
    finish 2 "leads-analysed" "broken" "pending-leads failed for #$num"
  fi
  ;;

"In progress")
  # ===========================================================================
  # pr-opened / opening-leads-review -- has Crew opened a PR yet.
  # ===========================================================================
  wt="$(bc_session worktree "$num")" || finish 2 "pr-opened" "broken" "worktree lookup failed for #$num"
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  if [ "$rc" -eq 0 ]; then
    pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
    bc_comment create-review-stubs "$pr" "$num" >/dev/null
    bc_issue transition "$num" "Leads review" || finish 2 "opening-leads-review" "broken" "transition to Leads review failed for #$num"
    finish 0 "opening-leads-review" "review stubs created, marked Leads review" "PR #$pr for #$num"
  else
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-crew.md"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "pr-opened" "broken" "nudge failed for crew on #$num"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "pr-opened" "nudged" "crew on #$num"
    fi
    finish 1 "pr-opened" "sleep" "crew already busy on #$num"
  fi
  ;;

"Leads review")
  # ===========================================================================
  # In the flowchart's order: breaker-tripped (breaker-exists), then
  # leads-reviewed-head (stale leads), then leads-all-approved -> merging-pr,
  # then cycles-exhausted -> tripping-breaker, else dispatching-rework. Plus
  # the crash-idempotency repair: a PR exists but carries no status comment
  # yet (a crashed opening-leads-review).
  # ===========================================================================
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  [ "$rc" -eq 0 ] || finish 2 "breaker-tripped" "broken" "no PR found for #$num at Leads review"
  pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
  wt="$(bc_session worktree "$num")" || finish 2 "breaker-tripped" "broken" "worktree lookup failed for #$num"

  if ! bc_comment scope "$pr" >/dev/null 2>&1; then
    bc_comment create-review-stubs "$pr" "$num" >/dev/null
  fi

  if bc_comment breaker-exists "$pr" >/dev/null 2>&1; then
    finish 1 "breaker-tripped" "sleep" "breaker pending on PR #$pr"
  fi

  stale="$(bc_comment stale-leads "$pr")"; stale_rc=$?
  if [ "$stale_rc" -eq 2 ]; then
    finish 2 "leads-reviewed-head" "broken" "stale-leads failed for PR #$pr"
  fi
  if [ "$stale_rc" -eq 0 ]; then
    sent="$(_nudge_all "leads-reviewed-head" "$num" "$wt" "$_BC_PROMPTS/dispatch-review.md" "$pr" "$stale")"; nrc=$?
    if [ "$nrc" -eq 2 ]; then
      finish 2 "leads-reviewed-head" "broken" "nudge failed for $sent on PR #$pr"
    fi
    if [ -n "$sent" ]; then
      finish 0 "leads-reviewed-head" "nudged" "$sent on PR #$pr"
    fi
    finish 1 "leads-reviewed-head" "sleep" "waiting on $stale (working) on PR #$pr"
  fi

  # stale_rc == 1: every lead in scope reviewed the current head.
  unapproved="$(bc_comment unapproved-leads "$pr")"; un_rc=$?
  if [ "$un_rc" -eq 1 ]; then
    # leads-all-approved yes -> merging-pr: merge, mark Done, tear the sessions down.
    bc_pr merge "$pr" || finish 2 "merging-pr" "broken" "merge failed for PR #$pr"
    bc_issue transition "$num" "Done" || finish 2 "merging-pr" "broken" "transition to Done failed for #$num"
    bc_session stop-all "$num" "$wt" >/dev/null 2>&1
    bc_session rm-worktree "$num" >/dev/null 2>&1
    finish 0 "merging-pr" "merged" "PR #$pr for #$num"
  elif [ "$un_rc" -eq 0 ]; then
    if bc_comment should-trigger-breaker "$pr" >/dev/null 2>&1; then
      bc_comment create-breaker "$pr" >/dev/null 2>&1
      finish 0 "tripping-breaker" "triggered breaker" "on PR #$pr for #$num"
    fi
    bc_issue transition "$num" "Reviewed" || finish 2 "dispatching-rework" "broken" "transition to Reviewed failed for #$num"
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-address.md" "$pr"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "dispatching-rework" "broken" "nudge failed for crew on PR #$pr"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "dispatching-rework" "marked Reviewed, dispatched" "crew to address PR #$pr"
    fi
    finish 0 "dispatching-rework" "marked Reviewed" "PR #$pr for #$num"
  else
    finish 2 "leads-all-approved" "broken" "unapproved-leads failed for PR #$pr"
  fi
  ;;

"Reviewed")
  # ===========================================================================
  # crew-addressed / reopening-leads-review -- has Crew pushed and updated its comment.
  # ===========================================================================
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  [ "$rc" -eq 0 ] || finish 2 "crew-addressed" "broken" "no PR found for #$num at Reviewed"
  pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
  wt="$(bc_session worktree "$num")" || finish 2 "crew-addressed" "broken" "worktree lookup failed for #$num"

  if bc_comment crew-addressed "$pr" >/dev/null 2>&1; then
    bc_comment bump-cycle "$pr" >/dev/null 2>&1
    bc_issue transition "$num" "Leads review" || finish 2 "reopening-leads-review" "broken" "transition to Leads review failed for #$num"
    finish 0 "reopening-leads-review" "bumped cycle, marked Leads review" "PR #$pr for #$num"
  else
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-address.md" "$pr"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "crew-addressed" "broken" "nudge failed for crew on PR #$pr"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "crew-addressed" "nudged" "crew on PR #$pr"
    fi
    finish 1 "crew-addressed" "sleep" "crew already busy on PR #$pr"
  fi
  ;;

*)
  finish 2 "subissue-status" "broken" "sub-issue #$num in unrecognised status '$status'"
  ;;

esac
