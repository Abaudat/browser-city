#!/usr/bin/env bash
# LEVEL 2 -- sprint-level facts and the two sprint-boundary actions
# (closing-sprint/starting-next-sprint in high-level-agentic-flow.mmd).
# Composes project.sh's iteration primitives and gh-cli.sh's issue close;
# the one piece of judgement it delegates is
# "what fits next sprint", via Scotty (`bc-session.sh scotty` +
# judge-sprint-scope.md).
#
# `start` and `write-scope` are the two halves of starting-next-sprint, the
# same split `bc-issue.sh` uses for creating-demo-issue: start gathers the
# candidates and hands them to Scotty, and Scotty calls write-scope back to
# move his picks onto the next sprint in one step. The board is the artefact
# here -- there is no prose -- so what makes the split worth it is not
# atomicity of text and carrier but that the *guards* live with the write:
# write-scope re-derives the candidate set itself and drops anything that is
# not one, so a picked number Scotty invented, or one another tick scoped in
# the meantime, cannot land on a sprint -- and it drops any story that would
# start an epic while an earlier one still has stories left behind. That is
# also why write-scope is in the bc-sdlc skill.
#
# The unit of scoping is the story. An epic is a grouping (see `bc-issue.sh
# next`): it is never scoped itself, and a story is scoped on its own rather
# than riding in on its epic's back. The first sprint-closing that ran for
# real showed what the other way costs: `close` put an unfinished epic's
# Backlog stories back on no sprint, but the candidates were epics and
# parentless stories only, so those stories could not be offered at all --
# and Scotty, handed only the next epics, scoped Epic 2 over the ten stories
# Epic 1 still had.
set -u
_BC_SPRINT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_SPRINT_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/project.sh
. "$_BC_SPRINT_DIR/lib/project.sh"
# shellcheck source=lib/gh-cli.sh
. "$_BC_SPRINT_DIR/lib/gh-cli.sh"
# shellcheck source=lib/claude.sh
. "$_BC_SPRINT_DIR/lib/claude.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-sprint.sh <command> [args]
  current              -- the iteration containing today (Zurich)
  next                  -- the iteration after current (or after today if none)
  over                  -- yes/no: is it past BC_DEMO_HOUR on current's last day
  items <n> [<status>]  -- the issues scoped into Sprint n, optionally one Status
  close                 -- close the current sprint, carry active work, close the demo
  start                 -- scope candidates into the next sprint via Scotty
  write-scope <n> <story>...  -- Scotty, starting-next-sprint: move his picks in
EOF
}

# Prints {number,id,title,start,end} for an iteration object on stdin (raw
# project_iterations shape: id,title,startDate,duration,end).
_bc_sprint_render() {
  "$JQ" -c '
    (.title | capture("Sprint (?<n>[0-9]+)").n | tonumber) as $n
    | {number: $n, id: .id, title: .title, start: .startDate, end: .end}
  '
}

# The next iteration after $1 (an iteration object, JSON, may be empty).
_bc_sprint_next_after() { # <current-json-or-empty> -> next iteration json or empty
  local cur="$1"
  if [ -n "$cur" ]; then
    project_iteration_after "$(printf '%s' "$cur" | "$JQ" -r '.end')"
  else
    project_iteration_after "$(bc_zurich_date)"
  fi
}

# What may be scoped into a sprint at all: an open story on no sprint that is
# not finished. Never an epic -- a grouping is not work -- and never the Demo
# issue, which belongs to the sprint it summarises. `start` offers exactly
# this set to Scotty and `write-scope` intersects his answer with it again --
# one predicate, both halves, so his picks cannot widen it.
_bc_sprint_candidates() { # <project_items JSON> on stdin -> the candidate items
  "$JQ" -c '
    [.[] | select(.state=="OPEN" and .sprintId==null and .isParent!=true
        and .status!="Done" and ((.labels|index("demo"))|not))]
  '
}

# The epic order, enforced: of the candidates <asked> names, the ones that may
# land. The first epic that would still have a candidate left over once these
# picks are gone is the one in flight, and nothing from a later epic may start
# ahead of it -- a sprint can take part of an epic, but never skip past one.
# Epics are ordered by issue number, the order they were opened in; a story in
# no epic is outside that order and always admitted.
_bc_sprint_admit() { # <candidates JSON> <asked JSON array of numbers> -> JSON array of numbers
  printf '%s\n%s\n' "$1" "$2" | "$JQ" -sc '
    .[0] as $cand | .[1] as $asked
    | [ $cand[] | .number as $x | select($asked | any(. == $x)) ] as $picked
    | ([ $cand[] | .number as $x | select($asked | any(. == $x) | not)
         | .parent | select(. != null) ] | min) as $first
    | [ $picked[] | select(.parent == null or $first == null or .parent <= $first) | .number ]
    | unique
  '
}

# Every story in <scoped> onto iteration <id>, each defaulted to Backlog only
# if the board has no Status for it yet.
_bc_sprint_carry_in() { # <scoped JSON array> <iteration-id>
  local scoped="$1" iid="$2" n st
  # jq.exe on this machine writes CRLF even for -r output; tr strips the \r so
  # `for` doesn't see e.g. "10\r" as the token (it would compare unequal to
  # "10" and, worse, get passed straight through to project_set_iteration).
  for n in $(printf '%s' "$scoped" | "$JQ" -r '.[]' | tr -d '\r' | sort -n); do
    project_set_iteration "$n" "$iid"
    st="$(project_field_get "$n" Status 2>/dev/null || true)"
    [ -n "$st" ] || project_set_single "$n" Status Backlog
  done
}

# The iteration titled "Sprint <n>", or exit 2 with a message naming the
# command that wanted it.
_bc_sprint_by_number() { # <n> <command-name> -> iteration JSON on stdout
  local n="$1" who="$2" it
  it="$(project_iterations | "$JQ" -c --arg t "Sprint $n" 'map(select(.title==$t)) | .[0] // empty')"
  if [ -z "$it" ]; then
    echo "bc-sprint $who: no iteration titled 'Sprint $n'" >&2
    return 2
  fi
  printf '%s' "$it"
}

# The board's Status column, in board order -- `items` validates its optional
# filter against it rather than silently answering [] for a typo.
_BC_STATUSES="Backlog|To analyze|In progress|Leads review|Reviewed|Done"

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true

case "$cmd" in

current)
  cur="$(project_iteration_for_date)"
  [ -n "$cur" ] || exit 1
  printf '%s' "$cur" | _bc_sprint_render
  ;;

next)
  cur="$(project_iteration_for_date)"
  nxt="$(_bc_sprint_next_after "$cur")"
  [ -n "$nxt" ] || exit 1
  printf '%s' "$nxt" | _bc_sprint_render
  ;;

over)
  cur="$(project_iteration_for_date)"
  if [ -z "$cur" ]; then
    echo no
    exit 1
  fi
  end="$(printf '%s' "$cur" | "$JQ" -r '.end')"
  today="$(bc_zurich_date)"
  hour="$(bc_zurich_hour)"
  if [[ "$today" > "$end" ]]; then
    echo yes
    exit 0
  fi
  if [ "$today" = "$end" ] && [ "$hour" -ge "$BC_DEMO_HOUR" ]; then
    echo yes
    exit 0
  fi
  echo no
  exit 1
  ;;

items)
  n="${1:-}" want="${2:-}"
  [ -n "$n" ] || { usage; exit 2; }
  sprint="$(_bc_sprint_by_number "$n" items)" || exit 2
  sprintid="$(printf '%s' "$sprint" | "$JQ" -r '.id')"

  items="$(project_items)" || { echo "bc-sprint items: could not read project items" >&2; exit 2; }
  if [ -n "$want" ] && ! [[ "|$_BC_STATUSES|" == *"|$want|"* ]]; then
    echo "bc-sprint items: unknown status '$want' (want one of: ${_BC_STATUSES//|/, })" >&2
    exit 2
  fi

  # The board is the source of truth for Status, Priority and Size, and this
  # is the read Scotty scopes and demoes from -- so it carries all three
  # alongside the epic link, and nothing else. `parent` is the epic; `isEpic`
  # tells him which rows ARE epics, since he must never scope one's own issue
  # into a sprint alongside its stories.
  out="$(printf '%s' "$items" | "$JQ" -c --arg s "$sprintid" --arg w "$want" '
    [ .[] | select(.sprintId==$s) | select($w=="" or .status==$w)
      | {number, title, status, priority, size, epic: .parent, isEpic: .isParent} ]
    | sort_by(.number)
  ')"
  printf '%s\n' "$out"
  [ "$(printf '%s' "$out" | "$JQ" 'length')" -gt 0 ] || exit 1
  exit 0
  ;;

close)
  cur="$(project_iteration_for_date)"
  if [ -z "$cur" ]; then
    echo "bc-sprint close: no current sprint for today" >&2
    exit 2
  fi
  curid="$(printf '%s' "$cur" | "$JQ" -r '.id')"
  nxt="$(_bc_sprint_next_after "$cur")"
  if [ -z "$nxt" ]; then
    echo "bc-sprint close: no next sprint iteration to carry work into" >&2
    exit 2
  fi
  nxtid="$(printf '%s' "$nxt" | "$JQ" -r '.id')"

  items="$(project_items)" || { echo "bc-sprint close: could not read project items" >&2; exit 2; }

  # The demo issue is handled explicitly below, so it is excluded from the
  # generic carry/clear pass over the rest of the sprint's items.
  sprint_items="$(printf '%s' "$items" | "$JQ" -c --arg cur "$curid" \
    '[.[] | select(.sprintId==$cur and ((.labels|index("demo"))|not))]')"

  # What carries: work the team actually started (any status past Backlog and
  # short of Done) plus the epic grouping it, so the sprint it moves into
  # still shows what the story belongs to. Nothing else does -- a story left
  # in Backlog was scoped and not reached, and it goes back to the unscoped
  # backlog for the next sprint's scoping to consider afresh, keeping the
  # Status it has. Status is never written here: close moves Sprint fields.
  carry_final="$(printf '%s' "$sprint_items" | "$JQ" -c '
    def isActive: . == "To analyze" or . == "In progress" or . == "Leads review" or . == "Reviewed";
    [.[] | select(.state=="OPEN" and (.status | isActive))] as $active
    | ([$active[].number] + [$active[] | select(.parent != null) | .parent]) | unique
  ')"

  # NB: "$carry | index(.number)" would be wrong here -- piping into $carry
  # rebinds `.` to $carry itself before .number is evaluated, so bind the
  # item's number to a variable first and test membership against that.
  clear_final="$(printf '%s' "$sprint_items" | "$JQ" -c --argjson carry "$carry_final" '
    [.[] | select(.state=="OPEN" and .status != "Done") | .number as $n
     | select($carry | any(. == $n) | not) | $n] | unique
  ')"

  # jq.exe on this machine writes CRLF even for -r output; tr strips the \r
  # so `for` doesn't see e.g. "10\r" as the token (it would compare unequal
  # to "10" and, worse, get passed straight through to project_set_iteration).
  for n in $(printf '%s' "$carry_final" | "$JQ" -r '.[]' | tr -d '\r' | sort -n); do
    project_set_iteration "$n" "$nxtid"
  done
  for n in $(printf '%s' "$clear_final" | "$JQ" -r '.[]' | tr -d '\r' | sort -n); do
    project_set_iteration "$n" clear
  done

  demo_item="$(printf '%s' "$items" | "$JQ" -c --arg cur "$curid" \
    '[.[] | select((.labels|index("demo")) and .sprintId==$cur and .state=="OPEN")] | .[0] // empty')"
  demo_n="null"
  if [ -n "$demo_item" ]; then
    demo_n="$(printf '%s' "$demo_item" | "$JQ" -r '.number')"
    project_set_single "$demo_n" Status Done
    gh_issue_close "$demo_n"
  fi

  printf '{"carried":%s,"cleared":%s,"demo":%s}\n' \
    "$(printf '%s' "$carry_final" | "$JQ" -c 'sort')" \
    "$(printf '%s' "$clear_final" | "$JQ" -c 'sort')" \
    "$demo_n"
  exit 0
  ;;

start)
  cur="$(project_iteration_for_date)"
  nxt="$(_bc_sprint_next_after "$cur")"
  if [ -z "$nxt" ]; then
    echo "bc-sprint start: no next sprint iteration configured" >&2
    exit 2
  fi
  nxtnum="$(printf '%s' "$nxt" | _bc_sprint_render | "$JQ" -r '.number')"
  nxttitle="$(printf '%s' "$nxt" | "$JQ" -r '.title')"
  nxtstart="$(printf '%s' "$nxt" | "$JQ" -r '.startDate')"
  nxtend="$(printf '%s' "$nxt" | "$JQ" -r '.end')"
  nxtdays="$(printf '%s' "$nxt" | "$JQ" -r '.duration')"

  items="$(project_items)" || { echo "bc-sprint start: could not read project items" >&2; exit 2; }

  candidates="$(printf '%s' "$items" | _bc_sprint_candidates)"
  ccount="$(printf '%s' "$candidates" | "$JQ" 'length')"
  if [ "$ccount" -eq 0 ]; then
    printf '{"scoped":[]}\n'
    exit 1
  fi

  curid=""
  [ -n "$cur" ] && curid="$(printf '%s' "$cur" | "$JQ" -r '.id')"
  nxtid="$(printf '%s' "$nxt" | "$JQ" -r '.id')"

  # What Scotty scopes from: every candidate under its epic, epics in the
  # order write-scope will hold him to, each with how far along it is -- so
  # "Epic 1 still has ten stories" is on the page rather than something he
  # would have to go and count -- then what is already on the next sprint
  # (the work close carried) and what last sprint delivered, sizes included.
  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-sprint-start.XXXXXX")"
  {
    printf '## Candidates, by epic, in the order the epics must be finished\n'
    printf '%s' "$items" | "$JQ" -r --argjson cand "$candidates" '
      def line: "- #\(.number) \(.title) — priority: \(.priority // "unset"), size: \(.size // "unset")";
      . as $items
      | ($cand | sort_by(.number)) as $cand
      | ($cand | map(.parent) | unique) as $ps
      | (($ps | map(select(. != null))) + [ $ps[] | select(. == null) ])[] as $e
      | ( if $e == null then "\n### Stories in no epic"
          else [ $items[] | select(.parent == $e) ] as $k
            | "\n### #\($e) \([ $items[] | select(.number == $e) ][0].title // "(epic not on the board)")"
              + " — \($k | map(select(.state=="CLOSED" or .status=="Done")) | length) of \($k | length) stories done,"
              + " \($k | map(select(.state=="OPEN" and .sprintId != null and .status != "Done")) | length) on a sprint"
          end ),
        ( $cand[] | select(.parent == $e) | line )
    ' | tr -d '\r'
    printf '\n## Already on %s\n\n' "$nxttitle"
    printf '%s' "$items" | "$JQ" -r --arg nxt "$nxtid" '
      [ .[] | select(.sprintId==$nxt and .isParent!=true and .state=="OPEN" and ((.labels|index("demo"))|not)) ]
      | if length == 0 then "(nothing)"
        else .[] | "- #\(.number) \(.title) — status: \(.status // "unset"), size: \(.size // "unset")" end
    ' | tr -d '\r'
    printf '\n## Last sprint delivered\n\n'
    printf '%s' "$items" | "$JQ" -r --arg cur "$curid" '
      [ .[] | select($cur != "" and .sprintId==$cur and .status=="Done" and .isParent!=true
          and ((.labels|index("demo"))|not)) ]
      | "\(length) stories" + (if length > 0 then " (sizes: \(map(.size // "unset") | join(", ")))" else "" end)
    ' | tr -d '\r'
    printf '\n## Next sprint\n\n%s %s→%s (%s days)\n' "$nxttitle" "$nxtstart" "$nxtend" "$nxtdays"
  } > "$input"

  # Scotty picks AND scopes, in one `write-scope` call of his own -- this
  # command never sees a list of numbers to act on. His reply is not the
  # product, so what he actually moved is read back off the board: the
  # candidates offered to him that are now on the next sprint.
  # The rendered prompt keeps its original basename -- `bc-session.sh scotty`
  # logs and looks up fixtures by it -- so it goes in a temp dir of its own
  # rather than under a mktemp'd name.
  promptdir="$(mktemp -d "${TMPDIR:-${TEMP:-/tmp}}/bc-sprint-start-prompt.XXXXXX")"
  prompt="$promptdir/judge-sprint-scope.md"
  claude_render_prompt "$_BC_SPRINT_DIR/prompts/judge-sprint-scope.md" \
    scripts="$_BC_SPRINT_DIR" sprint="$nxtnum" > "$prompt"

  bash "$_BC_SPRINT_DIR/bc-session.sh" scotty "$prompt" "$input"
  rm -rf "$promptdir"
  rm -f "$input"

  after="$(project_items)" || { echo "bc-sprint start: could not re-read project items" >&2; exit 2; }
  scoped="$(printf '%s\n%s\n' "$candidates" "$after" | "$JQ" -sc --arg nxt "$nxtid" '
    (.[0] | map(.number)) as $offered
    | [ .[1][] | select(.sprintId==$nxt) | .number as $x | select($offered | any(. == $x)) | $x ] | unique
  ')"
  if [ "$(printf '%s' "$scoped" | "$JQ" 'length')" -eq 0 ]; then
    echo "bc-sprint start: judge-sprint-scope.md scoped nothing into $nxttitle" >&2
    exit 2
  fi
  printf '{"scoped":%s,"sprint":"%s"}\n' "$scoped" "$nxttitle"
  exit 0
  ;;

write-scope)
  n="${1:-}"
  [ -n "$n" ] || { usage; exit 2; }
  shift
  [ "$#" -gt 0 ] || { usage; exit 2; }
  for a in "$@"; do
    case "$a" in
      ''|*[!0-9]*) echo "bc-sprint write-scope: not an issue number: $a" >&2; exit 2 ;;
    esac
  done

  sprint="$(_bc_sprint_by_number "$n" write-scope)" || exit 2
  sprintid="$(printf '%s' "$sprint" | "$JQ" -r '.id')"
  sprinttitle="$(printf '%s' "$sprint" | "$JQ" -r '.title')"

  items="$(project_items)" || { echo "bc-sprint write-scope: could not read project items" >&2; exit 2; }
  candidates="$(printf '%s' "$items" | _bc_sprint_candidates)"

  asked="$(printf '%s\n' "$@" | "$JQ" -Rsc 'split("\n") | map(select(length > 0) | tonumber)')"
  scoped="$(_bc_sprint_admit "$candidates" "$asked")"

  # Scotty reads this command's stderr in his session, so what was dropped,
  # and why, is said there rather than left for him to notice by omission.
  # Same "." rebinding trap as close's clear_final -- bind each number to $x
  # before testing it against an array.
  printf '%s\n%s\n%s\n' "$candidates" "$asked" "$scoped" | "$JQ" -sr '
    .[0] as $cand | .[1] as $asked | .[2] as $scoped
    | ($cand | map(.number)) as $nums
    | ([ $asked[] as $x | select($nums | any(. == $x) | not) | $x ] | unique) as $not
    | ([ $cand[] | .number as $x | select(($asked | any(. == $x)) and ($scoped | any(. == $x) | not)) ]) as $held
    | ([ $cand[] | .number as $x | select($asked | any(. == $x) | not) | .parent | select(. != null) ] | min) as $first
    | (if ($not | length) > 0 then "bc-sprint write-scope: not candidates (an epic, the demo, already on a sprint, finished, or no such issue), dropped: \($not | map("#\(.)") | join(" "))" else empty end),
      (if ($held | length) > 0 then "bc-sprint write-scope: epic #\($first) still has stories you did not pick, so these from later epics were dropped: \($held | map("#\(.number)") | join(" "))" else empty end)
  ' | tr -d '\r' >&2

  if [ "$(printf '%s' "$scoped" | "$JQ" 'length')" -eq 0 ]; then
    printf '{"scoped":[]}\n'
    exit 1
  fi

  _bc_sprint_carry_in "$scoped" "$sprintid"

  printf '{"scoped":%s,"sprint":"%s"}\n' "$scoped" "$sprinttitle"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
