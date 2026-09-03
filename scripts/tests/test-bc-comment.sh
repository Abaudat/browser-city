#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-comment.sh: stub creation and its
# idempotency, every read gate's yes/no and mixed-state list cases (moved
# head included), and every writer's marker-preserving edit plus its
# no-stub exit 2. Runs bc-comment.sh as a real subprocess so the dispatcher
# and exit codes get exercised exactly as a caller sees them.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_COMMENT="$SCRIPTS_DIR/bc-comment.sh"
. "$TEST_DIR/harness.sh"
. "$SCRIPTS_DIR/lib/config.sh"
bc_init
. "$SCRIPTS_DIR/lib/markers.sh"
. "$SCRIPTS_DIR/lib/claude.sh"

run() { local fake="$1"; shift; BC_FAKE="$fake" bash "$BC_COMMENT" "$@"; }

log_has() { grep -Eq -- "$2" "$1"; } # <file> <regex>

# _comment <id> -- body read from stdin -> one {"id":n,"body":"..."} object
_comment() {
  local id="$1" body
  body="$(cat)"
  "$JQ" -n -c --arg id "$id" --arg body "$body" '{id: ($id|tonumber), body: $body}'
}

# _written_body <calls.log> [line=1] -> content of the file the writer on
# that line logged (its path is always the last whitespace-separated token:
# gh_comment_create <n> <path>, gh_comment_edit <id> <path>).
_written_body() {
  local f p
  f="$1"
  p="$(sed -n "${2:-1}p" "$f" | awk '{print $NF}')"
  cat "$p"
}

# _body_has <calls.log> <line> <pattern> -- true if that logged write's file
# contains <pattern> as a plain substring.
_body_has() { grep -Fq -- "$3" <(_written_body "$1" "$2"); }

# _log_count <calls.log> <ere> -- number of calls.log lines matching <ere>.
_log_count() { grep -cE -- "$2" "$1" 2>/dev/null || printf 0; }

U1="11111111-1111-1111-1111-111111111111"
U2="22222222-2222-2222-2222-222222222222"
U3="33333333-3333-3333-3333-333333333333"

echo "create-analysis-stubs: creates only the missing ones, idempotent on a second run:"

FAKE_CAS="$(fake_dir)"
echo '[]' > "$FAKE_CAS/gh_issue_comments.5.json"
check_out "first run creates the two lead stubs (crew gets none)" 0 2 \
  run "$FAKE_CAS" create-analysis-stubs 5 quentin tim crew
check_out "2 gh_comment_create calls logged" 0 2 \
  _log_count "$FAKE_CAS/calls.log" '^gh_comment_create 5 '

# Second run: the issue now carries the three real stubs -- rebuild the
# fixture from what create-analysis-stubs actually wrote (marker-complete,
# so the idempotency check must skip every one of them).
{
  render_analysis_stub quentin | _comment 1
  render_analysis_stub tim | _comment 2
} | "$JQ" -sc '.' > "$FAKE_CAS/gh_issue_comments.5.json"
rm -f "$FAKE_CAS/calls.log"
check_out "second run (stubs already present) creates 0" 0 0 \
  run "$FAKE_CAS" create-analysis-stubs 5 quentin tim crew
check "second run wrote nothing to calls.log" 1 test -f "$FAKE_CAS/calls.log"

echo
echo "create-review-stubs: status + one per scoped lead + crew, idempotent:"

FAKE_CRS="$(fake_dir)"
echo '["lead:tim"]' > "$FAKE_CRS/gh_issue_labels.5.json"
echo '[]' > "$FAKE_CRS/gh_issue_comments.99.json"
check_out "creates status + quentin + tim + crew = 4" 0 4 run "$FAKE_CRS" create-review-stubs 99 5
check_out "status comment carries issue/scope/cycle=1" 0 \
  "$(printf '### Status\n\n<!-- bc:status -->\n<!-- bc:issue 5 -->\n<!-- bc:scope quentin,tim -->\n<!-- bc:cycle 1 -->')" \
  _written_body "$FAKE_CRS/calls.log" 1

{
  render_status 5 "quentin,tim" 1 | _comment 1
  render_review_stub quentin | _comment 2
  render_review_stub tim | _comment 3
  render_crew_review_stub | _comment 4
} | "$JQ" -sc '.' > "$FAKE_CRS/gh_issue_comments.99.json"
rm -f "$FAKE_CRS/calls.log"
check_out "second run creates 0" 0 0 run "$FAKE_CRS" create-review-stubs 99 5
check "second run wrote nothing" 1 test -f "$FAKE_CRS/calls.log"

echo
echo "create-breaker: gathers the thread, posts, labels, assigns; existing breaker and empty replies write nothing:"

FAKE_CB="$(fake_dir)"
{
  render_status 5 "quentin,tim" 9 | _comment 1
  printf '### Review — quentin\n\nI want approach A.\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed sha1 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 2
  printf '### Review — tim\n\nI want approach B.\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed sha1 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 3
} | "$JQ" -sc '.' > "$FAKE_CB/gh_issue_comments.100.json"
# The fixture stands in for Scotty: present means his own `write-breaker`
# call ran and recorded comment id 77 through BC_WRITE_RESULT.
printf '77\n' > "$FAKE_CB/claude_oneshot_acting.judge-breaker.md.json"
check_out "create-breaker prints the id Scotty posted" 0 77 run "$FAKE_CB" create-breaker 100
check "create-breaker handed the thread to Scotty" 0 \
  log_has "$FAKE_CB/calls.log" '^claude_oneshot_acting judge-breaker\.md$'
check "create-breaker posted nothing itself" 1 log_has "$FAKE_CB/calls.log" '^gh_comment_create'

FAKE_CB_EXISTS="$(fake_dir)"
{ render_breaker "already escalated" | _comment 1; } | "$JQ" -sc '.' > "$FAKE_CB_EXISTS/gh_issue_comments.100.json"
check "create-breaker when bc:breaker already exists exits 1" 1 run "$FAKE_CB_EXISTS" create-breaker 100
check "and writes nothing" 1 test -f "$FAKE_CB_EXISTS/calls.log"

FAKE_CB_EMPTY="$(fake_dir)"
echo '[]' > "$FAKE_CB_EMPTY/gh_issue_comments.100.json"
# No claude_oneshot_acting fixture: Scotty posted nothing.
check "create-breaker exits 2 when Scotty posted nothing" 2 run "$FAKE_CB_EMPTY" create-breaker 100
check "and the only call logged is the handoff" 0 \
  log_has "$FAKE_CB_EMPTY/calls.log" '^claude_oneshot_acting judge-breaker\.md$'
check "and no comment was posted" 1 log_has "$FAKE_CB_EMPTY/calls.log" '^gh_comment_create'

echo
echo "write-breaker: Scotty's own call -- posts the note, labels the PR, assigns the human:"

FAKE_WB="$(fake_dir)"
echo '[]' > "$FAKE_WB/gh_issue_comments.100.json"
printf 'Quentin wants A, Tim wants B. Which one?\n' > "$FAKE_WB/scotty-note.md"
check "write-breaker exits 0" 0 run "$FAKE_WB" write-breaker 100 "$FAKE_WB/scotty-note.md"
check "posted the breaker comment"  0 log_has "$FAKE_WB/calls.log" '^gh_comment_create 100 '
check "added the breaker label"     0 log_has "$FAKE_WB/calls.log" '^gh_pr_add_labels 100 breaker$'
check "assigned the human"          0 log_has "$FAKE_WB/calls.log" '^gh_pr_assign 100 Abaudat$'
check "the posted body carries the @mention" 0 _body_has "$FAKE_WB/calls.log" 1 "@Abaudat"
check "the posted body carries bc:breaker"   0 _body_has "$FAKE_WB/calls.log" 1 "<!-- bc:breaker -->"
check "the posted body carries Scotty's note" 0 _body_has "$FAKE_WB/calls.log" 1 "Quentin wants A"

FAKE_WB_EXISTS="$(fake_dir)"
{ render_breaker "already escalated" | _comment 1; } | "$JQ" -sc '.' > "$FAKE_WB_EXISTS/gh_issue_comments.100.json"
printf 'A second note.\n' > "$FAKE_WB_EXISTS/scotty-note.md"
check "write-breaker when bc:breaker already exists exits 1" 1 \
  run "$FAKE_WB_EXISTS" write-breaker 100 "$FAKE_WB_EXISTS/scotty-note.md"
check "and writes nothing" 1 test -f "$FAKE_WB_EXISTS/calls.log"

FAKE_WB_EMPTY="$(fake_dir)"
echo '[]' > "$FAKE_WB_EMPTY/gh_issue_comments.100.json"
printf '   \n' > "$FAKE_WB_EMPTY/scotty-note.md"
check "write-breaker with an empty note exits 2" 2 \
  run "$FAKE_WB_EMPTY" write-breaker 100 "$FAKE_WB_EMPTY/scotty-note.md"
check "and writes nothing" 1 test -f "$FAKE_WB_EMPTY/calls.log"
check "write-breaker with a missing body file exits 2" 2 \
  run "$FAKE_WB_EMPTY" write-breaker 100 "$FAKE_WB_EMPTY/nope.md"

echo
echo "bump-cycle: increments bc:cycle on the status comment, exit 2 without one:"

FAKE_BC="$(fake_dir)"
{ render_status 5 "quentin,tim" 3 | _comment 30; } | "$JQ" -sc '.' > "$FAKE_BC/gh_issue_comments.101.json"
check_out "bump-cycle prints the new value" 0 4 run "$FAKE_BC" bump-cycle 101
check "bump-cycle edited comment 30" 0 log_has "$FAKE_BC/calls.log" '^gh_comment_edit 30 '
check "the edited body carries cycle 4"  0 _body_has "$FAKE_BC/calls.log" 1 "<!-- bc:cycle 4 -->"

FAKE_BC_NONE="$(fake_dir)"
echo '[]' > "$FAKE_BC_NONE/gh_issue_comments.102.json"
check "bump-cycle without a status comment exits 2" 2 run "$FAKE_BC_NONE" bump-cycle 102

echo
echo "breaker-exists: yes/no:"

FAKE_BE_Y="$(fake_dir)"
{ render_breaker "note" | _comment 1; } | "$JQ" -sc '.' > "$FAKE_BE_Y/gh_issue_comments.5.json"
check_out "breaker present -> yes" 0 yes run "$FAKE_BE_Y" breaker-exists 5

FAKE_BE_N="$(fake_dir)"
echo '[]' > "$FAKE_BE_N/gh_issue_comments.5.json"
check_out "no breaker -> no" 1 no run "$FAKE_BE_N" breaker-exists 5

echo
echo "sessions: every role's uuid is derived from role + issue, nothing is read:"

FAKE_SESS="$(fake_dir)"
check_out "sessions returns a derived uuid per lead plus crew, in BC_ROLES order" 0 \
  "$("$JQ" -n -c --arg q "$(bc_role_uuid quentin 5)" --arg d "$(bc_role_uuid derek 5)" --arg t "$(bc_role_uuid tim 5)" --arg a "$(bc_role_uuid artie 5)" --arg c "$(bc_role_uuid crew 5)" '{quentin:$q,derek:$d,tim:$t,artie:$a,crew:$c}')" \
  run "$FAKE_SESS" sessions 5
check_out "a role's derived uuid is stable" 0 "$(bc_role_uuid tim 5)" bc_role_uuid tim 5
check "derived uuids differ per issue" 1 test "$(bc_role_uuid tim 5)" = "$(bc_role_uuid tim 6)"
check "derived uuids differ per role" 1 test "$(bc_role_uuid tim 5)" = "$(bc_role_uuid crew 5)"
check "a derived uuid has the 8-4-4-4-12 shape" 0 \
  bash -c 'printf %s "$1" | grep -Eq "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$"' _ "$(bc_role_uuid tim 5)"

echo
echo "scope: reads bc:scope off the PR's status comment, exit 2 when missing:"

FAKE_SCOPE="$(fake_dir)"
{ render_status 5 "quentin,derek" 1 | _comment 1; } | "$JQ" -sc '.' > "$FAKE_SCOPE/gh_issue_comments.99.json"
check_out "scope reads the status comment" 0 "quentin,derek" run "$FAKE_SCOPE" scope 99

FAKE_SCOPE0="$(fake_dir)"
echo '[]' > "$FAKE_SCOPE0/gh_issue_comments.99.json"
check "no status comment -> exit 2" 2 run "$FAKE_SCOPE0" scope 99

echo
echo "pending-leads: mixed READY/PENDING stubs, and the all-READY empty case:"

FAKE_PEND="$(fake_dir)"
echo '["lead:derek","lead:tim"]' > "$FAKE_PEND/gh_issue_labels.5.json"
{
  render_analysis_stub quentin | _comment 1
  render_analysis_stub tim | _comment 2
  render_analysis_stub derek | _comment 3
} | "$JQ" -sc '.' > "$FAKE_PEND/gh_issue_comments.5.json"
# mark quentin READY, leave tim/derek PENDING
sed -i 's/quentin -->\\n<!-- bc:direction PENDING/quentin -->\\n<!-- bc:direction READY/' "$FAKE_PEND/gh_issue_comments.5.json"
# BC_LEADS canonical order is "quentin derek tim artie", so pending roles
# come back derek-before-tim regardless of the order their stubs were made.
check_out "quentin ready, derek+tim pending (BC_LEADS order)" 0 "derek,tim" run "$FAKE_PEND" pending-leads 5

FAKE_PEND_ALL="$(fake_dir)"
echo '[]' > "$FAKE_PEND_ALL/gh_issue_labels.5.json"
{
  render_analysis_stub quentin | _comment 1
} | "$JQ" -sc '.' | sed 's/direction PENDING/direction READY/' > "$FAKE_PEND_ALL/gh_issue_comments.5.json"
check "everyone ready -> exit 1, empty" 1 run "$FAKE_PEND_ALL" pending-leads 5
check_out "everyone ready -> stdout empty" 1 "" run "$FAKE_PEND_ALL" pending-leads 5

FAKE_PEND_MISSING="$(fake_dir)"
echo '["lead:tim"]' > "$FAKE_PEND_MISSING/gh_issue_labels.5.json"
{ render_analysis_stub quentin | _comment 1; } | "$JQ" -sc '.' | sed 's/direction PENDING/direction READY/' > "$FAKE_PEND_MISSING/gh_issue_comments.5.json"
check_out "a scoped lead with no stub at all is pending" 0 "tim" run "$FAKE_PEND_MISSING" pending-leads 5

echo
echo "all-leads-commented: --issue and --pr phases:"

check_out "--issue: some pending -> no" 1 no run "$FAKE_PEND" all-leads-commented --issue 5
check_out "--issue: all ready -> yes" 0 yes run "$FAKE_PEND_ALL" all-leads-commented --issue 5

FAKE_ALC_PR="$(fake_dir)"
{
  render_status 5 "quentin,tim" 1 | _comment 1
  printf '### Review — quentin\n\n_Not yet reviewed._\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed sha1 -->\n' | _comment 2
  printf '### Review — tim\n\n_Not yet reviewed._\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed sha1 -->\n' | _comment 3
} | "$JQ" -sc '.' > "$FAKE_ALC_PR/gh_issue_comments.99.json"
echo "sha1" > "$FAKE_ALC_PR/gh_pr_head.99.json"
check_out "--pr: both reviewed at current head -> yes" 0 yes run "$FAKE_ALC_PR" all-leads-commented --pr 99
echo "sha2" > "$FAKE_ALC_PR/gh_pr_head.99.json"
check_out "--pr: head moved, now stale -> no" 1 no run "$FAKE_ALC_PR" all-leads-commented --pr 99

echo
echo "stale-leads: never-reviewed and head-moved both count as stale:"

FAKE_STALE="$(fake_dir)"
{
  render_status 5 "quentin,tim,derek" 1 | _comment 1
  printf '### Review — quentin\n\n_Not yet reviewed._\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaOLD -->\n' | _comment 2
  printf '### Review — tim\n\n_Not yet reviewed._\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaNEW -->\n' | _comment 3
  # derek has no review stub at all -- also stale
} | "$JQ" -sc '.' > "$FAKE_STALE/gh_issue_comments.99.json"
echo "shaNEW" > "$FAKE_STALE/gh_pr_head.99.json"
check_out "quentin (old sha) and derek (no stub) are stale, tim is fresh" 0 "quentin,derek" \
  run "$FAKE_STALE" stale-leads 99

FAKE_STALE_NONE="$(fake_dir)"
{
  render_status 5 "quentin" 1 | _comment 1
  printf '### Review — quentin\n\n_Not yet reviewed._\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaNEW -->\n' | _comment 2
} | "$JQ" -sc '.' > "$FAKE_STALE_NONE/gh_issue_comments.99.json"
echo "shaNEW" > "$FAKE_STALE_NONE/gh_pr_head.99.json"
check "nobody stale -> exit 1, empty" 1 run "$FAKE_STALE_NONE" stale-leads 99
check_out "nobody stale -> stdout empty" 1 "" run "$FAKE_STALE_NONE" stale-leads 99

echo
echo "unapproved-leads: reviewed-but-CHANGES and stale-and-approved both count as unapproved:"

FAKE_UNAPP="$(fake_dir)"
{
  render_status 5 "quentin,tim,derek" 1 | _comment 1
  printf '### Review — quentin\n\nfine\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaNEW -->\n<!-- bc:verdict APPROVED -->\n' | _comment 2
  printf '### Review — tim\n\nno\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed shaNEW -->\n<!-- bc:verdict CHANGES -->\n' | _comment 3
  printf '### Review — derek\n\nfine\n\n<!-- bc:lead:derek -->\n<!-- bc:reviewed shaOLD -->\n<!-- bc:verdict APPROVED -->\n' | _comment 4
} | "$JQ" -sc '.' > "$FAKE_UNAPP/gh_issue_comments.99.json"
echo "shaNEW" > "$FAKE_UNAPP/gh_pr_head.99.json"
check_out "tim (CHANGES) and derek (stale APPROVED) are unapproved, quentin cleared" 0 "tim,derek" \
  run "$FAKE_UNAPP" unapproved-leads 99

FAKE_UNAPP_ALL="$(fake_dir)"
{
  render_status 5 "quentin" 1 | _comment 1
  printf '### Review — quentin\n\nfine\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed shaNEW -->\n<!-- bc:verdict APPROVED -->\n' | _comment 2
} | "$JQ" -sc '.' > "$FAKE_UNAPP_ALL/gh_issue_comments.99.json"
echo "shaNEW" > "$FAKE_UNAPP_ALL/gh_pr_head.99.json"
check "everyone approved current head -> exit 1, empty" 1 run "$FAKE_UNAPP_ALL" unapproved-leads 99

echo
echo "crew-addressed: yes at the addressed sha, no once the head moves on:"

FAKE_CA="$(fake_dir)"
{ printf '### Crew\n\n_Not yet addressed._\n\n<!-- bc:crew -->\n<!-- bc:addressed sha1 -->\n' | _comment 1; } \
  | "$JQ" -sc '.' > "$FAKE_CA/gh_issue_comments.101.json"
echo "sha1" > "$FAKE_CA/gh_pr_head.101.json"
check_out "addressed matches current head -> yes" 0 yes run "$FAKE_CA" crew-addressed 101
echo "sha2" > "$FAKE_CA/gh_pr_head.101.json"
check_out "head moved on -> no" 1 no run "$FAKE_CA" crew-addressed 101

FAKE_CA_NONE="$(fake_dir)"
echo '[]' > "$FAKE_CA_NONE/gh_issue_comments.101.json"
check_out "no crew comment at all -> no" 1 no run "$FAKE_CA_NONE" crew-addressed 101

echo
echo "should-trigger-breaker: past BC_CYCLE_LIMIT (8) vs. at or under it:"

FAKE_STB_YES="$(fake_dir)"
{ render_status 5 "quentin" 9 | _comment 1; } | "$JQ" -sc '.' > "$FAKE_STB_YES/gh_issue_comments.101.json"
check_out "cycle 9 > limit 8 -> yes" 0 yes run "$FAKE_STB_YES" should-trigger-breaker 101

FAKE_STB_NO="$(fake_dir)"
{ render_status 5 "quentin" 8 | _comment 1; } | "$JQ" -sc '.' > "$FAKE_STB_NO/gh_issue_comments.101.json"
check_out "cycle 8, at the limit -> no" 1 no run "$FAKE_STB_NO" should-trigger-breaker 101

echo
echo "update-analysis: rebuilds the stub with the new prose and READY; exit 2 without a stub:"

FAKE_UA="$(fake_dir)"
{ render_analysis_stub quentin | _comment 7; } | "$JQ" -sc '.' > "$FAKE_UA/gh_issue_comments.5.json"
BODYFILE="$FAKE_UA/direction.txt"
printf 'Go with the tile-based approach.\n' > "$BODYFILE"
check "update-analysis exits 0" 0 run "$FAKE_UA" update-analysis 5 quentin "$BODYFILE"
check "edited comment 7" 0 log_has "$FAKE_UA/calls.log" '^gh_comment_edit 7 '
check_out "rebuilt body: heading, prose, READY" 0 \
  "$(printf '### Analysis — quentin\n\nGo with the tile-based approach.\n\n<!-- bc:lead:quentin -->\n<!-- bc:direction READY -->')" \
  _written_body "$FAKE_UA/calls.log" 1

FAKE_UA_NONE="$(fake_dir)"
echo '[]' > "$FAKE_UA_NONE/gh_issue_comments.5.json"
check "update-analysis with no stub for the role exits 2" 2 run "$FAKE_UA_NONE" update-analysis 5 tim "$BODYFILE"

echo
echo "approve / reject: stamp the current head and verdict on the right review stub; exit 2 without a stub:"

FAKE_AR="$(fake_dir)"
{
  render_review_stub quentin | _comment 11
  render_review_stub tim | _comment 12
} | "$JQ" -sc '.' > "$FAKE_AR/gh_issue_comments.99.json"
echo "cafebabe" > "$FAKE_AR/gh_pr_head.99.json"
check "approve exits 0" 0 run "$FAKE_AR" approve 99 quentin
check "approve edited quentin's stub (11), not tim's (12)" 0 log_has "$FAKE_AR/calls.log" '^gh_comment_edit 11 '
check "approve never touched comment 12" 1 log_has "$FAKE_AR/calls.log" '^gh_comment_edit 12 '
check_out "approve wrote a Cycle 1 section (no status comment -> cycle 1), the head and APPROVED" 0 \
  "$(printf '### Review — quentin\n\n#### Cycle 1 — APPROVED @ `cafebab`\nApproved.\n\n<!-- bc:lead:quentin -->\n<!-- bc:reviewed cafebabe -->\n<!-- bc:verdict APPROVED -->')" \
  _written_body "$FAKE_AR/calls.log" 1

FAKE_RJ="$(fake_dir)"
{ render_review_stub tim | _comment 20; } | "$JQ" -sc '.' > "$FAKE_RJ/gh_issue_comments.99.json"
echo "deadbeef" > "$FAKE_RJ/gh_pr_head.99.json"
REASON="$FAKE_RJ/reason.txt"
printf 'This breaks the save format.\n' > "$REASON"
check "reject with a bodyfile exits 0" 0 run "$FAKE_RJ" reject 99 tim "$REASON"
check_out "reject wrote a Cycle 1 section, the head and CHANGES with the given prose" 0 \
  "$(printf '### Review — tim\n\n#### Cycle 1 — CHANGES @ `deadbee`\nThis breaks the save format.\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed deadbeef -->\n<!-- bc:verdict CHANGES -->')" \
  _written_body "$FAKE_RJ/calls.log" 1

echo
echo "approve on a later cycle keeps the earlier sections; the same cycle twice replaces its section:"

FAKE_HIST="$(fake_dir)"
{
  render_status 5 "tim" 2 | _comment 30
  printf '### Review — tim\n\n#### Cycle 1 — CHANGES @ `abc1234`\n- the save format breaks\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed abc1234abc1234 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 31
} | "$JQ" -sc '.' > "$FAKE_HIST/gh_issue_comments.99.json"
echo "feedface" > "$FAKE_HIST/gh_pr_head.99.json"
check "approve on cycle 2 exits 0" 0 run "$FAKE_HIST" approve 99 tim
check_out "cycle 1 section kept above the new cycle 2 section" 0 \
  "$(printf '### Review — tim\n\n#### Cycle 1 — CHANGES @ `abc1234`\n- the save format breaks\n\n#### Cycle 2 — APPROVED @ `feedfac`\nApproved.\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed feedface -->\n<!-- bc:verdict APPROVED -->')" \
  _written_body "$FAKE_HIST/calls.log" 1

FAKE_SAME="$(fake_dir)"
{
  render_status 5 "tim" 1 | _comment 30
  printf '### Review — tim\n\n#### Cycle 1 — CHANGES @ `abc1234`\n- the save format breaks\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed abc1234abc1234 -->\n<!-- bc:verdict CHANGES -->\n' | _comment 31
} | "$JQ" -sc '.' > "$FAKE_SAME/gh_issue_comments.99.json"
echo "abc1234abc1234" > "$FAKE_SAME/gh_pr_head.99.json"
check "re-stamping the same cycle exits 0" 0 run "$FAKE_SAME" approve 99 tim
check_out "the cycle 1 section was replaced, not duplicated" 0 \
  "$(printf '### Review — tim\n\n#### Cycle 1 — APPROVED @ `abc1234`\nApproved.\n\n<!-- bc:lead:tim -->\n<!-- bc:reviewed abc1234abc1234 -->\n<!-- bc:verdict APPROVED -->')" \
  _written_body "$FAKE_SAME/calls.log" 1

FAKE_AR_NONE="$(fake_dir)"
echo '[]' > "$FAKE_AR_NONE/gh_issue_comments.99.json"
echo "cafebabe" > "$FAKE_AR_NONE/gh_pr_head.99.json"
check "approve with no stub for the role exits 2" 2 run "$FAKE_AR_NONE" approve 99 derek

echo
echo "mark-addressed: stamps the crew review comment with the current head; exit 2 without one:"

FAKE_MA="$(fake_dir)"
{ render_crew_review_stub | _comment 33; } | "$JQ" -sc '.' > "$FAKE_MA/gh_issue_comments.101.json"
echo "feedface" > "$FAKE_MA/gh_pr_head.101.json"
check "mark-addressed exits 0" 0 run "$FAKE_MA" mark-addressed 101
check "edited comment 33" 0 log_has "$FAKE_MA/calls.log" '^gh_comment_edit 33 '
check_out "mark-addressed stamped the head with the default prose" 0 \
  "$(printf '### Crew\n\nAddressed.\n\n<!-- bc:crew -->\n<!-- bc:addressed feedface -->')" \
  _written_body "$FAKE_MA/calls.log" 1

FAKE_MA_NONE="$(fake_dir)"
echo '[]' > "$FAKE_MA_NONE/gh_issue_comments.101.json"
echo "feedface" > "$FAKE_MA_NONE/gh_pr_head.101.json"
check "mark-addressed with no crew comment exits 2" 2 run "$FAKE_MA_NONE" mark-addressed 101

echo
echo "unknown command: usage on stderr, exit 2:"
check "unknown command exits 2" 2 run "$(fake_dir)" bogus-command

summary
