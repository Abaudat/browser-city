#!/usr/bin/env bash
# Fixture-driven coverage for scripts/orchestrator.sh: one scenario per edge
# of agentic-team/high-level-agentic-flow.mmd (QD/DA/DC/DN, QF/DM, N1,
# A1/A2, B1/B2, C0-C6, E1/E2), plus the two crash-idempotency repairs and
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

# run <fakedir> <now> -- one tick; BC_WAKE_REASON is written beside the
# fixture dir so a test can inspect it directly (checked to equal stdout
# once, below, then trusted for the rest of the file).
run() {
  local fake="$1" now="$2"
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
# QS/SS to find exactly this one active sub-issue.
one_active() {
  local dir="$1" n="$2" status="$3"
  "$JQ" -n -c --argjson n "$n" --arg s "$status" \
    '[{number:$n,title:"story",state:"OPEN",status:$s,priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900}]' \
    > "$dir/project_items.json"
}

NOW_MIDSPRINT="2026-09-02T08:00:00Z"   # Sprint 1, well before the demo hour.

# --- deterministic uuids for spawn-heavy scenarios (N1, crash repair) ------
# bc-session.sh's spawn uses `uuidgen` (falling back to python) for a fresh
# id every call -- a fake uuidgen earlier on PATH, counting up from a reset
# counter file, makes that sequence predictable so the fixtures below can
# describe the exact terminals spawn will create.
UUID_BIN="$(fake_dir)"
cat > "$UUID_BIN/uuidgen" <<'EOF'
#!/usr/bin/env bash
n=$(cat "$UUID_COUNTER" 2>/dev/null || echo 0)
n=$((n + 1))
printf '%s' "$n" > "$UUID_COUNTER"
printf '%08x-0000-0000-0000-%012x\n' "$n" "$n"
EOF
chmod +x "$UUID_BIN/uuidgen"

uuid_for() { printf '%08x-0000-0000-0000-%012x\n' "$1" "$1"; }   # <n> -> the uuid uuidgen #n produces
uuid8_for() { printf '%08x' "$1"; }                               # <n> -> its first 8 chars

run_seq() { # <fakedir> <now> <counterfile> -- like run(), with the fake uuidgen on PATH
  local fake="$1" now="$2" counter="$3"
  echo 0 > "$counter"
  PATH="$UUID_BIN:$PATH" UUID_COUNTER="$counter" \
    BC_FAKE="$fake" BC_NOW="$now" BC_WAKE_REASON="$fake/reason.txt" bash "$ORCH"
}

# =============================================================================
echo "sanity: the reason file carries exactly what stdout printed"
# =============================================================================
F0="$(fake_dir)"
write_iterations "$F0"
echo '[]' > "$F0/project_items.json"
OUT="$(run "$F0" "$NOW_MIDSPRINT")"
check_out "sanity: backlog empty -> N1 sleep, exit 1" 1 "N1 sleep backlog empty" run "$F0" "$NOW_MIDSPRINT"
check_out "sanity: BC_WAKE_REASON file matches stdout" 0 "$OUT" cat "$F0/reason.txt"
check "sanity: a sleep tick wrote nothing else" 1 test -f "$F0/calls.log"

# =============================================================================
echo
echo "QD: Sprint Demo In progress, no human comment yet -> sleep"
# =============================================================================
F_QD="$(fake_dir)"
write_iterations "$F_QD"
"$JQ" -n -c '[{number:40,title:"Sprint 1 Demo",state:"OPEN",status:"In progress",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_QD/project_items.json"
echo '[]' > "$F_QD/gh_issue_comments.40.json"
check_out "QD: sleep, awaiting feedback" 1 "QD sleep demo #40 awaiting feedback" run "$F_QD" "$NOW_MIDSPRINT"
check "QD: wrote nothing" 1 test -f "$F_QD/calls.log"

# =============================================================================
echo
echo "DA: Sprint Demo In progress, Adrian has commented -> sleep (FB is unscripted)"
# =============================================================================
F_DA="$(fake_dir)"
write_iterations "$F_DA"
"$JQ" -n -c '[{number:41,title:"Sprint 1 Demo",state:"OPEN",status:"In progress",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_DA/project_items.json"
echo '[{"id":1,"body":"Looks great, ship it!"}]' > "$F_DA/gh_issue_comments.41.json"
check_out "DA: sleep, awaiting feedback integration" 1 \
  "DA sleep demo #41 awaiting feedback integration; set the Demo issue to Reviewed" \
  run "$F_DA" "$NOW_MIDSPRINT"
check "DA: wrote nothing" 1 test -f "$F_DA/calls.log"

# =============================================================================
echo
echo "DC -> DN: Sprint Demo Reviewed -> close the sprint, start the next"
# =============================================================================
F_DN="$(fake_dir)"
write_iterations "$F_DN"
"$JQ" -n -c '[{number:42,title:"Sprint 1 Demo",state:"OPEN",status:"Reviewed",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_DN/project_items.json"
check_out "DC/DN: closed and started, exit 0" 0 "DN closed the sprint and started the next after demo #42" \
  run "$F_DN" "$NOW_MIDSPRINT"
check "DC: closed the demo issue (Status Done)" 0 log_has "$F_DN/calls.log" '^project_set_single 42 Status Done$'
check "DC: closed the demo issue on GitHub" 0 log_has "$F_DN/calls.log" '^gh_issue_close 42$'

# =============================================================================
echo
echo "QF/DM: sprint over, no demo yet -> create one"
# =============================================================================
F_DM="$(fake_dir)"
write_iterations "$F_DM"
echo '[]' > "$F_DM/project_items.json"
printf 'Shipped nothing notable this week.\n' > "$F_DM/claude_oneshot.judge-demo-summary.md.json"
OUT_DM="$(run "$F_DM" "2026-09-04T10:01:00Z")"; RC_DM=$?
check "QF/DM: exit 0" 0 bash -c "exit $RC_DM"
# gh_issue_create has no return-value fixture under BC_FAKE (see bc-issue.sh's
# own note on create-demo) -- the new issue number is legitimately blank here
# even on the success path, so this only pins the shape around it.
check "QF/DM: reason line names DM and sprint 1" 0 \
  bash -c "printf '%s' \"\$1\" | grep -Eq '^DM created demo #.* for sprint 1\$'" _ "$OUT_DM"
check "QF/DM: created the demo issue with the demo label" 0 \
  log_has "$F_DM/calls.log" '^gh_issue_create Sprint 1 Demo .* demo$'

# =============================================================================
echo
echo "QF guarded: sprint over, but a demo already exists for it -> no create, falls through"
# =============================================================================
F_QFG="$(fake_dir)"
write_iterations "$F_QFG"
"$JQ" -n -c '[{number:43,title:"Sprint 1 Demo",state:"CLOSED",status:"Done",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["demo"],isParent:false,parent:null}]' \
  > "$F_QFG/project_items.json"
check_out "QF guarded: falls through to N1 sleep (no active sub-issue, empty backlog)" 1 \
  "N1 sleep backlog empty" run "$F_QFG" "2026-09-04T10:01:00Z"
check "QF guarded: wrote nothing at all (falls through to an empty-backlog sleep)" 1 test -f "$F_QFG/calls.log"

# =============================================================================
echo
echo "N1: no active sub-issue -- picks, transitions, spawns, stubs, dispatches"
# =============================================================================
F_N1="$(fake_dir)"
write_iterations "$F_N1"
"$JQ" -n -c '[
  {number:900,title:"Parent",state:"OPEN",status:"Backlog",priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:true,parent:null},
  {number:901,title:"Sub",state:"OPEN",status:"Backlog",priority:"Standard",sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:["lead:tim"],isParent:false,parent:900}
]' > "$F_N1/project_items.json"
echo '["lead:tim"]' > "$F_N1/gh_issue_labels.901.json"
printf 'WT901' > "$F_N1/orca_worktree_path.issue:901.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_N1/orca_terminal_wait_idle.json"
# scope is "quentin,tim" (BC_LEADS order) -> spawn order is quentin(#1), tim(#2), crew(#3)
"$JQ" -n -c --arg u1 "$(uuid8_for 1)" --arg u2 "$(uuid8_for 2)" '
  [
    {handle:"hq",title:("✳ bc-quentin #901 (" + $u1 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0},
    {handle:"ht",title:("✳ bc-tim #901 (" + $u2 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}
  ]' > "$F_N1/orca_terminals.WT901.json"
CNT_N1="$F_N1/uuid-counter.txt"
OUT_N1="$(run_seq "$F_N1" "$NOW_MIDSPRINT" "$CNT_N1")"; RC_N1=$?
check_out "N1: exit 0, dispatched both leads" 0 "N1 started dev cycle, dispatched quentin,tim on #901" \
  bash -c 'printf %s "$1"' _ "$OUT_N1"
check "N1: transition to To analyze logged before any terminal create" 0 \
  line_before "$F_N1/calls.log" '^project_set_single 901 Status To analyze$' '^orca_terminal_create'
check "N1: spawned quentin, tim and crew" 0 \
  log_has "$F_N1/calls.log" 'orca_terminal_create WT901 bc-quentin #901'
check "N1: spawned tim"  0 log_has "$F_N1/calls.log" 'orca_terminal_create WT901 bc-tim #901'
check "N1: spawned crew" 0 log_has "$F_N1/calls.log" 'orca_terminal_create WT901 bc-crew #901'
check "N1: exactly 3 terminals created (no repeats)" 0 \
  log_count "$F_N1/calls.log" '^orca_terminal_create'
check "N1: created 3 stub comments" 0 log_count "$F_N1/calls.log" '^gh_comment_create 901 '
check "N1: sent to quentin's terminal" 0 log_has "$F_N1/calls.log" '^orca_terminal_send hq '
check "N1: sent to tim's terminal"     0 log_has "$F_N1/calls.log" '^orca_terminal_send ht '
check "N1: never sent to crew (crew is not nudged at To analyze)" 1 \
  log_has "$F_N1/calls.log" '^orca_terminal_send h[^qt]'

# =============================================================================
echo
echo "A1: To analyze, one pending lead -- idle session -> nudged"
# =============================================================================
F_A1I="$(fake_dir)"
write_iterations "$F_A1I"
one_active "$F_A1I" 201 "To analyze"
{ render_analysis_stub tim "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_A1I/gh_issue_comments.201.json"
printf 'WT201' > "$F_A1I/orca_worktree_path.issue:201.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-tim #201 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_A1I/orca_terminals.WT201.json"
check_out "A1: idle lead gets nudged, exit 0" 0 "A1 nudged tim on #201" run "$F_A1I" "$NOW_MIDSPRINT"
check "A1: sent to tim's terminal" 0 log_has "$F_A1I/calls.log" '^orca_terminal_send h1 '
check "A1: never spawned (session already existed)" 1 log_has "$F_A1I/calls.log" '^orca_terminal_create'

echo
echo "A1: To analyze, one pending lead -- working session -> nothing sent, sleep"
F_A1W="$(fake_dir)"
write_iterations "$F_A1W"
one_active "$F_A1W" 202 "To analyze"
{ render_analysis_stub tim "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_A1W/gh_issue_comments.202.json"
printf 'WT202' > "$F_A1W/orca_worktree_path.issue:202.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("◑ bc-tim #202 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_A1W/orca_terminals.WT202.json"
check_out "A1: working lead -> sleep, exit 1" 1 "A1 sleep waiting on tim (working) on #202" run "$F_A1W" "$NOW_MIDSPRINT"
check "A1: nothing was sent, nothing written at all" 1 test -f "$F_A1W/calls.log"

echo
echo "A1: To analyze, one pending lead -- absent session -> restarted then sent"
F_A1A="$(fake_dir)"
write_iterations "$F_A1A"
one_active "$F_A1A" 203 "To analyze"
{ render_analysis_stub tim "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_A1A/gh_issue_comments.203.json"
printf 'WT203' > "$F_A1A/orca_worktree_path.issue:203.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_A1A/orca_terminal_wait_idle.json"
# present in the terminal list but disconnected -> `state` reads it as
# absent, so `ensure` recreates it -- and since _bc_session_find ignores
# connected/orphaned, the later `send` still resolves to this same handle.
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-tim #203 (" + $u + ")"),agentIdentity:"claude",connected:false,orphaned:false,lastOutputAt:0}]' \
  > "$F_A1A/orca_terminals.WT203.json"
check_out "A1: absent lead -> restarted and nudged, exit 0" 0 "A1 nudged tim on #203" run "$F_A1A" "$NOW_MIDSPRINT"
check "A1: recreated tim's terminal with --session-id (no transcript)" 0 \
  log_has "$F_A1A/calls.log" '^orca_terminal_create WT203 bc-tim #203 .*--session-id '
check "A1: then sent to it" 0 log_has "$F_A1A/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "A2: To analyze, every lead READY -> mark In progress, dispatch to Crew"
# =============================================================================
F_A2="$(fake_dir)"
write_iterations "$F_A2"
one_active "$F_A2" 210 "To analyze"
{
  render_analysis_stub quentin "$(uuid_for 99)" | sed 's/direction PENDING/direction READY/' | _comment 1
  render_crew_stub "$(uuid_for 50)" | _comment 2
} | "$JQ" -sc '.' > "$F_A2/gh_issue_comments.210.json"
printf 'WT210' > "$F_A2/orca_worktree_path.issue:210.json"
"$JQ" -n -c --arg u "$(uuid8_for 50)" '[{handle:"h1",title:("✳ bc-crew #210 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_A2/orca_terminals.WT210.json"
check_out "A2: marked In progress, dispatched crew, exit 0" 0 \
  "A2 marked In progress, dispatched crew on #210" run "$F_A2" "$NOW_MIDSPRINT"
check "A2: transitioned to In progress" 0 log_has "$F_A2/calls.log" '^project_set_single 210 Status In progress$'
check "A2: sent to crew's terminal" 0 log_has "$F_A2/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "B1: In progress, no PR yet -> nudge Crew"
# =============================================================================
F_B1="$(fake_dir)"
write_iterations "$F_B1"
one_active "$F_B1" 220 "In progress"
{ render_crew_stub "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_B1/gh_issue_comments.220.json"
printf 'WT220' > "$F_B1/orca_worktree_path.issue:220.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-crew #220 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_B1/orca_terminals.WT220.json"
check_out "B1: no PR -> nudged crew, exit 0" 0 "B1 nudged crew on #220" run "$F_B1" "$NOW_MIDSPRINT"
check "B1: sent to crew's terminal" 0 log_has "$F_B1/calls.log" '^orca_terminal_send h1 '

# =============================================================================
echo
echo "B2: In progress, PR opened -> review stubs created, marked Leads review"
# =============================================================================
F_B2="$(fake_dir)"
write_iterations "$F_B2"
one_active "$F_B2" 230 "In progress"
echo '{"number":55,"headRefOid":"sha1"}' > "$F_B2/gh_pr_for_issue.230.json"
echo '["lead:tim"]' > "$F_B2/gh_issue_labels.230.json"
echo '[]' > "$F_B2/gh_issue_comments.55.json"
printf 'WT230' > "$F_B2/orca_worktree_path.issue:230.json"
check_out "B2: review stubs + Leads review, exit 0" 0 \
  "B2 review stubs created, marked Leads review PR #55 for #230" run "$F_B2" "$NOW_MIDSPRINT"
check "B2: created the status + quentin + tim + crew stubs" 0 \
  log_count "$F_B2/calls.log" '^gh_comment_create 55 '
check "B2: transitioned to Leads review" 0 \
  log_has "$F_B2/calls.log" '^project_set_single 230 Status Leads review$'

# =============================================================================
echo
echo "C0: Leads review, a breaker comment already exists -> sleep"
# =============================================================================
F_C0="$(fake_dir)"
write_iterations "$F_C0"
one_active "$F_C0" 240 "Leads review"
echo '{"number":60,"headRefOid":"shaX"}' > "$F_C0/gh_pr_for_issue.240.json"
{
  render_status 240 "quentin" 1 | _comment 1
  render_breaker "already escalated" | _comment 2
} | "$JQ" -sc '.' > "$F_C0/gh_issue_comments.60.json"
printf 'WT240' > "$F_C0/orca_worktree_path.issue:240.json"
check_out "C0: breaker exists -> sleep, exit 1" 1 "C0 sleep breaker pending on PR #60" run "$F_C0" "$NOW_MIDSPRINT"
check "C0: wrote nothing" 1 test -f "$F_C0/calls.log"

# =============================================================================
echo
echo "C1: Leads review, one stale lead among two -> nudge exactly that one"
# =============================================================================
F_C1="$(fake_dir)"
write_iterations "$F_C1"
one_active "$F_C1" 250 "Leads review"
echo '{"number":61,"headRefOid":"shaNEW"}' > "$F_C1/gh_pr_for_issue.250.json"
echo "shaNEW" > "$F_C1/gh_pr_head.61.json"
{
  render_status 250 "quentin,tim" 1 | _comment 1
  printf '### Review — quentin\n\n_Not yet reviewed._\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaOLD -->\n' | _comment 2
  printf '### Review — tim\n\n_Not yet reviewed._\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaNEW -->\n' | _comment 3
} | "$JQ" -sc '.' > "$F_C1/gh_issue_comments.61.json"
# the session record lives on the ISSUE (analysis stubs), not the PR.
{
  render_analysis_stub quentin "$(uuid_for 99)" | _comment 1
  render_analysis_stub tim "$(uuid_for 98)" | _comment 2
} | "$JQ" -sc '.' > "$F_C1/gh_issue_comments.250.json"
printf 'WT250' > "$F_C1/orca_worktree_path.issue:250.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-quentin #250 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_C1/orca_terminals.WT250.json"
check_out "C1: nudged only the stale lead (quentin), exit 0" 0 "C1 nudged quentin on PR #61" run "$F_C1" "$NOW_MIDSPRINT"
check "C1: sent to quentin's terminal" 0 log_has "$F_C1/calls.log" '^orca_terminal_send h1 '
check "C1: tim was never spawned or sent to" 1 log_has "$F_C1/calls.log" 'bc-tim #250'

# =============================================================================
echo
echo "C3: Leads review, all approved at current head -> merge, mark Done, tear down"
# =============================================================================
F_C3="$(fake_dir)"
write_iterations "$F_C3"
one_active "$F_C3" 260 "Leads review"
echo '{"number":62,"headRefOid":"shaFINAL"}' > "$F_C3/gh_pr_for_issue.260.json"
echo "shaFINAL" > "$F_C3/gh_pr_head.62.json"
{
  render_status 260 "quentin" 1 | _comment 1
  printf '### Review — quentin\n\nfine\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaFINAL -->\n<!-- bc:verdict APPROVED -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_C3/gh_issue_comments.62.json"
printf 'WT260' > "$F_C3/orca_worktree_path.issue:260.json"
"$JQ" -n -c '[
  {handle:"h1",title:"✳ bc-quentin #260 (aaaaaaaa)",agentIdentity:"claude",connected:true,orphaned:false},
  {handle:"h2",title:"✳ bc-crew #260 (bbbbbbbb)",agentIdentity:"claude",connected:true,orphaned:false}
]' > "$F_C3/orca_terminals.WT260.json"
check_out "C3: merged, marked Done, exit 0" 0 "C3 merged PR #62 for #260" run "$F_C3" "$NOW_MIDSPRINT"
check "C3: merged the PR" 0 log_has "$F_C3/calls.log" '^gh_pr_merge 62$'
check "C3: closed the issue (Done)" 0 log_has "$F_C3/calls.log" '^project_set_single 260 Status Done$'
check "C3: closed it on GitHub too" 0 log_has "$F_C3/calls.log" '^gh_issue_close 260$'
check "C3: stopped every session" 0 log_has "$F_C3/calls.log" '^orca_terminal_close'
check "C3: removed the worktree" 0 log_has "$F_C3/calls.log" '^orca_worktree_rm issue:260$'

# =============================================================================
echo
echo "C6: Leads review, cycle past the limit and not all approved -> circuit breaker"
# =============================================================================
F_C6="$(fake_dir)"
write_iterations "$F_C6"
one_active "$F_C6" 270 "Leads review"
echo '{"number":63,"headRefOid":"shaC6"}' > "$F_C6/gh_pr_for_issue.270.json"
echo "shaC6" > "$F_C6/gh_pr_head.63.json"
{
  render_status 270 "quentin,tim" 9 | _comment 1
  printf '### Review — quentin\n\nno\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaC6 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 2
  printf '### Review — tim\n\nfine\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaC6 -->\n<!-- bc:verdict APPROVED -->\n' | _comment 3
} | "$JQ" -sc '.' > "$F_C6/gh_issue_comments.63.json"
printf 'Quentin and Tim disagree. Adrian, which way?\n' > "$F_C6/claude_oneshot.judge-breaker.md.json"
printf 'WT270' > "$F_C6/orca_worktree_path.issue:270.json"
check_out "C6: circuit breaker triggered, exit 0" 0 "C6 triggered breaker on PR #63 for #270" run "$F_C6" "$NOW_MIDSPRINT"
check "C6: posted the breaker comment" 0 log_has "$F_C6/calls.log" '^gh_comment_create 63 '
check "C6: labelled the PR breaker" 0 log_has "$F_C6/calls.log" '^gh_pr_add_labels 63 breaker$'
check "C6: never merged" 1 log_has "$F_C6/calls.log" '^gh_pr_merge'
check "C6: never transitioned the issue" 1 log_has "$F_C6/calls.log" '^project_set_single 270 '

# =============================================================================
echo
echo "C4: Leads review, not all approved, cycle under the limit -> Reviewed, dispatch Crew"
# =============================================================================
F_C4="$(fake_dir)"
write_iterations "$F_C4"
one_active "$F_C4" 280 "Leads review"
echo '{"number":64,"headRefOid":"shaC4"}' > "$F_C4/gh_pr_for_issue.280.json"
echo "shaC4" > "$F_C4/gh_pr_head.64.json"
{
  render_status 280 "quentin" 2 | _comment 1
  printf '### Review — quentin\n\nno\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaC4 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_C4/gh_issue_comments.64.json"
{ render_crew_stub "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_C4/gh_issue_comments.280.json"
printf 'WT280' > "$F_C4/orca_worktree_path.issue:280.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-crew #280 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_C4/orca_terminals.WT280.json"
check_out "C4: marked Reviewed, dispatched crew, exit 0" 0 \
  "C4 marked Reviewed, dispatched crew to address PR #64" run "$F_C4" "$NOW_MIDSPRINT"
check "C4: transitioned to Reviewed" 0 log_has "$F_C4/calls.log" '^project_set_single 280 Status Reviewed$'
check "C4: sent to crew's terminal" 0 log_has "$F_C4/calls.log" '^orca_terminal_send h1 '
check "C4: never merged" 1 log_has "$F_C4/calls.log" '^gh_pr_merge'
check "C4: never triggered a breaker" 1 log_has "$F_C4/calls.log" 'breaker'

# =============================================================================
echo
echo "E1: Reviewed, Crew has not addressed the current head -> nudge Crew"
# =============================================================================
F_E1="$(fake_dir)"
write_iterations "$F_E1"
one_active "$F_E1" 290 "Reviewed"
echo '{"number":65,"headRefOid":"shaE1"}' > "$F_E1/gh_pr_for_issue.290.json"
echo "shaE1" > "$F_E1/gh_pr_head.65.json"
{ printf '### Crew\n\n_Not yet addressed._\n\n<!-- bc:crew -->\n<!-- bc:addressed shaOLD -->\n' | _comment 1; } \
  | "$JQ" -sc '.' > "$F_E1/gh_issue_comments.65.json"
{ render_crew_stub "$(uuid_for 99)" | _comment 1; } | "$JQ" -sc '.' > "$F_E1/gh_issue_comments.290.json"
printf 'WT290' > "$F_E1/orca_worktree_path.issue:290.json"
"$JQ" -n -c --arg u "$(uuid8_for 99)" '[{handle:"h1",title:("✳ bc-crew #290 (" + $u + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}]' \
  > "$F_E1/orca_terminals.WT290.json"
check_out "E1: nudged crew, exit 0" 0 "E1 nudged crew on PR #65" run "$F_E1" "$NOW_MIDSPRINT"
check "E1: sent to crew's terminal" 0 log_has "$F_E1/calls.log" '^orca_terminal_send h1 '
check "E1: never bumped the cycle" 1 log_has "$F_E1/calls.log" '^gh_comment_edit'

# =============================================================================
echo
echo "E2: Reviewed, Crew addressed the current head -> bump cycle, back to Leads review"
# =============================================================================
F_E2="$(fake_dir)"
write_iterations "$F_E2"
one_active "$F_E2" 300 "Reviewed"
echo '{"number":66,"headRefOid":"shaE2"}' > "$F_E2/gh_pr_for_issue.300.json"
echo "shaE2" > "$F_E2/gh_pr_head.66.json"
{
  render_status 300 "quentin" 3 | _comment 1
  printf '### Crew\n\n_Not yet addressed._\n\n<!-- bc:crew -->\n<!-- bc:addressed shaE2 -->\n' | _comment 2
} | "$JQ" -sc '.' > "$F_E2/gh_issue_comments.66.json"
printf 'WT300' > "$F_E2/orca_worktree_path.issue:300.json"
check_out "E2: bumped cycle, marked Leads review, exit 0" 0 \
  "E2 bumped cycle, marked Leads review PR #66 for #300" run "$F_E2" "$NOW_MIDSPRINT"
check "E2: bumped the cycle on the status comment" 0 log_has "$F_E2/calls.log" '^gh_comment_edit 1 '
check "E2: transitioned back to Leads review" 0 \
  log_has "$F_E2/calls.log" '^project_set_single 300 Status Leads review$'

# =============================================================================
echo
echo "crashed N1: To analyze, status transitioned but no stubs at all -> repair"
# =============================================================================
F_CR="$(fake_dir)"
write_iterations "$F_CR"
one_active "$F_CR" 310 "To analyze"
echo '[]' > "$F_CR/gh_issue_comments.310.json"     # crashed after the transition, before any stub
echo '["lead:tim"]' > "$F_CR/gh_issue_labels.310.json"
printf 'WT310' > "$F_CR/orca_worktree_path.issue:310.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F_CR/orca_terminal_wait_idle.json"
"$JQ" -n -c --arg u1 "$(uuid8_for 1)" --arg u2 "$(uuid8_for 2)" '
  [
    {handle:"hq",title:("✳ bc-quentin #310 (" + $u1 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0},
    {handle:"ht",title:("✳ bc-tim #310 (" + $u2 + ")"),agentIdentity:"claude",connected:true,orphaned:false,lastOutputAt:0}
  ]' > "$F_CR/orca_terminals.WT310.json"
CNT_CR="$F_CR/uuid-counter.txt"
OUT_CR="$(run_seq "$F_CR" "$NOW_MIDSPRINT" "$CNT_CR")"
check_out "repair: exit 0, both leads dispatched" 0 "A1 nudged quentin,tim on #310" \
  bash -c 'printf %s "$1"' _ "$OUT_CR"
check "repair: spawned quentin, tim and crew" 0 log_count "$F_CR/calls.log" '^orca_terminal_create'
check "repair: created 3 stub comments" 0 log_count "$F_CR/calls.log" '^gh_comment_create 310 '
check "repair: sent to quentin" 0 log_has "$F_CR/calls.log" '^orca_terminal_send hq '
check "repair: sent to tim"     0 log_has "$F_CR/calls.log" '^orca_terminal_send ht '
check "repair: never re-transitioned Status (already To analyze)" 1 \
  log_has "$F_CR/calls.log" '^project_set_single 310 '

# =============================================================================
echo
echo "hard failures: bc-issue current finding two active sub-issues propagates as broken"
# =============================================================================
F_QS2="$(fake_dir)"
write_iterations "$F_QS2"
"$JQ" -n -c '[
  {number:320,title:"one",state:"OPEN",status:"To analyze",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900},
  {number:321,title:"two",state:"OPEN",status:"Reviewed",priority:null,sprintId:"cd18e696",sprintTitle:"Sprint 1",labels:[],isParent:false,parent:900}
]' > "$F_QS2/project_items.json"
check_out "QS: two active sub-issues -> broken, exit 2" 2 "QS broken more than one active sub-issue" \
  run "$F_QS2" "$NOW_MIDSPRINT"

echo
echo "backlog empty: no active sub-issue, nothing in Backlog -> sleep (already exercised above, re-asserted here for the record)"
F_EMPTY="$(fake_dir)"
write_iterations "$F_EMPTY"
echo '[]' > "$F_EMPTY/project_items.json"
check_out "N1: empty backlog -> sleep, exit 1" 1 "N1 sleep backlog empty" run "$F_EMPTY" "$NOW_MIDSPRINT"
check "N1: empty backlog wrote nothing" 1 test -f "$F_EMPTY/calls.log"

summary
