#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-sprint.sh: current/next/over at
# pinned clock values, close's carry/clear/demo-close bookkeeping, items'
# sprint read, and scope-in -- the one way a story reaches a sprint, which is
# the orchestrator putting its pick on the sprint in play as it starts it.
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

# 12 is the case the sprint boundary turns on: a story on Sprint 1 that was
# never started, still Backlog (a crashed starting-dev-cycle, or a hand edit).
# It does NOT ride into Sprint 2 on the back of its epic -- it keeps its
# Status and goes back to the pool, for `bc-issue.sh next` to weigh against
# everything else.
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
echo "scope-in: the picked story goes on the sprint in play:"

FAKE_SI="$(fake_dir)"
write_iterations "$FAKE_SI"
check_out "scope-in: mid-sprint, the sprint containing today" 0 '{"scoped":42,"sprint":"Sprint 1"}' \
  run "$FAKE_SI" 2026-09-02T08:00:00Z scope-in 42
check "scope-in moved the story onto Sprint 1" 0 log_has "$FAKE_SI/calls.log" '^project_set_iteration 42 cd18e696$'
check "scope-in wrote no Status -- the transition is the orchestrator's" 1 log_has "$FAKE_SI/calls.log" '^project_set_single'

# 12:01 local on Sprint 1's last day. Nothing is picked between the demo hour
# and the demo's close, so a pick here comes after `close`: Sprint 1 has been
# demoed and summed up, and the story belongs to Sprint 2.
FAKE_SI2="$(fake_dir)"
write_iterations "$FAKE_SI2"
check_out "scope-in: once the current sprint is over, the next one" 0 '{"scoped":42,"sprint":"Sprint 2"}' \
  run "$FAKE_SI2" 2026-09-04T10:01:00Z scope-in 42
check "scope-in moved the story onto Sprint 2" 0 log_has "$FAKE_SI2/calls.log" '^project_set_iteration 42 sp2$'

# Before any configured sprint: nothing is current, the first upcoming one is
# where work starts.
FAKE_SI3="$(fake_dir)"
write_iterations "$FAKE_SI3"
check_out "scope-in: before all sprints, the first upcoming one" 0 '{"scoped":42,"sprint":"Sprint 1"}' \
  run "$FAKE_SI3" 2026-08-01T08:00:00Z scope-in 42

FAKE_SI4="$(fake_dir)"
write_iterations "$FAKE_SI4"
check "scope-in: no iteration left to scope into exits 2" 2 run "$FAKE_SI4" 2026-12-25T08:00:00Z scope-in 42
check "scope-in: a non-numeric issue exits 2"            2 run "$FAKE_SI4" 2026-09-02T08:00:00Z scope-in forty-two
check "scope-in: no issue exits 2"                       2 run "$FAKE_SI4" 2026-09-02T08:00:00Z scope-in
check "and none of those wrote anything" 1 test -f "$FAKE_SI4/calls.log"

echo
echo "start / write-scope are gone -- nobody plans a sprint:"
check "start is not a command any more"       2 run "$FAKE_SI4" 2026-09-02T08:00:00Z start
check "write-scope is not a command any more" 2 run "$FAKE_SI4" "" write-scope 2 42

summary
