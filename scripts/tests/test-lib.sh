#!/usr/bin/env bash
# Fake-mode and pure-logic coverage for scripts/lib/*.sh: read/write/exit
# fake-double behaviour, the clock helpers, project_iterations arithmetic,
# claude_transcript_exists, and the path converters.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LIB="$TEST_DIR/../lib"
. "$TEST_DIR/harness.sh"
. "$LIB/config.sh"
bc_init
. "$LIB/gh-cli.sh"
. "$LIB/project.sh"
. "$LIB/orca.sh"
. "$LIB/claude.sh"

# A literal "VAR=val" prefix immediately before a command scopes that
# assignment to just this one invocation (works for functions too, not only
# externals) -- so each wrapper below sets exactly one env var around one
# call, and never leaks it to the tests that follow.
with_fake()        { local d="$1"; shift; BC_FAKE="$d" "$@"; }
with_now()         { local n="$1"; shift; BC_NOW="$n" "$@"; }
with_claude_home() { local h="$1"; shift; BC_CLAUDE_HOME="$h" "$@"; }
roundtrip_win()    { local p; p="$(winpath "$1")"; posix2win "$p"; }

echo "fake reads: arg-specific fixture wins over the generic fallback:"
FAKE1="$(fake_dir)"
echo '["from-generic"]'  > "$FAKE1/gh_issue_labels.json"
echo '["from-specific"]' > "$FAKE1/gh_issue_labels.7.json"
check_out "arg-specific fixture used for issue 7" 0 '["from-specific"]' with_fake "$FAKE1" gh_issue_labels 7
check_out "generic fallback used for issue 3"     0 '["from-generic"]'  with_fake "$FAKE1" gh_issue_labels 3

FAKE1B="$(fake_dir)"
check "no fixture anywhere exits 1" 1 with_fake "$FAKE1B" gh_issue_labels 999

echo
echo "fake writes: logged to calls.log, one line per call:"
FAKE2="$(fake_dir)"
with_fake "$FAKE2" gh_issue_close 42 >/dev/null
with_fake "$FAKE2" gh_issue_assign 42 Abaudat >/dev/null
check_out "write logged: gh_issue_close"  0 "gh_issue_close 42"          sed -n '1p' "$FAKE2/calls.log"
check_out "write logged: gh_issue_assign" 0 "gh_issue_assign 42 Abaudat" sed -n '2p' "$FAKE2/calls.log"

echo
echo "fake writes: a <fn>.exit file forces that exit code instead of logging:"
FAKE3="$(fake_dir)"
echo 2 > "$FAKE3/gh_pr_merge.exit"
check     "forced exit 2, nothing logged"           2 with_fake "$FAKE3" gh_pr_merge 9
check_out "forced-exit call never reached calls.log" 1 "" test -f "$FAKE3/calls.log"

echo
echo "claude_transcript_exists: encoded-cwd lookup under a scratch HOME:"
FAKE4="$(fake_dir)"
UUID="cb5993d0-1111-2222-3333-444444444444"
WT="C:/Users/granb/orca/workspaces/BrowserCity/issue-3"
ENCODED="C--Users-granb-orca-workspaces-BrowserCity-issue-3"
mkdir -p "$FAKE4/.claude/projects/$ENCODED"
: > "$FAKE4/.claude/projects/$ENCODED/$UUID.jsonl"
check "transcript found (windows-form path in)" 0 with_claude_home "$FAKE4" claude_transcript_exists "$WT" "$UUID"
check "transcript found (posix-form path in)"   0 with_claude_home "$FAKE4" claude_transcript_exists "/c/Users/granb/orca/workspaces/BrowserCity/issue-3" "$UUID"
check "no transcript for an unmessaged session" 1 with_claude_home "$FAKE4" claude_transcript_exists "$WT" "00000000-0000-0000-0000-000000000000"

echo
echo "bc_zurich_hour / bc_zurich_date with BC_NOW pinned:"
# 2026-09-04T09:30:00Z is inside CEST (UTC+2) -> 11:30 local.
check_out "11:30 UTC+2 local from a pinned instant" 0 11         with_now 2026-09-04T09:30:00Z bc_zurich_hour
check_out "date follows the same pinned instant"    0 2026-09-04 with_now 2026-09-04T09:30:00Z bc_zurich_date
# 2026-01-15T23:30:00Z is inside CET (UTC+1) -> 00:30 local, next day.
check_out "past midnight local in winter (CET, UTC+1)" 0 0          with_now 2026-01-15T23:30:00Z bc_zurich_hour
check_out "date rolls to the next day locally"         0 2026-01-16 with_now 2026-01-15T23:30:00Z bc_zurich_date
# Friday-noon gate (BC_DEMO_HOUR default 12): 11:59 vs 12:01 local, same day.
check_out "11:59 local -> hour 11" 0 11 with_now 2026-09-04T09:59:00Z bc_zurich_hour
check_out "12:01 local -> hour 12" 0 12 with_now 2026-09-04T10:01:00Z bc_zurich_hour
# BC_NOW also accepts a plain epoch (all-digit) rather than an ISO string.
check_out "BC_NOW as an epoch integer" 0 2026-09-04 with_now 1788514200 bc_zurich_date

echo
echo "project_iterations: end-date arithmetic, driven by a fake fixture:"
FAKE5="$(fake_dir)"
cat > "$FAKE5/project_iterations.json" <<'JSON'
[
  {"id":"a1","title":"Sprint 1","startDate":"2026-09-01","duration":4},
  {"id":"a2","title":"Sprint 2","startDate":"2026-09-05","duration":7},
  {"id":"a3","title":"Leap check","startDate":"2028-02-25","duration":7}
]
JSON
OUTFILE="$FAKE5/actual-output.json"
with_fake "$FAKE5" project_iterations > "$OUTFILE"
check_out "4-day sprint: end = start + 3 days"                 0 2026-09-04 "$JQ" -r '.[] | select(.id=="a1") | .end' "$OUTFILE"
check_out "7-day sprint: end = start + 6 days"                 0 2026-09-11 "$JQ" -r '.[] | select(.id=="a2") | .end' "$OUTFILE"
check_out "7-day sprint crossing a leap-year Feb/Mar boundary" 0 2028-03-02 "$JQ" -r '.[] | select(.id=="a3") | .end' "$OUTFILE"

echo
echo "posix2win / winpath round-trip cases:"
check_out "winpath: drive path"                                0 /c/Users/granb            winpath 'C:\Users\granb'
check_out "winpath: forward-slash input already posix-ish stays untouched" 0 not/a/drive/path winpath 'not/a/drive/path'
check_out "posix2win: /c/... -> C:/..."                        0 C:/Users/granb             posix2win '/c/Users/granb'
check_out "posix2win: already windows-form is a no-op"         0 C:/Users/granb             posix2win 'C:/Users/granb'
check_out "round trip: winpath then posix2win restores drive letter and slashes" 0 'C:/Users/granb' roundtrip_win 'C:\Users\granb'

echo
echo "bc_record_result: writes to BC_WRITE_RESULT when set, is a no-op when not:"
RESULT_FILE="$(fake_dir)/result.txt"
BC_WRITE_RESULT="$RESULT_FILE" bc_record_result 901
check_out "recorded the value"                0 901 cat "$RESULT_FILE"
BC_WRITE_RESULT="$RESULT_FILE" bc_record_result 902
check_out "a second call replaces, never appends" 0 902 cat "$RESULT_FILE"
unset BC_WRITE_RESULT
check "no BC_WRITE_RESULT set is a silent no-op, not a failure" 0 bc_record_result 903

echo
echo "claude_render_prompt: {{key}} substitution, and a prompt with no keys:"
PROMPT_SRC="$(fake_dir)/p.md"
printf 'PR #{{pr}}, body at {{bodyfile}}\nbash {{scripts}}/bc-comment.sh write-breaker {{pr}} {{bodyfile}}\n' > "$PROMPT_SRC"
check_out "every occurrence of every key is replaced" 0 \
"PR #100, body at /tmp/note.md
bash /s/scripts/bc-comment.sh write-breaker 100 /tmp/note.md" \
  claude_render_prompt "$PROMPT_SRC" pr=100 bodyfile=/tmp/note.md scripts=/s/scripts
check_out "no keys given: the prompt comes back untouched" 0 "PR #{{pr}}" \
  claude_render_prompt <(printf 'PR #{{pr}}\n')

echo
echo "fake writes that have a return value: the .seq and .json answers:"
FAKE_W="$(fake_dir)"
check_out "no fixture: the write happens and says nothing" 0 '' \
  with_fake "$FAKE_W" gh_issue_create "A title" /tmp/body "story"
check "no fixture: it is still logged" 0 \
  bash -c "grep -q '^gh_issue_create A title ' '$FAKE_W/calls.log'"

printf '50\n51\n' > "$FAKE_W/gh_issue_create.seq"
check_out ".seq: the first call gets the first line"  0 50 \
  with_fake "$FAKE_W" gh_issue_create "First" /tmp/body ""
check_out ".seq: the second call gets the second"     0 51 \
  with_fake "$FAKE_W" gh_issue_create "Second" /tmp/body ""
check_out ".seq: an exhausted sequence answers nothing again" 0 '' \
  with_fake "$FAKE_W" gh_issue_create "Third" /tmp/body ""

FAKE_W2="$(fake_dir)"
printf '9001' > "$FAKE_W2/gh_issue_add_subissue.json"
check_out ".json: the same answer for every call" 0 9001 \
  with_fake "$FAKE_W2" gh_issue_add_subissue 50 9001
check_out ".json: and again"                      0 9001 \
  with_fake "$FAKE_W2" gh_issue_add_subissue 50 9002

echo
echo "project_set_single knows the board's Size field:"
FAKE_SZ="$(fake_dir)"
check "Size is a field it will set"        0 with_fake "$FAKE_SZ" project_set_single 51 Size M
check "the write is logged as given"       0 \
  bash -c "grep -qx 'project_set_single 51 Size M' '$FAKE_SZ/calls.log'"
check "a field it does not know is misuse" 2 project_set_single 51 Estimate 3
# project_field_get's Size branch cannot be exercised here: under BC_FAKE it
# answers from a project_field_get.<n>.<field>.json fixture and never reaches
# the jq that maps Size onto project_items' `size` key. That mapping is covered
# instead by test-bc-epic.sh, whose rerun fixture carries a size and whose
# assertion is that no Size is written a second time.

summary
