#!/usr/bin/env bash
# Issue/PR/comment/label primitives for $BC_REPO. Wraps `gh` (REST via
# `gh api`, plus a couple of porcelain commands and one GraphQL call for
# issue.parent, which REST does not expose). The one rule: every function is
# exactly one gh call -- no branching, no aggregation, no judgement -- and is
# fake-aware via fake.sh so nothing above this file needs GitHub reachable to
# be tested.

_BC_GH_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_GH_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_GH_LIB_DIR/fake.sh"

# Merges however many pages --paginate produced (each page its own top-level
# JSON array) into one flat array. Silent empty-array on empty input, so a
# zero-result endpoint and a one-page endpoint look the same to the caller.
_gh_merge_pages() { "$JQ" -s 'add // []'; }

gh_issue_create() { # <title> <bodyfile> <labels-csv> -> new issue number
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_issue_create "$@"; return; }
  local title="$1" bodyfile="$2" labels="$3" url
  local args=(--repo "$BC_REPO" --title "$title" --body-file "$bodyfile")
  if [ -n "$labels" ]; then
    local IFS=',' l
    for l in $labels; do args+=(--label "$l"); done
  fi
  url="$("$GH" issue create "${args[@]}" 2>/dev/null)" || return 1
  printf '%s' "${url##*/}"
}

gh_issue_labels() { # <n> -> JSON array of label names
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_issue_labels "$1"; return; }
  "$GH" api "repos/$BC_REPO/issues/$1/labels" --jq '[.[].name]' 2>/dev/null
}

gh_issue_add_labels() { # <n> <labels-csv>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_issue_add_labels "$@"; return; }
  "$GH" issue edit "$1" --repo "$BC_REPO" --add-label "$2" >/dev/null 2>&1
}

gh_issue_comments() { # <n> -> JSON array of comments (id, body, ...)
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_issue_comments "$1"; return; }
  local out
  out="$("$GH" api --paginate "repos/$BC_REPO/issues/$1/comments" 2>/dev/null)" || return 1
  printf '%s' "$out" | _gh_merge_pages
}

gh_comment_create() { # <n> <bodyfile> -> new comment id
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_comment_create "$@"; return; }
  "$GH" api "repos/$BC_REPO/issues/$1/comments" -F body="@$2" --jq '.id' 2>/dev/null
}

gh_comment_edit() { # <comment-id> <bodyfile>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_comment_edit "$@"; return; }
  "$GH" api "repos/$BC_REPO/issues/comments/$1" -X PATCH -F body="@$2" >/dev/null 2>&1
}

gh_issue_close() { # <n>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_issue_close "$@"; return; }
  "$GH" issue close "$1" --repo "$BC_REPO" >/dev/null 2>&1
}

gh_issue_assign() { # <n> <login>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_issue_assign "$@"; return; }
  "$GH" issue edit "$1" --repo "$BC_REPO" --add-assignee "$2" >/dev/null 2>&1
}

gh_subissues() { # <n> -> JSON array of sub-issues
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_subissues "$1"; return; }
  local out
  out="$("$GH" api --paginate "repos/$BC_REPO/issues/$1/sub_issues" 2>/dev/null)" || return 1
  printf '%s' "$out" | _gh_merge_pages
}

gh_issue_add_subissue() { # <parent> <child-database-id>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_issue_add_subissue "$@"; return; }
  "$GH" api "repos/$BC_REPO/issues/$1/sub_issues" -F sub_issue_id="$2" >/dev/null 2>&1
}

gh_issue_parent() { # <n> -> parent issue number (exit 1 if none)
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_issue_parent "$1"; return; }
  local owner="${BC_REPO%/*}" repo="${BC_REPO#*/}" out
  out="$("$GH" api graphql \
    -f query='query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){ issue(number:$number){ parent { number } } }
    }' -F owner="$owner" -F repo="$repo" -F number="$1" \
    --jq '.data.repository.issue.parent.number' 2>/dev/null)" || return 1
  [ -n "$out" ] && [ "$out" != "null" ] || return 1
  printf '%s' "$out"
}

gh_pr_list_open() { # -> JSON array of open PRs
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_pr_list_open; return; }
  "$GH" pr list --repo "$BC_REPO" --state open \
    --json number,title,headRefOid,body,labels 2>/dev/null
}

gh_pr_for_issue() { # <issue-n> -> {number, headRefOid} of the PR that closes it, or nothing
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_pr_for_issue "$1"; return; }
  local out
  out="$("$GH" pr list --repo "$BC_REPO" --state open \
    --search "\"Closes #$1\" in:body" \
    --json number,headRefOid 2>/dev/null)" || return 1
  [ "$(printf '%s' "$out" | "$JQ" 'length')" -gt 0 ] || return 1
  printf '%s' "$out" | "$JQ" -c '.[0]'
}

gh_pr_head() { # <pr> -> current head SHA
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_pr_head "$1"; return; }
  "$GH" pr view "$1" --repo "$BC_REPO" --json headRefOid --jq '.headRefOid' 2>/dev/null
}

gh_pr_create() { # <base> <head> <title> <bodyfile> <labels-csv> -> new PR number
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_pr_create "$@"; return; }
  local base="$1" head="$2" title="$3" bodyfile="$4" labels="$5" url
  local args=(--repo "$BC_REPO" --base "$base" --head "$head" --title "$title" --body-file "$bodyfile")
  if [ -n "$labels" ]; then
    local IFS=',' l
    for l in $labels; do args+=(--label "$l"); done
  fi
  url="$("$GH" pr create "${args[@]}" 2>/dev/null)" || return 1
  printf '%s' "${url##*/}"
}

gh_pr_merge() { # <pr>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_pr_merge "$@"; return; }
  "$GH" pr merge "$1" --repo "$BC_REPO" "--${BC_MERGE_METHOD}" --delete-branch >/dev/null 2>&1
}

gh_label_list() { # -> JSON array of label names in the repo
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_label_list; return; }
  "$GH" api "repos/$BC_REPO/labels" --jq '[.[].name]' --paginate 2>/dev/null | _gh_merge_pages
}

gh_label_create() { # <name> <color-hex-no-hash> <description>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_label_create "$@"; return; }
  "$GH" label create "$1" --repo "$BC_REPO" --color "$2" --description "$3" --force >/dev/null 2>&1
}

# Appended by the bc-issue.sh work: create-demo needs each Done story's body
# (first non-empty line) and demo-current needs to read the `bc:demo` marker
# out of the demo issue's own body -- gh-cli.sh had no body getter yet.
gh_issue_body() { # <n> -> issue body text
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_issue_body "$1"; return; }
  "$GH" api "repos/$BC_REPO/issues/$1" --jq '.body // ""' 2>/dev/null
}

gh_auth_scopes() { # -> space-separated token scopes, from `gh auth status`
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read gh_auth_scopes; return; }
  "$GH" auth status 2>&1 | "$JQ" -Rrs 'capture("Token scopes: (?<s>.*)").s? // empty' \
    | tr -d "'" | tr ',' ' '
}

# Appended by the bc-comment.sh work: create-breaker needs to label and
# assign a PULL REQUEST, and gh_issue_add_labels/gh_issue_assign cannot be
# reused for that -- both are built on porcelain `gh issue edit`, which
# resolves its target through a GraphQL query that requires an actual Issue
# node. Confirmed empirically against the real repo: `gh issue view <PR
# number>` fails with "Could not resolve to an Issue with the number of N."
# even though the PR exists. The REST `/issues/{number}/...` endpoints are
# shared between issues and PRs (confirmed too: `gh api repos/.../issues/
# <PR number>/comments` succeeds), so these two call `gh api` directly on
# that endpoint instead of the porcelain command, exactly like
# gh_comment_create/gh_issue_comments already do above.
gh_pr_add_labels() { # <pr> <labels-csv>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_pr_add_labels "$@"; return; }
  local n="$1" labels="$2" IFS=',' l args=()
  for l in $labels; do args+=(-f "labels[]=$l"); done
  [ "${#args[@]}" -gt 0 ] || return 0
  "$GH" api "repos/$BC_REPO/issues/$n/labels" -X POST "${args[@]}" >/dev/null 2>&1
}

gh_pr_assign() { # <pr> <login>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write gh_pr_assign "$@"; return; }
  "$GH" api "repos/$BC_REPO/issues/$1/assignees" -f "assignees[]=$2" >/dev/null 2>&1
}
