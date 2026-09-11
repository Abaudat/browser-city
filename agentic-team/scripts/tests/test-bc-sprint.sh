#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-sprint.sh: current/next/over at
# pinned clock values, close's carry/clear/demo-close bookkeeping, items'
# sprint read, start's handoff to Scotty, and write-scope's two guards --
# candidates only, and the epic order -- which are what stands between a
# picked number and the board.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_SPRINT="$SCRIPTS_DIR/bc-sprint.sh"
. "$TEST_DIR/harness.sh"
. "$SCRIPTS_DIR/lib/config.sh"
bc_init

run() { # <fakedir> <now-or-empty> <args...>
  local fake="$1" now="$2"; shift 2
  BC_FAKE="$fake" BC_NOW="$now" bash "$BC_SPRINT" "$@"
}

log_has() { grep -Eq -- "$2" "$1"; } # <file> <regex>

# Mirrors the real iteration schedule: Sprint 1 = 2026-09-01 (4 days), then
# Sat->Fri 7-day sprints. end is computed at runtime by _project_iter_end.
write_iterations() { # <dir>
  cat > "$1/project_iterations.json" <<'JSON'
[
  {"id":"cd18e696","title":"Sprint 1","startDate":"2026-09-01","duration":4},
  {"id":"sp2","title":"Sprint 2","startDate":"2026-09-05","duration":7},
  {"id":"sp3","title":"Sprint 3","startDate":"2026-09-12","duration":7},
  {"id":"sp4","title":"Sprint 4","startDate":"2026-09-19","duration":7},
  {"id":"sp5","title":"Sprint 5","startDate":"2026-09-26","duration":7},
  {"id":"sp6","title":"Sprint 6","startDate":"2026-10-03","duration":7}
]
JSON
}

echo "current / next / over across pinned clock values:"

FAKE_C="$(fake_dir)"
write_iterations "$FAKE_C"

# 2026-09-04T09:59:00Z = 11:59 local (CEST, UTC+2) -- still Sprint 1, before demo hour.
check_out "current: 11:59 on Sprint 1's last day is still Sprint 1" 0 \
  '{"number":1,"id":"cd18e696","title":"Sprint 1","start":"2026-09-01","end":"2026-09-04"}' \
  run "$FAKE_C" 2026-09-04T09:59:00Z current
check_out "next: from Sprint 1's last day, next is Sprint 2" 0 \
  '{"number":2,"id":"sp2","title":"Sprint 2","start":"2026-09-05","end":"2026-09-11"}' \
  run "$FAKE_C" 2026-09-04T09:59:00Z next
check_out "over: 11:59 local, before BC_DEMO_HOUR -> no" 1 no \
  run "$FAKE_C" 2026-09-04T09:59:00Z over

# 2026-09-04T10:01:00Z = 12:01 local -- same day, past the demo hour.
check_out "current: 12:01 on Sprint 1's last day is still Sprint 1" 0 \
  '{"number":1,"id":"cd18e696","title":"Sprint 1","start":"2026-09-01","end":"2026-09-04"}' \
  run "$FAKE_C" 2026-09-04T10:01:00Z current
check_out "over: 12:01 local, at/after BC_DEMO_HOUR -> yes" 0 yes \
  run "$FAKE_C" 2026-09-04T10:01:00Z over

# Mid-sprint day: nowhere near the boundary.
check_out "current: mid-sprint day resolves to Sprint 1" 0 \
  '{"number":1,"id":"cd18e696","title":"Sprint 1","start":"2026-09-01","end":"2026-09-04"}' \
  run "$FAKE_C" 2026-09-02T08:00:00Z current
check_out "over: mid-sprint day -> no" 1 no \
  run "$FAKE_C" 2026-09-02T08:00:00Z over
check_out "next: mid-sprint day still resolves to Sprint 2" 0 \
  '{"number":2,"id":"sp2","title":"Sprint 2","start":"2026-09-05","end":"2026-09-11"}' \
  run "$FAKE_C" 2026-09-02T08:00:00Z next

# Before any configured sprint: current absent, next falls back to the
# earliest iteration starting after today.
check "current: before all sprints -> exit 1" 1 \
  run "$FAKE_C" 2026-08-01T08:00:00Z current
check_out "next: before all sprints falls back to the first upcoming iteration" 0 \
  '{"number":1,"id":"cd18e696","title":"Sprint 1","start":"2026-09-01","end":"2026-09-04"}' \
  run "$FAKE_C" 2026-08-01T08:00:00Z next

# A day past every configured sprint: nothing is current, nothing is next,
# and "over" (which needs a current sprint's end) is also a clean no/exit1.
check "current: a day past all sprints -> exit 1" 1 \
  run "$FAKE_C" 2026-12-25T08:00:00Z current
check "next: a day past all sprints -> exit 1"    1 \
  run "$FAKE_C" 2026-12-25T08:00:00Z next
check_out "over: a day past all sprints -> no" 1 no \
  run "$FAKE_C" 2026-12-25T08:00:00Z over

echo
echo "close: carries active work + its epic, unscopes what stayed in Backlog, closes the demo:"

FAKE_CL="$(fake_dir)"
write_iterations "$FAKE_CL"
cat > "$FAKE_CL/project_items.json" <<'JSON'
[
  {"number":10,"title":"Parent P1","state":"OPEN","status":"In progress","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":11,"title":"Sub A","state":"OPEN","status":"In progress","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":10},
  {"number":12,"title":"Sub B","state":"OPEN","status":"Backlog","priority":"Low","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":10},
  {"number":13,"title":"Sub C","state":"CLOSED","status":"Done","priority":"Low","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":10},
  {"number":20,"title":"Parent P2","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":21,"title":"Sub D","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":20},
  {"number":30,"title":"Standalone backlog","state":"OPEN","status":"Backlog","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":31,"title":"Standalone done","state":"CLOSED","status":"Done","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":99,"title":"Sprint 1 Demo","state":"OPEN","status":"In progress","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null},
  {"number":40,"title":"Not this sprint","state":"OPEN","status":"Backlog","priority":null,"sprintId":"sp2","sprintTitle":"Sprint 2","labels":[],"isParent":false,"parent":null}
]
JSON

# 12 is the case the sprint boundary turns on: a story scoped into Sprint 1,
# never reached, still Backlog. It does NOT ride into Sprint 2 on the back of
# its epic -- it keeps its Status and goes back to the unscoped backlog, for
# the next sprint's scoping to weigh against everything else.
check_out "close: summary carries the active sub + its epic, unscopes every Backlog item, closes the demo" 0   '{"carried":[10,11],"cleared":[12,20,21,30],"demo":99}'   run "$FAKE_CL" 2026-09-03T08:00:00Z close

check "close logged carry for the epic of the active sub" 0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 10 sp2$'
check "close logged carry for the active sub"       0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 11 sp2$'
check "close unscoped the untouched backlog sibling" 0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 12 clear$'
check "close never carried the untouched backlog sibling" 1   log_has "$FAKE_CL/calls.log" '^project_set_iteration 12 sp2$'
check "close logged clear for the idle epic"        0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 20 clear$'
check "close logged clear for its backlog sub"      0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 21 clear$'
check "close logged clear for the standalone issue" 0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 30 clear$'
check "close wrote no Status but the demo's"        1 log_has "$FAKE_CL/calls.log" '^project_set_single [123][0-9] '
check "close never touched the done sub-issue"      1 log_has "$FAKE_CL/calls.log" '(^| )13( |$)'
check "close never touched the done standalone"     1 log_has "$FAKE_CL/calls.log" '(^| )31( |$)'
check "close never touched next sprint's own item"  1 log_has "$FAKE_CL/calls.log" '(^| )40( |$)'
check "close marked the demo issue Done"            0 log_has "$FAKE_CL/calls.log" '^project_set_single 99 Status Done$'
check "close closed the demo issue"                 0 log_has "$FAKE_CL/calls.log" '^gh_issue_close 99$'

echo
echo "close: two Backlog and one Reviewed, all on the closing sprint:"

FAKE_CL3="$(fake_dir)"
write_iterations "$FAKE_CL3"
cat > "$FAKE_CL3/project_items.json" <<'JSON'
[
  {"number":80,"title":"Task 0, Backlog","state":"OPEN","status":"Backlog","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":81,"title":"Task 1, Backlog","state":"OPEN","status":"Backlog","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":82,"title":"Task 2, Reviewed","state":"OPEN","status":"Reviewed","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null}
]
JSON
check_out "close: the Reviewed task moves on, the two Backlog tasks come off the sprint" 0   '{"carried":[82],"cleared":[80,81],"demo":null}'   run "$FAKE_CL3" 2026-09-03T08:00:00Z close
check "close moved the Reviewed task to the next sprint" 0   log_has "$FAKE_CL3/calls.log" '^project_set_iteration 82 sp2$'
check "close unscoped the first Backlog task"  0 log_has "$FAKE_CL3/calls.log" '^project_set_iteration 80 clear$'
check "close unscoped the second Backlog task" 0 log_has "$FAKE_CL3/calls.log" '^project_set_iteration 81 clear$'
check "close rewrote no Status at all"         1 log_has "$FAKE_CL3/calls.log" '^project_set_single'

echo
echo "close: no current sprint for today -> exit 2, nothing written:"
FAKE_CL2="$(fake_dir)"
write_iterations "$FAKE_CL2"
echo '[]' > "$FAKE_CL2/project_items.json"
check "close with no current sprint exits 2"        2 run "$FAKE_CL2" 2026-12-25T08:00:00Z close
check "close with no current sprint wrote nothing"  1 test -f "$FAKE_CL2/calls.log"

echo
echo "items: the sprint's issues, whole and filtered by Status:"

FAKE_IT="$(fake_dir)"
write_iterations "$FAKE_IT"
cat > "$FAKE_IT/project_items.json" <<'JSON'
[
  {"number":10,"title":"Parent P1","state":"OPEN","status":"In progress","priority":"Standard","size":"L","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":11,"title":"Sub A","state":"OPEN","status":"In progress","priority":"Standard","size":"M","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":10},
  {"number":12,"title":"Sub B","state":"CLOSED","status":"Done","priority":"Low","size":"S","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":10},
  {"number":40,"title":"On the next sprint already","state":"OPEN","status":"Backlog","priority":null,"size":null,"sprintId":"sp2","sprintTitle":"Sprint 2","labels":[],"isParent":false,"parent":null}
]
JSON

check_out "items: every issue on Sprint 1, sorted, with epic + size" 0 \
  '[{"number":10,"title":"Parent P1","status":"In progress","priority":"Standard","size":"L","epic":null,"isEpic":true},{"number":11,"title":"Sub A","status":"In progress","priority":"Standard","size":"M","epic":10,"isEpic":false},{"number":12,"title":"Sub B","status":"Done","priority":"Low","size":"S","epic":10,"isEpic":false}]' \
  run "$FAKE_IT" "" items 1
check_out "items 1 Done: only what the team finished" 0 \
  '[{"number":12,"title":"Sub B","status":"Done","priority":"Low","size":"S","epic":10,"isEpic":false}]' \
  run "$FAKE_IT" "" items 1 Done
check_out "items: a Status nothing is in -> exit 1, empty array" 1 '[]' \
  run "$FAKE_IT" "" items 1 "Leads review"
check "items: an unknown Status exits 2 rather than answering empty" 2 \
  run "$FAKE_IT" "" items 1 Shipped
check "items: no such sprint exits 2" 2 run "$FAKE_IT" "" items 9
check "items: reads only -- wrote nothing" 1 test -f "$FAKE_IT/calls.log"

echo
echo "start: hands Scotty the stories by epic, reads back what he scoped:"

# Sprint 1 is closing (now is inside it), Sprint 2 (sp2) is next. Epic 40 is
# in flight: 41 finished, 44 carried onto Sprint 2, 42 and 43 back on no
# sprint. Epic 60 has not started. 50 is a story in no epic. Neither epic, the
# demo, nor anything already on a sprint may be offered.
_scope_board() {
  cat <<'JSON'
[
  {"number":15,"title":"Delivered last sprint","state":"CLOSED","status":"Done","priority":"Standard","size":"M","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":40,"title":"Epic 1: Foundations","state":"OPEN","status":"Backlog","priority":null,"size":null,"sprintId":"sp2","sprintTitle":"Sprint 2","labels":["epic"],"isParent":true,"parent":null},
  {"number":41,"title":"Story 1.1","state":"CLOSED","status":"Done","priority":"Standard","size":"S","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["story"],"isParent":false,"parent":40},
  {"number":42,"title":"Story 1.2","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":40},
  {"number":43,"title":"Story 1.3","state":"OPEN","status":"Backlog","priority":"Critical","size":"L","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":40},
  {"number":44,"title":"Story 1.4","state":"OPEN","status":"Leads review","priority":"Standard","size":"M","sprintId":"sp2","sprintTitle":"Sprint 2","labels":["story"],"isParent":false,"parent":40},
  {"number":50,"title":"Fix inventory bug","state":"OPEN","status":"Backlog","priority":"Blocker","size":"XS","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":null},
  {"number":60,"title":"Epic 2: Content","state":"OPEN","status":"Backlog","priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},
  {"number":61,"title":"Story 2.1","state":"OPEN","status":"Backlog","priority":"Blocker","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":60},
  {"number":62,"title":"Story 2.2","state":"OPEN","status":"Backlog","priority":"Standard","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":60},
  {"number":70,"title":"Sprint 1 Demo","state":"CLOSED","status":"Done","priority":null,"size":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null}
]
JSON
}

FAKE_ST="$(fake_dir)"
write_iterations "$FAKE_ST"
_scope_board > "$FAKE_ST/project_items.json"
# The overlay stands in for Scotty: present means his own `write-scope` call
# ran, and the board read back afterwards has 42 and 43 on Sprint 2.
mkdir -p "$FAKE_ST/bc_scotty.judge-sprint-scope.md.d"
_scope_board | "$JQ" -c 'map(if .number == 42 or .number == 43 then .sprintId = "sp2" | .sprintTitle = "Sprint 2" else . end)' \
  > "$FAKE_ST/bc_scotty.judge-sprint-scope.md.d/project_items.json"

check_out "start prints what the board says Scotty scoped" 0 '{"scoped":[42,43],"sprint":"Sprint 2"}' \
  run "$FAKE_ST" 2026-09-03T08:00:00Z start
check "start handed the candidates to Scotty" 0 \
  log_has "$FAKE_ST/calls.log" '^bc_scotty judge-sprint-scope\.md$'
check "start scoped nothing itself" 1 log_has "$FAKE_ST/calls.log" '^project_set_iteration'

IN="$FAKE_ST/bc_scotty.judge-sprint-scope.md.input"
# The first sprint that closed for real: the unfinished epic's Backlog stories
# were not offered at all, so Scotty scoped the next epic over them.
check "the in-flight epic's unscoped stories are offered"  0 grep -q '^- #42 Story 1.2' "$IN"
check "and so are its other ones"                          0 grep -q '^- #43 Story 1.3' "$IN"
check "the in-flight epic heads its group with its progress" 0 grep -q '^### #40 Epic 1: Foundations — 1 of 4 stories done, 1 on a sprint$' "$IN"
check "no epic is ever offered as a candidate"             1 grep -Eq '^- #(40|60) ' "$IN"
check "nothing finished, carried, or the demo is offered as a candidate" 1 grep -Eq '^- #(15|41|70) ' "$IN"
check "the carried story is listed as already on the next sprint" 0 grep -q '^- #44 Story 1.4 — status: Leads review, size: M$' "$IN"
check "last sprint's delivery counts stories only, with sizes" 0 grep -q '^2 stories (sizes: M, S)$' "$IN"
check_out "epics come in issue order, stories in no epic last" 0 '#40 #60 Stories' \
  sh -c 'grep "^### " "$1" | cut -d" " -f2 | tr "\n" " " | sed "s/ $//"' _ "$IN"

echo
echo "start: no eligible candidates -> exit 1, nothing scoped, no Scotty call:"
FAKE_ST0="$(fake_dir)"
write_iterations "$FAKE_ST0"
echo '[{"number":60,"title":"An epic is not a candidate","state":"OPEN","status":"Backlog","priority":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null}]' > "$FAKE_ST0/project_items.json"
check_out "start with no candidates" 1 '{"scoped":[]}' run "$FAKE_ST0" 2026-09-03T08:00:00Z start
check "start with no candidates wrote nothing" 1 test -f "$FAKE_ST0/calls.log"

echo
echo "start: Scotty scoping nothing exits 2:"
FAKE_ST1="$(fake_dir)"
write_iterations "$FAKE_ST1"
_scope_board > "$FAKE_ST1/project_items.json"
# No bc_scotty overlay: the board reads back unchanged.
check "start exits 2 when Scotty scoped nothing" 2 run "$FAKE_ST1" 2026-09-03T08:00:00Z start
check "and the only call logged is the handoff" 0 \
  log_has "$FAKE_ST1/calls.log" '^bc_scotty judge-sprint-scope\.md$'
check "and nothing was moved onto a sprint" 1 \
  log_has "$FAKE_ST1/calls.log" '^project_set_iteration'

echo
echo "start: no next sprint configured -> exit 2, nothing written:"
FAKE_ST2="$(fake_dir)"
cat > "$FAKE_ST2/project_iterations.json" <<'JSON'
[
  {"id":"only1","title":"Sprint 1","startDate":"2026-09-01","duration":4}
]
JSON
_scope_board > "$FAKE_ST2/project_items.json"
check "start with no next iteration exits 2"       2 run "$FAKE_ST2" 2026-12-25T08:00:00Z start
check "start with no next iteration wrote nothing" 1 test -f "$FAKE_ST2/calls.log"

echo
echo "write-scope: Scotty's own call -- stories only, never an epic, nothing else:"

_ws_fake() { # -> a fresh fake dir holding the scoping board
  local d
  d="$(fake_dir)"
  write_iterations "$d"
  _scope_board > "$d/project_items.json"
  echo 'Backlog' > "$d/project_field_get.43.Status.json"
  echo 'Backlog' > "$d/project_field_get.50.Status.json"
  echo 'Backlog' > "$d/project_field_get.61.Status.json"
  printf '%s' "$d"
}

FAKE_WS="$(_ws_fake)"
check_out "write-scope keeps only the real candidates out of what it was asked" 0 \
  '{"scoped":[42,43,50],"sprint":"Sprint 2"}' \
  run "$FAKE_WS" "" write-scope 2 43 42 50 40 44 41 70 4242
check "write-scope moved each story"             0 log_has "$FAKE_WS/calls.log" '^project_set_iteration 42 sp2$'
check "write-scope defaulted an unset Status"    0 log_has "$FAKE_WS/calls.log" '^project_set_single 42 Status Backlog$'
check "write-scope left a set Status alone"      1 log_has "$FAKE_WS/calls.log" '^project_set_single 43 '
check "write-scope dropped the epic (40)"            1 log_has "$FAKE_WS/calls.log" '(^| )40( |$)'
check "write-scope dropped the carried story (44)"   1 log_has "$FAKE_WS/calls.log" '(^| )44( |$)'
check "write-scope dropped the finished story (41)"  1 log_has "$FAKE_WS/calls.log" '(^| )41( |$)'
check "write-scope left the demo issue (70) alone"   1 log_has "$FAKE_WS/calls.log" '(^| )70( |$)'
check "write-scope dropped the invented number (4242)" 1 log_has "$FAKE_WS/calls.log" '(^| )4242( |$)'
run "$FAKE_WS" "" write-scope 2 43 42 50 40 44 41 70 4242 >/dev/null 2>"$FAKE_WS/stderr.txt"
check "and it says on stderr what it dropped" 0 grep -q 'dropped: #40 #41 #44 #70 #4242' "$FAKE_WS/stderr.txt"

echo
echo "write-scope: the epic order -- nothing from a later epic while an earlier one has stories left:"

FAKE_WO="$(_ws_fake)"
check_out "a later epic's story is dropped while the in-flight epic has one unpicked" 0 \
  '{"scoped":[43,50],"sprint":"Sprint 2"}' \
  run "$FAKE_WO" "" write-scope 2 43 61 50
check "the later epic's story was not moved" 1 log_has "$FAKE_WO/calls.log" '(^| )61( |$)'
run "$FAKE_WO" "" write-scope 2 43 61 50 >/dev/null 2>"$FAKE_WO/stderr.txt"
check "and stderr names the epic still in flight and what was held back" 0 \
  grep -q 'epic #40 still has stories you did not pick, so these from later epics were dropped: #61' "$FAKE_WO/stderr.txt"

FAKE_WO2="$(_ws_fake)"
check_out "once the in-flight epic is wholly picked, the next epic may start" 0 \
  '{"scoped":[42,43,61],"sprint":"Sprint 2"}' \
  run "$FAKE_WO2" "" write-scope 2 42 43 61

FAKE_WO3="$(_ws_fake)"
check_out "part of the in-flight epic is fine on its own" 0 \
  '{"scoped":[43],"sprint":"Sprint 2"}' \
  run "$FAKE_WO3" "" write-scope 2 43

FAKE_WO4="$(_ws_fake)"
check_out "only a later epic's stories -> nothing lands, exit 1" 1 \
  '{"scoped":[]}' run "$FAKE_WO4" "" write-scope 2 61 62
check "and nothing was written" 1 test -f "$FAKE_WO4/calls.log"

FAKE_WS0="$(fake_dir)"
write_iterations "$FAKE_WS0"
echo '[]' > "$FAKE_WS0/project_items.json"
check_out "write-scope: nothing asked for is a candidate -> exit 1" 1 \
  '{"scoped":[]}' run "$FAKE_WS0" "" write-scope 2 50
check "write-scope with no candidates wrote nothing" 1 test -f "$FAKE_WS0/calls.log"

FAKE_WS2="$(fake_dir)"
write_iterations "$FAKE_WS2"
echo '[]' > "$FAKE_WS2/project_items.json"
check "write-scope with no issues at all exits 2"   2 run "$FAKE_WS2" "" write-scope 2
check "write-scope with a non-numeric issue exits 2" 2 run "$FAKE_WS2" "" write-scope 2 50 fifty
check "write-scope with no such sprint exits 2"      2 run "$FAKE_WS2" "" write-scope 9 50
check "and none of those wrote anything" 1 test -f "$FAKE_WS2/calls.log"

summary
