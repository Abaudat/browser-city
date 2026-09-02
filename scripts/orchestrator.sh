#!/usr/bin/env bash
# LEVEL 3 -- the wake. One entry point, one wake, one decision, one action,
# exit. Walks agentic-team/high-level-agentic-flow.mmd top to bottom every
# time it runs: it reads state through the level-2 scripts (bc-issue.sh,
# bc-comment.sh, bc-pr.sh, bc-sprint.sh, bc-session.sh) as subprocesses --
# never sources gh.sh/project.sh/orca.sh/claude.sh and never calls
# gh/orca/claude directly -- picks the single branch of the flowchart the
# facts select, does the one thing at the end of it, and exits. It reads
# state; it never remembers it, so a crash mid-tick just means the next tick
# re-derives where things stand and finishes the job (see the two crash-
# idempotency repairs below, at "To analyze" and "Leads review").
#
# Node names in comments and in the one-line wake reason are
# agentic-team/high-level-agentic-flow.mmd's: QD/DA (Sprint Demo gates,
# FB is the one node left unscripted) DC/DN (close+start the Sprint) QF/DM
# (demo due) QS/SS (which sub-issue, which status) N1 (start a dev cycle)
# A1/A2 (To analyze) B1/B2 (In progress) C0-C6 (Leads review) E1/E2
# (Reviewed).
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
# rejoin story: looks the role's session uuid up via `bc-comment sessions`;
# if it is missing (the stub was never created for this one role -- a role
# added to scope after N1 ran, or a partial-create crash this role's own
# repair didn't cover), spawns a fresh session and creates just that one
# stub -- the N1 repair path, scoped to a single role -- then nudges via
# _nudge_send.
_nudge() {
  local role="$1" issue="$2" worktree="$3" promptfile="$4" pr="${5:-}"
  local sessions uuid

  sessions="$(bc_comment sessions "$issue" 2>/dev/null)"
  uuid="$(printf '%s' "$sessions" | "$JQ" -r --arg r "$role" '.[$r] // empty' 2>/dev/null)"

  if [ -z "$uuid" ] || [ "$uuid" = "null" ]; then
    uuid="$(bc_session spawn "$role" "$issue" "$worktree")"
    if [ -z "$uuid" ]; then
      echo "orchestrator: nudge: spawn failed for $role on #$issue" >&2
      return 2
    fi
    bc_comment create-analysis-stubs "$issue" "${role}=${uuid}" >/dev/null 2>&1
  fi

  _nudge_send "$role" "$issue" "$worktree" "$uuid" "$promptfile" "$pr"
}

# _nudge_all <node> <issue> <worktree> <promptfile> <pr> <role-csv> -- runs
# _nudge (uuid looked up per role) for every role in the csv, aborting the
# whole tick as broken on a hard failure. Prints the comma-joined roles
# actually sent to on stdout. For A1 and C1, whose roles come from a
# pending/stale-leads query rather than a just-built pairs list.
#
# NB: every caller invokes this via a `sent="$(_nudge_all ...)"` command
# substitution, which runs in its own subshell -- so `finish`'s bare `exit`
# here would only kill that subshell, not the tick. The reason text would
# leak onto stdout, get captured into $sent, and the caller would go on to
# treat a real "broken" failure as a successful dispatch (this happened live
# during the e2e run: "N1 started dev cycle, dispatched N1 broken nudge
# failed for quentin on #12 on #12", exit 0). So on a hard failure this
# prints only the failed role name and returns 2; the caller, which is NOT
# itself in a subshell, checks $? and calls finish.
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

# _nudge_pairs <node> <issue> <worktree> <promptfile> <pr> <role=uuid>... --
# like _nudge_all, but for roles whose uuid is already known (just spawned,
# or just stubbed) -- uses _nudge_send directly, no `bc-comment sessions`
# read-after-write needed. The "crew" pair, if present, is skipped -- crew
# is always nudged separately with its own prompt. Prints the comma-joined
# roles actually sent to on stdout. Used by N1 and the "To analyze"
# crash-repair, which both already hold the pairs they just created.
#
# Same subshell caveat as _nudge_all above -- see its comment.
_nudge_pairs() {
  local node="$1" issue="$2" worktree="$3" promptfile="$4" pr="$5"; shift 5
  local pair role uuid rc sent=()
  for pair in "$@"; do
    role="${pair%%=*}" uuid="${pair#*=}"
    [ "$role" = "crew" ] && continue
    _nudge_send "$role" "$issue" "$worktree" "$uuid" "$promptfile" "$pr"; rc=$?
    if [ "$rc" -eq 2 ]; then
      printf '%s' "$role"
      return 2
    fi
    [ "$rc" -eq 0 ] && sent+=("$role")
  done
  _join ',' "${sent[@]}"
}

# =============================================================================
# QD / DA / DC / DN -- the Sprint Demo. FB (integrating Adrian's feedback) is
# the one node left unscripted -- Adrian does it by hand and moves the Demo
# issue to Reviewed himself, which is what DC/DN below react to.
# =============================================================================
demo_json="$(bc_issue demo-current)"; demo_rc=$?
if [ "$demo_rc" -eq 2 ]; then
  finish 2 "QD" "broken" "demo-current failed"
fi
if [ "$demo_rc" -eq 0 ]; then
  dnum="$(printf '%s' "$demo_json" | "$JQ" -r '.number')"
  dstatus="$(printf '%s' "$demo_json" | "$JQ" -r '.status')"
  case "$dstatus" in
    "In progress")
      if bc_issue demo-commented "$dnum" >/dev/null 2>&1; then
        finish 1 "DA" "sleep" "demo #$dnum awaiting feedback integration; set the Demo issue to Reviewed"
      else
        finish 1 "QD" "sleep" "demo #$dnum awaiting feedback"
      fi
      ;;
    "Reviewed")
      bc_sprint close >/dev/null 2>&1; close_rc=$?
      if [ "$close_rc" -ne 0 ]; then
        finish 2 "DC" "broken" "sprint close failed for demo #$dnum"
      fi
      bc_sprint start >/dev/null 2>&1; start_rc=$?
      if [ "$start_rc" -eq 2 ]; then
        finish 2 "DN" "broken" "sprint start failed after closing for demo #$dnum"
      fi
      finish 0 "DN" "closed the sprint and started the next" "after demo #$dnum"
      ;;
    *)
      finish 1 "QD" "sleep" "demo #$dnum in unexpected status $dstatus"
      ;;
  esac
fi
# demo_rc == 1: no active Sprint Demo issue -- fall through to QF/DM.

# =============================================================================
# QF / DM -- is the sprint over, and if so has today's demo already been
# created (demo-for guards against creating a second one on the same
# Friday afternoon tick after tick)?
# =============================================================================
if bc_sprint over >/dev/null 2>&1; then
  cur_json="$(bc_sprint current 2>/dev/null)"
  curnum="$(printf '%s' "$cur_json" | "$JQ" -r '.number // empty' 2>/dev/null)"
  if [ -n "$curnum" ] && ! bc_issue demo-for "$curnum" >/dev/null 2>&1; then
    newnum="$(bc_issue create-demo "$curnum")"; rc=$?
    if [ "$rc" -ne 0 ]; then
      finish 2 "DM" "broken" "create-demo failed for sprint $curnum"
    fi
    finish 0 "DM" "created" "demo #$newnum for sprint $curnum"
  fi
  # else: no current sprint to summarise, or a demo already exists for it
  # (QF guarded) -- fall through to QS/SS.
fi

# =============================================================================
# QS / SS -- is a sub-issue in an active status, and which one.
# =============================================================================
cur="$(bc_issue current)"; cur_rc=$?
if [ "$cur_rc" -eq 2 ]; then
  finish 2 "QS" "broken" "more than one active sub-issue"
fi

if [ "$cur_rc" -eq 1 ]; then
  # =========================================================================
  # N1 -- no sub-issue active: start a new dev cycle. Status is transitioned
  # BEFORE any side effect it announces (a crash after this claims #n but
  # before the stubs land is exactly the "To analyze, no stubs" repair
  # below, not a duplicate pick next tick).
  # =========================================================================
  pick="$(bc_issue next)"; rc=$?
  [ "$rc" -eq 0 ] || finish 1 "N1" "sleep" "backlog empty"

  n="$(printf '%s' "$pick" | "$JQ" -r '.number')"
  scope="$(printf '%s' "$pick" | "$JQ" -r '.scope')"

  bc_issue transition "$n" "To analyze" || finish 2 "N1" "broken" "transition to To analyze failed for #$n"
  wt="$(bc_session worktree "$n")" || finish 2 "N1" "broken" "worktree failed for #$n"

  pairs=()
  IFS=',' read -ra roles <<< "$scope"
  for role in "${roles[@]}"; do
    [ -n "$role" ] || continue
    uuid="$(bc_session spawn "$role" "$n" "$wt")" || finish 2 "N1" "broken" "spawn failed for $role on #$n"
    pairs+=("${role}=${uuid}")
  done
  crew_uuid="$(bc_session spawn crew "$n" "$wt")" || finish 2 "N1" "broken" "spawn failed for crew on #$n"
  pairs+=("crew=${crew_uuid}")

  bc_comment create-analysis-stubs "$n" "${pairs[@]}" >/dev/null

  sent="$(_nudge_pairs "N1" "$n" "$wt" "$_BC_PROMPTS/dispatch-analysis.md" "" "${pairs[@]}")"; nrc=$?
  if [ "$nrc" -eq 2 ]; then
    finish 2 "N1" "broken" "nudge failed for $sent on #$n"
  fi
  if [ -n "$sent" ]; then
    finish 0 "N1" "started dev cycle, dispatched" "$sent on #$n"
  fi
  finish 0 "N1" "started dev cycle" "#$n"
fi

# cur_rc == 0: a sub-issue is active.
num="$(printf '%s' "$cur" | "$JQ" -r '.number')"
status="$(printf '%s' "$cur" | "$JQ" -r '.status')"

case "$status" in

"To analyze")
  # ===========================================================================
  # A1 / A2, plus the crash-idempotency repair: if `bc-comment sessions`
  # finds nothing, N1's transition landed but its spawn+stub loop never
  # finished -- rebuild every stub via the same path N1 uses, then continue.
  # ===========================================================================
  if ! bc_comment sessions "$num" >/dev/null 2>&1; then
    # Crashed N1: the transition landed but the spawn+stub loop never
    # finished. Rebuild every stub via the same path N1 uses -- and since
    # every one of them is a fresh PENDING stub, every scoped lead is
    # obviously pending; dispatch them directly (via the pairs just built)
    # rather than re-querying pending-leads, which would need this tick's
    # own comment-creates read back from GitHub to answer correctly.
    scope="$(bc_issue scope "$num" 2>/dev/null)"
    wt="$(bc_session worktree "$num")" || finish 2 "N1" "broken" "worktree failed for #$num (repair)"
    pairs=()
    IFS=',' read -ra roles <<< "$scope"
    for role in "${roles[@]}"; do
      [ -n "$role" ] || continue
      uuid="$(bc_session spawn "$role" "$num" "$wt")" || finish 2 "N1" "broken" "spawn failed for $role on #$num (repair)"
      pairs+=("${role}=${uuid}")
    done
    crew_uuid="$(bc_session spawn crew "$num" "$wt")" || finish 2 "N1" "broken" "spawn failed for crew on #$num (repair)"
    pairs+=("crew=${crew_uuid}")
    bc_comment create-analysis-stubs "$num" "${pairs[@]}" >/dev/null

    sent="$(_nudge_pairs "A1" "$num" "$wt" "$_BC_PROMPTS/dispatch-analysis.md" "" "${pairs[@]}")"; nrc=$?
    if [ "$nrc" -eq 2 ]; then
      finish 2 "A1" "broken" "nudge failed for $sent on #$num"
    fi
    if [ -n "$sent" ]; then
      finish 0 "A1" "nudged" "$sent on #$num"
    fi
    finish 1 "A1" "sleep" "repaired stubs for #$num, all leads already busy"
  fi

  pending="$(bc_comment pending-leads "$num")"; rc=$?
  wt="$(bc_session worktree "$num")" || finish 2 "A1" "broken" "worktree lookup failed for #$num"
  if [ "$rc" -eq 1 ]; then
    # A2: every lead in scope is READY.
    bc_issue transition "$num" "In progress" || finish 2 "A2" "broken" "transition to In progress failed for #$num"
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-crew.md"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "A2" "broken" "nudge failed for crew on #$num"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "A2" "marked In progress, dispatched" "crew on #$num"
    fi
    finish 0 "A2" "marked In progress" "#$num"
  elif [ "$rc" -eq 0 ]; then
    # A1 no: nudge exactly the pending leads.
    sent="$(_nudge_all "A1" "$num" "$wt" "$_BC_PROMPTS/dispatch-analysis.md" "" "$pending")"; nrc=$?
    if [ "$nrc" -eq 2 ]; then
      finish 2 "A1" "broken" "nudge failed for $sent on #$num"
    fi
    if [ -n "$sent" ]; then
      finish 0 "A1" "nudged" "$sent on #$num"
    fi
    finish 1 "A1" "sleep" "waiting on $pending (working) on #$num"
  else
    finish 2 "A1" "broken" "pending-leads failed for #$num"
  fi
  ;;

"In progress")
  # ===========================================================================
  # B1 / B2 -- has Crew opened a PR yet.
  # ===========================================================================
  wt="$(bc_session worktree "$num")" || finish 2 "B1" "broken" "worktree lookup failed for #$num"
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  if [ "$rc" -eq 0 ]; then
    pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
    bc_comment create-review-stubs "$pr" "$num" >/dev/null
    bc_issue transition "$num" "Leads review" || finish 2 "B2" "broken" "transition to Leads review failed for #$num"
    finish 0 "B2" "review stubs created, marked Leads review" "PR #$pr for #$num"
  else
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-crew.md"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "B1" "broken" "nudge failed for crew on #$num"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "B1" "nudged" "crew on #$num"
    fi
    finish 1 "B1" "sleep" "crew already busy on #$num"
  fi
  ;;

"Leads review")
  # ===========================================================================
  # C0..C6, in the plan's order: C0 breaker-exists, C1 stale leads, C2/C3 all
  # approved, C5/C6 cycle limit, C4 else. Plus the crash-idempotency repair:
  # a PR exists but carries no status comment yet (a crashed B2).
  # ===========================================================================
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  [ "$rc" -eq 0 ] || finish 2 "C0" "broken" "no PR found for #$num at Leads review"
  pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
  wt="$(bc_session worktree "$num")" || finish 2 "C0" "broken" "worktree lookup failed for #$num"

  if ! bc_comment scope "$pr" >/dev/null 2>&1; then
    bc_comment create-review-stubs "$pr" "$num" >/dev/null
  fi

  if bc_comment breaker-exists "$pr" >/dev/null 2>&1; then
    finish 1 "C0" "sleep" "breaker pending on PR #$pr"
  fi

  stale="$(bc_comment stale-leads "$pr")"; stale_rc=$?
  if [ "$stale_rc" -eq 2 ]; then
    finish 2 "C1" "broken" "stale-leads failed for PR #$pr"
  fi
  if [ "$stale_rc" -eq 0 ]; then
    sent="$(_nudge_all "C1" "$num" "$wt" "$_BC_PROMPTS/dispatch-review.md" "$pr" "$stale")"; nrc=$?
    if [ "$nrc" -eq 2 ]; then
      finish 2 "C1" "broken" "nudge failed for $sent on PR #$pr"
    fi
    if [ -n "$sent" ]; then
      finish 0 "C1" "nudged" "$sent on PR #$pr"
    fi
    finish 1 "C1" "sleep" "waiting on $stale (working) on PR #$pr"
  fi

  # stale_rc == 1: every lead in scope reviewed the current head.
  unapproved="$(bc_comment unapproved-leads "$pr")"; un_rc=$?
  if [ "$un_rc" -eq 1 ]; then
    # C2 yes -> C3: merge, mark Done, tear the sessions down.
    bc_pr merge "$pr" || finish 2 "C3" "broken" "merge failed for PR #$pr"
    bc_issue transition "$num" "Done" || finish 2 "C3" "broken" "transition to Done failed for #$num"
    bc_session stop-all "$num" "$wt" >/dev/null 2>&1
    bc_session rm-worktree "$num" >/dev/null 2>&1
    finish 0 "C3" "merged" "PR #$pr for #$num"
  elif [ "$un_rc" -eq 0 ]; then
    if bc_comment should-trigger-breaker "$pr" >/dev/null 2>&1; then
      bc_comment create-breaker "$pr" >/dev/null 2>&1
      finish 0 "C6" "triggered breaker" "on PR #$pr for #$num"
    fi
    bc_issue transition "$num" "Reviewed" || finish 2 "C4" "broken" "transition to Reviewed failed for #$num"
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-address.md" "$pr"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "C4" "broken" "nudge failed for crew on PR #$pr"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "C4" "marked Reviewed, dispatched" "crew to address PR #$pr"
    fi
    finish 0 "C4" "marked Reviewed" "PR #$pr for #$num"
  else
    finish 2 "C2" "broken" "unapproved-leads failed for PR #$pr"
  fi
  ;;

"Reviewed")
  # ===========================================================================
  # E1 / E2 -- has Crew pushed and updated its comment.
  # ===========================================================================
  pr_json="$(bc_pr for-issue "$num")"; rc=$?
  [ "$rc" -eq 0 ] || finish 2 "E1" "broken" "no PR found for #$num at Reviewed"
  pr="$(printf '%s' "$pr_json" | "$JQ" -r '.number')"
  wt="$(bc_session worktree "$num")" || finish 2 "E1" "broken" "worktree lookup failed for #$num"

  if bc_comment crew-addressed "$pr" >/dev/null 2>&1; then
    bc_comment bump-cycle "$pr" >/dev/null 2>&1
    bc_issue transition "$num" "Leads review" || finish 2 "E2" "broken" "transition to Leads review failed for #$num"
    finish 0 "E2" "bumped cycle, marked Leads review" "PR #$pr for #$num"
  else
    _nudge crew "$num" "$wt" "$_BC_PROMPTS/dispatch-address.md" "$pr"; nrc=$?
    [ "$nrc" -eq 2 ] && finish 2 "E1" "broken" "nudge failed for crew on PR #$pr"
    if [ "$nrc" -eq 0 ]; then
      finish 0 "E1" "nudged" "crew on PR #$pr"
    fi
    finish 1 "E1" "sleep" "crew already busy on PR #$pr"
  fi
  ;;

*)
  finish 2 "SS" "broken" "sub-issue #$num in unrecognised status '$status'"
  ;;

esac
