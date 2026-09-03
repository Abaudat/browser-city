#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-issue.sh: next's priority ordering
# and backlog-sub-issue gate, current's 0/1/2-active cases, transition,
# scope's lead-label handling, create-demo's call sequence, and the
# demo-current/demo-commented/demo-for gates.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_ISSUE="$SCRIPTS_DIR/bc-issue.sh"
. "$TEST_DIR/harness.sh"

run() { # <fakedir> <now-or-empty> <args...>
  local fake="$1" now="$2"; shift 2
  BC_FAKE="$fake" BC_NOW="$now" bash "$BC_ISSUE" "$@"
}

log_has() { grep -Eq -- "$2" "$1"; } # <file> <regex>

write_iterations() { # <dir> -- Sprint 1 active on 2026-09-01..2026-09-04
  cat > "$1/project_iterations.json" <<'JSON'
[
  {"id":"cd18e696","title":"Sprint 1","startDate":"2026-09-01","duration":4},
  {"id":"sp2","title":"Sprint 2","startDate":"2026-09-05","duration":7}
]
JSON
}

echo "next: priority ordering among parents, and 'no Backlog sub-issue' skip:"

FAKE_N1="$(fake_dir)"
write_iterations "$FAKE_N1"
cat > "$FAKE_N1/project_items.json" <<'JSON'
[
  {"number":100,"title":"Parent A (top priority, nothing left to start)","state":"OPEN","status":"In progress","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":101,"title":"Sub of A, already active","state":"OPEN","status":"In progress","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100},
  {"number":102,"title":"Sub of A, done","state":"CLOSED","status":"Done","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100},
  {"number":300,"title":"Parent C (next highest priority, has work)","state":"OPEN","status":"Backlog","priority":"Critical","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":301,"title":"Sub of C, backlog","state":"OPEN","status":"Backlog","priority":"Low","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":300},
  {"number":200,"title":"Parent B (lower priority, never reached)","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":201,"title":"Sub of B, backlog","state":"OPEN","status":"Backlog","priority":"Low","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":200}
]
JSON
echo '["lead:tim"]' > "$FAKE_N1/gh_issue_labels.json"

check_out "next: skips the top-priority parent with no Backlog sub-issue, picks the next one down" 0 \
  '{"number":301,"parent":300,"scope":"quentin,tim"}' \
  run "$FAKE_N1" 2026-09-02T08:00:00Z next

FAKE_N2="$(fake_dir)"
write_iterations "$FAKE_N2"
cat > "$FAKE_N2/project_items.json" <<'JSON'
[
  {"number":400,"title":"Parent D","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":401,"title":"Sub, Standard priority","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400},
  {"number":402,"title":"Sub, Blocker priority, lower number","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400},
  {"number":403,"title":"Sub, Blocker priority, higher number","state":"OPEN","status":null,"priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400}
]
JSON
echo '[]' > "$FAKE_N2/gh_issue_labels.json"

check_out "next: among tied top-priority sub-issues, picks the lowest number" 0 \
  '{"number":402,"parent":400,"scope":"quentin"}' \
  run "$FAKE_N2" 2026-09-02T08:00:00Z next

FAKE_N0="$(fake_dir)"
write_iterations "$FAKE_N0"
echo '[]' > "$FAKE_N0/project_items.json"
check "next: no current sprint -> exit 1" 1 run "$FAKE_N0" 2026-12-25T08:00:00Z next
check "next: nothing to start -> exit 1" 1 run "$FAKE_N0" 2026-09-02T08:00:00Z next

echo
echo "current: 0 / 1 / 2 active sub-issues (and the demo issue is never 'current'):"

FAKE_CUR0="$(fake_dir)"
cat > "$FAKE_CUR0/project_items.json" <<'JSON'
[
  {"number":1,"title":"A parent, not eligible","state":"OPEN","status":"In progress","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":2,"title":"Backlog sub, not active","state":"OPEN","status":"Backlog","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":1}
]
JSON
check "current: zero active -> exit 1" 1 run "$FAKE_CUR0" "" current

FAKE_CUR1="$(fake_dir)"
cat > "$FAKE_CUR1/project_items.json" <<'JSON'
[
  {"number":5,"title":"The one active sub-issue","state":"OPEN","status":"Leads review","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":1},
  {"number":6,"title":"Sprint 1 Demo, also In progress but excluded","state":"OPEN","status":"In progress","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null}
]
JSON
check_out "current: exactly one active (demo excluded) -> its number/status" 0 \
  '{"number":5,"status":"Leads review"}' run "$FAKE_CUR1" "" current

FAKE_CUR2="$(fake_dir)"
cat > "$FAKE_CUR2/project_items.json" <<'JSON'
[
  {"number":7,"title":"Active one","state":"OPEN","status":"To analyze","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":1},
  {"number":8,"title":"Active two","state":"OPEN","status":"Reviewed","priority":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":1}
]
JSON
check "current: two active -> exit 2" 2 run "$FAKE_CUR2" "" current

echo
echo "transition: writes Status, Done also closes the issue, invalid status is rejected:"

FAKE_TR="$(fake_dir)"
check "transition to Done exits 0"          0 run "$FAKE_TR" "" transition 55 Done
check "transition logged the status write"  0 log_has "$FAKE_TR/calls.log" '^project_set_single 55 Status Done$'
check "transition Done also closed the issue" 0 log_has "$FAKE_TR/calls.log" '^gh_issue_close 55$'

FAKE_TR2="$(fake_dir)"
check "transition to a non-Done status exits 0" 0 run "$FAKE_TR2" "" transition 56 "In progress"
check "transition to non-Done logged the status write" 0 \
  log_has "$FAKE_TR2/calls.log" '^project_set_single 56 Status In progress$'
check "transition to non-Done never closed the issue" 1 log_has "$FAKE_TR2/calls.log" '^gh_issue_close'

FAKE_TR3="$(fake_dir)"
check "transition with an unknown status exits 2"       2 run "$FAKE_TR3" "" transition 57 Bogus
check "transition with an unknown status wrote nothing" 1 test -f "$FAKE_TR3/calls.log"

echo
echo "scope: lead labels restricted to BC_LEADS, quentin always in, unknown leads ignored:"

FAKE_SC1="$(fake_dir)"
echo '["lead:derek","lead:tim"]' > "$FAKE_SC1/gh_issue_labels.7.json"
check_out "scope: two known leads, quentin first" 0 "quentin,derek,tim" run "$FAKE_SC1" "" scope 7

FAKE_SC2="$(fake_dir)"
echo '[]' > "$FAKE_SC2/gh_issue_labels.8.json"
check_out "scope: no lead labels -> just quentin" 0 "quentin" run "$FAKE_SC2" "" scope 8

FAKE_SC3="$(fake_dir)"
echo '["lead:bob","lead:artie"]' > "$FAKE_SC3/gh_issue_labels.9.json"
check_out "scope: unknown lead:bob ignored, known lead kept" 0 "quentin,artie" run "$FAKE_SC3" "" scope 9

echo
echo "create-demo: the call sequence (Scotty summary -> new issue -> project add/scope):"

FAKE_DM="$(fake_dir)"
cat > "$FAKE_DM/project_iterations.json" <<'JSON'
[
  {"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}
]
JSON
cat > "$FAKE_DM/project_items.json" <<'JSON'
[
  {"number":501,"title":"Fix inventory bug","state":"CLOSED","status":"Done","priority":"Standard","sprintId":"sp3id","sprintTitle":"Sprint 3","labels":[],"isParent":false,"parent":null},
  {"number":502,"title":"Add forest level","state":"CLOSED","status":"Done","priority":"Standard","sprintId":"sp3id","sprintTitle":"Sprint 3","labels":[],"isParent":false,"parent":null},
  {"number":503,"title":"Still in progress, excluded","state":"OPEN","status":"In progress","priority":"Standard","sprintId":"sp3id","sprintTitle":"Sprint 3","labels":[],"isParent":false,"parent":null}
]
JSON
printf 'Fixed the crash on load.\nMore details follow.\n' > "$FAKE_DM/gh_issue_body.501.json"
printf '\n\nAdded the forest level.\n' > "$FAKE_DM/gh_issue_body.502.json"
# The fixture stands in for Scotty: present means his own `write-demo` call
# ran and recorded #900 through BC_WRITE_RESULT.
printf '900\n' > "$FAKE_DM/claude_oneshot_acting.judge-demo-summary.md.json"

check_out "create-demo prints the number Scotty opened" 0 900 run "$FAKE_DM" "" create-demo 3
check "create-demo handed the thread to Scotty" 0 \
  log_has "$FAKE_DM/calls.log" '^claude_oneshot_acting judge-demo-summary\.md$'
check "create-demo opened nothing itself" 1 \
  log_has "$FAKE_DM/calls.log" '^gh_issue_create'
check "create-demo never touched the still-in-progress story" 1 \
  log_has "$FAKE_DM/calls.log" '(^| )503( |$)'

FAKE_DM_EMPTY="$(fake_dir)"
cat > "$FAKE_DM_EMPTY/project_iterations.json" <<'JSON'
[
  {"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}
]
JSON
echo '[]' > "$FAKE_DM_EMPTY/project_items.json"
# No claude_oneshot_acting fixture: Scotty wrote nothing.
check "create-demo exits 2 when Scotty opened nothing" 2 run "$FAKE_DM_EMPTY" "" create-demo 3
check "and the only call logged is the handoff" 0 \
  log_has "$FAKE_DM_EMPTY/calls.log" '^claude_oneshot_acting judge-demo-summary\.md$'
check "and no issue was created" 1 log_has "$FAKE_DM_EMPTY/calls.log" '^gh_issue_create'

FAKE_DM_NOSPRINT="$(fake_dir)"
echo '[]' > "$FAKE_DM_NOSPRINT/project_iterations.json"
check "create-demo with no such iteration exits 2 before spending a Scotty call" 2 \
  run "$FAKE_DM_NOSPRINT" "" create-demo 3
check "and wrote nothing" 1 test -f "$FAKE_DM_NOSPRINT/calls.log"

echo
echo "write-demo: Scotty's own call -- opens the issue, labels it, scopes it into the sprint:"

FAKE_WD="$(fake_dir)"
cat > "$FAKE_WD/project_iterations.json" <<'JSON'
[
  {"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}
]
JSON
WD_BODY="$FAKE_WD/scotty-body.md"
printf 'The team shipped a crash fix and a new level.\n\n- [ ] Show the crash fix\n- [ ] Show the forest level\n' \
  > "$WD_BODY"

check "write-demo exits 0" 0 run "$FAKE_WD" "" write-demo 3 "$WD_BODY"
check "write-demo created the issue with the demo label" 0 \
  log_has "$FAKE_WD/calls.log" '^gh_issue_create Sprint 3 Demo .* demo$'
# project_item is a fake_read (it "returns" an id even though it's a
# side-effecting add-if-missing in real life), so it never appears in
# calls.log -- only the two project_set_* writes below are observable here.
check "write-demo scoped it into Sprint 3"  0 \
  log_has "$FAKE_WD/calls.log" '^project_set_iteration.*sp3id$'
check "write-demo marked it In progress"    0 \
  log_has "$FAKE_WD/calls.log" '^project_set_single.*Status In progress$'

FAKE_WD_EMPTY="$(fake_dir)"
cat > "$FAKE_WD_EMPTY/project_iterations.json" <<'JSON'
[
  {"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}
]
JSON
printf '   \n' > "$FAKE_WD_EMPTY/scotty-body.md"
check "write-demo with an empty body exits 2" 2 \
  run "$FAKE_WD_EMPTY" "" write-demo 3 "$FAKE_WD_EMPTY/scotty-body.md"
check "and wrote nothing" 1 test -f "$FAKE_WD_EMPTY/calls.log"
check "write-demo with a missing body file exits 2" 2 \
  run "$FAKE_WD_EMPTY" "" write-demo 3 "$FAKE_WD_EMPTY/nope.md"

echo
echo "demo-current: marker in the body wins over sprintTitle, and the 'none open' case:"

FAKE_DCUR1="$(fake_dir)"
cat > "$FAKE_DCUR1/project_items.json" <<'JSON'
[
  {"number":600,"title":"Sprint 4 Demo","state":"OPEN","status":"In progress","priority":null,"sprintId":"sp4","sprintTitle":"Sprint 4","labels":["demo"],"isParent":false,"parent":null}
]
JSON
printf 'Some intro text.\n\n<!-- bc:demo 9 -->\n' > "$FAKE_DCUR1/gh_issue_body.600.json"
check_out "demo-current: sprint number comes from the bc:demo marker, not the title" 0 \
  '{"number":600,"status":"In progress","sprint":9}' run "$FAKE_DCUR1" "" demo-current

FAKE_DCUR2="$(fake_dir)"
cat > "$FAKE_DCUR2/project_items.json" <<'JSON'
[
  {"number":700,"title":"Sprint 5 Demo","state":"OPEN","status":"Reviewed","priority":null,"sprintId":"sp5","sprintTitle":"Sprint 5","labels":["demo"],"isParent":false,"parent":null}
]
JSON
printf 'No marker in this body at all.\n' > "$FAKE_DCUR2/gh_issue_body.700.json"
check_out "demo-current: falls back to sprintTitle when there is no marker" 0 \
  '{"number":700,"status":"Reviewed","sprint":5}' run "$FAKE_DCUR2" "" demo-current

FAKE_DCUR0="$(fake_dir)"
echo '[]' > "$FAKE_DCUR0/project_items.json"
check "demo-current: none open -> exit 1" 1 run "$FAKE_DCUR0" "" demo-current

echo
echo "demo-commented: a human comment vs. only bc: stub comments:"

FAKE_CM_YES="$(fake_dir)"
cat > "$FAKE_CM_YES/gh_issue_comments.42.json" <<'JSON'
[
  {"id":1,"body":"<!-- bc:crew -->\n<!-- bc:session cb5993d0-0000-0000-0000-000000000000 -->"},
  {"id":2,"body":"Looks great, ship it!"}
]
JSON
check_out "demo-commented: a human comment present -> yes" 0 yes run "$FAKE_CM_YES" "" demo-commented 42

FAKE_CM_NO="$(fake_dir)"
cat > "$FAKE_CM_NO/gh_issue_comments.43.json" <<'JSON'
[
  {"id":1,"body":"<!-- bc:crew -->\n<!-- bc:session cb5993d0-0000-0000-0000-000000000000 -->"}
]
JSON
check_out "demo-commented: only stub comments -> no" 1 no run "$FAKE_CM_NO" "" demo-commented 43

echo
echo "demo-for: a demo issue exists for the sprint, or it does not:"

FAKE_DF="$(fake_dir)"
cat > "$FAKE_DF/project_items.json" <<'JSON'
[
  {"number":800,"title":"Sprint 7 Demo","state":"CLOSED","status":"Done","priority":null,"sprintId":"sp7","sprintTitle":"Sprint 7","labels":["demo"],"isParent":false,"parent":null}
]
JSON
check_out "demo-for: matching sprint number -> its issue number" 0 800 run "$FAKE_DF" "" demo-for 7
check "demo-for: no demo issue for that sprint -> exit 1" 1 run "$FAKE_DF" "" demo-for 8

summary
