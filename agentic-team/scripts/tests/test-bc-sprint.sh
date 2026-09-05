#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-sprint.sh: current/next/over at
# pinned clock values, close's carry/clear/demo-close bookkeeping, and
# start's Scotty-scoped candidate selection (including the malformed-reply
# guard).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_SPRINT="$SCRIPTS_DIR/bc-sprint.sh"
. "$TEST_DIR/harness.sh"

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
echo "close: carries active work + its parent, clears backlog, closes the demo:"

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

check_out "close: summary carries P1+active sub+backlog sibling, clears the rest, closes the demo" 0 \
  '{"carried":[10,11,12],"cleared":[20,21,30],"demo":99}' \
  run "$FAKE_CL" 2026-09-03T08:00:00Z close

check "close logged carry for the parent"          0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 10 sp2$'
check "close logged carry for the active sub"      0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 11 sp2$'
check "close logged carry for the backlog sibling"  0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 12 sp2$'
check "close logged clear for the idle parent"      0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 20 clear$'
check "close logged clear for its backlog sub"      0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 21 clear$'
check "close logged clear for the standalone issue" 0 log_has "$FAKE_CL/calls.log" '^project_set_iteration 30 clear$'
check "close never touched the done sub-issue"      1 log_has "$FAKE_CL/calls.log" '(^| )13( |$)'
check "close never touched the done standalone"     1 log_has "$FAKE_CL/calls.log" '(^| )31( |$)'
check "close never touched next sprint's own item"  1 log_has "$FAKE_CL/calls.log" '(^| )40( |$)'
check "close marked the demo issue Done"            0 log_has "$FAKE_CL/calls.log" '^project_set_single 99 Status Done$'
check "close closed the demo issue"                 0 log_has "$FAKE_CL/calls.log" '^gh_issue_close 99$'

echo
echo "close: no current sprint for today -> exit 2, nothing written:"
FAKE_CL2="$(fake_dir)"
write_iterations "$FAKE_CL2"
echo '[]' > "$FAKE_CL2/project_items.json"
check "close with no current sprint exits 2"        2 run "$FAKE_CL2" 2026-12-25T08:00:00Z close
check "close with no current sprint wrote nothing"  1 test -f "$FAKE_CL2/calls.log"

echo
echo "start: Scotty scopes candidates into the next sprint:"

FAKE_ST="$(fake_dir)"
write_iterations "$FAKE_ST"
cat > "$FAKE_ST/project_items.json" <<'JSON'
[
  {"number":15,"title":"Delivered last sprint","state":"CLOSED","status":"Done","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":50,"title":"Fix inventory bug","state":"OPEN","status":null,"priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null},
  {"number":60,"title":"Nice-to-have polish","state":"OPEN","status":null,"priority":"Low","sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null},
  {"number":70,"title":"Sprint 1 Demo","state":"OPEN","status":"In progress","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null},
  {"number":80,"title":"A sub-issue, not directly scopable","state":"OPEN","status":null,"priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":50},
  {"number":90,"title":"Already scoped somewhere","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"sp2","sprintTitle":"Sprint 2","labels":[],"isParent":true,"parent":null},
  {"number":51,"title":"Sub of 50","state":"OPEN","status":"To analyze","priority":"Standard","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":50}
]
JSON
echo '[{"number":51}]' > "$FAKE_ST/gh_subissues.50.json"
printf 'Sure, here is my pick: [50]\n' > "$FAKE_ST/claude_oneshot.judge-sprint-scope.md.json"
echo 'To analyze' > "$FAKE_ST/project_field_get.51.Status.json"

check_out "start: scopes the chosen candidate into the next sprint" 0 \
  '{"scoped":[50],"sprint":"Sprint 2"}' \
  run "$FAKE_ST" 2026-09-03T08:00:00Z start

check "start logged carrying the chosen candidate"    0 log_has "$FAKE_ST/calls.log" '^project_set_iteration 50 sp2$'
check "start defaulted the candidate's Status to Backlog (unset)" 0 log_has "$FAKE_ST/calls.log" '^project_set_single 50 Status Backlog$'
# gh_subissues is a read, not a write -- reads aren't logged to calls.log,
# only fixture-served; its effect is that 51 (from gh_subissues.50.json)
# gets carried below, which IS a write and IS asserted.
check "start carried the sub-issue too"               0 log_has "$FAKE_ST/calls.log" '^project_set_iteration 51 sp2$'
check "start did NOT reset the sub-issue's Status (already set)" 1 \
  log_has "$FAKE_ST/calls.log" '^project_set_single 51 '
check "start left the non-candidate sub-issue (80) untouched" 1 \
  log_has "$FAKE_ST/calls.log" '(^| )80( |$)'
check "start left the already-scoped candidate (90) untouched" 1 \
  log_has "$FAKE_ST/calls.log" '(^| )90( |$)'
check "start left the demo issue (70) untouched"      1 log_has "$FAKE_ST/calls.log" '(^| )70( |$)'

echo
echo "start: no eligible candidates -> exit 1, {\"scoped\":[]}, no Scotty call:"
FAKE_ST0="$(fake_dir)"
write_iterations "$FAKE_ST0"
echo '[]' > "$FAKE_ST0/project_items.json"
check_out "start with no candidates" 1 '{"scoped":[]}' run "$FAKE_ST0" 2026-09-03T08:00:00Z start
check "start with no candidates wrote nothing" 1 test -f "$FAKE_ST0/calls.log"

echo
echo "start: a malformed Scotty reply exits 2 and writes nothing:"
FAKE_ST1="$(fake_dir)"
write_iterations "$FAKE_ST1"
cat > "$FAKE_ST1/project_items.json" <<'JSON'
[
  {"number":50,"title":"Fix inventory bug","state":"OPEN","status":null,"priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null}
]
JSON
printf 'Sorry, I cannot decide right now.\n' > "$FAKE_ST1/claude_oneshot.judge-sprint-scope.md.json"
check "start with a malformed reply exits 2"       2 run "$FAKE_ST1" 2026-09-03T08:00:00Z start
check "start with a malformed reply wrote nothing" 1 test -f "$FAKE_ST1/calls.log"

echo
echo "start: no next sprint configured -> exit 2, nothing written:"
FAKE_ST2="$(fake_dir)"
cat > "$FAKE_ST2/project_iterations.json" <<'JSON'
[
  {"id":"only1","title":"Sprint 1","startDate":"2026-09-01","duration":4}
]
JSON
cat > "$FAKE_ST2/project_items.json" <<'JSON'
[
  {"number":50,"title":"Fix inventory bug","state":"OPEN","status":null,"priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null}
]
JSON
check "start with no next iteration exits 2"       2 run "$FAKE_ST2" 2026-12-25T08:00:00Z start
check "start with no next iteration wrote nothing" 1 test -f "$FAKE_ST2/calls.log"

summary
