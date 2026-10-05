#!/usr/bin/env bash
# LEVEL 2 -- sprint-level facts and the sprint's two writes: `close`
# (closing-sprint in high-level-agentic-flow.mmd) and `scope-in`
# (starting-dev-cycle). Composes project.sh's iteration primitives and
# gh-cli.sh's issue close. Nothing here needs judgement, so nothing here
# calls Scotty.
#
# There is no sprint planning. A sprint is not a batch of work chosen up
# front; it is the week a story happened to be started in. The backlog is one
# pool that `bc-issue.sh next` picks from whenever the team is free -- highest
# priority, smallest size, no open blocker, any epic -- and `scope-in` is the
# orchestrator putting that one pick onto the sprint in play as it starts it.
# So a sprint fills as it goes, the team never runs dry because a plan did,
# and the Sprint field is left meaning exactly what the demo needs it to mean:
# "this is what was worked on that week".
#
# It used to be otherwise: `start` handed Scotty the candidates after each
# demo and `write-scope` moved his picks in, held to epic order. That stopped
# the team whenever the plan ran out before the week did, and epic order was
# standing in for dependencies the board could not express. GitHub's native
# issue dependencies express them now, story by story.
set -u
_BC_SPRINT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_SPRINT_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/project.sh
. "$_BC_SPRINT_DIR/lib/project.sh"
# shellcheck source=lib/gh-cli.sh
. "$_BC_SPRINT_DIR/lib/gh-cli.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-sprint.sh <command> [args]
  current              -- the iteration containing today (Zurich)
  next                  -- the iteration after current (or after today if none)
  over                  -- yes/no: is it past BC_DEMO_HOUR on current's last day
  items <n> [<status>]  -- the issues scoped into Sprint n, optionally one Status
  close                 -- close the current sprint, carry active work, close the demo
  scope-in <story>      -- starting-dev-cycle: put the picked story on the sprint in play
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

# Is <iteration JSON> over -- past its last day, or on it at/after
# BC_DEMO_HOUR. `over` answers with it and `scope-in` steers by it.
_bc_sprint_is_over() { # <iteration-json>
  local end today
  end="$(printf '%s' "$1" | "$JQ" -r '.end')"
  today="$(bc_zurich_date)"
  [[ "$today" > "$end" ]] && return 0
  [ "$today" = "$end" ] && [ "$(bc_zurich_hour)" -ge "$BC_DEMO_HOUR" ]
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
  if _bc_sprint_is_over "$cur"; then
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
  # is the read Scotty demoes from -- so it carries all three alongside the
  # epic link, and nothing else. `parent` is the epic; `isEpic` tells him
  # which rows ARE epics (one rides along when `close` carries its story).
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
  # still shows what the story belongs to. Nothing else does -- a story still
  # in Backlog on the sprint is one a crashed starting-dev-cycle scoped in and
  # never started (or one put there by hand), and it goes back to the pool for
  # `bc-issue.sh next` to weigh against everything else, keeping the Status it
  # has. Status is never written here: close moves Sprint fields.
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

scope-in)
  n="${1:-}"
  [ -n "$n" ] || { usage; exit 2; }
  case "$n" in
    *[!0-9]*) echo "bc-sprint scope-in: not an issue number: $n" >&2; exit 2 ;;
  esac

  # The sprint in play is the one containing today -- unless that one is
  # already over. Nothing is picked between the demo hour and the demo's close
  # (the orchestrator is in the Sprint Demo branch for all of it), so a pick
  # made on an over sprint is one made after `close` ran: that week has been
  # demoed and summed up, and the story belongs to the next.
  cur="$(project_iteration_for_date)"
  target="$cur"
  if [ -z "$cur" ] || _bc_sprint_is_over "$cur"; then
    target="$(_bc_sprint_next_after "$cur")"
  fi
  if [ -z "$target" ]; then
    echo "bc-sprint scope-in: no sprint iteration to put #$n on -- add iterations to the board" >&2
    exit 2
  fi

  project_set_iteration "$n" "$(printf '%s' "$target" | "$JQ" -r '.id')"     || { echo "bc-sprint scope-in: could not put #$n on a sprint" >&2; exit 2; }
  printf '{"scoped":%s,"sprint":"%s"}
' "$n" "$(printf '%s' "$target" | "$JQ" -r '.title')"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
