#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-pr.sh: for-issue/head's found/not-
# found shapes, merge, and open's full path -- the "Closes #<issue>" body,
# the master-branch refusal, and the idempotent-when-a-PR-already-exists
# short circuit, run against a real scratch git repo (BC_SKIP_PUSH=1 stands
# in for the real `git push`, per the plan's test hook).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$TEST_DIR/.."
BC_PR="$SCRIPTS_DIR/bc-pr.sh"
. "$TEST_DIR/harness.sh"

run() { local fake="$1"; shift; BC_FAKE="$fake" bash "$BC_PR" "$@"; }

log_has() { grep -Eq -- "$2" "$1"; } # <file> <regex>

# _written_body <calls.log> [line=1] -> content of the file the writer on
# that line logged (its path is always the last whitespace-separated token).
_written_body() {
  local f p
  f="$1"
  p="$(sed -n "${2:-1}p" "$f" | awk '{print $NF}')"
  cat "$p"
}

# --- a scratch git repo for `open` ------------------------------------------
# One repo, reused read-only-ish across the open tests below: master with one
# commit, and a feature branch issue-8 checked out with one more commit.
REPO="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-pr-repo.XXXXXX")"
(
  cd "$REPO" || exit 1
  git init -q
  git config user.email test@example.com
  git config user.name test
  git config core.autocrlf false
  echo hi > f.txt
  git add f.txt
  git commit -q -m init
  git branch -M master
  git checkout -q -b issue-8
  echo more >> f.txt
  git commit -aq -m work
) >/dev/null 2>&1

in_repo() { ( cd "$REPO" && "$@" ); } # run a command with cwd=$REPO

echo "for-issue: found (number+head, key renamed) and not-found:"

FAKE_FI="$(fake_dir)"
echo '{"number":42,"headRefOid":"deadbeef"}' > "$FAKE_FI/gh_pr_for_issue.7.json"
check_out "found -> {number,head}" 0 '{"number":42,"head":"deadbeef"}' run "$FAKE_FI" for-issue 7
check "not found -> exit 1" 1 run "$FAKE_FI" for-issue 999

echo
echo "head: found (bare sha) and not-found:"

FAKE_HD="$(fake_dir)"
echo "cafebabe" > "$FAKE_HD/gh_pr_head.42.json"
check_out "found -> bare sha" 0 cafebabe run "$FAKE_HD" head 42
check "not found -> exit 1" 1 run "$FAKE_HD" head 999

echo
echo "merge: passes through gh_pr_merge's exit code:"

FAKE_MG="$(fake_dir)"
check "merge succeeds -> exit 0" 0 run "$FAKE_MG" merge 42
check "merge logged against the right PR" 0 log_has "$FAKE_MG/calls.log" '^gh_pr_merge 42$'

# fake.sh's <fn>.exit hook makes the primitive itself `exit` the whole
# process with that code (see lib/fake.sh bc_fake_write) rather than
# returning failure to its caller -- there is no fake shape for "the
# primitive returns nonzero" short of that, so this checks the forced code
# propagates, not bc-pr.sh's own `|| exit 2` (which the fake can't reach).
FAKE_MG_FAIL="$(fake_dir)"
echo 1 > "$FAKE_MG_FAIL/gh_pr_merge.exit"
check "a forced gh_pr_merge exit propagates" 1 run "$FAKE_MG_FAIL" merge 42

echo
echo "open: refuses to run from the base branch, before touching gh or git push:"

FAKE_MASTER="$(fake_dir)"
BODYFILE="$FAKE_MASTER/body.txt"
printf 'Implements the thing.\n' > "$BODYFILE"
( cd "$REPO" && git checkout -q master )
check "open from master exits 2" 2 in_repo env BC_FAKE="$FAKE_MASTER" BC_SKIP_PUSH=1 bash "$BC_PR" open 8 "T" "$BODYFILE"
check "open from master wrote nothing" 1 test -f "$FAKE_MASTER/calls.log"

echo
echo "open: creates the PR from the branch, pushes first, body = content blank-line Closes #n:"

( cd "$REPO" && git checkout -q issue-8 )
FAKE_OPEN="$(fake_dir)"
BODYFILE2="$FAKE_OPEN/body.txt"
printf 'Implements the thing.\nSecond line.\n' > "$BODYFILE2"
# A single-word title keeps calls.log's fields positional (title with spaces
# would shift the bodyfile-path field, which is otherwise this format's only
# variable-width part -- see gh_pr_create's <base> <head> <title> <bodyfile>
# <labels> signature).
NEW_PR="$(in_repo env BC_FAKE="$FAKE_OPEN" BC_SKIP_PUSH=1 bash "$BC_PR" open 8 "PRTitle" "$BODYFILE2")"
RC=$?
check_out "open exits 0" 0 0 printf '%s' "$RC"
check "open created a PR from issue-8 into master with the story label" 0 \
  log_has "$FAKE_OPEN/calls.log" '^gh_pr_create master issue-8 PRTitle .* story$'
_open_written_body() { # gh_pr_create's path field is second-to-last (labels is last)
  local p
  p="$(sed -n '1p' "$FAKE_OPEN/calls.log" | awk '{print $(NF-1)}')"
  cat "$p"
}
check_out "open's body is content + blank line + Closes #8" 0 \
  "$(printf 'Implements the thing.\nSecond line.\n\nCloses #8')" \
  _open_written_body

echo
echo "open: BC_SKIP_PUSH=1 really skips the push (no real remote in this scratch repo):"
# If bc-pr.sh open had actually tried `git push` above, the whole command
# would have failed (no remote named origin) and every check above would
# have failed with it -- this just makes that assumption explicit.
check "the scratch repo has no origin remote configured" 2 in_repo git remote get-url origin

echo
echo "open: idempotent when a PR for the issue is already open -- prints its number, creates nothing:"

FAKE_IDEM="$(fake_dir)"
echo '{"number":55,"headRefOid":"abc123"}' > "$FAKE_IDEM/gh_pr_for_issue.8.json"
check_out "prints the existing PR's number" 0 55 \
  in_repo env BC_FAKE="$FAKE_IDEM" BC_SKIP_PUSH=1 bash "$BC_PR" open 8 "T" "$BODYFILE2"
check "creates nothing (no calls.log at all)" 1 test -f "$FAKE_IDEM/calls.log"

echo
echo "unknown command: usage on stderr, exit 2:"
check "unknown command exits 2" 2 run "$(fake_dir)" bogus-command

summary
