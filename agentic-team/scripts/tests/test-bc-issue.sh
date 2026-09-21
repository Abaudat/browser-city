#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-issue.sh: next's whole-backlog pick
# (no open blocker, then priority, size, number) and its Backlog/open gates,
# write-story's and write-blockers' dependencies, current's 0/1/2-active cases, transition
# (including the epic that closes with its last story),
# scope's lead-label handling, backlog's unscoped read, create-demo's call
# sequence, write-demo's checklist lint, the demo-current/demo-commented/
# demo-for gates, and the integrate-feedback/write-epic/write-story/
# write-feedback-reply half of integrating-feedback -- including the reply
# gate: Reviewed is set only once a feedback-reply comment is actually on
# the thread.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_ISSUE="$SCRIPTS_DIR/bc-issue.sh"
. "$TEST_DIR/harness.sh"

run() { # <fakedir> <now-or-empty> <args...>
  local fake="$1" now="$2"; shift 2
  BC_FAKE="$fake" BC_NOW="$now" bash "$BC_ISSUE" "$@"
}

# run_dl <denylist-path-or-empty> <fakedir> <now-or-empty> <args...> -- same
# as run, plus an optional BC_DEMO_DENYLIST_FILE override for write-demo's
# lint tests (a missing/empty/CRLF/regex-bearing denylist, injected without
# ever touching the real prompts/demo-checklist-denylist.txt).
run_dl() {
  local dl="$1" fake="$2" now="$3"; shift 3
  if [ -n "$dl" ]; then
    BC_DEMO_DENYLIST_FILE="$dl" BC_FAKE="$fake" BC_NOW="$now" bash "$BC_ISSUE" "$@"
  else
    BC_FAKE="$fake" BC_NOW="$now" bash "$BC_ISSUE" "$@"
  fi
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

echo "next: the whole backlog's startable stories, by priority then size -- sprints and epics never enter into it:"

FAKE_N1="$(fake_dir)"
cat > "$FAKE_N1/project_items.json" <<'JSON'
[
  {"number":100,"title":"Epic A, never startable","state":"OPEN","status":"Backlog","priority":"Blocker","size":null,"sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null,"blockedBy":[]},
  {"number":101,"title":"Sub of A, already active","state":"OPEN","status":"In progress","priority":"Blocker","size":"S","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100,"blockedBy":[]},
  {"number":102,"title":"Sub of A, done","state":"CLOSED","status":"Done","priority":"Blocker","size":"S","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":100,"blockedBy":[]},
  {"number":103,"title":"Sub of A, closed by hand but still Backlog","state":"CLOSED","status":"Backlog","priority":"Blocker","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":100,"blockedBy":[]},
  {"number":104,"title":"Sub of A, Blocker but blocked by an open story","state":"OPEN","status":"Backlog","priority":"Blocker","size":"XS","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":100,"blockedBy":[301]},
  {"number":301,"title":"Sub of C, Low, on no sprint","state":"OPEN","status":"Backlog","priority":"Low","size":"XS","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":300,"blockedBy":[]},
  {"number":201,"title":"Sub of B, Critical, a LATER epic, on no sprint","state":"OPEN","status":"Backlog","priority":"Critical","size":"L","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":200,"blockedBy":[]},
  {"number":999,"title":"Sprint 1 Demo, Backlog but not work","state":"OPEN","status":"Backlog","priority":"Blocker","size":null,"sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":["demo"],"isParent":false,"parent":null,"blockedBy":[]}
]
JSON
echo '["lead:tim"]' > "$FAKE_N1/gh_issue_labels.json"

# 201 is on no sprint and hangs off an epic that is not even on the board, and
# it still wins: every higher-priority candidate is out for its own reason --
# 100 is an epic, 101 is not Backlog, 102/103 are closed, 999 is the Demo
# issue, and 104, the Blocker, is blocked by the open 301. No iterations
# fixture exists here at all: `next` no longer asks what sprint it is.
check_out "next: the highest-priority unblocked Backlog story, any epic, on no sprint" 0   '{"number":201,"parent":200,"scope":"quentin,tim"}'   run "$FAKE_N1" 2026-09-02T08:00:00Z next
check "next: reads only -- wrote nothing" 1 test -f "$FAKE_N1/calls.log"

# project_items carries OPEN blockers only, so a story whose blocker has been
# closed arrives with an empty list and is startable again -- 104 now beats 201.
FAKE_N1B="$(fake_dir)"
sed 's/"blockedBy":\[301\]/"blockedBy":[]/' "$FAKE_N1/project_items.json" > "$FAKE_N1B/project_items.json"
echo '[]' > "$FAKE_N1B/gh_issue_labels.json"
check_out "next: once its blocker closes, the Blocker story is the pick" 0   '{"number":104,"parent":100,"scope":"quentin"}'   run "$FAKE_N1B" "" next

# BC_ONLY_ISSUE fences the e2e run in: the pick is board-wide, so its
# throwaway story has to be the only thing `next` can see.
check_out "next: BC_ONLY_ISSUE narrows the pool to that one story" 0   '{"number":301,"parent":300,"scope":"quentin"}' \
  env BC_ONLY_ISSUE=301 BC_FAKE="$FAKE_N1B" bash "$BC_ISSUE" next
check "next: BC_ONLY_ISSUE naming a blocked story starts nothing else" 1 \
  env BC_ONLY_ISSUE=104 BC_FAKE="$FAKE_N1" bash "$BC_ISSUE" next

FAKE_N2="$(fake_dir)"
cat > "$FAKE_N2/project_items.json" <<'JSON'
[
  {"number":401,"title":"Standard, tiny","state":"OPEN","status":"Backlog","priority":"Standard","size":"XS","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":400},
  {"number":402,"title":"Blocker, L, lowest number","state":"OPEN","status":"Backlog","priority":"Blocker","size":"L","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":400},
  {"number":403,"title":"Blocker, size unset","state":"OPEN","status":"Backlog","priority":"Blocker","size":null,"sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":400},
  {"number":404,"title":"Blocker, S, higher number","state":"OPEN","status":"Backlog","priority":"Blocker","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":500},
  {"number":405,"title":"Blocker, S, higher number still","state":"OPEN","status":"Backlog","priority":"Blocker","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":500}
]
JSON
echo '[]' > "$FAKE_N2/gh_issue_labels.json"

# Priority first (401's XS does not beat a Blocker), then size (404's S beats
# 402's L and 403's unset, which sorts last), then number (404 before 405).
# These fixtures carry no blockedBy key at all: absent reads as unblocked.
check_out "next: within the top priority the smallest story goes first, lowest number on a tie" 0   '{"number":404,"parent":500,"scope":"quentin"}'   run "$FAKE_N2" "" next

# A story that hangs off no epic is ordinary work and starts like any other;
# its parent comes back as null rather than the pick being skipped.
FAKE_N3="$(fake_dir)"
cat > "$FAKE_N3/project_items.json" <<'JSON'
[
  {"number":500,"title":"Standalone story","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":null,"blockedBy":[]}
]
JSON
echo '[]' > "$FAKE_N3/gh_issue_labels.json"
check_out "next: an epic-less story is startable, with a null parent" 0   '{"number":500,"parent":null,"scope":"quentin"}'   run "$FAKE_N3" "" next

# Statuses past Backlog belong to `current`, not `next`, and an unset Status
# is not Backlog either.
FAKE_N4="$(fake_dir)"
cat > "$FAKE_N4/project_items.json" <<'JSON'
[
  {"number":600,"title":"Reviewed, not startable","state":"OPEN","status":"Reviewed","priority":"Blocker","size":"S","sprintId":"cd18e696","sprintTitle":"Sprint 1","labels":[],"isParent":false,"parent":null,"blockedBy":[]},
  {"number":601,"title":"Status unset, not startable either","state":"OPEN","status":null,"priority":"Blocker","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":null,"blockedBy":[]}
]
JSON
check_out "next: nothing in Backlog -> exit 1, silent" 1 '' run "$FAKE_N4" "" next

# Stories left, none startable: a cycle, or a blocker nobody can pick. That is
# a stall, not an empty backlog, and `next` says so for the wake reason.
FAKE_N5="$(fake_dir)"
cat > "$FAKE_N5/project_items.json" <<'JSON'
[
  {"number":700,"title":"Blocked by 701","state":"OPEN","status":"Backlog","priority":"Critical","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":null,"blockedBy":[701]},
  {"number":701,"title":"Blocked by 700","state":"OPEN","status":"Backlog","priority":"Critical","size":"S","sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":null,"blockedBy":[700]}
]
JSON
check_out "next: every Backlog story blocked -> exit 1, and it says so" 1 \
  '2 Backlog stories, every one blocked by an open issue' run "$FAKE_N5" "" next

FAKE_N0="$(fake_dir)"
echo '[]' > "$FAKE_N0/project_items.json"
check_out "next: an empty board -> exit 1, silent" 1 '' run "$FAKE_N0" "" next
check "next: an unreadable board -> exit 2" 2 run "$(fake_dir)" "" next

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
# The overlay stands in for Scotty: present means his own `write-demo` call
# ran, and the board read back afterwards carries the Demo issue it opened.
mkdir -p "$FAKE_DM/bc_scotty.judge-demo-summary.md.d"
cat > "$FAKE_DM/bc_scotty.judge-demo-summary.md.d/project_items.json" <<'JSON'
[
  {"number":501,"title":"Fix inventory bug","state":"CLOSED","status":"Done","priority":"Standard","sprintId":"sp3id","sprintTitle":"Sprint 3","labels":[],"isParent":false,"parent":null},
  {"number":900,"title":"Sprint 3 Demo","state":"OPEN","status":"In progress","priority":null,"sprintId":"sp3id","sprintTitle":"Sprint 3","labels":["demo"],"isParent":false,"parent":null}
]
JSON

check_out "create-demo prints the number Scotty opened" 0 900 run "$FAKE_DM" "" create-demo 3
check "create-demo handed the thread to Scotty" 0 \
  log_has "$FAKE_DM/calls.log" '^bc_scotty judge-demo-summary\.md$'
check "create-demo opened nothing itself" 1 \
  log_has "$FAKE_DM/calls.log" '^gh_issue_create'
check "create-demo never touched the still-in-progress story" 1 \
  log_has "$FAKE_DM/calls.log" '(^| )503( |$)'
check "create-demo handed Scotty only what was finished" 0 \
  grep -q '#502 Add forest level' "$FAKE_DM/bc_scotty.judge-demo-summary.md.input"

FAKE_DM_EMPTY="$(fake_dir)"
cat > "$FAKE_DM_EMPTY/project_iterations.json" <<'JSON'
[
  {"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}
]
JSON
echo '[]' > "$FAKE_DM_EMPTY/project_items.json"
# No bc_scotty overlay: Scotty wrote nothing.
check "create-demo exits 2 when Scotty opened nothing" 2 run "$FAKE_DM_EMPTY" "" create-demo 3
check "and the only call logged is the handoff" 0 \
  log_has "$FAKE_DM_EMPTY/calls.log" '^bc_scotty judge-demo-summary\.md$'
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
echo "write-demo: checklist lines are linted for player-facing language before anything is created:"

FAKE_LINT_ITER='[{"id":"sp3id","title":"Sprint 3","startDate":"2026-09-12","duration":7}]'

# lint_body <dir> <checklist-line> -> path to a body file carrying it, plus a
# harmless summary paragraph -- the lint never touches the summary.
lint_body() {
  local dir="$1" line="$2" f
  f="$dir/lint-body.md"
  printf 'A short summary for Adrian.\n\n%s\n' "$line" > "$f"
  printf '%s' "$f"
}

lint_bad() { # <name> <checklist-line> [denylist-override]
  local name="$1" line="$2" dl="${3:-}" d body
  d="$(fake_dir)"
  printf '%s' "$FAKE_LINT_ITER" > "$d/project_iterations.json"
  body="$(lint_body "$d" "$line")"
  check "$name: rejected, exit 3" 3 run_dl "$dl" "$d" "" write-demo 3 "$body"
  check "$name: created nothing"  1 test -f "$d/calls.log"
}

lint_good() { # <name> <checklist-line> [denylist-override]
  local name="$1" line="$2" dl="${3:-}" d body
  d="$(fake_dir)"
  printf '%s' "$FAKE_LINT_ITER" > "$d/project_iterations.json"
  printf '999\n' > "$d/gh_issue_create.json"
  body="$(lint_body "$d" "$line")"
  check "$name: passes, exit 0" 0 run_dl "$dl" "$d" "" write-demo 3 "$body"
}

# shape_bad <name> <line> -- a list-item shape that is not the canonical
# "- [ ] " bullet: itself rejected, exit 3, before the jargon rules even run.
shape_bad() {
  local name="$1" line="$2" d body err
  d="$(fake_dir)"
  printf '%s' "$FAKE_LINT_ITER" > "$d/project_iterations.json"
  body="$(lint_body "$d" "$line")"
  check "$name: rejected, exit 3" 3 run "$d" "" write-demo 3 "$body"
  err="$(run "$d" "" write-demo 3 "$body" 2>&1 1>/dev/null)"
  check "$name: names the required form" 0 \
    bash -c 'printf "%s" "$1" | grep -qF -- "$2"' _ "$err" "checklist lines must start with '- [ ] '"
  check "$name: created nothing" 1 test -f "$d/calls.log"
}

# Adrian's own complaint, verbatim -- the acceptance criterion this lint exists for.
ADRIAN_LINE='- [ ] Walk through a defs/ object definition and its packed atlas entry'
FAKE_LINT_ADRIAN="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_LINT_ADRIAN/project_iterations.json"
ADRIAN_BODY="$(lint_body "$FAKE_LINT_ADRIAN" "$ADRIAN_LINE")"
check "Adrian's literal complaint line is rejected, exit 3" 3 \
  run "$FAKE_LINT_ADRIAN" "" write-demo 3 "$ADRIAN_BODY"
LINT_ERR="$(run "$FAKE_LINT_ADRIAN" "" write-demo 3 "$ADRIAN_BODY" 2>&1 1>/dev/null)"
check "and the offending line is named in stderr" 0 \
  bash -c 'printf "%s" "$1" | grep -qF -- "$2"' _ "$LINT_ERR" "$ADRIAN_LINE"
check "and no gh_issue_create appears in the call log" 1 \
  test -f "$FAKE_LINT_ADRIAN/calls.log"

# Rule: a backtick anywhere in the line.
lint_bad  "backtick"    "- [ ] Watch the team land a \`parry()\` combo"
lint_good "no backtick" "- [ ] Watch the team land a parry combo"

# Rule: a path-like token -- a slash between word characters, or a token
# ending in a source/doc extension.
lint_bad  "path-like token (slash)"     "- [ ] Confirm the client/server handshake on login"
lint_bad  "path-like token (extension)" "- [ ] Check the new config.yml loads correctly"
lint_good "no path"                     "- [ ] Confirm the login screen appears"

# Rule: a snake_case or camelCase token of the kind that only appears in code.
lint_bad  "snake_case token" "- [ ] Watch the walk_speed increase in the new zone"
lint_bad  "camelCase token"  "- [ ] Watch the questLog fill up with new markers"
lint_good "plain English"    "- [ ] Watch the player walk through the new zone"

# Rule: the denylist, seeded from Adrian's actual complaint and its siblings.
lint_bad  "denylist word (reducer)" "- [ ] Confirm the reducer runs without errors"
lint_good "denylist word absent"    "- [ ] Confirm building placement works smoothly"

# Ambiguous English words never belong on the denylist -- a lint that rejects
# "sit at a table" is worse than none.
lint_good "ambiguous word: table"       "- [ ] Sit at the crafting table and place an item"
lint_good "ambiguous word: build"       "- [ ] Build a house in the new district"
lint_good "ambiguous word: test (verb)" "- [ ] Test the new elevator by riding it up"

echo
echo "write-demo: the denylist catches inflected forms (plural/participle), never via an open-ended prefix that would eat plain English:"

lint_bad  "inflected: schemas"    "- [ ] Show the new database schemas"
lint_bad  "inflected: reducers"   "- [ ] Walk through the reducers that place buildings"
lint_bad  "inflected: refactored" "- [ ] Show the refactored street generator"
lint_bad  "inflected: unit tests" "- [ ] Show the unit tests passing"
lint_bad  "inflected: endpoints"  "- [ ] Show the new API endpoints"

lint_good "CI never eats 'city'"  "- [ ] Walk around the city"
lint_good "PR never eats 'press'" "- [ ] Press the button"
lint_good "PR never eats 'price'" "- [ ] Watch the price change"

echo
echo "write-demo: a denylist entry with regex metacharacters is matched literally -- never errors, never over-matches:"

REGEX_DENYLIST="$(fake_dir)/denylist-regex.txt"
printf 'node.js\n' > "$REGEX_DENYLIST"
lint_bad  "literal entry with a dot matches itself"  "- [ ] Read about node.js on the client" "$REGEX_DENYLIST"
lint_good "the dot is literal, not 'any character'"  "- [ ] Read about nodexjs on the client" "$REGEX_DENYLIST"

CPP_DENYLIST="$(fake_dir)/denylist-cpp.txt"
printf 'c++\n' > "$CPP_DENYLIST"
lint_bad  "literal entry with a plus matches itself"        "- [ ] Show off the c++ prototype" "$CPP_DENYLIST"
lint_good "a plus-bearing entry never crashes the lint"      "- [ ] Show off the new district"  "$CPP_DENYLIST"

echo
echo "write-demo: the denylist survives a CRLF checkout -- a Windows autocrlf tree with no .gitattributes protection yet, or one read before this fix:"

CRLF_DENYLIST="$(fake_dir)/denylist-crlf.txt"
printf 'reducer\r\natlas\r\n' > "$CRLF_DENYLIST"
lint_bad "a CRLF denylist entry still matches" "- [ ] Confirm the reducer runs without errors" "$CRLF_DENYLIST"

echo
echo "write-demo: a missing or empty denylist file is an infra failure, not a silent skip -- exit 2, never 3, and nothing is created even for an otherwise-clean checklist:"

FAKE_DL_MISSING="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_DL_MISSING/project_iterations.json"
MISSING_DL="$FAKE_DL_MISSING/nonexistent-denylist.txt"
MISSING_BODY="$(lint_body "$FAKE_DL_MISSING" "- [ ] Watch the player walk through the new zone")"
check "missing denylist file: exit 2, not 3" 2 \
  run_dl "$MISSING_DL" "$FAKE_DL_MISSING" "" write-demo 3 "$MISSING_BODY"
MISSING_ERR="$(run_dl "$MISSING_DL" "$FAKE_DL_MISSING" "" write-demo 3 "$MISSING_BODY" 2>&1 1>/dev/null)"
check "missing denylist file: names it on stderr" 0 \
  bash -c 'printf "%s" "$1" | grep -qF -- "$2"' _ "$MISSING_ERR" "$MISSING_DL"
check "missing denylist file: created nothing" 1 test -f "$FAKE_DL_MISSING/calls.log"

FAKE_DL_EMPTY="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_DL_EMPTY/project_iterations.json"
EMPTY_DL="$FAKE_DL_EMPTY/empty-denylist.txt"
printf '\n\n   \n' > "$EMPTY_DL"
EMPTY_DL_BODY="$(lint_body "$FAKE_DL_EMPTY" "- [ ] Watch the player walk through the new zone")"
check "denylist file with zero entries: exit 2, not 3" 2 \
  run_dl "$EMPTY_DL" "$FAKE_DL_EMPTY" "" write-demo 3 "$EMPTY_DL_BODY"
check "denylist file with zero entries: created nothing" 1 test -f "$FAKE_DL_EMPTY/calls.log"

echo
echo "write-demo: only the canonical '- [ ] ' bullet is linted as a checklist line -- any other list-item shape is itself rejected, exit 3, so drifting to a different bullet never silently disables the gate:"

shape_bad "asterisk bullet"           "* [ ] Show the new zone"
shape_bad "indented hyphen bullet"    "  - [ ] Show the new zone"
shape_bad "checked box"               "- [x] Show the new zone"
shape_bad "extra space after hyphen"  "-  [ ] Show the new zone"
shape_bad "ordered-list bullet"       "1. [ ] Show the new zone"
shape_bad "plain bullet, no checkbox" "- Show the new zone"

# One bad line among good ones rejects the whole body.
FAKE_LINT_MIX="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_LINT_MIX/project_iterations.json"
MIX_BODY="$FAKE_LINT_MIX/mix.md"
printf 'A short summary for Adrian.\n\n- [ ] Watch the player walk through the new zone\n- [ ] Confirm the reducer runs without errors\n- [ ] Watch the team land a parry combo\n' \
  > "$MIX_BODY"
check "one bad line among good ones rejects the whole body, exit 3" 3 \
  run "$FAKE_LINT_MIX" "" write-demo 3 "$MIX_BODY"
check "and nothing was created" 1 test -f "$FAKE_LINT_MIX/calls.log"

# The summary paragraph is never linted -- only checkbox lines are.
FAKE_LINT_SUMMARY="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_LINT_SUMMARY/project_iterations.json"
printf '999\n' > "$FAKE_LINT_SUMMARY/gh_issue_create.json"
SUMMARY_BODY="$FAKE_LINT_SUMMARY/summary.md"
printf 'The team refactored the defs/ pipeline and shipped a new endpoint.\n\n- [ ] Watch the player walk through the new zone\n' \
  > "$SUMMARY_BODY"
check "jargon in the summary paragraph is not linted" 0 \
  run "$FAKE_LINT_SUMMARY" "" write-demo 3 "$SUMMARY_BODY"

# A checklist is not required at all -- a sprint of pure process work has
# nothing player-visible to show, and an empty checklist must not be forced.
FAKE_LINT_EMPTY="$(fake_dir)"
printf '%s' "$FAKE_LINT_ITER" > "$FAKE_LINT_EMPTY/project_iterations.json"
printf '999\n' > "$FAKE_LINT_EMPTY/gh_issue_create.json"
EMPTY_CL_BODY="$FAKE_LINT_EMPTY/no-checklist.md"
printf 'The team spent the sprint on internal process work only.\n' > "$EMPTY_CL_BODY"
check "an empty checklist still passes" 0 \
  run "$FAKE_LINT_EMPTY" "" write-demo 3 "$EMPTY_CL_BODY"

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

# Scotty's own reply must never read as Adrian having commented again -- the
# retry protection `write-feedback-reply`'s marker exists for, pinned at the
# call site that actually matters, not just in the marker's own round trip.
FAKE_CM_REPLY_ONLY="$(fake_dir)"
cat > "$FAKE_CM_REPLY_ONLY/gh_issue_comments.44.json" <<'JSON'
[
  {"id":1,"body":"### Scotty's reply\n\nOpened #122 to tighten it.\n\n<!-- bc:feedback-reply -->"}
]
JSON
check_out "demo-commented: only Scotty's own reply present -> no" 1 no run "$FAKE_CM_REPLY_ONLY" "" demo-commented 44

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
echo "backlog: open work on the board, on no sprint, with its open blockers:"

FAKE_BL="$(fake_dir)"
cat > "$FAKE_BL/project_items.json" <<'JSON'
[
  {"number":120,"title":"Epic 3 — Combat","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null},
  {"number":121,"title":"Parry","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120,"blockedBy":[119]},
  {"number":130,"title":"Already on a sprint","state":"OPEN","status":"In progress","priority":"Blocker","size":"S","sprintId":"sp2","sprintTitle":"Sprint 2","labels":["story"],"isParent":false,"parent":120},
  {"number":140,"title":"Shipped last sprint","state":"CLOSED","status":"Done","priority":"Low","size":"XS","sprintId":null,"sprintTitle":null,"labels":["story"],"isParent":false,"parent":120},
  {"number":150,"title":"Sprint 2 Demo","state":"OPEN","status":"In progress","priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":["demo"],"isParent":false,"parent":null}
]
JSON

check_out "backlog: the unscoped open work, epic link and all" 0 \
  '[{"number":120,"title":"Epic 3 — Combat","status":"Backlog","priority":"Critical","size":null,"epic":null,"isEpic":true,"blockedBy":[]},{"number":121,"title":"Parry","status":"Backlog","priority":"Standard","size":"M","epic":120,"isEpic":false,"blockedBy":[119]}]' \
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
echo "write-story: opens it, labels its leads, links it under its epic, marks its blockers:"

FAKE_WT="$(fake_dir)"
WT_BODY="$FAKE_WT/scotty-story.md"
printf 'As a player, I can parry.\n\n- Timing window is 200ms\n' > "$WT_BODY"
printf '401\n' > "$FAKE_WT/gh_issue_create.json"
printf 'I_kwDO401\n' > "$FAKE_WT/gh_issue_id.401.json"
printf 'I_kwDO97\n'  > "$FAKE_WT/gh_issue_id.97.json"
printf 'I_kwDO132\n' > "$FAKE_WT/gh_issue_id.132.json"

check_out "write-story prints the new issue number" 0 401 \
  run "$FAKE_WT" "" write-story 400 3.1 "Parry" "$WT_BODY" M Standard derek,tim 97,#132
check "write-story labelled it story + one label per lead" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_create Parry .* story,lead:derek,lead:tim$'
check "write-story linked it under its epic by DATABASE id" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_add_subissue 400 I_kwDO401$'
check "write-story marked it blocked by the first, by DATABASE id" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_add_blocker 401 I_kwDO97$'
check "write-story marked it blocked by the second, '#' and all" 0 \
  log_has "$FAKE_WT/calls.log" '^gh_issue_add_blocker 401 I_kwDO132$'
check "write-story put it in Backlog"  0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Status Backlog$'
check "write-story set its Size"       0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Size M$'
check "write-story set its Priority"   0 log_has "$FAKE_WT/calls.log" '^project_set_single 401 Priority Standard$'
check "write-story scoped it into NO sprint" 1 log_has "$FAKE_WT/calls.log" '^project_set_iteration'
# A story is startable the moment it is in Backlog with nothing blocking it.
check_out "write-story wrote the blockers BEFORE the story reached Backlog" 0 blocker \
  sh -c 'grep -E "^(gh_issue_add_blocker|project_set_single 401 Status)" "$1" | head -1 | sed "s/^gh_issue_add_blocker.*/blocker/"' _ "$FAKE_WT/calls.log"

FAKE_WT_NL="$(fake_dir)"
printf 'A story.\n' > "$FAKE_WT_NL/body.md"
printf '402\n' > "$FAKE_WT_NL/gh_issue_create.json"
check_out "write-story with '-' leads and '-' blockers takes the story label alone" 0 402 \
  run "$FAKE_WT_NL" "" write-story 400 3.2 "Riposte" "$FAKE_WT_NL/body.md" S Low - -
check "and quentin was NOT written as a label (scope adds him on read)" 0 \
  log_has "$FAKE_WT_NL/calls.log" '^gh_issue_create Riposte .* story$'
check "and '-' wrote no blocker" 1 log_has "$FAKE_WT_NL/calls.log" '^gh_issue_add_blocker'

# No gh_issue_id fixture for 98: the blocker does not resolve to an issue.
FAKE_WT3="$(fake_dir)"
printf 'A story.\n' > "$FAKE_WT3/body.md"
printf '403\n' > "$FAKE_WT3/gh_issue_create.json"
check "write-story with a blocker that does not exist exits 2" 2 \
  run "$FAKE_WT3" "" write-story 400 3.3 "Feint" "$FAKE_WT3/body.md" S Low - 98
check "and the story it could not block never reached Backlog" 1 \
  log_has "$FAKE_WT3/calls.log" '^project_set_single 403 Status Backlog$'

FAKE_WT2="$(fake_dir)"
printf 'A story.\n' > "$FAKE_WT2/body.md"
check "write-story with an unknown size exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" Huge Standard derek -
check "write-story with an unknown priority exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Urgent derek -
check "write-story with an unknown lead exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Standard bob -
check "write-story with a blocker that is not a number exits 2" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Standard derek 97,story-3.2
check "write-story with no blockers argument exits 2 -- '-' has to be said" 2 \
  run "$FAKE_WT2" "" write-story 400 3.1 "Parry" "$FAKE_WT2/body.md" M Standard derek
check "and none of those created anything" 1 test -f "$FAKE_WT2/calls.log"

echo
echo "write-blockers: an existing story, blocked by others:"

FAKE_WB="$(fake_dir)"
printf 'I_kwDO97\n'  > "$FAKE_WB/gh_issue_id.97.json"
printf 'I_kwDO132\n' > "$FAKE_WB/gh_issue_id.132.json"
check_out "write-blockers prints the blocked issue" 0 150 run "$FAKE_WB" "" write-blockers 150 97 132
check "write-blockers wrote the first dependency"  0 log_has "$FAKE_WB/calls.log" '^gh_issue_add_blocker 150 I_kwDO97$'
check "write-blockers wrote the second dependency" 0 log_has "$FAKE_WB/calls.log" '^gh_issue_add_blocker 150 I_kwDO132$'
check "write-blockers touched nothing on the board" 1 log_has "$FAKE_WB/calls.log" '^project_'

FAKE_WB2="$(fake_dir)"
printf 'I_kwDO97\n' > "$FAKE_WB2/gh_issue_id.97.json"
check "write-blockers with no blocker exits 2"           2 run "$FAKE_WB2" "" write-blockers 150
check "write-blockers on itself exits 2"                 2 run "$FAKE_WB2" "" write-blockers 97 97
check "write-blockers with a non-numeric issue exits 2"  2 run "$FAKE_WB2" "" write-blockers story 97
check "write-blockers with an unknown blocker exits 2"   2 run "$FAKE_WB2" "" write-blockers 150 4242
check "and none of those wrote anything" 1 test -f "$FAKE_WB2/calls.log"

echo
echo "write-feedback-reply: Scotty's report back to Adrian -- idempotent upsert, marked so a retry never reads it back as feedback:"

FAKE_FR="$(fake_dir)"
FR_BODY="$FAKE_FR/scotty-reply.md"
printf 'I opened #122 to tighten the parry window; everything else you raised is already on the backlog.\n' > "$FR_BODY"
echo '[]' > "$FAKE_FR/gh_issue_comments.900.json"
printf '55\n' > "$FAKE_FR/gh_comment_create.json"

check_out "write-feedback-reply creates a new comment, prints its id" 0 55 \
  run "$FAKE_FR" "" write-feedback-reply 900 "$FR_BODY"
check "write-feedback-reply posted on the demo issue" 0 \
  log_has "$FAKE_FR/calls.log" '^gh_comment_create 900 '
check "write-feedback-reply never edited (nothing to find yet)" 1 \
  log_has "$FAKE_FR/calls.log" '^gh_comment_edit'
# The marker itself is render_feedback_reply's contract, covered by
# test-markers.sh's own round trip -- this suite only needs the call shape.

# Idempotent upsert: a retry (integrating-feedback dies before Reviewed and
# runs again) must edit the same comment, never post a second one.
FAKE_FR2="$(fake_dir)"
FR2_BODY1="$FAKE_FR2/reply1.md"
printf 'First ruling.\n' > "$FR2_BODY1"
echo '[]' > "$FAKE_FR2/gh_issue_comments.900.json"
printf '55\n' > "$FAKE_FR2/gh_comment_create.json"
run "$FAKE_FR2" "" write-feedback-reply 900 "$FR2_BODY1" >/dev/null
cat > "$FAKE_FR2/gh_issue_comments.900.json" <<'JSON'
[{"id":55,"body":"### Scotty's reply\n\nFirst ruling.\n\n<!-- bc:feedback-reply -->"}]
JSON
FR2_BODY2="$FAKE_FR2/reply2.md"
printf 'Second ruling, after a retry.\n' > "$FR2_BODY2"
check_out "write-feedback-reply on a retry edits the existing comment" 0 55 \
  run "$FAKE_FR2" "" write-feedback-reply 900 "$FR2_BODY2"
check "and it is an edit, not a second create" 0 \
  log_has "$FAKE_FR2/calls.log" '^gh_comment_edit 55 '
CREATE_COUNT="$(grep -c '^gh_comment_create' "$FAKE_FR2/calls.log")"
check_out "exactly one create across both calls" 0 1 printf '%s' "$CREATE_COUNT"

FAKE_FR_ERR="$(fake_dir)"
printf 'A reply.\n' > "$FAKE_FR_ERR/body.md"
printf '   \n' > "$FAKE_FR_ERR/empty.md"
MARKED_BODY="$FAKE_FR_ERR/marked.md"
printf 'A reply with a marker already in it.\n\n<!-- bc:demo 3 -->\n' > "$MARKED_BODY"

check "write-feedback-reply with a missing issue argument exits 2" 2 \
  run "$FAKE_FR_ERR" "" write-feedback-reply
check "write-feedback-reply with a missing body file exits 2" 2 \
  run "$FAKE_FR_ERR" "" write-feedback-reply 900 "$FAKE_FR_ERR/nope.md"
check "write-feedback-reply with an empty body exits 2" 2 \
  run "$FAKE_FR_ERR" "" write-feedback-reply 900 "$FAKE_FR_ERR/empty.md"
check "write-feedback-reply with a body carrying a bc: marker exits 2" 2 \
  run "$FAKE_FR_ERR" "" write-feedback-reply 900 "$MARKED_BODY"
check "none of those posted anything" 1 test -f "$FAKE_FR_ERR/calls.log"

# A failed read of the thread is an infra failure, never "no reply exists
# yet" -- the fallback that read as [] used to create a second reply on
# exactly the flaky-network retry the upsert exists to protect against.
FAKE_FR_READFAIL="$(fake_dir)"
READFAIL_BODY="$FAKE_FR_READFAIL/reply.md"
printf 'A reply.\n' > "$READFAIL_BODY"
# No gh_issue_comments.<n>.json fixture at all -- the read itself fails.
check "write-feedback-reply with a failed thread read exits 2" 2 \
  run "$FAKE_FR_READFAIL" "" write-feedback-reply 900 "$READFAIL_BODY"
check "and nothing was posted" 1 test -f "$FAKE_FR_READFAIL/calls.log"

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
# Scotty's own write-feedback-reply call, standing in via the overlay trick
# create-demo's test above already uses: the board read back AFTER his
# session carries his reply comment, alongside the human one.
mkdir -p "$FAKE_FB/bc_scotty.judge-feedback.md.d"
cat > "$FAKE_FB/bc_scotty.judge-feedback.md.d/gh_issue_comments.900.json" <<'JSON'
[
  {"id":1,"body":"Parrying feels floaty — can we tighten it?"},
  {"id":2,"body":"### Sprint 3 Demo\n\nSummary.\n\n<!-- bc:demo 3 -->"},
  {"id":3,"body":"### Scotty's reply\n\nOpened #122 to tighten it.\n\n<!-- bc:feedback-reply -->"}
]
JSON

check_out "integrate-feedback reports the demo and what the board gained" 0 \
  '{"demo":900,"created":1}' run "$FAKE_FB" "" integrate-feedback 900
check "integrate-feedback handed the thread to Scotty" 0 \
  log_has "$FAKE_FB/calls.log" '^bc_scotty judge-feedback\.md$'
check "integrate-feedback opened nothing itself" 1 \
  log_has "$FAKE_FB/calls.log" '^gh_issue_create'
check "integrate-feedback marked the demo Reviewed" 0 \
  log_has "$FAKE_FB/calls.log" '^project_set_single 900 Status Reviewed$'

# A retry: the thread already carries Scotty's earlier reply alongside
# Adrian's comment (the tick died between the reply and Reviewed, so this
# ran again). The input handed to judge-feedback.md must still carry
# Adrian's own text -- and must NOT carry the reply's, or Scotty would be
# fed his own ruling back to himself as though it were more feedback.
FAKE_FB_RETRY="$(fake_dir)"
printf 'The team shipped a crash fix.\n' > "$FAKE_FB_RETRY/gh_issue_body.901.json"
cat > "$FAKE_FB_RETRY/gh_issue_comments.901.json" <<'JSON'
[
  {"id":1,"body":"Parrying feels floaty — can we tighten it?"},
  {"id":2,"body":"### Scotty's reply\n\nOpened #122 to tighten it.\n\n<!-- bc:feedback-reply -->"}
]
JSON
echo '[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null}]' \
  > "$FAKE_FB_RETRY/project_items.json"
mkdir -p "$FAKE_FB_RETRY/bc_scotty.judge-feedback.md.d"
cat > "$FAKE_FB_RETRY/bc_scotty.judge-feedback.md.d/gh_issue_comments.901.json" <<'JSON'
[
  {"id":1,"body":"Parrying feels floaty — can we tighten it?"},
  {"id":2,"body":"### Scotty's reply\n\nOpened #122 to tighten it.\n\n<!-- bc:feedback-reply -->"}
]
JSON
run "$FAKE_FB_RETRY" "" integrate-feedback 901 >/dev/null
check "integrate-feedback's input carries Adrian's comment" 0 \
  log_has "$FAKE_FB_RETRY/bc_scotty.judge-feedback.md.input" 'Parrying feels floaty'
check "integrate-feedback's input does NOT carry Scotty's own reply back to him" 1 \
  log_has "$FAKE_FB_RETRY/bc_scotty.judge-feedback.md.input" "Opened #122 to tighten it"

FAKE_FB0="$(fake_dir)"
printf 'Demo body.\n' > "$FAKE_FB0/gh_issue_body.900.json"
echo '[{"id":1,"body":"Looks good."}]' > "$FAKE_FB0/gh_issue_comments.900.json"
# One fixture, so the count before equals the count after: feedback that asked
# for nothing new still advances the demo, reporting a gain of zero. Feedback
# that opened nothing still owes Adrian a reply saying so.
echo '[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null}]' \
  > "$FAKE_FB0/project_items.json"
mkdir -p "$FAKE_FB0/bc_scotty.judge-feedback.md.d"
cat > "$FAKE_FB0/bc_scotty.judge-feedback.md.d/gh_issue_comments.900.json" <<'JSON'
[
  {"id":1,"body":"Looks good."},
  {"id":2,"body":"### Scotty's reply\n\nNothing to open -- already covered.\n\n<!-- bc:feedback-reply -->"}
]
JSON

check_out "integrate-feedback reports a gain of zero when the backlog did not grow" 0 \
  '{"demo":900,"created":0}' run "$FAKE_FB0" "" integrate-feedback 900
check "and the demo still moved to Reviewed" 0 \
  log_has "$FAKE_FB0/calls.log" '^project_set_single 900 Status Reviewed$'

check "integrate-feedback with no issue argument exits 2" 2 run "$FAKE_FB0" "" integrate-feedback

# Reviewed is a gate, not a hope: if Scotty's session comes back with no
# feedback-reply comment on the thread, integrate-feedback fails loudly
# rather than trusting that he wrote one.
FAKE_FB_NOREPLY="$(fake_dir)"
printf 'Demo body.\n' > "$FAKE_FB_NOREPLY/gh_issue_body.900.json"
echo '[{"id":1,"body":"Looks good."}]' > "$FAKE_FB_NOREPLY/gh_issue_comments.900.json"
echo '[{"number":120,"title":"Epic 3","state":"OPEN","status":"Backlog","priority":"Critical","size":null,"sprintId":null,"sprintTitle":null,"labels":["epic"],"isParent":true,"parent":null}]' \
  > "$FAKE_FB_NOREPLY/project_items.json"
# No bc_scotty overlay at all: he left no reply behind.
check "integrate-feedback with no reply on the thread exits 2" 2 \
  run "$FAKE_FB_NOREPLY" "" integrate-feedback 900
check "and the demo was NOT marked Reviewed" 1 \
  log_has "$FAKE_FB_NOREPLY/calls.log" '^project_set_single 900 Status Reviewed$'


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
