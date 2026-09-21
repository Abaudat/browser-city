#!/usr/bin/env bash
# LEVEL 2 -- issue-level facts and actions: which sub-issue is active and in
# what status, every Status transition, and the Sprint Demo issue
# (high-level-agentic-flow.mmd's subissue-active/subissue-status,
# demo-active/demo-has-feedback, creating-demo-issue and integrating-feedback,
# plus every node that moves a Status). Composes project.sh/gh-cli.sh primitives; the two pieces of
# judgement it delegates are the Sprint Demo body and what Adrian's feedback
# means, both via Scotty (`bc-session.sh scotty` + judge-demo-summary.md /
# judge-feedback.md).
#
# `create-demo` and `write-demo` are the two halves of creating-demo-issue:
# create-demo gathers what shipped and hands it to Scotty, and Scotty calls
# write-demo back to open the issue with his body, label it and scope it into
# the sprint in one step. That is what makes the summary and the issue
# carrying it atomic -- no Sprint Demo issue ever exists without its body --
# and it is why write-demo is in the bc-sdlc skill. create-demo learns the new
# number by reading the board back once he is done, not from his reply.
#
# `integrate-feedback`, `write-epic` and `write-story` are the same split for
# integrating-feedback, with one difference that shapes the whole node:
# Scotty opens an unknown NUMBER of issues there, so there is no one issue
# to look for. integrate-feedback counts
# the open, unscoped items on the board before and after instead, and reports
# the difference; the count is a report, not a gate. Feedback that asks for
# nothing new -- praise, a question, a note about work already on the backlog
# -- is a legitimate outcome, so the Demo issue moves to Reviewed either way
# and the sprint rolls on the next tick rather than the node retrying forever.
#
# `next` is the whole of scoping. There is no sprint planning step: the
# backlog is one pool, and whenever the team is free the orchestrator starts
# the story `next` names -- no open blocker, then highest Priority, then
# smallest Size, then lowest number -- from whichever epic it hangs off. What
# orders the work is the board's Priority and Size plus GitHub's native issue
# dependencies, which is why `write-story` takes a story's blockers as a
# required argument and `write-blockers` exists for a story already open: a
# story opened without them is one the picker may start before its
# foundations exist.
#
# `epic-context` and `amend-story` serve judging-task-request, where a lead
# has asked mid-review for work its PR cannot carry. epic-context is the read
# that makes the ruling possible -- the epic and every sibling story, so
# "fold it into #47 instead" is a move Scotty can actually see rather than
# one he would have to guess at; amend-story is the write for that ruling,
# appending to a story rather than rewriting it. The other two rulings need
# nothing new: denying costs a comment, and creating is `write-story`.
set -u
_BC_ISSUE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_ISSUE_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/project.sh
. "$_BC_ISSUE_DIR/lib/project.sh"
# shellcheck source=lib/gh-cli.sh
. "$_BC_ISSUE_DIR/lib/gh-cli.sh"
# shellcheck source=lib/claude.sh
. "$_BC_ISSUE_DIR/lib/claude.sh"
# shellcheck source=lib/markers.sh
. "$_BC_ISSUE_DIR/lib/markers.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-issue.sh <command> [args]
  next                        -- the startable story: no open blocker, by priority, then size
  current                     -- the single sub-issue in an active status
  transition <issue> <status> -- set Status (and close on Done)
  scope <issue>                -- comma-joined leads in scope, quentin always
  backlog                      -- open work on the board, on no sprint yet
  create-demo <n>              -- open the Sprint n Demo issue (hands it to Scotty)
  write-demo <n> <bodyfile>     -- Scotty, creating-demo-issue: open it + scope it
  demo-current                 -- the open Sprint Demo issue, if any
  demo-commented <issue>        -- has a human commented on it
  demo-for <n>                  -- does a Sprint n Demo issue exist
  integrate-feedback <issue>     -- turn the demo's feedback into backlog work
  write-epic <n> <title> <bodyfile> <priority>
                                 -- Scotty, integrating-feedback: open an epic
  write-story <epic> <id> <title> <bodyfile> <size> <priority> <leads-csv> <blocked-by-csv>
                                 -- Scotty, integrating-feedback: open a story
  write-blockers <issue> <blocker>...
                                 -- Scotty: mark an existing story blocked by others
  epic-context <issue>           -- judging-task-request: the story's epic and every sibling
  amend-story <issue> <bodyfile> [<size>] [<priority>]
                                 -- Scotty, judging-task-request: fold work into an existing story
EOF
}

_BC_STATUSES="Backlog|To analyze|In progress|Leads review|Reviewed|Done"
_BC_SIZES="XS|S|M|L|XL"
_BC_PRIORITIES="Blocker|Critical|Standard|Low"

# _bc_issue_check_option <value> <allowed-pipe-list> <label> <command>
# Field values are set by name against the board's own option list, so a typo
# does not fail at project_set_single -- it resolves to nothing and the field
# is left silently unset. Every write below checks first.
_bc_issue_check_option() {
  if [[ "|$2|" == *"|$1|"* ]]; then
    return 0
  fi
  echo "bc-issue $4: unknown $3 '$1' (want one of: ${2//|/, })" >&2
  return 2
}

# _bc_issue_body <bodyfile> <command> -> the file's prose, trailing blanks
# trimmed, or exit 2. Same contract as write-demo's: the body file holds only
# the author's prose, and an empty one is an error rather than an empty issue.
_bc_issue_body() {
  local f="$1" who="$2" text
  [ -f "$f" ] || { echo "bc-issue $who: no such body file: $f" >&2; return 2; }
  text="$(sed -e 's/[[:space:]]*$//' "$f")"
  if [ -z "$(printf '%s' "$text" | tr -d '[:space:]')" ]; then
    echo "bc-issue $who: the body file is empty" >&2
    return 2
  fi
  printf '%s' "$text"
}

# An epic exists only to group its stories, so it is never transitioned on its
# own: it finishes exactly when its last story does. `transition <n> Done`
# calls this after closing <n>, and it closes the parent only if every OTHER
# sub-issue is already closed -- <n> itself is excluded because the sub-issues
# read can still show the close we just made as open. No parent, an unreadable
# parent, or one story still open is the ordinary case and is silent.
_bc_issue_close_epic_if_last() { # <issue> -> parent number on stdout if closed
  local child="$1" parent subs open
  parent="$(gh_issue_parent "$child" 2>/dev/null)" || return 1
  [ -n "$parent" ] || return 1
  subs="$(gh_subissues "$parent" 2>/dev/null)" || return 1
  open="$(printf '%s' "$subs" | "$JQ" --argjson n "$child" \
    '[.[] | select((.number != $n)
        and (((.state // "open") | ascii_downcase) != "closed"))] | length' \
    2>/dev/null)" || return 1
  [ "$open" = "0" ] || return 1
  project_set_single "$parent" Status Done || return 1
  gh_issue_close "$parent" || return 1
  printf '%s' "$parent"
}

# _bc_issue_blockers <csv-or-dash> <command> -> the blocker numbers, space
# separated ("-" is none), or exit 2 on anything that is not an issue number.
_bc_issue_blockers() {
  local csv="$1" who="$2" b out=()
  [ "$csv" != "-" ] || return 0
  local IFS=','
  for b in $csv; do
    [ -n "$b" ] || continue
    b="${b#\#}"
    case "$b" in
      ''|*[!0-9]*) echo "bc-issue $who: not an issue number: $b" >&2; return 2 ;;
    esac
    out+=("$b")
  done
  IFS=' '
  printf '%s' "${out[*]}"
}

# _bc_issue_block <issue> <space-separated blockers> <command> -- marks <issue>
# blocked by each. A blocker that does not resolve to an issue is exit 2, loud:
# a dependency silently not written is a story the picker starts too early.
_bc_issue_block() {
  local issue="$1" who="$3" b id
  for b in $2; do
    id="$(gh_issue_id "$b" 2>/dev/null)"
    if [ -z "$id" ]; then
      echo "bc-issue $who: no such issue to be blocked by: #$b" >&2
      return 2
    fi
    gh_issue_add_blocker "$issue" "$id" || {
      echo "bc-issue $who: could not mark #$issue blocked by #$b" >&2; return 2; }
  done
}

# scope logic shared by `next` (embeds it) and `scope` (prints it).
_bc_issue_scope() { # <issue> -> comma-joined roles on stdout
  local issue="$1" labels role present="" out=()
  labels="$(gh_issue_labels "$issue")" || return 1
  for role in $BC_LEADS; do
    if printf '%s' "$labels" | "$JQ" -e --arg r "${BC_LEAD_LABEL_PREFIX}${role}" \
        'index($r) != null' >/dev/null 2>&1; then
      present="$present $role "
    fi
  done
  for role in $BC_LEADS; do
    if [[ "$present" == *" $role "* ]] || [[ " $BC_ALWAYS_LEADS " == *" $role "* ]]; then
      out+=("$role")
    fi
  done
  local IFS=','
  printf '%s' "${out[*]}"
}

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in

next)
  items="$(project_items)" || { echo "bc-issue next: could not read project items" >&2; exit 2; }

  # The pool is the whole board, not a sprint: every open story in Backlog,
  # from any epic. An epic is a grouping and is never started -- it only ever
  # comes back as context; the Demo issue is a sprint's summary, never work;
  # an issue closed by hand keeps whatever Status it had, hence the OPEN gate.
  # Of those, the startable ones are the ones no open issue blocks
  # (project_items drops closed blockers), and the order among them is
  # Priority, then Size -- the small story first, so something ships sooner
  # and unblocks more -- then issue number.
  #
  # BC_ONLY_ISSUE narrows the pool to one story. It exists for the e2e run:
  # with no sprint to fence its throwaway story in, a run would otherwise
  # start whatever real work outranks it.
  pool="$(printf '%s' "$items" | "$JQ" -c --arg only "${BC_ONLY_ISSUE:-}" '
    [ .[] | select(.isParent!=true and .state=="OPEN" and .status=="Backlog"
        and ((.labels|index("demo"))|not)
        and ($only == "" or (.number|tostring) == $only)) ]
  ')"
  pick="$(printf '%s' "$pool" | "$JQ" -c '
    def prank: if . == "Blocker" then 0 elif . == "Critical" then 1
                elif . == "Standard" then 2 elif . == "Low" then 3 else 4 end;
    def srank: if . == "XS" then 0 elif . == "S" then 1 elif . == "M" then 2
                elif . == "L" then 3 elif . == "XL" then 4 else 5 end;
    [ .[] | select((.blockedBy // []) | length == 0) ]
    | sort_by([(.priority|prank), (.size|srank), .number])
    | .[0] // empty
    | {number, parent}
  ')"
  if [ -z "$pick" ]; then
    # A backlog with stories in it and none startable is not an empty backlog:
    # it is a dependency on something nobody will ever pick -- a cycle, or a
    # blocker that is off the board or not in Backlog. Said on stdout, where
    # the orchestrator's sleep reason picks it up.
    blocked="$(printf '%s' "$pool" | "$JQ" 'length')"
    [ "$blocked" -eq 0 ] || printf '%s Backlog stories, every one blocked by an open issue\n' "$blocked"
    exit 1
  fi

  n="$(printf '%s' "$pick" | "$JQ" -r '.number')"
  p="$(printf '%s' "$pick" | "$JQ" -r '.parent')"
  scope="$(_bc_issue_scope "$n")" || scope="$BC_ALWAYS_LEADS"
  printf '{"number":%s,"parent":%s,"scope":"%s"}\n' "$n" "$p" "$scope"
  ;;

current)
  items="$(project_items)" || { echo "bc-issue current: could not read project items" >&2; exit 2; }
  matches="$(printf '%s' "$items" | "$JQ" -c '
    [.[] | select(.isParent!=true
        and (.status=="To analyze" or .status=="In progress" or .status=="Leads review" or .status=="Reviewed")
        and ((.labels|index("demo"))|not))]
  ')"
  count="$(printf '%s' "$matches" | "$JQ" 'length')"
  if [ "$count" -eq 0 ]; then
    exit 1
  fi
  if [ "$count" -gt 1 ]; then
    echo "bc-issue current: more than one active sub-issue: $(printf '%s' "$matches" | "$JQ" -r '[.[].number] | join(", ")')" >&2
    exit 2
  fi
  printf '%s' "$matches" | "$JQ" -c '.[0] | {number, status}'
  ;;

transition)
  issue="${1:-}" status="${2:-}"
  [ -n "$issue" ] && [ -n "$status" ] || { usage; exit 2; }
  if ! [[ "|$_BC_STATUSES|" == *"|$status|"* ]]; then
    echo "bc-issue transition: unknown status '$status' (want one of: ${_BC_STATUSES//|/, })" >&2
    exit 2
  fi
  project_set_single "$issue" Status "$status" || { echo "bc-issue transition: failed to set Status" >&2; exit 2; }
  if [ "$status" = "Done" ]; then
    gh_issue_close "$issue" || { echo "bc-issue transition: failed to close issue" >&2; exit 2; }
    _bc_issue_close_epic_if_last "$issue" >/dev/null || true
  fi
  exit 0
  ;;

scope)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  out="$(_bc_issue_scope "$issue")" || { echo "bc-issue scope: could not read labels for #$issue" >&2; exit 2; }
  printf '%s\n' "$out"
  ;;

backlog)
  items="$(project_items)" || { echo "bc-issue backlog: could not read project items" >&2; exit 2; }
  # The backlog is what is on the board but on no sprint: open, sprintId null,
  # and not a Demo issue (one belongs to the sprint it summarises and is never
  # groomed). Sub-issues are included -- Scotty grooms stories, and a story's
  # epic and open blockers are exactly what he needs to see next to its
  # priority and size.
  out="$(printf '%s' "$items" | "$JQ" -c '
    [ .[] | select(.state=="OPEN" and .sprintId==null and ((.labels|index("demo"))|not))
      | {number, title, status, priority, size, epic: .parent, isEpic: .isParent, blockedBy: (.blockedBy // [])} ]
    | sort_by(.number)
  ')"
  printf '%s\n' "$out"
  [ "$(printf '%s' "$out" | "$JQ" 'length')" -gt 0 ] || exit 1
  exit 0
  ;;

create-demo)
  n="${1:-}"
  [ -n "$n" ] || { usage; exit 2; }
  sprint="$(project_iterations | "$JQ" -c --arg t "Sprint $n" 'map(select(.title==$t)) | .[0] // empty')"
  if [ -z "$sprint" ]; then
    echo "bc-issue create-demo: no iteration titled 'Sprint $n'" >&2
    exit 2
  fi
  sprintid="$(printf '%s' "$sprint" | "$JQ" -r '.id')"

  items="$(project_items)" || { echo "bc-issue create-demo: could not read project items" >&2; exit 2; }
  done_items="$(printf '%s' "$items" | "$JQ" -c --arg s "$sprintid" \
    '[.[] | select(.sprintId==$s and .status=="Done")]')"

  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-create-demo.XXXXXX")"
  count="$(printf '%s' "$done_items" | "$JQ" 'length')"
  i=0
  while [ "$i" -lt "$count" ]; do
    num="$(printf '%s' "$done_items" | "$JQ" -r --argjson i "$i" '.[$i].number')"
    title="$(printf '%s' "$done_items" | "$JQ" -r --argjson i "$i" '.[$i].title')"
    body="$(gh_issue_body "$num" 2>/dev/null || true)"
    firstline="$(printf '%s\n' "$body" | grep -m1 -v '^[[:space:]]*$' || true)"
    printf -- '- #%s %s\n  %s\n' "$num" "$title" "$firstline" >> "$input"
    i=$((i + 1))
  done

  # Scotty writes the body AND opens the issue, in one `write-demo` call of
  # his own -- this command never sees his prose. His reply is not the
  # product, so the new issue number is read back off the board.
  bodyfile="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-demo-body.XXXXXX")"
  # The rendered prompt keeps its original basename -- `bc-session.sh scotty`
  # logs and looks up fixtures by it -- so it goes in a temp dir of its own
  # rather than under a mktemp'd name.
  promptdir="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-demo-prompt.XXXXXX")"
  prompt="$promptdir/judge-demo-summary.md"
  claude_render_prompt "$_BC_ISSUE_DIR/prompts/judge-demo-summary.md" \
    scripts="$_BC_ISSUE_DIR" sprint="$n" bodyfile="$bodyfile" > "$prompt"

  bash "$_BC_ISSUE_DIR/bc-session.sh" scotty "$prompt" "$input"
  rm -rf "$promptdir"
  rm -f "$input" "$bodyfile"

  new="$(project_items 2>/dev/null | "$JQ" -r --arg t "Sprint $n" \
    '[.[] | select((.labels|index("demo")) and .sprintTitle==$t)] | .[0].number // empty' | tr -d '\r')"
  if [ -z "$new" ]; then
    echo "bc-issue create-demo: judge-demo-summary.md did not open the Sprint $n Demo issue" >&2
    exit 2
  fi
  printf '%s\n' "$new"
  exit 0
  ;;

write-demo)
  n="${1:-}" bodyfile="${2:-}"
  [ -n "$n" ] && [ -n "$bodyfile" ] || { usage; exit 2; }
  [ -f "$bodyfile" ] || { echo "bc-issue write-demo: no such body file: $bodyfile" >&2; exit 2; }
  summary="$(sed -e 's/[[:space:]]*$//' "$bodyfile")"
  if [ -z "$(printf '%s' "$summary" | tr -d '[:space:]')" ]; then
    echo "bc-issue write-demo: the body file is empty" >&2
    exit 2
  fi
  sprint="$(project_iterations | "$JQ" -c --arg t "Sprint $n" 'map(select(.title==$t)) | .[0] // empty')"
  if [ -z "$sprint" ]; then
    echo "bc-issue write-demo: no iteration titled 'Sprint $n'" >&2
    exit 2
  fi
  sprintid="$(printf '%s' "$sprint" | "$JQ" -r '.id')"

  out="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-demo-out.XXXXXX")"
  render_demo_body "$n" "$summary" > "$out"
  new="$(gh_issue_create "Sprint $n Demo" "$out" "$BC_LABEL_DEMO")"
  rc=$?
  rm -f "$out"
  # Check the function's exit code, not whether stdout was empty: under
  # BC_FAKE, gh_issue_create's write-fixture has no return-value support (it
  # only logs and returns 0), so $new is legitimately empty in every fake
  # test even on the success path -- only a nonzero exit means gh actually
  # failed to create the issue.
  if [ "$rc" -ne 0 ]; then
    echo "bc-issue write-demo: gh_issue_create failed" >&2
    exit 2
  fi

  project_item "$new" >/dev/null
  project_set_iteration "$new" "$sprintid"
  project_set_single "$new" Status "In progress"

  printf '%s\n' "$new"
  exit 0
  ;;

demo-current)
  items="$(project_items)" || { echo "bc-issue demo-current: could not read project items" >&2; exit 2; }
  cand="$(printf '%s' "$items" | "$JQ" -c '
    [.[] | select((.labels|index("demo")) and (.status=="In progress" or .status=="Reviewed") and .state=="OPEN")] | .[0] // empty
  ')"
  [ -n "$cand" ] || exit 1

  n="$(printf '%s' "$cand" | "$JQ" -r '.number')"
  status="$(printf '%s' "$cand" | "$JQ" -r '.status')"
  sprintTitle="$(printf '%s' "$cand" | "$JQ" -r '.sprintTitle // empty')"

  body="$(gh_issue_body "$n" 2>/dev/null || true)"
  k="$(marker_get "$body" "demo" 2>/dev/null || true)"
  if [ -z "$k" ] && [[ "$sprintTitle" =~ Sprint\ ([0-9]+) ]]; then
    k="${BASH_REMATCH[1]}"
  fi
  printf '{"number":%s,"status":"%s","sprint":%s}\n' "$n" "$status" "${k:-null}"
  ;;

demo-commented)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  comments="$(gh_issue_comments "$issue")" || { echo no; exit 1; }
  count="$(printf '%s' "$comments" | "$JQ" 'length')"
  i=0
  human=1
  while [ "$i" -lt "$count" ]; do
    body="$(printf '%s' "$comments" | "$JQ" -r --argjson i "$i" '.[$i].body')"
    if is_human_comment "$body"; then
      human=0
      break
    fi
    i=$((i + 1))
  done
  if [ "$human" -eq 0 ]; then
    echo yes
    exit 0
  fi
  echo no
  exit 1
  ;;

demo-for)
  n="${1:-}"
  [ -n "$n" ] || { usage; exit 2; }
  items="$(project_items)" || { echo "bc-issue demo-for: could not read project items" >&2; exit 2; }
  found="$(printf '%s' "$items" | "$JQ" -r --arg t "Sprint $n" \
    '[.[] | select((.labels|index("demo")) and .sprintTitle==$t)] | .[0].number // empty')"
  [ -n "$found" ] || exit 1
  printf '%s\n' "$found"
  ;;

integrate-feedback)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }

  body="$(gh_issue_body "$issue" 2>/dev/null || true)"
  comments="$(gh_issue_comments "$issue")" || { echo "bc-issue integrate-feedback: could not read #$issue" >&2; exit 2; }
  human="$(printf '%s' "$comments" | "$JQ" -c '[.[] | .body]')"
  hcount="$(printf '%s' "$human" | "$JQ" 'length')"

  items="$(project_items)" || { echo "bc-issue integrate-feedback: could not read project items" >&2; exit 2; }
  # The count of open, unscoped work BEFORE the call. Scotty may open any
  # number of epics and stories, so what landed is re-derived from the board
  # rather than taken from his word -- same principle as every other read
  # here, just reported instead of gated.
  before="$(printf '%s' "$items" | "$JQ" \
    '[.[] | select(.state=="OPEN" and .sprintId==null)] | length')"

  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-feedback.XXXXXX")"
  {
    printf 'Sprint Demo issue: #%s\n\n' "$issue"
    printf '%s\n\n' "$body"
    printf -- '--- feedback ---\n'
    i=0
    while [ "$i" -lt "$hcount" ]; do
      ctext="$(printf '%s' "$human" | "$JQ" -r --argjson i "$i" '.[$i]')"
      if is_human_comment "$ctext"; then
        printf -- '- %s\n' "$ctext"
      fi
      i=$((i + 1))
    done
    printf -- '\n--- backlog ---\n'
    printf '%s' "$items" | "$JQ" -r '
      .[] | select(.state=="OPEN" and .sprintId==null and ((.labels|index("demo"))|not))
      | "- #\(.number) \(.title) — \(if .isParent then "epic" else "story of #\(.parent // "nothing")" end), priority: \(.priority // "unset"), size: \(.size // "unset")"
        + (if ((.blockedBy // []) | length) > 0 then ", blocked by: \(.blockedBy | map("#\(.)") | join(" "))" else "" end)
    ' | tr -d '\r'
  } > "$input"

  promptdir="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-feedback-prompt.XXXXXX")"
  prompt="$promptdir/judge-feedback.md"
  claude_render_prompt "$_BC_ISSUE_DIR/prompts/judge-feedback.md" \
    scripts="$_BC_ISSUE_DIR" demo="$issue" > "$prompt"

  bash "$_BC_ISSUE_DIR/bc-session.sh" scotty "$prompt" "$input"
  rm -rf "$promptdir"
  rm -f "$input"

  after_items="$(project_items)" || { echo "bc-issue integrate-feedback: could not re-read project items" >&2; exit 2; }
  after="$(printf '%s' "$after_items" | "$JQ" \
    '[.[] | select(.state=="OPEN" and .sprintId==null)] | length')"
  # Reviewed regardless of what the count says: feedback the backlog already
  # covers, or that asked for nothing, leaves it unchanged, and holding the
  # demo In progress for that would stall every sprint behind it. A tick that
  # dies BEFORE this line still leaves the demo In progress and simply runs
  # again -- that is what makes the node safe to retry, not the count.
  project_set_single "$issue" Status Reviewed || {
    echo "bc-issue integrate-feedback: failed to mark demo #$issue Reviewed" >&2; exit 2; }

  printf '{"demo":%s,"created":%s}\n' "$issue" "$((after - before))"
  exit 0
  ;;

write-epic)
  n="${1:-}" title="${2:-}" bodyfile="${3:-}" prio="${4:-}"
  [ -n "$n" ] && [ -n "$title" ] && [ -n "$bodyfile" ] && [ -n "$prio" ] || { usage; exit 2; }
  _bc_issue_check_option "$prio" "$_BC_PRIORITIES" priority write-epic || exit 2
  preamble="$(_bc_issue_body "$bodyfile" write-epic)" || exit 2

  out="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-epic-out.XXXXXX")"
  render_epic_body "$n" "$preamble" > "$out"
  new="$(gh_issue_create "$title" "$out" "$BC_LABEL_EPIC")"
  rc=$?
  rm -f "$out"
  # Check the function's exit code, not whether stdout was empty: under
  # BC_FAKE, gh_issue_create's write-fixture may legitimately answer nothing.
  if [ "$rc" -ne 0 ]; then
    echo "bc-issue write-epic: gh_issue_create failed" >&2
    exit 2
  fi

  # Backlog, and on no sprint: an epic is a grouping and is never scoped, and
  # its stories go onto a sprint one at a time, as starting-dev-cycle picks them.
  project_item "$new" >/dev/null
  project_set_single "$new" Status Backlog
  project_set_single "$new" Priority "$prio"

  printf '%s\n' "$new"
  exit 0
  ;;

write-story)
  parent="${1:-}" sid="${2:-}" title="${3:-}" bodyfile="${4:-}"
  size="${5:-}" prio="${6:-}" leads="${7:-}" blockers="${8:-}"
  [ -n "$parent" ] && [ -n "$sid" ] && [ -n "$title" ] && [ -n "$bodyfile" ] \
    && [ -n "$size" ] && [ -n "$prio" ] && [ -n "$leads" ] && [ -n "$blockers" ] || { usage; exit 2; }
  _bc_issue_check_option "$size" "$_BC_SIZES" size write-story || exit 2
  _bc_issue_check_option "$prio" "$_BC_PRIORITIES" priority write-story || exit 2
  # Required, "-" for none, for the same reason <leads-csv> is: the picker
  # starts any story nothing blocks, so "what must land first" has to be an
  # answer Scotty gave rather than a question he was never asked. Parsed
  # before the issue exists -- a typo must not leave a story open and unblocked.
  blocker_list="$(_bc_issue_blockers "$blockers" write-story)" || exit 2

  # Lead scope is a label, never a line in the body -- `bc-issue scope` reads
  # it back off the labels and quentin is added there whether or not he was
  # asked for, so "-" means "quentin alone" rather than "nobody".
  labels="$BC_LABEL_STORY"
  if [ "$leads" != "-" ]; then
    IFS=',' read -r -a _leads <<< "$leads"
    for r in "${_leads[@]}"; do
      [ -n "$r" ] || continue
      if [[ " $BC_LEADS " != *" $r "* ]]; then
        echo "bc-issue write-story: unknown lead '$r' (want one of: $BC_LEADS)" >&2
        exit 2
      fi
      labels="$labels,${BC_LEAD_LABEL_PREFIX}${r}"
    done
  fi

  story="$(_bc_issue_body "$bodyfile" write-story)" || exit 2

  out="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-story-out.XXXXXX")"
  render_story_body "$sid" "$story" > "$out"
  new="$(gh_issue_create "$title" "$out" "$labels")"
  rc=$?
  rm -f "$out"
  if [ "$rc" -ne 0 ]; then
    echo "bc-issue write-story: gh_issue_create failed" >&2
    exit 2
  fi

  # Epic membership is the sub-issue link and nothing else -- not a label, not
  # a line in the body -- so this call is what makes the story part of its
  # epic. gh_issue_add_subissue takes the CHILD's database id, not its number.
  child="$(gh_issue_id "$new")"
  if [ -n "$child" ]; then
    gh_issue_add_subissue "$parent" "$child"
  fi

  # Blockers before the board: a story is startable the moment it is in
  # Backlog with nothing blocking it, so the dependencies land first.
  _bc_issue_block "$new" "$blocker_list" write-story || exit 2

  project_item "$new" >/dev/null
  project_set_single "$new" Status Backlog
  project_set_single "$new" Size "$size"
  project_set_single "$new" Priority "$prio"

  printf '%s\n' "$new"
  exit 0
  ;;

write-blockers)
  # For a story that is already open: work Scotty has just created that must
  # land BEFORE it (a fix an existing story turns out to rest on), or a
  # dependency grooming missed. Adds, never removes -- a blocker stops
  # blocking by being closed, which is the only way one should.
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  shift
  [ "$#" -gt 0 ] || { usage; exit 2; }
  case "$issue" in *[!0-9]*) echo "bc-issue write-blockers: not an issue number: $issue" >&2; exit 2 ;; esac
  blocker_list="$(_bc_issue_blockers "$(IFS=','; printf '%s' "$*")" write-blockers)" || exit 2
  for b in $blocker_list; do
    if [ "$b" = "$issue" ]; then
      echo "bc-issue write-blockers: #$issue cannot block itself" >&2
      exit 2
    fi
  done
  _bc_issue_block "$issue" "$blocker_list" write-blockers || exit 2
  printf '%s\n' "$issue"
  exit 0
  ;;

epic-context)
  # judging-task-request: everything Scotty needs to rule on a lead's request
  # without guessing -- the story in play, the epic it belongs to and that
  # epic's preamble, and every sibling story with its status, size and
  # priority. The whole epic is the unit of judgement here: a request only
  # makes sense against the outcome the epic is chasing, and "modify an
  # existing issue instead" is only reachable if the existing issues are in
  # front of him.
  #
  # Epic membership is the sub-issue link, which project_items already
  # carries as `parent`, so this is one read of the board plus one body
  # fetch -- gh_issue_parent is only the fallback for a story the board has
  # somehow not got an item for.
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  items="$(project_items)" || { echo "bc-issue epic-context: could not read project items" >&2; exit 2; }
  epic="$(printf '%s' "$items" | "$JQ" -r --argjson n "$issue" \
    'map(select(.number==$n)) | .[0].parent // empty')"
  [ -n "$epic" ] || epic="$(gh_issue_parent "$issue" 2>/dev/null || true)"
  if [ -z "$epic" ]; then
    echo "bc-issue epic-context: issue #$issue is in no epic" >&2
    exit 1
  fi
  epic_body="$(gh_issue_body "$epic" 2>/dev/null || true)"
  printf '%s' "$items" | "$JQ" -c \
    --argjson story "$issue" --argjson epic "$epic" --arg body "$epic_body" '
    {
      story: $story,
      epic: $epic,
      epicTitle: (map(select(.number==$epic)) | .[0].title // null),
      epicBody: $body,
      stories: [ .[] | select(.parent==$epic)
                 | {number, title, state, status, size, priority, blockedBy: (.blockedBy // [])} ]
                 | sort_by(.number)
    }'
  exit 0
  ;;

amend-story)
  # judging-task-request, the "fold it into work that already exists" ruling.
  # The amendment is APPENDED under its own heading rather than replacing the
  # body: the story's original prose and acceptance criteria are what the
  # leads pre-registered against, and rewriting them out from under a task in
  # flight would silently move the target. Size and Priority are optional --
  # more work often means a bigger story, but not always, and an omitted one
  # is left exactly as the board has it rather than reset to a default.
  issue="${1:-}" bodyfile="${2:-}" size="${3:-}" prio="${4:-}"
  [ -n "$issue" ] && [ -n "$bodyfile" ] || { usage; exit 2; }
  [ -z "$size" ] || _bc_issue_check_option "$size" "$_BC_SIZES" size amend-story || exit 2
  [ -z "$prio" ] || _bc_issue_check_option "$prio" "$_BC_PRIORITIES" priority amend-story || exit 2
  amendment="$(_bc_issue_body "$bodyfile" amend-story)" || exit 2

  current="$(gh_issue_body "$issue" 2>/dev/null || true)"
  if [ -z "$(printf '%s' "$current" | tr -d '[:space:]')" ]; then
    echo "bc-issue amend-story: issue #$issue has no body to amend" >&2
    exit 2
  fi

  # The `bc:story` provenance marker stays at the bottom of the body, where
  # the round-trip check looks for it, so the amendment goes in ahead of the
  # first marker line rather than after everything.
  out="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-amend-out.XXXXXX")"
  printf '%s\n' "$current" | awk -v amd="$amendment" '
    BEGIN { done = 0 }
    /^<!-- bc:/ && !done { print "## Amendment\n\n" amd "\n"; done = 1 }
    { print }
    END { if (!done) print "\n## Amendment\n\n" amd }
  ' > "$out"
  # Deliberately NOT rm'd, unlike write-demo/write-epic/write-story's body
  # files and for the same reason _bc_write_comment in bc-comment.sh keeps
  # its own: this is the only writer here whose product is a body ASSEMBLED
  # from something already on GitHub rather than handed in whole, so the
  # only way to assert it kept the original prose and left the marker at the
  # bottom is to read back the exact path gh_issue_edit_body logged. Left
  # for the OS temp directory to reap.
  gh_issue_edit_body "$issue" "$out" || { echo "bc-issue amend-story: gh_issue_edit_body failed" >&2; exit 2; }

  [ -z "$size" ] || project_set_single "$issue" Size "$size"
  [ -z "$prio" ] || project_set_single "$issue" Priority "$prio"

  printf '%s\n' "$issue"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
