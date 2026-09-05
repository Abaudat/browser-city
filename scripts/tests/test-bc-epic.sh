#!/usr/bin/env bash
# Fixture-driven coverage for scripts/lib/epics.sh and scripts/bc-epic.sh:
# the markdown grammar, the empty-board import, the idempotent rerun, the
# half-finished repair, a silent judge, --only's excluded set, and check's
# both-directions round trip.
#
# Every scenario points BC_EPICS_DIR at a fixture epic written here rather
# than at the real _bmad-output tree, so these tests keep passing after the
# per-epic files are deleted -- which Story 0.20 requires them to be.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_EPIC="$SCRIPTS_DIR/bc-epic.sh"
. "$TEST_DIR/harness.sh"

run() { # <fakedir> <epicsdir> <args...>
  local fake="$1" epics="$2"; shift 2
  BC_FAKE="$fake" BC_EPICS_DIR="$epics" bash "$BC_EPIC" "$@"
}

# A run that writes nothing never creates calls.log, so a missing log is
# "the call is not there" -- exit 1 -- rather than grep's file error, exit 2.
log_has() { [ -f "$1" ] && grep -Eq -- "$2" "$1"; }   # <file> <regex>

# A two-story epic with a gap in the numbering (9.1, 9.3), one three-lead
# story and one two-lead story, CRLF line endings like the real files, and a
# trailing `---`.
write_epic() { # <dir>
  mkdir -p "$1"
  printf '%s\r\n' \
    '[← Epics index](index.md)' \
    '' \
    'Story status is **not** recorded here.' \
    '' \
    '---' \
    '' \
    '## Epic 9: A Test Epic' \
    '' \
    'The epic outcome, in one paragraph.' \
    '' \
    '**Sizing.** Most of these are small.' \
    '' \
    '### Story 9.1: The First Thing' \
    '' \
    '**Leads:** quentin, tim' \
    '' \
    'As Adrian,' \
    'I want the first thing,' \
    'So that the second one has something to stand on.' \
    '' \
    '**Acceptance Criteria:**' \
    '' \
    '**Given** a precondition' \
    '**When** something happens' \
    '**Then** the result holds' \
    '' \
    '### Story 9.3: The Third Thing' \
    '' \
    '**Leads:** quentin, derek, artie' \
    '' \
    'As Adrian,' \
    'I want the third thing,' \
    'So that the epic ends somewhere.' \
    '' \
    '**Acceptance Criteria:**' \
    '' \
    '**Given** another precondition' \
    '**When** something else happens' \
    '**Then** that result holds too' \
    '' \
    '---' \
    > "$1/epic-9.md"
}

# What Scotty answers when he is asked. Sized for both stories, so a scenario
# that wants an unplaced story deletes this fixture rather than editing it.
write_judge() { # <dir>
  printf '{"9.1":{"size":"S","priority":"Critical"},"9.3":{"size":"M","priority":"Standard"}}' \
    > "$1/claude_oneshot.judge-story-size.md.json"
}

EPICS="$(fake_dir)"
write_epic "$EPICS"

echo "parse: the grammar, the leads line, and the body verbatim:"

FAKE_P="$(fake_dir)"
check_out "parse: epic number and title" 0 '9 A Test Epic' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '\"\(.epic) \(.title)\"' | tr -d '\r'"
check_out "parse: both story ids, the numbering gap kept" 0 '9.1 9.3' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '[.stories[].id] | join(\" \")' | tr -d '\r'"
check_out "parse: leads come off the Leads line, in file order" 0 'quentin,derek,artie' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '.stories[1].leads | join(\",\")' | tr -d '\r'"
check_out "parse: the Leads line is NOT in the body" 0 'absent' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '.stories[0].body' | grep -q 'Leads' && echo present || echo absent"
check_out "parse: the body starts at the role sentence" 0 'As Adrian,' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '.stories[0].body' | head -1 | tr -d '\r'"
check_out "parse: the body ends at the last Then, no trailing ---" 0 '**Then** that result holds too' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '.stories[1].body' | tail -1 | tr -d '\r'"
check_out "parse: the preamble is the epic's own prose, not a story's" 0 'The epic outcome, in one paragraph.' \
  bash -c "BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' parse 9 | jq -r '.preamble' | head -1 | tr -d '\r'"
check "parse: an epic file that does not exist is broken, not empty" 2 \
  run "$FAKE_P" "$EPICS" parse 7
check "parse: --only naming a story the file lacks is broken" 2 \
  run "$FAKE_P" "$EPICS" parse 9 --only 9.1,9.9

echo
echo "import: the empty board:"

FAKE_I="$(fake_dir)"
echo '[]' > "$FAKE_I/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_I/project_items.json"
echo '[]' > "$FAKE_I/gh_issue_labels.json"
printf '50\n51\n52\n' > "$FAKE_I/gh_issue_create.seq"
echo '9001' > "$FAKE_I/gh_issue_id.json"
write_judge "$FAKE_I"

OUT_I="$(run "$FAKE_I" "$EPICS" import 9 2>/dev/null)"
RC_I=$?
LOG_I="$FAKE_I/calls.log"

check_out "import: exit 0 and both stories created" 0 '9.1 9.3' \
  bash -c "printf '%s' '$OUT_I' | jq -r '.created | join(\" \")' | tr -d '\r'"
check_out "import: the epic issue number is reported" 0 '50' \
  bash -c "printf '%s' '$OUT_I' | jq -r '.issue' | tr -d '\r'"
check_out "import: nothing unplaced" 0 '[]' \
  bash -c "printf '%s' '$OUT_I' | jq -c '.unplaced' | tr -d '\r'"
check "import: three issues created -- the epic and its two stories" 0 \
  bash -c "[ \"\$(grep -c '^gh_issue_create ' '$LOG_I')\" = 3 ]"
check "import: the epic issue carries the epic label" 0 \
  log_has "$LOG_I" '^gh_issue_create Epic 9: A Test Epic .* epic$'
check "import: a story carries only its non-always leads as labels" 0 \
  log_has "$LOG_I" '^gh_issue_create Story 9.3: The Third Thing .* lead:derek,lead:artie$'
check "import: quentin is never labelled -- he is BC_ALWAYS_LEADS" 1 \
  log_has "$LOG_I" 'lead:quentin'
check "import: both stories linked under the epic" 0 \
  bash -c "[ \"\$(grep -c '^gh_issue_add_subissue 50 9001' '$LOG_I')\" = 2 ]"
check "import: Status Backlog set on a story" 0 \
  log_has "$LOG_I" '^project_set_single 51 Status Backlog$'
check "import: the judged Size is set" 0 \
  log_has "$LOG_I" '^project_set_single 51 Size S$'
check "import: the judged Priority is set" 0 \
  log_has "$LOG_I" '^project_set_single 52 Priority Standard$'
check "import: the epic itself gets no Status -- bc-sprint start owns that" 1 \
  log_has "$LOG_I" '^project_set_single 50 Status'
# claude_oneshot is a fake READ and so never reaches calls.log, but one answer
# covering both stories can only have come from one call: the fixture is a
# single object naming them both, with a different size each.
check "import: one answer sized both stories -- one call for the whole epic" 0 \
  bash -c "grep -q 'project_set_single 51 Size S' '$LOG_I' && grep -q 'project_set_single 52 Size M' '$LOG_I'"

echo
echo "import: the second run creates nothing twice:"

FAKE_R="$(fake_dir)"
cat > "$FAKE_R/gh_issue_list_bodies.json" <<'JSON'
[
  {"number":50,"title":"Epic 9: A Test Epic","body":"outcome\n\n<!-- bc:epic 9 -->","labels":[]},
  {"number":51,"title":"Story 9.1: The First Thing","body":"As Adrian,\n\n<!-- bc:story 9.1 -->","labels":[{"name":"lead:tim"}]},
  {"number":52,"title":"Story 9.3: The Third Thing","body":"As Adrian,\n\n<!-- bc:story 9.3 -->","labels":[]}
]
JSON
cat > "$FAKE_R/gh_subissues.50.json" <<'JSON'
[{"number":51},{"number":52}]
JSON
cat > "$FAKE_R/project_items.json" <<'JSON'
[
  {"number":50,"title":"Epic 9","state":"OPEN","status":null,"priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null},
  {"number":51,"title":"Story 9.1","state":"OPEN","status":"Backlog","priority":"Critical","size":"S","sprintId":null,"sprintTitle":null,"labels":["lead:tim"],"isParent":false,"parent":50},
  {"number":52,"title":"Story 9.3","state":"OPEN","status":"Backlog","priority":"Standard","size":"M","sprintId":null,"sprintTitle":null,"labels":["lead:derek","lead:artie"],"isParent":false,"parent":50}
]
JSON
echo '["lead:tim","lead:derek","lead:artie"]' > "$FAKE_R/gh_issue_labels.json"
write_judge "$FAKE_R"

OUT_R="$(run "$FAKE_R" "$EPICS" import 9 2>/dev/null)"
RC_R=$?
LOG_R="$FAKE_R/calls.log"

check "import rerun: exit 1 -- nothing to do" 1 \
  run "$FAKE_R" "$EPICS" import 9
check_out "import rerun: created is empty" 0 '[]' \
  bash -c "printf '%s' '$OUT_R' | jq -c '.created' | tr -d '\r'"
check_out "import rerun: both stories skipped" 0 '9.1 9.3' \
  bash -c "printf '%s' '$OUT_R' | jq -r '.skipped | join(\" \")' | tr -d '\r'"
check "import rerun: no issue is created a second time" 1 \
  log_has "$LOG_R" '^gh_issue_create '
check "import rerun: nothing is re-linked" 1 \
  log_has "$LOG_R" '^gh_issue_add_subissue '
check "import rerun: no Size is rewritten" 1 \
  log_has "$LOG_R" '^project_set_single [0-9]+ Size '
check "import rerun: Scotty is never asked -- everything is already sized" 1 \
  log_has "$LOG_R" '^claude_oneshot '

echo
echo "import: a half-finished run is repaired, not repeated:"

FAKE_H="$(fake_dir)"
cat > "$FAKE_H/gh_issue_list_bodies.json" <<'JSON'
[
  {"number":50,"title":"Epic 9: A Test Epic","body":"outcome\n\n<!-- bc:epic 9 -->","labels":[]},
  {"number":51,"title":"Story 9.1: The First Thing","body":"As Adrian,\n\n<!-- bc:story 9.1 -->","labels":[]}
]
JSON
echo '[]' > "$FAKE_H/gh_subissues.50.json"
cat > "$FAKE_H/project_items.json" <<'JSON'
[
  {"number":50,"title":"Epic 9","state":"OPEN","status":null,"priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":[],"isParent":true,"parent":null},
  {"number":51,"title":"Story 9.1","state":"OPEN","status":null,"priority":null,"size":null,"sprintId":null,"sprintTitle":null,"labels":[],"isParent":false,"parent":null}
]
JSON
echo '[]' > "$FAKE_H/gh_issue_labels.json"
printf '52\n' > "$FAKE_H/gh_issue_create.seq"
echo '9002' > "$FAKE_H/gh_issue_id.json"
write_judge "$FAKE_H"

OUT_H="$(run "$FAKE_H" "$EPICS" import 9 2>/dev/null)"
LOG_H="$FAKE_H/calls.log"

check "half-finished: the existing story issue is not created again" 1 \
  log_has "$LOG_H" '^gh_issue_create Story 9.1'
check "half-finished: the missing one is created" 0 \
  log_has "$LOG_H" '^gh_issue_create Story 9.3'
check "half-finished: the orphan is linked under the epic" 0 \
  log_has "$LOG_H" '^gh_issue_add_subissue 50 9002$'
check "half-finished: the unsized existing story gets its Size" 0 \
  log_has "$LOG_H" '^project_set_single 51 Size S$'
check "half-finished: the epic issue is reused, not recreated" 1 \
  log_has "$LOG_H" '^gh_issue_create Epic 9'
check_out "half-finished: 9.1 is reported repaired, not created" 0 '9.1' \
  bash -c "printf '%s' '$OUT_H' | jq -r '.repaired | join(\" \")' | tr -d '\r'"
check "half-finished: the missing lead label is added" 0 \
  log_has "$LOG_H" '^gh_issue_add_labels 51 lead:tim$'

echo
echo "import: a judge that does not answer leaves the story unplaced, never guessed:"

FAKE_S="$(fake_dir)"
echo '[]' > "$FAKE_S/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_S/project_items.json"
echo '[]' > "$FAKE_S/gh_issue_labels.json"
printf '50\n51\n52\n' > "$FAKE_S/gh_issue_create.seq"
echo '9001' > "$FAKE_S/gh_issue_id.json"
# no claude_oneshot fixture: Scotty said nothing at all

check "judge silent: exit 2 -- something could not be placed" 2 \
  run "$FAKE_S" "$EPICS" import 9

FAKE_S2="$(fake_dir)"
echo '[]' > "$FAKE_S2/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_S2/project_items.json"
echo '[]' > "$FAKE_S2/gh_issue_labels.json"
printf '50\n51\n52\n' > "$FAKE_S2/gh_issue_create.seq"
echo '9001' > "$FAKE_S2/gh_issue_id.json"
OUT_S2="$(run "$FAKE_S2" "$EPICS" import 9 2>/dev/null)"
LOG_S2="$FAKE_S2/calls.log"

check_out "judge silent: both stories are named unplaced" 0 '9.1 9.3' \
  bash -c "printf '%s' '$OUT_S2' | jq -r '.unplaced | unique | join(\" \")' | tr -d '\r'"
check "judge silent: no Size is invented" 1 \
  log_has "$LOG_S2" '^project_set_single [0-9]+ Size '
check "judge silent: the issues are still created -- a rerun finishes them" 0 \
  log_has "$LOG_S2" '^gh_issue_create Story 9.1'

FAKE_S3="$(fake_dir)"
echo '[]' > "$FAKE_S3/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_S3/project_items.json"
echo '[]' > "$FAKE_S3/gh_issue_labels.json"
printf '50\n51\n52\n' > "$FAKE_S3/gh_issue_create.seq"
echo '9001' > "$FAKE_S3/gh_issue_id.json"
printf '{"9.1":{"size":"HUGE","priority":"Critical"},"9.3":{"size":"M","priority":"Standard"}}' \
  > "$FAKE_S3/claude_oneshot.judge-story-size.md.json"
OUT_S3="$(run "$FAKE_S3" "$EPICS" import 9 2>/dev/null)"

check_out "judge nonsense: a size the board does not offer is unplaced, not sent" 0 '9.1' \
  bash -c "printf '%s' '$OUT_S3' | jq -r '.unplaced | unique | join(\" \")' | tr -d '\r'"
check "judge nonsense: the well-formed story is still sized" 0 \
  log_has "$FAKE_S3/calls.log" '^project_set_single 52 Size M$'

echo
echo "--only: the rest is excluded, never drift:"

FAKE_O="$(fake_dir)"
echo '[]' > "$FAKE_O/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_O/project_items.json"
echo '[]' > "$FAKE_O/gh_issue_labels.json"
printf '50\n51\n' > "$FAKE_O/gh_issue_create.seq"
echo '9001' > "$FAKE_O/gh_issue_id.json"
write_judge "$FAKE_O"

OUT_O="$(run "$FAKE_O" "$EPICS" import 9 --only 9.1 2>/dev/null)"

check_out "--only: just the named story is created" 0 '9.1' \
  bash -c "printf '%s' '$OUT_O' | jq -r '.created | join(\" \")' | tr -d '\r'"
check_out "--only: the other one is excluded" 0 '9.3' \
  bash -c "printf '%s' '$OUT_O' | jq -r '.excluded | join(\" \")' | tr -d '\r'"
check "--only: the excluded story is never created" 1 \
  log_has "$FAKE_O/calls.log" '^gh_issue_create Story 9.3'

echo
echo "check: the round trip, both directions:"

check_out "check: identical sets, exit 0" 0 \
  "$(printf 'epic 9: #50\nonly-in-file: \nonly-on-board: \nexcluded: ')" \
  run "$FAKE_R" "$EPICS" check 9

check "check: a story on neither side of the link is drift" 1 \
  run "$FAKE_H" "$EPICS" check 9
check_out "check: it is named, and by id" 0 '9.1 9.3' \
  bash -c "run() { BC_FAKE='$FAKE_H' BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' \"\$@\"; }; run check 9 | sed -n 's/^only-in-file: //p' | tr -d '\r'"

check "check: no epic issue at all is drift, not a crash" 1 \
  run "$FAKE_I" "$EPICS" check 9

FAKE_C="$(fake_dir)"
cat > "$FAKE_C/gh_issue_list_bodies.json" <<'JSON'
[
  {"number":50,"title":"Epic 9: A Test Epic","body":"outcome\n\n<!-- bc:epic 9 -->","labels":[]},
  {"number":51,"title":"Story 9.1","body":"x\n\n<!-- bc:story 9.1 -->","labels":[]},
  {"number":52,"title":"Story 9.3","body":"x\n\n<!-- bc:story 9.3 -->","labels":[]},
  {"number":53,"title":"Story 9.7","body":"x\n\n<!-- bc:story 9.7 -->","labels":[]}
]
JSON
cat > "$FAKE_C/gh_subissues.50.json" <<'JSON'
[{"number":51},{"number":52},{"number":53}]
JSON
echo '[]' > "$FAKE_C/project_items.json"

check "check: a sub-issue the file has no story for is drift" 1 \
  run "$FAKE_C" "$EPICS" check 9
check_out "check: it is named on the board side" 0 '9.7' \
  bash -c "BC_FAKE='$FAKE_C' BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' check 9 | sed -n 's/^only-on-board: //p' | tr -d '\r'"
check_out "check: an --only-excluded story on the board is not drift" 0 '' \
  bash -c "BC_FAKE='$FAKE_R' BC_EPICS_DIR='$EPICS' bash '$BC_EPIC' check 9 --only 9.1 | sed -n 's/^only-on-board: //p' | tr -d '\r'"

echo
echo "plan: reads, reports and writes nothing:"

FAKE_PL="$(fake_dir)"
echo '[]' > "$FAKE_PL/gh_issue_list_bodies.json"
echo '[]' > "$FAKE_PL/project_items.json"
check "plan: an empty board has work to do" 0 \
  run "$FAKE_PL" "$EPICS" plan 9
check "plan: writes nothing at all" 1 \
  bash -c "[ -f '$FAKE_PL/calls.log' ]"
check "plan: never asks Scotty" 1 \
  bash -c "[ -f '$FAKE_PL/calls.log' ] && grep -q claude_oneshot '$FAKE_PL/calls.log'"
check "plan: a board already in place has nothing to do" 1 \
  run "$FAKE_R" "$EPICS" plan 9

echo
echo "usage:"
check "no command is misuse" 2 run "$FAKE_P" "$EPICS" ""
check "an unknown command is misuse" 2 run "$FAKE_P" "$EPICS" frobnicate 9
check "an unknown flag is misuse" 2 run "$FAKE_P" "$EPICS" parse 9 --wat

summary
