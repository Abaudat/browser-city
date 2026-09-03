#!/usr/bin/env bash
# LEVEL 2 -- the structured-comment reads/writes every other role in the
# flow depends on -- the analysis stubs, the review stubs and their verdicts,
# the cycle counter and the circuit breaker. Covers the To analyze, Leads
# review and Reviewed phases of high-level-agentic-flow.mmd. Composes
# gh-cli.sh + markers.sh; delegates to bc-issue.sh (for `scope`) and bc-pr.sh
# (for `head`) as subprocesses rather than re-deriving their facts, and to
# Scotty (claude_oneshot_acting + judge-breaker.md) for the one piece of
# judgement, the breaker note.
#
# `create-breaker` and `write-breaker` are the two halves of that one node:
# create-breaker gathers the thread and hands it to Scotty, and Scotty calls
# write-breaker back to post the note, label the PR and assign the human in
# one step. Splitting it that way is what makes the note and the comment
# carrying it atomic -- there is no state in which the breaker comment exists
# without Scotty's prose in it -- and it is why write-breaker is in the
# bc-sdlc skill: Scotty is a caller of this script, not just its subject.
#
# One writer per comment, always found by marker: every write command below
# locates its comment via `_bc_find_by_marker` and `gh_comment_edit`s it --
# none of them ever calls gh_comment_create a second time for the same
# marker (create-analysis-stubs/create-review-stubs/write-breaker are the
# only creators, and each is itself marker-gated for idempotency).
set -u
_BC_COMMENT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_COMMENT_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/gh-cli.sh
. "$_BC_COMMENT_DIR/lib/gh-cli.sh"
# shellcheck source=lib/claude.sh
. "$_BC_COMMENT_DIR/lib/claude.sh"
# shellcheck source=lib/markers.sh
. "$_BC_COMMENT_DIR/lib/markers.sh"

_BC_ISSUE_SH="$_BC_COMMENT_DIR/bc-issue.sh"
_BC_PR_SH="$_BC_COMMENT_DIR/bc-pr.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-comment.sh <command> [args]
  create-analysis-stubs <issue> <role>...       -- starting-dev-cycle / leads-analysed (idempotent; crew gets none)
  create-review-stubs <pr> <issue>              -- opening-leads-review
  create-breaker <pr>                           -- tripping-breaker (hands it to Scotty)
  write-breaker <pr> <bodyfile>                 -- Scotty, tripping-breaker: post + label + assign
  bump-cycle <pr>                                -- reopening-leads-review
  breaker-exists <pr>                            -- breaker-tripped
  sessions <issue>                               -- {role: uuid}, derived from role + issue
  scope <pr>
  pending-leads <issue>                          -- leads-analysed
  all-leads-commented --issue <n> | --pr <n>     -- leads-analysed, leads-reviewed-head
  stale-leads <pr>                               -- leads-reviewed-head
  unapproved-leads <pr>                          -- leads-all-approved
  crew-addressed <pr>                            -- crew-addressed
  should-trigger-breaker <pr>                    -- cycles-exhausted
  update-analysis <issue> <role> <bodyfile>      -- a lead, To analyze
  approve <pr> <role> [bodyfile]                 -- a lead, Leads review
  reject <pr> <role> [bodyfile]                  -- a lead, Leads review
  mark-addressed <pr> [bodyfile]                 -- Crew, Reviewed
EOF
}

# --- shared helpers ----------------------------------------------------------

# _bc_comments <n> -> JSON array on stdout, "[]" (never a hard failure) if
# the read fails or there simply are none yet -- every caller below treats
# "no comments" and "couldn't read" the same way: nothing found yet.
_bc_comments() { gh_issue_comments "$1" 2>/dev/null || printf '[]'; }

# _bc_find_by_marker <comments-json> <marker-name> -> {"id":n,"body":"..."}
# on stdout (numeric id, body with jq.exe's CRLF stripped), exit 1 if no
# comment in the array carries that marker.
_bc_find_by_marker() {
  local comments="$1" name="$2" count i body id
  count="$(printf '%s' "$comments" | "$JQ" 'length' 2>/dev/null || printf 0)"
  i=0
  while [ "$i" -lt "$count" ]; do
    body="$(printf '%s' "$comments" | "$JQ" -r --argjson i "$i" '.[$i].body' | tr -d '\r')"
    if has_marker "$body" "$name"; then
      id="$(printf '%s' "$comments" | "$JQ" -r --argjson i "$i" '.[$i].id')"
      "$JQ" -n -c --arg id "$id" --arg body "$body" '{id: ($id|tonumber), body: $body}'
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

# _bc_review_history <body> <cycle> -> the earlier cycle sections of a
# lead's review comment: everything between the "### Review" heading and the
# markers, minus the "_Not yet reviewed._" placeholder and minus a section
# already written for this same cycle (stamping a cycle twice replaces it).
# Each `approve`/`reject` appends its own "#### Cycle N" section after this,
# so the comment keeps the lead's history -- the agents read their last
# section to know what they already said.
_bc_review_history() {
  local body="$1" cycle="$2"
  printf '%s\n' "$body" | awk -v cyc="$cycle" '
    /^<!-- bc:/ { exit }
    /^### Review — / { next }
    /^_Not yet reviewed\._$/ { next }
    $0 ~ ("^#### Cycle " cyc " — ") { exit }
    { print }
  ' | sed -e '/./,$!d' -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

_bc_marker_present() { # <comments-json> <marker-name> -> exit 0/1
  _bc_find_by_marker "$1" "$2" >/dev/null 2>&1
}

# _bc_write_comment <n> <renderer-output-on-stdin> -- helper so every
# creator below is a one-liner: `_bc_render ... | _bc_write_comment "$n"`.
# Deliberately does NOT rm its tempfile (unlike bc-issue.sh/bc-sprint.sh's
# bodyfile helpers): tests assert a writer's effect by reading the exact
# path gh_comment_create/gh_comment_edit logged to calls.log back off disk
# and checking its markers -- under BC_FAKE nothing else ever captures what
# was written, so the file has to still be there afterwards. Left for the OS
# temp directory to reap, same as harness.sh's fake_dir.
_bc_write_comment() {
  local n="$1" f
  f="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment.XXXXXX")"
  cat > "$f"
  gh_comment_create "$n" "$f" >/dev/null
}

_bc_edit_comment() { # <comment-id> <new-body-on-stdin>
  local id="$1" f
  f="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment.XXXXXX")"
  cat > "$f"
  gh_comment_edit "$id" "$f"
}

_bc_pr_head() { bash "$_BC_PR_SH" head "$1" 2>/dev/null; } # <pr> -> sha or empty/1

_bc_issue_scope() { bash "$_BC_ISSUE_SH" scope "$1" 2>/dev/null; } # <issue> -> csv or empty/2

# _bc_scope_of_pr <comments-json> -> the bc:scope csv from the status
# comment, or exit 1 if there is no status comment / no scope marker on it.
_bc_scope_of_pr() {
  local comments="$1" status body
  status="$(_bc_find_by_marker "$comments" "status")" || return 1
  body="$(printf '%s' "$status" | "$JQ" -r '.body')"
  marker_get "$body" scope
}

# _bc_pending_leads <scope-csv> <comments-json> -> csv on stdout ; 0 has
# pending, 1 none. A scoped lead with no analysis stub at all counts as
# pending (a crashed starting-dev-cycle left it missing; the orchestrator
# re-creates stubs before asking), so a missing comment can never read as
# "done".
_bc_pending_leads() {
  local scope="$1" comments="$2" role stub body direction out=()
  for role in $BC_LEADS; do
    case ",$scope," in *",$role,"*) ;; *) continue ;; esac
    if stub="$(_bc_find_by_marker "$comments" "lead:${role}")"; then
      body="$(printf '%s' "$stub" | "$JQ" -r '.body')"
      direction="$(marker_get "$body" direction 2>/dev/null || true)"
      [ "$direction" = "READY" ] && continue
    fi
    out+=("$role")
  done
  [ "${#out[@]}" -gt 0 ] || return 1
  local IFS=','
  printf '%s' "${out[*]}"
  return 0
}

# _bc_stale_leads <scope-csv> <comments-json> <head> -> csv on stdout ; 0 has
# stale, 1 none stale. A scoped role with no review stub at all counts as
# stale too (a crashed opening-leads-review tick left it missing).
_bc_stale_leads() {
  local scope="$1" comments="$2" head="$3" role stub body reviewed out=()
  local IFS=',' roles
  read -ra roles <<< "$scope"
  for role in "${roles[@]}"; do
    [ -n "$role" ] || continue
    stub="$(_bc_find_by_marker "$comments" "lead:${role}")" || { out+=("$role"); continue; }
    body="$(printf '%s' "$stub" | "$JQ" -r '.body')"
    reviewed="$(marker_get "$body" reviewed 2>/dev/null || printf -- -)"
    [ "$reviewed" = "$head" ] || out+=("$role")
  done
  [ "${#out[@]}" -gt 0 ] || return 1
  local IFS=','
  printf '%s' "${out[*]}"
  return 0
}

# _bc_unapproved_leads <scope-csv> <comments-json> <head> -> csv ; 0 has
# unapproved, 1 all approved.
_bc_unapproved_leads() {
  local scope="$1" comments="$2" head="$3" role stub body reviewed verdict out=()
  local IFS=',' roles
  read -ra roles <<< "$scope"
  for role in "${roles[@]}"; do
    [ -n "$role" ] || continue
    stub="$(_bc_find_by_marker "$comments" "lead:${role}")" || { out+=("$role"); continue; }
    body="$(printf '%s' "$stub" | "$JQ" -r '.body')"
    reviewed="$(marker_get "$body" reviewed 2>/dev/null || printf -- -)"
    verdict="$(marker_get "$body" verdict 2>/dev/null || true)"
    if [ "$reviewed" = "$head" ] && [ "$verdict" = "APPROVED" ]; then
      :
    else
      out+=("$role")
    fi
  done
  [ "${#out[@]}" -gt 0 ] || return 1
  local IFS=','
  printf '%s' "${out[*]}"
  return 0
}

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in

create-analysis-stubs)
  issue="${1:-}"; shift || true
  [ -n "$issue" ] && [ $# -gt 0 ] || { usage; exit 2; }
  comments="$(_bc_comments "$issue")"
  created=0
  for pair in "$@"; do
    role="${pair%%=*}"   # "role=uuid" is still accepted; the uuid is ignored
    # Crew never writes on the issue: no stub for it.
    [ "$role" = "crew" ] && continue
    _bc_marker_present "$comments" "lead:${role}" && continue
    render_analysis_stub "$role" | _bc_write_comment "$issue"
    created=$((created + 1))
  done
  printf '%s\n' "$created"
  exit 0
  ;;

create-review-stubs)
  pr="${1:-}" issue="${2:-}"
  [ -n "$pr" ] && [ -n "$issue" ] || { usage; exit 2; }
  scope="$(_bc_issue_scope "$issue")"
  if [ -z "$scope" ]; then
    echo "bc-comment create-review-stubs: could not read scope for issue #$issue" >&2
    exit 2
  fi
  comments="$(_bc_comments "$pr")"
  created=0
  if ! _bc_marker_present "$comments" "status"; then
    render_status "$issue" "$scope" 1 | _bc_write_comment "$pr"
    created=$((created + 1))
  fi
  IFS=',' read -ra roles <<< "$scope"
  for role in "${roles[@]}"; do
    [ -n "$role" ] || continue
    _bc_marker_present "$comments" "lead:${role}" && continue
    render_review_stub "$role" | _bc_write_comment "$pr"
    created=$((created + 1))
  done
  if ! _bc_marker_present "$comments" "crew"; then
    render_crew_review_stub | _bc_write_comment "$pr"
    created=$((created + 1))
  fi
  printf '%s\n' "$created"
  exit 0
  ;;

create-breaker)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  _bc_marker_present "$comments" "breaker" && exit 1

  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment-breaker.XXXXXX")"
  status="$(_bc_find_by_marker "$comments" "status" || true)"
  if [ -n "$status" ]; then
    sbody="$(printf '%s' "$status" | "$JQ" -r '.body')"
    sissue="$(marker_get "$sbody" issue 2>/dev/null || true)"
    sscope="$(marker_get "$sbody" scope 2>/dev/null || true)"
    scycle="$(marker_get "$sbody" cycle 2>/dev/null || true)"
    printf 'PR #%s status: issue #%s, scope: %s, review cycle: %s\n\n' \
      "$pr" "$sissue" "$sscope" "$scycle" >> "$input"
  fi
  count="$(printf '%s' "$comments" | "$JQ" 'length')"
  i=0
  while [ "$i" -lt "$count" ]; do
    body="$(printf '%s' "$comments" | "$JQ" -r --argjson i "$i" '.[$i].body' | tr -d '\r')"
    heading="$(printf '%s\n' "$body" | grep -m1 '^###' || true)"
    stripped="$(printf '%s\n' "$body" | grep -v '<!-- bc:' || true)"
    printf -- '---\n%s\n\n%s\n\n' "${heading:-(comment)}" "$stripped" >> "$input"
    i=$((i + 1))
  done

  # Scotty writes the note AND posts it, in one `write-breaker` call of his
  # own -- this command never sees his prose. His stdout is not the product,
  # so the comment id comes back through BC_WRITE_RESULT instead.
  bodyfile="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment-breaker-body.XXXXXX")"
  result="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment-breaker-result.XXXXXX")"
  # The rendered prompt keeps its original basename -- claude_oneshot_acting
  # logs and looks up fixtures by it -- so it goes in a temp dir of its own
  # rather than under a mktemp'd name.
  promptdir="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-comment-breaker-prompt.XXXXXX")"
  prompt="$promptdir/judge-breaker.md"
  claude_render_prompt "$_BC_COMMENT_DIR/prompts/judge-breaker.md" \
    scripts="$_BC_COMMENT_DIR" pr="$pr" bodyfile="$bodyfile" > "$prompt"

  export BC_WRITE_RESULT="$result"
  claude_oneshot_acting "$prompt" "$input"
  unset BC_WRITE_RESULT
  rm -rf "$promptdir"
  rm -f "$input" "$bodyfile"

  newid="$(tr -d '\r\n' < "$result" 2>/dev/null || true)"
  rm -f "$result"
  if [ -z "$newid" ]; then
    echo "bc-comment create-breaker: judge-breaker.md did not write the breaker comment on PR #$pr" >&2
    exit 2
  fi
  printf '%s\n' "$newid"
  exit 0
  ;;

write-breaker)
  pr="${1:-}" bodyfile="${2:-}"
  [ -n "$pr" ] && [ -n "$bodyfile" ] || { usage; exit 2; }
  [ -f "$bodyfile" ] || { echo "bc-comment write-breaker: no such body file: $bodyfile" >&2; exit 2; }
  note="$(sed -e 's/[[:space:]]*$//' "$bodyfile")"
  if [ -z "$(printf '%s' "$note" | tr -d '[:space:]')" ]; then
    echo "bc-comment write-breaker: the body file is empty" >&2
    exit 2
  fi
  comments="$(_bc_comments "$pr")"
  _bc_marker_present "$comments" "breaker" && exit 1

  out="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-comment-breaker-out.XXXXXX")"
  render_breaker "$note" > "$out"
  newid="$(gh_comment_create "$pr" "$out")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "bc-comment write-breaker: gh_comment_create failed" >&2
    exit 2
  fi
  gh_pr_add_labels "$pr" "$BC_LABEL_BREAKER"
  gh_pr_assign "$pr" "$BC_HUMAN"

  [ -n "$newid" ] || newid=ok
  bc_record_result "$newid"
  printf '%s\n' "$newid"
  exit 0
  ;;

bump-cycle)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  status="$(_bc_find_by_marker "$comments" "status")" || {
    echo "bc-comment bump-cycle: no status comment on PR #$pr" >&2
    exit 2
  }
  id="$(printf '%s' "$status" | "$JQ" -r '.id')"
  body="$(printf '%s' "$status" | "$JQ" -r '.body')"
  cur="$(marker_get "$body" cycle 2>/dev/null || printf 0)"
  new=$((cur + 1))
  marker_set "$body" cycle "$new" | _bc_edit_comment "$id"
  printf '%s\n' "$new"
  exit 0
  ;;

breaker-exists)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  if _bc_marker_present "$comments" "breaker"; then
    echo yes
    exit 0
  fi
  echo no
  exit 1
  ;;

sessions)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  # Nothing is read: every role's uuid is a function of role + issue.
  result="{}"
  for role in $BC_ROLES; do
    result="$(printf '%s' "$result" | "$JQ" -c --arg r "$role" --arg u "$(bc_role_uuid "$role" "$issue")" '. + {($r): $u}')"
  done
  printf '%s\n' "$result"
  exit 0
  ;;

scope)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  val="$(_bc_scope_of_pr "$comments")" || {
    echo "bc-comment scope: no status comment (or no bc:scope on it) for PR #$pr" >&2
    exit 2
  }
  printf '%s\n' "$val"
  exit 0
  ;;

pending-leads)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  scope="$(_bc_issue_scope "$issue")"
  [ -n "$scope" ] || { echo "bc-comment pending-leads: could not read scope for issue #$issue" >&2; exit 2; }
  comments="$(_bc_comments "$issue")"
  out="$(_bc_pending_leads "$scope" "$comments")"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$out"
  exit "$rc"
  ;;

all-leads-commented)
  flag="${1:-}" n="${2:-}"
  [ -n "$flag" ] && [ -n "$n" ] || { usage; exit 2; }
  case "$flag" in
    --issue)
      scope="$(_bc_issue_scope "$n")"
      [ -n "$scope" ] || { echo "bc-comment all-leads-commented: could not read scope for issue #$n" >&2; exit 2; }
      comments="$(_bc_comments "$n")"
      if _bc_pending_leads "$scope" "$comments" >/dev/null; then echo no; exit 1; else echo yes; exit 0; fi
      ;;
    --pr)
      comments="$(_bc_comments "$n")"
      scope="$(_bc_scope_of_pr "$comments")" || { echo "bc-comment all-leads-commented: no status comment for PR #$n" >&2; exit 2; }
      head="$(_bc_pr_head "$n")" || { echo "bc-comment all-leads-commented: no head for PR #$n" >&2; exit 2; }
      if _bc_stale_leads "$scope" "$comments" "$head" >/dev/null; then echo no; exit 1; else echo yes; exit 0; fi
      ;;
    *) usage; exit 2 ;;
  esac
  ;;

stale-leads)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  scope="$(_bc_scope_of_pr "$comments")" || { echo "bc-comment stale-leads: no status comment for PR #$pr" >&2; exit 2; }
  head="$(_bc_pr_head "$pr")" || { echo "bc-comment stale-leads: no head for PR #$pr" >&2; exit 2; }
  out="$(_bc_stale_leads "$scope" "$comments" "$head")"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$out"
  exit "$rc"
  ;;

unapproved-leads)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  scope="$(_bc_scope_of_pr "$comments")" || { echo "bc-comment unapproved-leads: no status comment for PR #$pr" >&2; exit 2; }
  head="$(_bc_pr_head "$pr")" || { echo "bc-comment unapproved-leads: no head for PR #$pr" >&2; exit 2; }
  out="$(_bc_unapproved_leads "$scope" "$comments" "$head")"; rc=$?
  [ "$rc" -eq 0 ] && printf '%s\n' "$out"
  exit "$rc"
  ;;

crew-addressed)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  head="$(_bc_pr_head "$pr")" || head=""
  stub="$(_bc_find_by_marker "$comments" "crew")" || { echo no; exit 1; }
  body="$(printf '%s' "$stub" | "$JQ" -r '.body')"
  addressed="$(marker_get "$body" addressed 2>/dev/null || printf -- -)"
  if [ -n "$head" ] && [ "$addressed" = "$head" ]; then
    echo yes
    exit 0
  fi
  echo no
  exit 1
  ;;

should-trigger-breaker)
  pr="${1:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  comments="$(_bc_comments "$pr")"
  status="$(_bc_find_by_marker "$comments" "status")" || { echo no; exit 1; }
  body="$(printf '%s' "$status" | "$JQ" -r '.body')"
  cycle="$(marker_get "$body" cycle 2>/dev/null || printf 0)"
  if [[ "$cycle" =~ ^[0-9]+$ ]] && [ "$cycle" -gt "$BC_CYCLE_LIMIT" ]; then
    echo yes
    exit 0
  fi
  echo no
  exit 1
  ;;

update-analysis)
  issue="${1:-}" role="${2:-}" bodyfile="${3:-}"
  [ -n "$issue" ] && [ -n "$role" ] && [ -n "$bodyfile" ] || { usage; exit 2; }
  comments="$(_bc_comments "$issue")"
  stub="$(_bc_find_by_marker "$comments" "lead:${role}")" || {
    echo "bc-comment update-analysis: no analysis stub for $role on issue #$issue" >&2
    exit 2
  }
  id="$(printf '%s' "$stub" | "$JQ" -r '.id')"
  content="$(cat "$bodyfile")"
  {
    printf '### Analysis — %s\n\n' "$role"
    printf '%s\n\n' "$content"
    printf '<!-- bc:lead:%s -->\n' "$role"
    printf '<!-- bc:direction READY -->\n'
  } | _bc_edit_comment "$id"
  exit 0
  ;;

approve|reject)
  verdict=APPROVED
  [ "$cmd" = "reject" ] && verdict=CHANGES
  default="Approved."
  [ "$cmd" = "reject" ] && default="Changes requested."
  pr="${1:-}" role="${2:-}" bodyfile="${3:-}"
  [ -n "$pr" ] && [ -n "$role" ] || { usage; exit 2; }
  head="$(_bc_pr_head "$pr")" || { echo "bc-comment $cmd: no head for PR #$pr" >&2; exit 2; }
  comments="$(_bc_comments "$pr")"
  stub="$(_bc_find_by_marker "$comments" "lead:${role}")" || {
    echo "bc-comment $cmd: no review stub for $role on PR #$pr" >&2
    exit 2
  }
  id="$(printf '%s' "$stub" | "$JQ" -r '.id')"
  body="$(printf '%s' "$stub" | "$JQ" -r '.body')"
  content="$default"
  [ -n "$bodyfile" ] && [ -f "$bodyfile" ] && content="$(cat "$bodyfile")"
  # The review cycle comes from the orchestrator's status comment (bump-cycle
  # moves it at reopening-leads-review); a PR with no status comment yet is on
  # its first.
  cycle=1
  status="$(_bc_find_by_marker "$comments" "status" || true)"
  if [ -n "$status" ]; then
    cycle="$(marker_get "$(printf '%s' "$status" | "$JQ" -r '.body')" cycle 2>/dev/null || printf 1)"
  fi
  history="$(_bc_review_history "$body" "$cycle")"
  {
    printf '### Review — %s\n\n' "$role"
    [ -n "$history" ] && printf '%s\n\n' "$history"
    printf '#### Cycle %s — %s @ `%s`\n' "$cycle" "$verdict" "${head:0:7}"
    printf '%s\n\n' "$content"
    printf '<!-- bc:lead:%s -->\n' "$role"
    printf '<!-- bc:reviewed %s -->\n' "$head"
    printf '<!-- bc:verdict %s -->\n' "$verdict"
  } | _bc_edit_comment "$id"
  exit 0
  ;;

mark-addressed)
  pr="${1:-}" bodyfile="${2:-}"
  [ -n "$pr" ] || { usage; exit 2; }
  head="$(_bc_pr_head "$pr")" || { echo "bc-comment mark-addressed: no head for PR #$pr" >&2; exit 2; }
  comments="$(_bc_comments "$pr")"
  stub="$(_bc_find_by_marker "$comments" "crew")" || {
    echo "bc-comment mark-addressed: no crew review comment on PR #$pr" >&2
    exit 2
  }
  id="$(printf '%s' "$stub" | "$JQ" -r '.id')"
  content="Addressed."
  [ -n "$bodyfile" ] && [ -f "$bodyfile" ] && content="$(cat "$bodyfile")"
  {
    printf '### Crew\n\n'
    printf '%s\n\n' "$content"
    printf '<!-- bc:crew -->\n'
    printf '<!-- bc:addressed %s -->\n' "$head"
  } | _bc_edit_comment "$id"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
