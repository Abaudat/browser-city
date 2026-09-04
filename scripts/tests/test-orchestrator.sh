#!/usr/bin/env bash
# Fixture-driven coverage for scripts/orchestrator.sh: one scenario per edge
# of agentic-team/high-level-agentic-flow.mmd (demo-active/demo-has-feedback/closing-sprint/starting-next-sprint, sprint-over/creating-demo-issue, starting-dev-cycle,
# leads-analysed/dispatching-implementation, pr-opened/opening-leads-review, breaker-tripped-tripping-breaker, crew-addressed/reopening-leads-review), plus the two crash-idempotency repairs and
# the two hard-failure propagations (bc-issue current's exit 2, an empty
# backlog). Runs orchestrator.sh as a real subprocess -- BC_FAKE drives the
# level-1 primitives, the level-2 scripts run for real underneath it, and
# BC_WAKE_REASON is pointed at a per-scenario file so the written reason
# line can be checked alongside stdout and the exit code.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
ORCH="$SCRIPTS_DIR/orchestrator.sh"
. "$TEST_DIR/harness.sh"
. "$SCRIPTS_DIR/lib/config.sh"
bc_init
. "$SCRIPTS_DIR/lib/markers.sh"
. "$SCRIPTS_DIR/lib/claude.sh"
role8() { bc_role_uuid "$1" "$2" | cut -c1-8; }   # <role> <issue> -> first 8 chars of its derived uuid

# run <fakedir> <now> -- one tick; BC_WAKE_REASON is written beside the
# fixture dir so a test can inspect it directly (checked to equal stdout
# once, below, then trusted for the rest of the file).
run() {
  local fake="$1" now="$2"
  # budget-available is the first branch of every wake now, and lib/budget.sh
  # treats a fake dir with no rate_monitor.json as "the monitor could not
  # answer" -- deliberately, so the gate is never silently open. Every
  # scenario below is about some branch further down, so unless it wrote its
  # own budget fixture it gets one saying there is plenty. The gate's own
  # scenarios, at the top of this file, write theirs first.
  [ -f "$fake/rate_monitor.json" ] || printf '%s' \
    '{"overallStatus":"allowed","session":{"utilization":0.10,"reset":"1788123600"},"weekly":{"utilization":0.20,"reset":"1788512400"}}' \
    > "$fake/rate_monitor.json"
  BC_FAKE="$fake" BC_NOW="$now" BC_WAKE_REASON="$fake/reason.txt" bash "$ORCH"
}

log_has()   { grep -Eq -- "$2" "$1"; }                # <file> <ere>
log_lacks() { ! grep -Eq -- "$2" "$1"; }               # <file> <ere>
log_count() { grep -cE -- "$2" "$1" 2>/dev/null || printf 0; }
line_before() { # <file> <ere-earlier> <ere-later> -- earlier's first match line < later's
  local f="$1" a b
  a="$(grep -nE -- "$2" "$f" | head -1 | cut -d: -f1)"
  b="$(grep -nE -- "$3" "$f" | head -1 | cut -d: -f1)"
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]
}

# _comment <id> -- body on stdin -> one {"id":n,"body":"..."} object, the
# same trick test-bc-comment.sh uses to hand-assemble a comments array.
_comment() {
  local id="$1" body
  body="$(cat)"
  "$JQ" -n -c --arg id "$id" --arg body "$body" '{id: ($id|tonumber), body: $body}'
}

write_iterations() { # <dir> -- mirrors the real project's schedule.
  cat > "$1/project_iterations.json" <<'JSON'
[
  {"id":"cd18e696","title":"Sprint 1","startDate":"2026-09-01","duration":4},
  {"id":"3834dfe6","title":"Sprint 2","startDate":"2026-09-05","duration":7}
]
JSON
}

# one_active <dir> <number> <status> -- the minimal project_items.json for
# subissue-active/subissue-status to find exactly this one active sub-issue.
one_active() {
  local dir="$1" n="$2" status="$3"
  "$JQ" -n -c --argjson n "$n" --arg s "$status" \
    '[{number:$n,title:"story",state:"OPEN",status:$s,priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900}]' \
    > "$dir/project_items.json"
}

NOW_MIDSPRINT="2026-09-02T08:00:00Z"   # Sprint 1, well before the demo hour.

# =============================================================================
echo "budget-available: the gate is the first branch, and nothing runs behind it"
# =============================================================================
# A spent budget and a broken gate both stop the tick, and the pair of them
# is the reason this node exists: they must not read the same. Both
# scenarios below hand the orchestrator a board with real work waiting
# (a Sprint Demo needing an issue), so a tick that got past the gate would
# have written to calls.log -- the absence of that file is the assertion
# that the gate stopped the wake rather than merely commenting on it.
budget_board() { # <dir> -- a board with work the tick would otherwise do
  write_iterations "$1"
  echo '[]' > "$1/project_items.json"
}

F_BUDGET_SPENT="$(fake_dir)"
budget_board "$F_BUDGET_SPENT"
printf '%s' '{"overallStatus":"allowed","session":{"utilization":0.91,"reset":"1788123600"},"weekly":{"utilization":0.20,"reset":"1788512400"}}' \
  > "$F_BUDGET_SPENT/rate_monitor.json"
check_out "budget-available: over the session cap -> sleep, exit 1" 1 \
  "budget-available sleep session=0.91 cap=0.85 resumes=2026-08-30T21:00:00Z" \
  run "$F_BUDGET_SPENT" "$NOW_MIDSPRINT"
check "budget-available: a spent tick touched nothing" 1 test -f "$F_BUDGET_SPENT/calls.log"

F_BUDGET_BROKEN="$(fake_dir)"
budget_board "$F_BUDGET_BROKEN"
printf '%s' 'not json at all' > "$F_BUDGET_BROKEN/rate_monitor.json"
BROKEN_OUT="$(run "$F_BUDGET_BROKEN" "$NOW_MIDSPRINT")"; BROKEN_RC=$?
check "budget-available: a gate that cannot answer exits 2, not 1" 0 \
  test "$BROKEN_RC" = 2
check "budget-available: and the reason says broken, not sleep" 0 \
  grep -q "^budget-available broken " "$F_BUDGET_BROKEN/reason.txt"
check "budget-available: a broken tick touched nothing either" 1 test -f "$F_BUDGET_BROKEN/calls.log"

F_BUDGET_OK="$(fake_dir)"
budget_board "$F_BUDGET_OK"
printf '%s' '{"overallStatus":"allowed","session":{"utilization":0.84,"reset":"1788123600"},"weekly":{"utilization":0.79,"reset":"1788512400"}}' \
  > "$F_BUDGET_OK/rate_monitor.json"
check_out "budget-available: just under both caps falls through to the flow" 1 \
  "starting-dev-cycle sleep backlog empty" \
  run "$F_BUDGET_OK" "$NOW_MIDSPRINT"

# =============================================================================
echo
echo "sanity: the reason file carries exactly what stdout printed"
# =============================================================================
F0="$(fake_dir)"
write_iterations "$F0"
echo '[]' > "$F0/project_items.json"
OUT="$(run "$F0" "$NOW_MIDSPRINT")"
check_out "sanity: backlog empty -> starting-dev-cycle sleep, exit 1" 1 "starting-dev-cycle sleep backlog empty" run "$F0" "$NOW_MIDSPRINT"
check_out "sanity: BC_WAKE_REASON file matches stdout" 0 "$OUT" cat "$F0/reason.txt"
check "sanity: a sleep tick wrote nothing else" 1 test -f "$F0/calls.log"

# =============================================================================
echo
echo "demo-active: Sprint Demo In progress, no human comment yet -> sleep"
# =============================================================================
F_DEMO_ACTIVE="$(fake_dir)"
write_iterations "$F_DEMO_ACTIVE"
"$JQ" -n -c '[{number:40,title:"Sprint 1 Demo",state:"OPEN",status:"In progress",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_DEMO_ACTIVE/project_items.json"
echo '[]' > "$F_DEMO_ACTIVE/gh_issue_comments.40.json"
check_out "demo-active: sleep, awaiting feedback" 1 "demo-active sleep demo #40 awaiting feedback" run "$F_DEMO_ACTIVE" "$NOW_MIDSPRINT"
check "demo-active: wrote nothing" 1 test -f "$F_DEMO_ACTIVE/calls.log"

# =============================================================================
echo
echo "demo-has-feedback: Sprint Demo In progress, Adrian has commented -> sleep (integrating-feedback is unscripted)"
# =============================================================================
F_DEMO_HAS_FEEDBACK="$(fake_dir)"
write_iterations "$F_DEMO_HAS_FEEDBACK"
"$JQ" -n -c '[{number:41,title:"Sprint 1 Demo",state:"OPEN",status:"In progress",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_DEMO_HAS_FEEDBACK/project_items.json"
echo '[{"id":1,"body":"Looks great, ship it!"}]' > "$F_DEMO_HAS_FEEDBACK/gh_issue_comments.41.json"
check_out "demo-has-feedback: sleep, awaiting feedback integration" 1 \
  "demo-has-feedback sleep demo #41 awaiting feedback integration; set the Demo issue to Reviewed" \
  run "$F_DEMO_HAS_FEEDBACK" "$NOW_MIDSPRINT"
check "demo-has-feedback: wrote nothing" 1 test -f "$F_DEMO_HAS_FEEDBACK/calls.log"

# =============================================================================
echo
echo "closing-sprint -> starting-next-sprint: Sprint Demo Reviewed -> close the sprint, start the next"
# =============================================================================
F_SPRINT_ROLLOVER="$(fake_dir)"
write_iterations "$F_SPRINT_ROLLOVER"
"$JQ" -n -c '[{number:42,title:"Sprint 1 Demo",state:"OPEN",status:"Reviewed",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_SPRINT_ROLLOVER/project_items.json"
check_out "closing-sprint/starting-next-sprint: closed and started, exit 0" 0 "starting-next-sprint closed the sprint and started the next after demo #42" \
  run "$F_SPRINT_ROLLOVER" "$NOW_MIDSPRINT"
check "closing-sprint: closed the demo issue (Status Done)" 0 log_has "$F_SPRINT_ROLLOVER/calls.log" '^project_set_single 42 Status Done$'
check "closing-sprint: closed the demo issue on GitHub" 0 log_has "$F_SPRINT_ROLLOVER/calls.log" '^gh_issue_close 42$'

# =============================================================================
echo
echo "sprint-over/creating-demo-issue: sprint over, no demo yet -> create one"
# =============================================================================
F_CREATING_DEMO="$(fake_dir)"
write_iterations "$F_CREATING_DEMO"
echo '[]' > "$F_CREATING_DEMO/project_items.json"
# create-demo hands the work to Scotty, who opens the issue himself with his
# own `write-demo` call; this fixture stands in for that call having run and
# recorded #43 (see claude_oneshot_acting in lib/claude.sh).
printf '43\n' > "$F_CREATING_DEMO/claude_oneshot_acting.judge-demo-summary.md.json"
check_out "sprint-over/creating-demo-issue: created, exit 0" 0 \
  "creating-demo-issue created demo #43 for sprint 1" \
  run "$F_CREATING_DEMO" "2026-09-04T10:01:00Z"
check "sprint-over/creating-demo-issue: handed the sprint's stories to Scotty" 0 \
  log_has "$F_CREATING_DEMO/calls.log" '^claude_oneshot_acting judge-demo-summary\.md$'
check "sprint-over/creating-demo-issue: the orchestrator opened no issue itself" 1 \
  log_has "$F_CREATING_DEMO/calls.log" '^gh_issue_create'

# =============================================================================
echo
echo "sprint-over guarded: sprint over, but a demo already exists for it -> no create, falls through"
# =============================================================================
F_SPRINT_OVER_GUARDED="$(fake_dir)"
write_iterations "$F_SPRINT_OVER_GUARDED"
"$JQ" -n -c '[{number:43,title:"Sprint 1 Demo",state:"CLOSED",status:"Done",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_SPRINT_OVER_GUARDED/project_items.json"
check_out "sprint-over guarded: falls through to starting-dev-cycle sleep (no active sub-issue, empty backlog)" 1 \
  "starting-dev-cycle sleep backlog empty" run "$F_SPRINT_OVER_GUARDED" "2026-09-04T10:01:00Z"
check "sprint-over guarded: wrote nothing at all (falls through to an empty-backlog sleep)" 1 test -f "$F_SPRINT_OVER_GUARDED/calls.log"

# =============================================================================
echo
echo "starting-dev-cycle: no active sub-issue -- picks, transitions, spawns, stubs, dispatches"
# =============================================================================
F_DEV_CYCLE="$(fake_dir)"
write_iterations "$F_DEV_CYCLE"
"$JQ" -n -c '[
  {number:900,title:"Parent",state:"OPEN",status:"Backlog",priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:true,parent:null},
  {number:901,title:"Sub",state:"OPEN",status:"Backlog",priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["lead:tim"],isParent:false,parent:900}
]' > "$F_DEV_CYCLE/project_items.json"
echo '["lead:tim"]' > "$F_DEV_CYCLE/gh_issue_labels.901.json"
printf 'WT901' > "$F_DEV_CYCLE/orca_worktree_path.issue:901.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_DEV_CYCLE/orca_terminal_wait_idle.json"
# scope is "quentin,tim"; both panes are listed but disconnected, so `state`
# reads them as absent, `ensure` starts them (create logged, --session-id
# since there is no transcript) and `send` still resolves their handles.
"$JQ" -n -c --arg u1 "$(role8 quentin 901)" --arg u2 "$(role8 tim 901)" '
  [
    {handle:"hq",title:("✳ bc-quentin #901 (" + $u1 + ")"),agentIdentity:"claude",connected:false,orphaned:false,lastOutputAt:0},
    {handle:"ht",title:("✳ bc-tim #901 (" + $u2 + ")"),agentIdentity:"claude",connected:false,orphaned:false,lastOutputAt:0}
  ]' > "$F_DEV_CYCLE/orca_terminals.WT901.json"
OUT_DEV_CYCLE="$(run "$F_DEV_CYCLE" "$NOW_MIDSPRINT")"; RC_DEV_CYCLE=$?
check_out "starting-dev-cycle: exit 0, dispatched both leads" 0 "starting-dev-cycle started dev cycle, dispatched quentin,tim on #901" \
  bash -c 'printf %s "$1"' _ "$OUT_DEV_CYCLE"
check "starting-dev-cycle: transition to To analyze logged before any terminal create" 0 \
  line_before "$F_DEV_CYCLE/calls.log" '^project_set_single 901 Status To analyze$' '^orca_terminal_create'
check "starting-dev-cycle: spawned quentin" 0 \
  log_has "$F_DEV_CYCLE/calls.log" 'orca_terminal_create WT901 bc-quentin #901'
check "starting-dev-cycle: spawned tim"  0 log_has "$F_DEV_CYCLE/calls.log" 'orca_terminal_create WT901 bc-tim #901'
check "starting-dev-cycle: did not spawn crew (crew starts at dispatching-implementation, with a derived uuid)" 1 \
  log_has "$F_DEV_CYCLE/calls.log" 'orca_terminal_create WT901 bc-crew #901'
check_out "starting-dev-cycle: exactly 2 terminals created (no repeats)" 0 2 \
  log_count "$F_DEV_CYCLE/calls.log" '^orca_terminal_create'
check_out "starting-dev-cycle: created 2 stub comments (one per lead, none for crew)" 0 2 \
  log_count "$F_DEV_CYCLE/calls.log" '^gh_comment_create 901 '
check "starting-dev-cycle: sent to quentin's terminal" 0 log_has "$F_DEV_CYCLE/calls.log" '^orca_terminal_send hq '
check "starting-dev-cycle: sent to tim's terminal"     0 log_has "$F_DEV_CYCLE/calls.log" '^orca_terminal_send ht '
check "starting-dev-cycle: never sent to crew (crew is not nudged at To analyze)" 1 \
  log_has "$F_DEV_CYCLE/calls.log" '^orca_terminal_send h[^qt]'

# =============================================================================
echo
echo "leads-analysed: To analyze, one pending lead -- idle session -> nudged"
# =============================================================================
F_LEADS_ANALYSED_IDLE="$(fake_dir)"
write_iterations "$F_LEADS_ANALYSED_IDLE"
one_active "$F_LEADS_ANALYSED_IDLE" 201 "To analyze"
echo '["lead:tim"]' > "$F_LEADS_ANALYSED_IDLE/gh_issue_labels.201.json"
{
  render_analysis_stub quentin | sed 's/direction PENDING/direction READY/' | _comment 1
  render_analysis_stub tim | _comment 2
} | "$JQ" -sc '.' > "$F_LEADS_ANALYSED_IDLE/gh_issue_comments.201.json"
printf 'WT201' > "$F_LEADS_ANALYSED_IDLE/orca_worktree_path.issue:201.json"
"$JQ" -n -c --arg u "$(role8 tim 201)" '[{handle:"h1",title:("✳ bc-tim #201 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_LEADS_ANALYSED_IDLE/orca_terminals.WT201.json"
check_out "leads-analysed: idle lead gets nudged, exit 0" 0 "leads-analysed nudged tim on #201" run "$F_LEADS_ANALYSED_IDLE" "$NOW_MIDSPRINT"
check "leads-analysed: sent to tim's terminal" 0 log_has "$F_LEADS_ANALYSED_IDLE/calls.log" '^orca_terminal_send h1 '
check "leads-analysed: never spawned (session already existed)" 1 log_has "$F_LEADS_ANALYSED_IDLE/calls.log" '^orca_terminal_create'

echo
echo "leads-analysed: To analyze, one pending lead -- working session -> nothing sent, sleep"
F_LEADS_ANALYSED_WORKING="$(fake_dir)"
write_iterations "$F_LEADS_ANALYSED_WORKING"
one_active "$F_LEADS_ANALYSED_WORKING" 202 "To analyze"
echo '["lead:tim"]' > "$F_LEADS_ANALYSED_WORKING/gh_issue_labels.202.json"
{
  render_analysis_stub quentin | sed 's/direction PENDING/direction READY/' | _comment 1
  render_analysis_stub tim | _comment 2
} | "$JQ" -sc '.' > "$F_LEADS_ANALYSED_WORKING/gh_issue_comments.202.json"
printf 'WT202' > "$F_LEADS_ANALYSED_WORKING/orca_worktree_path.issue:202.json"
"$JQ" -n -c --arg u "$(role8 tim 202)" '[{handle:"h1",title:("◑ bc-tim #202 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_LEADS_ANALYSED_WORKING/orca_terminals.WT202.json"
check_out "leads-analysed: working lead -> sleep, exit 1" 1 "leads-analysed sleep waiting on tim (working) on #202" run "$F_LEADS_ANALYSED_WORKING" "$NOW_MIDSPRINT"
check "leads-analysed: nothing was sent, nothing written at all" 1 test -f "$F_LEADS_ANALYSED_WORKING/calls.log"

echo
echo "leads-analysed: To analyze, one pending lead -- absent session -> restarted then sent"
F_LEADS_ANALYSED_ABSENT="$(fake_dir)"
write_iterations "$F_LEADS_ANALYSED_ABSENT"
one_active "$F_LEADS_ANALYSED_ABSENT" 203 "To analyze"
echo '["lead:tim"]' > "$F_LEADS_ANALYSED_ABSENT/gh_issue_labels.203.json"
{
  render_analysis_stub quentin | sed 's/direction PENDING/direction READY/' | _comment 1
  render_analysis_stub tim | _comment 2
} | "$JQ" -sc '.' > "$F_LEADS_ANALYSED_ABSENT/gh_issue_comments.203.json"
printf 'WT203' > "$F_LEADS_ANALYSED_ABSENT/orca_worktree_path.issue:203.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_LEADS_ANALYSED_ABSENT/orca_terminal_wait_idle.json"
# present in the terminal list but disconnected -> `state` reads it as
# absent, so `ensure` recreates it -- and since _bc_session_find ignores
# connected/orphaned, the later `send` still resolves to this same handle.
"$JQ" -n -c --arg u "$(role8 tim 203)" '[{handle:"h1",title:("✳ bc-tim #203 (" + $u + ")"),agentIdentity:"claude",connected:false,orphaned:false,lastOutputAt:0}]' \
  > "$F_LEADS_ANALYSED_ABSENT/orca_terminals.WT203.json"
check_out "leads-analysed: absent lead -> restarted and nudged, exit 0" 0 "leads-analysed nudged tim on #203" run "$F_LEADS_ANALYSED_ABSENT" "$NOW_MIDSPRINT"
check "leads-analysed: recreated tim's terminal with --session-id (no transcript)" 0 \
  log_has "$F_LEADS_ANALYSED_ABSENT/calls.log" '^orca_terminal_create WT203 bc-tim #203 .*--session-id '
check "leads-analysed: then sent to it" 0 log_has "$F_LEADS_ANALYSED_ABSENT/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "dispatching-implementation: To analyze, every lead READY -> mark In progress, dispatch to Crew"
# =============================================================================
F_DISPATCH_IMPL="$(fake_dir)"
write_iterations "$F_DISPATCH_IMPL"
one_active "$F_DISPATCH_IMPL" 210 "To analyze"
echo '[]' > "$F_DISPATCH_IMPL/gh_issue_labels.210.json"
{
  render_analysis_stub quentin | sed 's/direction PENDING/direction READY/' | _comment 1
} | "$JQ" -sc '.' > "$F_DISPATCH_IMPL/gh_issue_comments.210.json"
printf 'WT210' > "$F_DISPATCH_IMPL/orca_worktree_path.issue:210.json"
"$JQ" -n -c --arg u "$(role8 crew 210)" '[{handle:"h1",title:("✳ bc-crew #210 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_DISPATCH_IMPL/orca_terminals.WT210.json"
check_out "dispatching-implementation: marked In progress, dispatched crew, exit 0" 0 \
  "dispatching-implementation marked In progress, dispatched crew on #210" run "$F_DISPATCH_IMPL" "$NOW_MIDSPRINT"
check "dispatching-implementation: transitioned to In progress" 0 log_has "$F_DISPATCH_IMPL/calls.log" '^project_set_single 210 Status In progress$'
check "dispatching-implementation: sent to crew's terminal" 0 log_has "$F_DISPATCH_IMPL/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "pr-opened: In progress, no PR yet -> nudge Crew"
# =============================================================================
F_PR_OPENED="$(fake_dir)"
write_iterations "$F_PR_OPENED"
one_active "$F_PR_OPENED" 220 "In progress"
{ render_analysis_stub quentin | _comment 1; } | "$JQ" -sc '.' > "$F_PR_OPENED/gh_issue_comments.220.json"
printf 'WT220' > "$F_PR_OPENED/orca_worktree_path.issue:220.json"
"$JQ" -n -c --arg u "$(role8 crew 220)" '[{handle:"h1",title:("✳ bc-crew #220 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_PR_OPENED/orca_terminals.WT220.json"
check_out "pr-opened: no PR -> nudged crew, exit 0" 0 "pr-opened nudged crew on #220" run "$F_PR_OPENED" "$NOW_MIDSPRINT"
check "pr-opened: sent to crew's terminal" 0 log_has "$F_PR_OPENED/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "opening-leads-review: In progress, PR opened -> review stubs created, marked Leads review"
# =============================================================================
F_OPENING_REVIEW="$(fake_dir)"
write_iterations "$F_OPENING_REVIEW"
one_active "$F_OPENING_REVIEW" 230 "In progress"
echo '{"number":55,"headRefOid":"sha1"}' > "$F_OPENING_REVIEW/gh_pr_for_issue.230.json"
echo '["lead:tim"]' > "$F_OPENING_REVIEW/gh_issue_labels.230.json"
echo '[]' > "$F_OPENING_REVIEW/gh_issue_comments.55.json"
printf 'WT230' > "$F_OPENING_REVIEW/orca_worktree_path.issue:230.json"
check_out "opening-leads-review: review stubs + Leads review, exit 0" 0 \
  "opening-leads-review review stubs created, marked Leads review PR #55 for #230" run "$F_OPENING_REVIEW" "$NOW_MIDSPRINT"
check "opening-leads-review: created the status + quentin + tim + crew stubs" 0 \
  log_count "$F_OPENING_REVIEW/calls.log" '^gh_comment_create 55 '
check "opening-leads-review: transitioned to Leads review" 0 \
  log_has "$F_OPENING_REVIEW/calls.log" '^project_set_single 230 Status Leads review$'

# =============================================================================
echo
echo "breaker-tripped: Leads review, a breaker comment already exists -> sleep"
# =============================================================================
F_BREAKER_TRIPPED="$(fake_dir)"
write_iterations "$F_BREAKER_TRIPPED"
one_active "$F_BREAKER_TRIPPED" 240 "Leads review"
echo '{"number":60,"headRefOid":"shaX"}' > "$F_BREAKER_TRIPPED/gh_pr_for_issue.240.json"
{
  render_status 240 "quentin" 1 | _comment 1
  render_breaker "already escalated" | _comment 2
} | "$JQ" -sc '.' > "$F_BREAKER_TRIPPED/gh_issue_comments.60.json"
printf 'WT240' > "$F_BREAKER_TRIPPED/orca_worktree_path.issue:240.json"
check_out "breaker-tripped: breaker exists -> sleep, exit 1" 1 "breaker-tripped sleep breaker pending on PR #60" run "$F_BREAKER_TRIPPED" "$NOW_MIDSPRINT"
check "breaker-tripped: wrote nothing" 1 test -f "$F_BREAKER_TRIPPED/calls.log"

# =============================================================================
echo
echo "leads-reviewed-head: Leads review, one stale lead among two -> nudge exactly that one"
# =============================================================================
F_LEADS_REVIEWED_HEAD="$(fake_dir)"
write_iterations "$F_LEADS_REVIEWED_HEAD"
one_active "$F_LEADS_REVIEWED_HEAD" 250 "Leads review"
echo '{"number":61,"headRefOid":"shaNEW"}' > "$F_LEADS_REVIEWED_HEAD/gh_pr_for_issue.250.json"
echo "shaNEW" > "$F_LEADS_REVIEWED_HEAD/gh_pr_head.61.json"
{
  render_status 250 "quentin,tim" 1 | _comment 1
  printf '### Review — quentin\n\n_Not yet reviewed._\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaOLD -->\n' | _comment 2
  printf '### Review — tim\n\n_Not yet reviewed._\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaNEW -->\n' | _comment 3
} | "$JQ" -sc '.' > "$F_LEADS_REVIEWED_HEAD/gh_issue_comments.61.json"
# the analysis stubs live on the ISSUE; session ids are derived, not read.
{
  render_analysis_stub quentin | _comment 1
  render_analysis_stub tim | _comment 2
} | "$JQ" -sc '.' > "$F_LEADS_REVIEWED_HEAD/gh_issue_comments.250.json"
printf 'WT250' > "$F_LEADS_REVIEWED_HEAD/orca_worktree_path.issue:250.json"
"$JQ" -n -c --arg u "$(role8 quentin 250)" '[{handle:"h1",title:("✳ bc-quentin #250 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_LEADS_REVIEWED_HEAD/orca_terminals.WT250.json"
check_out "leads-reviewed-head: nudged only the stale lead (quentin), exit 0" 0 "leads-reviewed-head nudged quentin on PR #61" run "$F_LEADS_REVIEWED_HEAD" "$NOW_MIDSPRINT"
check "leads-reviewed-head: sent to quentin's terminal" 0 log_has "$F_LEADS_REVIEWED_HEAD/calls.log" '^orca_terminal_send h1 '
check "leads-reviewed-head: tim was never spawned or sent to" 1 log_has "$F_LEADS_REVIEWED_HEAD/calls.log" 'bc-tim #250'

# =============================================================================
echo
echo "merging-pr: Leads review, all approved at current head -> merge, mark Done, tear down"
# =============================================================================
F_MERGING_PR="$(fake_dir)"
write_iterations "$F_MERGING_PR"
one_active "$F_MERGING_PR" 260 "Leads review"
echo '{"number":62,"headRefOid":"shaFINAL"}' > "$F_MERGING_PR/gh_pr_for_issue.260.json"
echo "shaFINAL" > "$F_MERGING_PR/gh_pr_head.62.json"
{
  render_status 260 "quentin" 1 | _comment 1
  printf '### Review — quentin\n\nfine\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaFINAL -->\n<!-- bc:verdict APPROVED -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_MERGING_PR/gh_issue_comments.62.json"
printf 'WT260' > "$F_MERGING_PR/orca_worktree_path.issue:260.json"
"$JQ" -n -c '[
  {handle:"h1",title:"✳ bc-quentin #260 (aaaaaaaa)",agentIdentity:"claude",connected:true,orphaned:false},
  {handle:"h2",title:"✳ bc-crew #260 (bbbbbbbb)",agentIdentity:"claude",connected:true,orphaned:false}
]' > "$F_MERGING_PR/orca_terminals.WT260.json"
check_out "merging-pr: merged, marked Done, exit 0" 0 "merging-pr merged PR #62 for #260" run "$F_MERGING_PR" "$NOW_MIDSPRINT"
check "merging-pr: merged the PR" 0 log_has "$F_MERGING_PR/calls.log" '^gh_pr_merge 62$'
check "merging-pr: closed the issue (Done)" 0 log_has "$F_MERGING_PR/calls.log" '^project_set_single 260 Status Done$'
check "merging-pr: closed it on GitHub too" 0 log_has "$F_MERGING_PR/calls.log" '^gh_issue_close 260$'
check "merging-pr: stopped every session" 0 log_has "$F_MERGING_PR/calls.log" '^orca_terminal_close'
check "merging-pr: removed the worktree" 0 log_has "$F_MERGING_PR/calls.log" '^orca_worktree_rm issue:260$'

# =============================================================================
echo
echo "tripping-breaker: Leads review, cycle past the limit and not all approved -> circuit breaker"
# =============================================================================
F_TRIPPING_BREAKER="$(fake_dir)"
write_iterations "$F_TRIPPING_BREAKER"
one_active "$F_TRIPPING_BREAKER" 270 "Leads review"
echo '{"number":63,"headRefOid":"shaC6"}' > "$F_TRIPPING_BREAKER/gh_pr_for_issue.270.json"
echo "shaC6" > "$F_TRIPPING_BREAKER/gh_pr_head.63.json"
{
  render_status 270 "quentin,tim" 9 | _comment 1
  printf '### Review — quentin\n\nno\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaC6 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 2
  printf '### Review — tim\n\nfine\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaC6 -->\n<!-- bc:verdict APPROVED -->\n' | _comment 3
} | "$JQ" -sc '.' > "$F_TRIPPING_BREAKER/gh_issue_comments.63.json"
# As with the demo, create-breaker only hands the thread over: Scotty posts
# the note himself with `write-breaker`, which is what this fixture stands in
# for -- so gh_comment_create and the breaker label are asserted in
# test-bc-comment.sh, not here.
printf '88\n' > "$F_TRIPPING_BREAKER/claude_oneshot_acting.judge-breaker.md.json"
printf 'WT270' > "$F_TRIPPING_BREAKER/orca_worktree_path.issue:270.json"
check_out "tripping-breaker: circuit breaker triggered, exit 0" 0 "tripping-breaker triggered breaker on PR #63 for #270" run "$F_TRIPPING_BREAKER" "$NOW_MIDSPRINT"
check "tripping-breaker: handed the thread to Scotty" 0 log_has "$F_TRIPPING_BREAKER/calls.log" '^claude_oneshot_acting judge-breaker\.md$'
check "tripping-breaker: the orchestrator posted no comment itself" 1 log_has "$F_TRIPPING_BREAKER/calls.log" '^gh_comment_create 63 '
check "tripping-breaker: never merged" 1 log_has "$F_TRIPPING_BREAKER/calls.log" '^gh_pr_merge'
check "tripping-breaker: never transitioned the issue" 1 log_has "$F_TRIPPING_BREAKER/calls.log" '^project_set_single 270 '

# =============================================================================
echo
echo "dispatching-rework: Leads review, not all approved, cycle under the limit -> Reviewed, dispatch Crew"
# =============================================================================
F_DISPATCH_REWORK="$(fake_dir)"
write_iterations "$F_DISPATCH_REWORK"
one_active "$F_DISPATCH_REWORK" 280 "Leads review"
echo '{"number":64,"headRefOid":"shaC4"}' > "$F_DISPATCH_REWORK/gh_pr_for_issue.280.json"
echo "shaC4" > "$F_DISPATCH_REWORK/gh_pr_head.64.json"
{
  render_status 280 "quentin" 2 | _comment 1
  printf '### Review — quentin\n\nno\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaC4 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_DISPATCH_REWORK/gh_issue_comments.64.json"
{ render_analysis_stub quentin | _comment 1; } | "$JQ" -sc '.' > "$F_DISPATCH_REWORK/gh_issue_comments.280.json"
printf 'WT280' > "$F_DISPATCH_REWORK/orca_worktree_path.issue:280.json"
"$JQ" -n -c --arg u "$(role8 crew 280)" '[{handle:"h1",title:("✳ bc-crew #280 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_DISPATCH_REWORK/orca_terminals.WT280.json"
check_out "dispatching-rework: marked Reviewed, dispatched crew, exit 0" 0 \
  "dispatching-rework marked Reviewed, dispatched crew to address PR #64" run "$F_DISPATCH_REWORK" "$NOW_MIDSPRINT"
check "dispatching-rework: transitioned to Reviewed" 0 log_has "$F_DISPATCH_REWORK/calls.log" '^project_set_single 280 Status Reviewed$'
check "dispatching-rework: sent to crew's terminal" 0 log_has "$F_DISPATCH_REWORK/calls.log" '^orca_terminal_send h1 '
check "dispatching-rework: never merged" 1 log_has "$F_DISPATCH_REWORK/calls.log" '^gh_pr_merge'
check "dispatching-rework: never triggered a breaker" 1 log_has "$F_DISPATCH_REWORK/calls.log" 'breaker'

# =============================================================================
echo
echo "crew-addressed: Reviewed, Crew has not addressed the current head -> nudge Crew"
# =============================================================================
F_CREW_ADDRESSED="$(fake_dir)"
write_iterations "$F_CREW_ADDRESSED"
one_active "$F_CREW_ADDRESSED" 290 "Reviewed"
echo '{"number":65,"headRefOid":"shaE1"}' > "$F_CREW_ADDRESSED/gh_pr_for_issue.290.json"
echo "shaE1" > "$F_CREW_ADDRESSED/gh_pr_head.65.json"
{ printf '### Crew\n\n_Not yet addressed._\n\n<!-- bc:crew -->\n<!-- bc:addressed shaOLD -->\n' | _comment 1; } \
  | "$JQ" -sc '.' > "$F_CREW_ADDRESSED/gh_issue_comments.65.json"
{ render_analysis_stub quentin | _comment 1; } | "$JQ" -sc '.' > "$F_CREW_ADDRESSED/gh_issue_comments.290.json"
printf 'WT290' > "$F_CREW_ADDRESSED/orca_worktree_path.issue:290.json"
"$JQ" -n -c --arg u "$(role8 crew 290)" '[{handle:"h1",title:("✳ bc-crew #290 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_CREW_ADDRESSED/orca_terminals.WT290.json"
check_out "crew-addressed: nudged crew, exit 0" 0 "crew-addressed nudged crew on PR #65" run "$F_CREW_ADDRESSED" "$NOW_MIDSPRINT"
check "crew-addressed: sent to crew's terminal" 0 log_has "$F_CREW_ADDRESSED/calls.log" '^orca_terminal_send h1 '
check "crew-addressed: never bumped the cycle" 1 log_has "$F_CREW_ADDRESSED/calls.log" '^gh_comment_edit'

# =============================================================================
echo
echo "reopening-leads-review: Reviewed, Crew addressed the current head -> bump cycle, back to Leads review"
# =============================================================================
F_REOPENING_REVIEW="$(fake_dir)"
write_iterations "$F_REOPENING_REVIEW"
one_active "$F_REOPENING_REVIEW" 300 "Reviewed"
echo '{"number":66,"headRefOid":"shaE2"}' > "$F_REOPENING_REVIEW/gh_pr_for_issue.300.json"
echo "shaE2" > "$F_REOPENING_REVIEW/gh_pr_head.66.json"
{
  render_status 300 "quentin" 3 | _comment 1
  printf '### Crew\n\n_Not yet addressed._\n\n<!-- bc:crew -->\n<!-- bc:addressed shaE2 -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_REOPENING_REVIEW/gh_issue_comments.66.json"
printf 'WT300' > "$F_REOPENING_REVIEW/orca_worktree_path.issue:300.json"
check_out "reopening-leads-review: bumped cycle, marked Leads review, exit 0" 0 \
  "reopening-leads-review bumped cycle, marked Leads review PR #66 for #300" run "$F_REOPENING_REVIEW" "$NOW_MIDSPRINT"
check "reopening-leads-review: bumped the cycle on the status comment" 0 log_has "$F_REOPENING_REVIEW/calls.log" '^gh_comment_edit 1 '
check "reopening-leads-review: transitioned back to Leads review" 0 \
  log_has "$F_REOPENING_REVIEW/calls.log" '^project_set_single 300 Status Leads review$'

# =============================================================================
echo
echo "crashed starting-dev-cycle: To analyze, status transitioned but no stubs at all -> repair"
# =============================================================================
F_REPAIR="$(fake_dir)"
write_iterations "$F_REPAIR"
one_active "$F_REPAIR" 310 "To analyze"
echo '[]' > "$F_REPAIR/gh_issue_comments.310.json"     # crashed after the transition, before any stub
echo '["lead:tim"]' > "$F_REPAIR/gh_issue_labels.310.json"
printf 'WT310' > "$F_REPAIR/orca_worktree_path.issue:310.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_REPAIR/orca_terminal_wait_idle.json"
"$JQ" -n -c --arg u1 "$(role8 quentin 310)" --arg u2 "$(role8 tim 310)" '
  [
    {handle:"hq",title:("✳ bc-quentin #310 (" + $u1 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0},
    {handle:"ht",title:("✳ bc-tim #310 (" + $u2 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}
  ]' > "$F_REPAIR/orca_terminals.WT310.json"
OUT_REPAIR="$(run "$F_REPAIR" "$NOW_MIDSPRINT")"
check_out "repair: exit 0, both leads dispatched" 0 "leads-analysed nudged quentin,tim on #310" \
  bash -c 'printf %s "$1"' _ "$OUT_REPAIR"
check "repair: no terminal created (both sessions were already up)" 1 log_has "$F_REPAIR/calls.log" '^orca_terminal_create'
check_out "repair: created 2 stub comments" 0 2 log_count "$F_REPAIR/calls.log" '^gh_comment_create 310 '
check "repair: sent to quentin" 0 log_has "$F_REPAIR/calls.log" '^orca_terminal_send hq '
check "repair: sent to tim"     0 log_has "$F_REPAIR/calls.log" '^orca_terminal_send ht '
check "repair: never re-transitioned Status (already To analyze)" 1 \
  log_has "$F_REPAIR/calls.log" '^project_set_single 310 '

# =============================================================================
echo
echo "hard failures: bc-issue current finding two active sub-issues propagates as broken"
# =============================================================================
F_TWO_ACTIVE="$(fake_dir)"
write_iterations "$F_TWO_ACTIVE"
"$JQ" -n -c '[
  {number:320,title:"one",state:"OPEN",status:"To analyze",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900},
  {number:321,title:"two",state:"OPEN",status:"Reviewed",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900}
]' > "$F_TWO_ACTIVE/project_items.json"
check_out "subissue-active: two active sub-issues -> broken, exit 2" 2 "subissue-active broken more than one active sub-issue" \
  run "$F_TWO_ACTIVE" "$NOW_MIDSPRINT"

echo
echo "backlog empty: no active sub-issue, nothing in Backlog -> sleep (already exercised above, re-asserted here for the record)"
F_EMPTY="$(fake_dir)"
write_iterations "$F_EMPTY"
echo '[]' > "$F_EMPTY/project_items.json"
check_out "starting-dev-cycle: empty backlog -> sleep, exit 1" 1 "starting-dev-cycle sleep backlog empty" run "$F_EMPTY" "$NOW_MIDSPRINT"
check "starting-dev-cycle: empty backlog wrote nothing" 1 test -f "$F_EMPTY/calls.log"

summary
