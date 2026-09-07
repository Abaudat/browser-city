#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-issue.sh: next's priority ordering
# and its sprint/Backlog/open gates, current's 0/1/2-active cases, transition
# (including the epic that closes with its last story),
# scope's lead-label handling, backlog's unscoped read, create-demo's call
# sequence, the demo-current/demo-commented/demo-for gates, and the
# integrate-feedback/write-epic/write-story half of integrating-feedback.
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

echo "next: the sprint's own Backlog stories, by priority -- epics never enter into it:"

FAKE_N1="$(fake_dir)"
write_iterations "$FAKE_N1"
cat > "$FAKE_N1/project_items.json" <<'JSON'
[
  {"number":100,"title":"Epic A, itself on no sprint","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null},
  {"number":101,"title":"Sub of A, already active","state":"OPEN","status":"In progress","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100},
  {"number":102,"title":"Sub of A, done","state":"CLOSED","status":"Done","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100},
  {"number":103,"title":"Sub of A, closed by hand but still Backlog","state":"CLOSED","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100},
  {"number":104,"title":"Sub of A, Backlog but on no sprint","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":100},
  {"number":300,"title":"Epic C, on the sprint but never startable","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":301,"title":"Sub of C, backlog, on the sprint","state":"OPEN","status":"Backlog","priority":"Low","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":300},
  {"number":201,"title":"Sub of B, backlog, on the sprint, higher priority","state":"OPEN","status":"Backlog","priority":"Critical","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":200},
  {"number":999,"title":"Sprint 1 Demo, Backlog on the sprint but not work","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null}
]
JSON
echo '["lead:tim"]' > "$FAKE_N1/gh_issue_labels.json"

# 201 beats 301 on priority even though its epic (200) is not on the board at
# all, and every higher-priority candidate is excluded for a different reason:
# 100/300 are epics, 101 is not Backlog, 102/103 are closed, 104 is on no
# sprint, 999 is the Demo issue.
check_out "next: picks the sprint's highest-priority Backlog story, whatever epic it hangs off" 0   '{"number":201,"parent":200,"scope":"quentin,tim"}'   run "$FAKE_N1" 2026-09-02T08:00:00Z next

FAKE_N2="$(fake_dir)"
write_iterations "$FAKE_N2"
cat > "$FAKE_N2/project_items.json" <<'JSON'
[
  {"number":400,"title":"Epic D","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":true,"parent":null},
  {"number":401,"title":"Sub, Standard priority","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400},
  {"number":402,"title":"Sub, Blocker priority, lower number","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400},
  {"number":403,"title":"Sub, Blocker priority, higher number","state":"OPEN","status":"Backlog","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":400}
]
JSON
echo '[]' > "$FAKE_N2/gh_issue_labels.json"

check_out "next: among tied top-priority stories, picks the lowest number" 0   '{"number":402,"parent":400,"scope":"quentin"}'   run "$FAKE_N2" 2026-09-02T08:00:00Z next

# A story that hangs off no epic is ordinary work and starts like any other;
# its parent comes back as null rather than the pick being skipped.
FAKE_N3="$(fake_dir)"
write_iterations "$FAKE_N3"
cat > "$FAKE_N3/project_items.json" <<'JSON'
[
  {"number":500,"title":"Standalone story on the sprint","state":"OPEN","status":"Backlog","priority":"Standard","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null}
]
JSON
echo '[]' > "$FAKE_N3/gh_issue_labels.json"
check_out "next: an epic-less story is startable, with a null parent" 0   '{"number":500,"parent":null,"scope":"quentin"}'   run "$FAKE_N3" 2026-09-02T08:00:00Z next

# Statuses past Backlog belong to `current`, not `next` -- a sprint whose
# every story is under way has nothing left to start.
FAKE_N4="$(fake_dir)"
write_iterations "$FAKE_N4"
cat > "$FAKE_N4/project_items.json" <<'JSON'
[
  {"number":600,"title":"Reviewed, not startable","state":"OPEN","status":"Reviewed","priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null},
  {"number":601,"title":"Status unset, not startable either","state":"OPEN","status":null,"priority":"Blocker","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null}
]
JSON
check "next: nothing in Backlog on the sprint -> exit 1" 1 run "$FAKE_N4" 2026-09-02T08:00:00Z next

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
# No gh_issue_parent fixture: 55 hangs off nothing, so nothing follows it.
check "transition to Done exits 0"          0 run "$FAKE_TR" "" transition 55 Done
check "transition logged the status write"  0 log_has "$FAKE_TR/calls.log" '^project_set_single 55 Status Done$'
check "transition Done also closed the issue" 0 log_has "$FAKE_TR/calls.log" '^gh_issue_close 55$'
check "transition of an epic-less story closed nothing else" 1   log_has "$FAKE_TR/calls.log" '^gh_issue_close [^5]'

FAKE_TR2="$(fake_dir)"
check "transition to a non-Done status exits 0" 0 run "$FAKE_TR2" "" transition 56 "In progress"
check "transition to non-Done logged the status write" 0 \
  log_has "$FAKE_TR2/calls.log" '^project_set_single 56 Status In progress$'
check "transition to non-Done never closed the issue" 1 log_has "$FAKE_TR2/calls.log" '^gh_issue_close'

FAKE_TR3="$(fake_dir)"
check "transition with an unknown status exits 2"       2 run "$FAKE_TR3" "" transition 57 Bogus
check "transition with an unknown status wrote nothing" 1 test -f "$FAKE_TR3/calls.log"

echo
echo "transition Done: the epic follows its last story out, and only its last:"

# 61 is the last open story of epic 60: 62 is already closed, and 61's own
# close is not yet visible in the sub-issues read, which is exactly the case
# the helper has to see through.
FAKE_EP="$(fake_dir)"
echo '60' > "$FAKE_EP/gh_issue_parent.61.json"
cat > "$FAKE_EP/gh_subissues.60.json" <<'JSON'
[{"number":61,"state":"open"},{"number":62,"state":"closed"}]
JSON
check "transition of the last story exits 0"        0 run "$FAKE_EP" "" transition 61 Done
check "the story itself was closed"                 0 log_has "$FAKE_EP/calls.log" '^gh_issue_close 61$'
check "the epic was marked Done"                    0 log_has "$FAKE_EP/calls.log" '^project_set_single 60 Status Done$'
check "the epic was closed"                         0 log_has "$FAKE_EP/calls.log" '^gh_issue_close 60$'

# Same epic, but 63 is still open: the epic is not finished and is left alone.
FAKE_EP2="$(fake_dir)"
echo '60' > "$FAKE_EP2/gh_issue_parent.61.json"
cat > "$FAKE_EP2/gh_subissues.60.json" <<'JSON'
[{"number":61,"state":"open"},{"number":62,"state":"closed"},{"number":63,"state":"open"}]
JSON
check "transition with a sibling still open exits 0" 0 run "$FAKE_EP2" "" transition 61 Done
check "the story itself was still closed"            0 log_has "$FAKE_EP2/calls.log" '^gh_issue_close 61$'
check "the epic was NOT marked Done"                 1 log_has "$FAKE_EP2/calls.log" '^project_set_single 60 '
check "the epic was NOT closed"                      1 log_has "$FAKE_EP2/calls.log" '^gh_issue_close 60$'

# A non-Done transition never closes anything, epic or story, even on the
# last open story of its epic.
FAKE_EP3="$(fake_dir)"
echo '60' > "$FAKE_EP3/gh_issue_parent.61.json"
cat > "$FAKE_EP3/gh_subissues.60.json" <<'JSON'
[{"number":61,"state":"open"},{"number":62,"state":"closed"}]
JSON
check "transition to Leads review exits 0"  0 run "$FAKE_EP3" "" transition 61 "Leads review"
check "and closed nothing at all"           1 log_has "$FAKE_EP3/calls.log" '^gh_issue_close'

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


echo
echo "backlog: open work on the board, on no sprint:"

FAKE_BL="$(fake_dir)"
cat > "$FAKE_BL/project_items.json" <<'JSON'
[
  {"number":120,"title":"Epic 3 — Combat","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},
  {"number":121,"title":"Parry","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120},
  {"number":130,"title":"Already on a sprint","state":"OPEN","status":"In progress","priority":"Blocker","size":"S","sprintId":"sp2","sprintTitle":"Sprint 2","labels":["story"],"isParent":false,"parent":120},
  {"number":140,"title":"Shipped last sprint","state":"CLOSED","status":"Done","priority":"Low","size":"XS","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120},
  {"number":150,"title":"Sprint 2 Demo","state":"OPEN","status":"In progress","priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":["demo"],"isParent":false,"parent":null}
]
JSON

check_out "backlog: the unscoped open work, epic link and all" 0 \
  '[{"number":120,"title":"Epic 3 — Combat","status":"Backlog","priority":"Critical","size":null,"epic":null,"isEpic":true},{"number":121,"title":"Parry","status":"Backlog","priority":"Standard","size":"M","epic":120,"isEpic":false}]' \
  run "$FAKE_BL" "" backlog
check "backlog: reads only -- wrote nothing" 1 test -f "$FAKE_BL/calls.log"

FAKE_BL0="$(fake_dir)"
echo '[]' > "$FAKE_BL0/project_items.json"
check_out "backlog: an empty backlog is exit 1, not an error" 1 '[]' run "$FAKE_BL0" "" backlog

echo
echo "write-epic: Scotty's own call -- opens it, labels it, Backlog on no sprint:"

FAKE_WE="$(fake_dir)"
WE_BODY="$FAKE_WE/scotty-epic.md"
printf 'Combat that rewards timing over stat checks.\n' > "$WE_BODY"
printf '400\n' > "$FAKE_WE/gh_issue_create.json"

check_out "write-epic prints the new issue number" 0 400 \
  run "$FAKE_WE" "" write-epic 3 "Epic 3 — Combat" "$WE_BODY" Critical
check "write-epic created the issue with the epic label" 0 \
  log_has "$FAKE_WE/calls.log" '^gh_issue_create Epic 3 .* epic$'
# project_item is a fake_read (it "returns" an id even though it's a
# side-effecting add-if-missing in real life), so it never appears in
# calls.log -- only the project_set_* writes below are observable here.
check "write-epic put it in Backlog"     0 log_has "$FAKE_WE/calls.log" '^project_set_single 400 Status Backlog$'
check "write-epic set its Priority"      0 log_has "$FAKE_WE/calls.log" '^project_set_single 400 Priority Critical$'
check "write-epic scoped it into NO sprint" 1 log_has "$FAKE_WE/calls.log" '^project_set_iteration'

FAKE_WE2="$(fake_dir)"
printf 'A preamble.\n' > "$FAKE_WE2/body.md"
printf '   \n' > "$FAKE_WE2/empty.md"
check "write-epic with an unknown priority exits 2" 2 \
  run "$FAKE_WE2" "" write-epic 3 "Epic 3" "$FAKE_WE2/body.md" Urgent
check "write-epic with an empty body exits 2" 2 \
  run "$FAKE_WE2" "" write-epic 3 "Epic 3" "$FAKE_WE2/empty.md" Critical
check "write-epic with a missing body file exits 2" 2 \
  run "$FAKE_WE2" "" write-epic 3 "Epic 3" "$FAKE_WE2/nope.md" Critical
check "write-epic with a missing argument exits 2" 2 \
  run "$FAKE_WE2" "" write-epic 3 "Epic 3" "$FAKE_WE2/body.md"
check "and none of those created anything" 1 test -f "$FAKE_WE2/calls.log"

echo
echo "write-story: opens it, labels its leads, links it under its epic:"

FAKE_WT="$(fake_dir)"
WT_BODY="$FAKE_WT/scotty-story.md"
printf 'As a player, I can parry.\n\n- Timing window is 200ms\n' > "$WT_BODY"
printf '401\n' > "$FAKE_WT/gh_issue_create.json"
printf 'I_kwDO401\n' > "$FAKE_WT/gh_issue_id.401.json"

check_out "write-story prints the new issue number" 0 401 \
  run "$FAKE_WT" "" write-story 400 3.1 "Parry" "$WT_BODY" M Standard derek,tim
check "write-story labelled it story + one label per lead" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_create Parry .* story,lead:derek,lead:tim$'
check "write-story linked it under its epic by DATABASE id" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_add_subissue 400 I_kwDO401$'
check "write-story put it in Backlog"  0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Status Backlog$'
check "write-story set its Size"       0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Size M$'
check "write-story set its Priority"   0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Priority Standard$'
check "write-story scoped it into NO sprint" 1 log_has "$FAKE_WT/calls.log" '^project_set_iteration'

FAKE_WT_NL="$(fake_dir)"
printf 'A story.\n' > "$FAKE_WT_NL/body.md"
printf '402\n' > "$FAKE_WT_NL/gh_issue_create.json"
check_out "write-story with '-' leads takes the story label alone" 0 402 \
  run "$FAKE_WT_NL" "" write-story 400 3.2 "Riposte" "$FAKE_WT_NL/body.md" S Low -
check "and quentin was NOT written as a label (scope adds him on read)" 0 \
  log_has "$FAKE_WT_NL/calls.log" '^gh_issue_create Riposte .* story$'

FAKE_WT2="$(fake_dir)"
printf 'A story.\n' > "$FAKE_WT2/body.md"
check "write-story with an unknown size exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" Huge Standard derek
check "write-story with an unknown priority exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Urgent derek
check "write-story with an unknown lead exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Standard bob
check "write-story with a missing argument exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Standard
check "and none of those created anything" 1 test -f "$FAKE_WT2/calls.log"

echo
echo "integrate-feedback: hands the thread to Scotty, then reports what the board gained:"

FAKE_FB="$(fake_dir)"
printf 'The team shipped a crash fix.\n' > "$FAKE_FB/gh_issue_body.900.json"
cat > "$FAKE_FB/gh_issue_comments.900.json" <<'JSON'
[
  {"id":1,"body":"Parrying feels floaty — can we tighten it?"},
  {"id":2,"body":"### Sprint 3 Demo\n\nSummary.\n\n<!-- bc:demo 3 -->"}
]
JSON
# A .seq fixture is the board before and after Scotty's call: two unscoped
# open items become three, which is the difference integrate-feedback reports.
cat > "$FAKE_FB/project_items.seq" <<'JSON'
[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},{"number":121,"title":"Parry","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120}]
[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},{"number":121,"title":"Parry","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120},{"number":122,"title":"Tighten the parry window","state":"OPEN","status":"Backlog","priority":"Standard","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120}]
JSON

check_out "integrate-feedback reports the demo and what the board gained" 0 \
  '{"demo":900,"created":1}' run "$FAKE_FB" "" integrate-feedback 900
check "integrate-feedback handed the thread to Scotty" 0 \
  log_has "$FAKE_FB/calls.log" '^claude_oneshot_acting judge-feedback\.md$'
check "integrate-feedback opened nothing itself" 1 \
  log_has "$FAKE_FB/calls.log" '^gh_issue_create'
check "integrate-feedback marked the demo Reviewed" 0 \
  log_has "$FAKE_FB/calls.log" '^project_set_single 900 Status Reviewed$'

FAKE_FB0="$(fake_dir)"
printf 'Demo body.\n' > "$FAKE_FB0/gh_issue_body.900.json"
echo '[{"id":1,"body":"Looks good."}]' > "$FAKE_FB0/gh_issue_comments.900.json"
# One fixture, so the count before equals the count after: feedback that asked
# for nothing new still advances the demo, reporting a gain of zero.
echo '[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null}]' \
  > "$FAKE_FB0/project_items.json"

check_out "integrate-feedback reports a gain of zero when the backlog did not grow" 0 \
  '{"demo":900,"created":0}' run "$FAKE_FB0" "" integrate-feedback 900
check "and the demo still moved to Reviewed" 0 \
  log_has "$FAKE_FB0/calls.log" '^project_set_single 900 Status Reviewed$'

check "integrate-feedback with no issue argument exits 2" 2 run "$FAKE_FB0" "" integrate-feedback


echo
echo "epic-context: the story's epic, its preamble, and every sibling with its board fields:"

# epic-context answers with JSON, so these assertions need jq -- the rest of
# this file compares plain strings and never needed it resolved.
. "$SCRIPTS_DIR/lib/config.sh"
bc_init

# ec <fakedir> <issue> <jq-filter> -- one field of epic-context's document
ec() { local fake="$1" n="$2" filter="$3"; run "$fake" "" epic-context "$n" | "$JQ" -r "$filter"; }

FAKE_EC="$(fake_dir)"
cat > "$FAKE_EC/project_items.json" <<'JSON'
[
  {"number":300,"title":"Epic 3 — Combat","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},
  {"number":301,"title":"Parry","state":"OPEN","status":"Leads review","priority":"Standard","size":"M","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["story"],"isParent":false,"parent":300},
  {"number":302,"title":"Riposte","state":"OPEN","status":"Backlog","priority":"Low","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":300},
  {"number":400,"title":"Epic 4 — Trade","state":"OPEN","status":"Backlog","priority":"Low","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},
  {"number":401,"title":"Haggling, another epic's story","state":"OPEN","status":"Backlog","priority":"Low","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":400}
]
JSON
printf 'Combat should feel weighty.' > "$FAKE_EC/gh_issue_body.300.json"

check_out "epic-context names the story's epic" 0 300 ec "$FAKE_EC" 301 '.epic'
check_out "epic-context carries the epic's title" 0 "Epic 3 — Combat" ec "$FAKE_EC" 301 '.epicTitle'
check_out "epic-context carries the epic's preamble" 0 "Combat should feel weighty." \
  ec "$FAKE_EC" 301 '.epicBody'
check_out "epic-context lists every sibling of that epic and no other epic's" 0 "301 302" \
  ec "$FAKE_EC" 301 '[.stories[].number] | join(" ")'
check_out "epic-context carries each sibling's status, size and priority" 0 "Leads review M Standard" \
  ec "$FAKE_EC" 301 '.stories[0] | [.status, .size, .priority] | join(" ")'
check "epic-context read the board and wrote nothing" 1 test -f "$FAKE_EC/calls.log"

# A story the board knows but that hangs off no epic: exit 1, not a document
# with a null epic in it -- the caller must be able to tell the two apart
# without inspecting the payload.
FAKE_EC_NONE="$(fake_dir)"
echo '[{"number":301,"title":"Orphan","state":"OPEN","status":"Backlog","priority":"Low","size":"S","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":null}]' \
  > "$FAKE_EC_NONE/project_items.json"
check "epic-context on a story in no epic exits 1" 1 run "$FAKE_EC_NONE" "" epic-context 301
check "epic-context with no issue argument exits 2" 2 run "$FAKE_EC_NONE" "" epic-context

echo
echo "amend-story: appends above the markers, leaves the original prose, sets only the fields given:"

# last_body <calls.log> -- the file the first logged write named (its path is
# always the last token), the same trick test-bc-comment.sh uses.
last_body() { sed -n '1p' "$1" | awk '{print $NF}'; }

FAKE_AM="$(fake_dir)"
printf 'Parry the incoming blow.\n\n## Acceptance criteria\n\n- Parry window is 200ms\n\n<!-- bc:story 3.1 -->\n' \
  > "$FAKE_AM/gh_issue_body.301.json"
printf 'It must also cancel the parry on a dodge input.\n\n- Dodge during parry cancels it\n' \
  > "$FAKE_AM/amendment.md"

check_out "amend-story prints the issue it amended" 0 301 \
  run "$FAKE_AM" "" amend-story 301 "$FAKE_AM/amendment.md" L Critical
check "amend-story rewrote the body" 0 log_has "$FAKE_AM/calls.log" '^gh_issue_edit_body 301 '
AMENDED="$(last_body "$FAKE_AM/calls.log")"
check "the original prose survived" 0 grep -Fq 'Parry the incoming blow.' "$AMENDED"
check "the original acceptance criteria survived" 0 grep -Fq 'Parry window is 200ms' "$AMENDED"
check "the amendment landed under its own heading" 0 grep -Fq '## Amendment' "$AMENDED"
check "the amendment prose landed" 0 grep -Fq 'cancel the parry on a dodge input' "$AMENDED"
check "the bc:story marker survived" 0 grep -Fq '<!-- bc:story 3.1 -->' "$AMENDED"
# The provenance marker is what the epic round-trip check reads, and it reads
# it at the bottom -- an amendment appended after it would move it.
check_out "and the marker is still the last non-empty line" 0 '<!-- bc:story 3.1 -->' \
  bash -c "grep -v '^[[:space:]]*\$' '$AMENDED' | tail -1"
check "amend-story set the Size it was given" 0 \
  log_has "$FAKE_AM/calls.log" '^project_set_single 301 Size L$'
check "amend-story set the Priority it was given" 0 \
  log_has "$FAKE_AM/calls.log" '^project_set_single 301 Priority Critical$'

FAKE_AM2="$(fake_dir)"
printf 'A story.\n\n<!-- bc:story 3.1 -->\n' > "$FAKE_AM2/gh_issue_body.301.json"
printf 'And also this.\n' > "$FAKE_AM2/amendment.md"
check "amend-story with neither size nor priority exits 0" 0 \
  run "$FAKE_AM2" "" amend-story 301 "$FAKE_AM2/amendment.md"
check "and touched neither field on the board" 1 \
  log_has "$FAKE_AM2/calls.log" '^project_set_single'

FAKE_AM3="$(fake_dir)"
printf 'A story.\n\n<!-- bc:story 3.1 -->\n' > "$FAKE_AM3/gh_issue_body.301.json"
printf 'And also this.\n' > "$FAKE_AM3/amendment.md"
: > "$FAKE_AM3/empty.md"
check "amend-story with an unknown size exits 2" 2 \
  run "$FAKE_AM3" "" amend-story 301 "$FAKE_AM3/amendment.md" Huge
check "amend-story with an unknown priority exits 2" 2 \
  run "$FAKE_AM3" "" amend-story 301 "$FAKE_AM3/amendment.md" M Urgent
check "amend-story with an empty body file exits 2" 2 \
  run "$FAKE_AM3" "" amend-story 301 "$FAKE_AM3/empty.md"
check "amend-story with no body file exits 2" 2 run "$FAKE_AM3" "" amend-story 301
check "and none of those wrote anything" 1 test -f "$FAKE_AM3/calls.log"

FAKE_AM4="$(fake_dir)"
printf 'And also this.\n' > "$FAKE_AM4/amendment.md"
check "amend-story on an issue with no body exits 2 rather than inventing one" 2 \
  run "$FAKE_AM4" "" amend-story 301 "$FAKE_AM4/amendment.md"
check "and wrote nothing" 1 test -f "$FAKE_AM4/calls.log"

summary
