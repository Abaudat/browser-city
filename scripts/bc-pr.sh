#!/usr/bin/env bash
# LEVEL 2 -- pull-request facts and actions (B1, C3 in
# high-level-agentic-flow.mmd; `open` is called by Crew, not Scotty).
# Composes gh.sh only. The one primitive this file uses that is NOT in
# lib/ -- `git` itself, for the current branch and the push -- is the one
# tool the plan explicitly leaves unwrapped (see plan-the-implementation-of-
# snoopy-magpie.md, bc-pr.sh section): "git is not wrapped -- call `git`
# directly". `open` runs in whatever cwd the caller (Crew, in its task
# worktree) is sitting in; this script never `cd`s.
set -u
_BC_PR_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_PR_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/gh.sh
. "$_BC_PR_DIR/lib/gh.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-pr.sh <command> [args]
  open <issue> <title> <bodyfile>  -- open a PR from the cwd's current branch (Crew)
  merge <pr>                        -- squash-merge and delete the branch
  for-issue <issue>                 -- {"number":n,"head":"<sha>"} of the open PR closing it
  head <pr>                         -- the PR's current head sha
EOF
}

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in

open)
  issue="${1:-}" title="${2:-}" bodyfile="${3:-}"
  [ -n "$issue" ] && [ -n "$title" ] && [ -n "$bodyfile" ] || { usage; exit 2; }

  # Idempotent for nudges: if a PR closing this issue is already open, this
  # is a re-dispatch to Crew after a crash/nudge -- report it, create nothing.
  existing="$(gh_pr_for_issue "$issue" 2>/dev/null)"
  if [ -n "$existing" ]; then
    printf '%s\n' "$(printf '%s' "$existing" | "$JQ" -r '.number')"
    exit 0
  fi

  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || {
    echo "bc-pr open: could not determine the current git branch" >&2
    exit 2
  }
  if [ "$branch" = "$BC_BASE_BRANCH" ]; then
    echo "bc-pr open: refusing to open a PR from $BC_BASE_BRANCH" >&2
    exit 2
  fi

  # BC_SKIP_PUSH=1 is a test hook -- tests run against a scratch repo with no
  # real remote to push to.
  if [ "${BC_SKIP_PUSH:-}" != "1" ]; then
    git push -u origin "$branch" >/dev/null 2>&1 || {
      echo "bc-pr open: git push -u origin $branch failed" >&2
      exit 2
    }
  fi

  content="$(cat "$bodyfile")"
  prbody="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-pr-open.XXXXXX")"
  printf '%s\n\nCloses #%s\n' "$content" "$issue" > "$prbody"

  new="$(gh_pr_create "$BC_BASE_BRANCH" "$branch" "$title" "$prbody" "$BC_LABEL_STORY")"
  rc=$?
  # Deliberately not rm'd: a test asserts the "Closes #<issue>" body by
  # reading the path gh_pr_create logged to calls.log back off disk.
  # Same BC_FAKE quirk as bc-issue.sh create-demo: gh_pr_create's write
  # fixture has no return-value support under BC_FAKE unless a
  # gh_pr_create.json fixture is present, so check the function's exit code,
  # not whether $new came back empty.
  if [ "$rc" -ne 0 ]; then
    echo "bc-pr open: gh_pr_create failed" >&2
    exit 2
  fi
  printf '%s\n' "$new"
  exit 0
  ;;

merge)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  gh_pr_merge "$pr" || { echo "bc-pr merge: failed to merge PR #$pr" >&2; exit 2; }
  exit 0
  ;;

for-issue)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  out="$(gh_pr_for_issue "$issue")" || exit 1
  [ -n "$out" ] || exit 1
  printf '%s' "$out" | "$JQ" -c '{number: .number, head: .headRefOid}'
  exit 0
  ;;

head)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  sha="$(gh_pr_head "$pr")" || exit 1
  [ -n "$sha" ] || exit 1
  printf '%s\n' "$sha"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
