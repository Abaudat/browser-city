#!/usr/bin/env bash
# Marker round-trip coverage: parse/render of the <!-- bc:name value --> vocabulary.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/harness.sh"
. "$SCRIPT_DIR/../lib/markers.sh"

echo "has_marker / marker_get on a hand-built body:"

BODY='### Review — tim

Looks fine.

<!-- bc:lead:tim -->
<!-- bc:reviewed abc123 -->
<!-- bc:verdict APPROVED -->'

check     "has_marker finds lead:tim"                     0        has_marker "$BODY" "lead:tim"
check     "has_marker misses lead:derek"                  1        has_marker "$BODY" "lead:derek"
check_out "marker_get reviewed"                            0 abc123   marker_get "$BODY" "reviewed"
check_out "marker_get verdict"                             0 APPROVED marker_get "$BODY" "verdict"
check     "marker_get missing name exits 1"                1        marker_get "$BODY" "cycle"
check     "marker_get presence-only marker exits 1"        1        marker_get "<!-- bc:status -->" "status"
check     "has_marker true for presence-only marker"       0        has_marker "<!-- bc:status -->" "status"

echo
echo "is_human_comment:"
check "human comment (no markers) is human"     0 is_human_comment "just a comment, no markers here"
check "marker-bearing comment is not human"     1 is_human_comment "$BODY"

echo
echo "marker_set: append when absent, replace in place when present, never duplicates:"

APPENDED="$(marker_set "line one" "cycle" "1")"
check_out "marker_set appends a new marker" 0 "line one
<!-- bc:cycle 1 -->" printf '%s' "$APPENDED"

REPLACED="$(marker_set "$APPENDED" "cycle" "2")"
check_out "marker_get after replace sees new value" 0 2 marker_get "$REPLACED" "cycle"
OCCURRENCES="$(printf '%s' "$REPLACED" | grep -c -- '<!-- bc:cycle ')"
check_out "marker_set replaces rather than duplicates" 0 1 printf '%s' "$OCCURRENCES"

echo
echo "values with spaces, commas and SHA-like tokens round-trip:"

WITH_SPACES="$(marker_set "body" "note" "a value with spaces")"
check_out "value with spaces" 0 "a value with spaces" marker_get "$WITH_SPACES" "note"

WITH_COMMAS="$(marker_set "body" "scope" "quentin,tim,derek")"
check_out "value with commas" 0 "quentin,tim,derek" marker_get "$WITH_COMMAS" "scope"

SHA=$(printf 'a%.0s' $(seq 1 40))
WITH_SHA="$(marker_set "body" "reviewed" "$SHA")"
check_out "sha-like value" 0 "$SHA" marker_get "$WITH_SHA" "reviewed"

echo
echo "renderers produce bodies that parse back with the expected markers:"

UUID="cb5993d0-0000-0000-0000-000000000000"

S="$(render_analysis_stub tim)"
check     "analysis stub: lead role present"  0 has_marker "$S" "lead:tim"
check_out "analysis stub: direction PENDING"  0 PENDING marker_get "$S" "direction"
check     "analysis stub: carries no session marker (ids are derived)" 1 has_marker "$S" "session"

S="$(render_status 42 "quentin,tim" 1)"
check     "status: bc:status present"         0 has_marker "$S" "status"
check_out "status: issue"                     0 42 marker_get "$S" "issue"
check_out "status: scope"                     0 "quentin,tim" marker_get "$S" "scope"
check_out "status: cycle"                     0 1 marker_get "$S" "cycle"

S="$(render_review_stub derek)"
check     "review stub: bc:lead:derek present"    0 has_marker "$S" "lead:derek"
check_out "review stub: reviewed placeholder"     0 - marker_get "$S" "reviewed"
check     "review stub: no verdict yet"           1 marker_get "$S" "verdict"

S="$(render_crew_review_stub)"
check     "crew review stub: bc:crew present"           0 has_marker "$S" "crew"
check_out "crew review stub: addressed placeholder"     0 - marker_get "$S" "addressed"

S="$(BC_HUMAN=Abaudat render_breaker "cycle limit reached")"
check "breaker: bc:breaker present"      0 has_marker "$S" "breaker"
check "breaker: mentions the human"      0 bash -c "printf '%s' \"\$1\" | grep -q '@Abaudat'" _ "$S"

S="$(render_demo_body 3 "Shipped the inventory screen.")"
check_out "demo body: sprint number"      0 3 marker_get "$S" "demo"
check     "demo body: is not a human comment" 1 is_human_comment "$S"

echo
echo "the epic import's provenance markers:"

S="$(render_epic_body 0 "The epic outcome, in one paragraph.")"
check_out "epic body: the epic number is the marker's value" 0 0 marker_get "$S" "epic"
check     "epic body: the preamble is carried through" 0   bash -c "printf '%s' \"\$1\" | grep -q 'The epic outcome, in one paragraph.'" _ "$S"
check     "epic body: is not a human comment" 1 is_human_comment "$S"

S="$(render_story_body 0.20 "As Scotty,
I want the plan on the board,
So that the plan and the tracker are one thing.")"
check_out "story body: the story id is the marker's value" 0 0.20 marker_get "$S" "story"
check     "story body: the role sentence is carried through" 0   bash -c "printf '%s' \"\$1\" | grep -q 'I want the plan on the board,'" _ "$S"
# Story 0.20: epic membership is the sub-issue link, lead scope is a label and
# status is the board's field -- none of the three restated in the body.
check "story body: says nothing about its epic"   1 bash -c "printf '%s' \"\$1\" | grep -qi 'epic'"   _ "$S"
check "story body: says nothing about its leads"  1 bash -c "printf '%s' \"\$1\" | grep -qi 'lead'"   _ "$S"
check "story body: says nothing about its status" 1 bash -c "printf '%s' \"\$1\" | grep -qi 'backlog'" _ "$S"

summary
