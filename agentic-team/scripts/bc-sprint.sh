#!/usr/bin/env bash
# LEVEL 2 -- sprint-level facts and the two sprint-boundary actions
# (closing-sprint/starting-next-sprint in high-level-agentic-flow.mmd).
# Composes project.sh's iteration primitives and gh-cli.sh's sub-issue
# primitive; the one piece of judgement it delegates is
# "what fits next sprint", via Scotty (claude_oneshot + judge-sprint-scope.md).
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
  close                 -- close the current sprint, carry active work, close the demo
  start                 -- scope candidates into the next sprint via Scotty
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

  active_carry="$(printf '%s' "$sprint_items" | "$JQ" -c '
    def isActive: . == "To analyze" or . == "In progress" or . == "Leads review" or . == "Reviewed";
    [.[] | select(.status | isActive)] as $active
    | ([$active[].number] + [$active[] | select(.parent != null) | .parent]) | unique
  ')"

  carry_final="$(printf '%s' "$sprint_items" | "$JQ" -c --argjson carry0 "$active_carry" '
    reduce .[] as $it ($carry0;
      if ($it.status != "Done")
         and ($it.parent != null)
         and (($carry0 | index($it.parent)) != null)
         and ((. | index($it.number)) == null)
      then . + [$it.number]
      else . end)
    | unique
  ')"

  # NB: "$carry | index(.number)" would be wrong here -- piping into $carry
  # rebinds `.` to $carry itself before .number is evaluated, so bind the
  # item's number to a variable first and test membership against that.
  clear_final="$(printf '%s' "$sprint_items" | "$JQ" -c --argjson carry "$carry_final" '
    [.[] | select(.status != "Done") | .number as $n
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
  nxtid="$(printf '%s' "$nxt" | "$JQ" -r '.id')"
  nxttitle="$(printf '%s' "$nxt" | "$JQ" -r '.title')"
  nxtstart="$(printf '%s' "$nxt" | "$JQ" -r '.startDate')"
  nxtend="$(printf '%s' "$nxt" | "$JQ" -r '.end')"
  nxtdays="$(printf '%s' "$nxt" | "$JQ" -r '.duration')"

  items="$(project_items)" || { echo "bc-sprint start: could not read project items" >&2; exit 2; }

  candidates="$(printf '%s' "$items" | "$JQ" -c '
    [.[] | select(.state=="OPEN" and .sprintId==null
        and (.isParent==true or (.parent==null and ((.labels|index("demo"))|not))))]
  ')"
  ccount="$(printf '%s' "$candidates" | "$JQ" 'length')"
  if [ "$ccount" -eq 0 ]; then
    printf '{"scoped":[]}\n'
    exit 1
  fi

  delivered=0
  if [ -n "$cur" ]; then
    curid="$(printf '%s' "$cur" | "$JQ" -r '.id')"
    delivered="$(printf '%s' "$items" | "$JQ" --arg cur "$curid" \
      '[.[] | select(.sprintId==$cur and .status=="Done")] | length')"
  fi

  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-sprint-start.XXXXXX")"
  {
    printf '%s' "$candidates" | "$JQ" -r \
      '.[] | "- #\(.number) \(.title) — priority: \(.priority // "unset"), size: \(.size // "unset")"' | tr -d '\r'
    printf 'Last sprint delivered: %s\n' "$delivered"
    printf 'Next sprint: %s %s→%s (%s days)\n' "$nxttitle" "$nxtstart" "$nxtend" "$nxtdays"
  } > "$input"

  reply="$(claude_oneshot "$_BC_SPRINT_DIR/prompts/judge-sprint-scope.md" "$input")"
  rm -f "$input"

  extracted="$(printf '%s' "$reply" | tr '\n' ' ' | sed -n 's/.*\(\[[^][]*\]\).*/\1/p' | head -1)"
  if [ -z "$extracted" ] || ! printf '%s' "$extracted" \
      | "$JQ" -e '(type=="array") and (map(type=="number") | all)' >/dev/null 2>&1; then
    echo "bc-sprint start: judge-sprint-scope.md did not return a valid JSON array of issue numbers (got: $reply)" >&2
    exit 2
  fi
  chosen="$extracted"
  chosen_count="$(printf '%s' "$chosen" | "$JQ" 'length')"
  if [ "$chosen_count" -eq 0 ]; then
    echo "bc-sprint start: judge-sprint-scope.md chose no stories" >&2
    exit 2
  fi

  # Same "." rebinding trap as clear_final above -- bind the candidate number
  # to $n before testing it against $cand.
  scoped="$(printf '%s\n%s\n' "$candidates" "$chosen" | "$JQ" -sc '
    (.[0] | map(.number)) as $cand
    | [ .[1][] as $n | select($cand | any(. == $n)) | $n ] | unique
  ')"
  scoped_count="$(printf '%s' "$scoped" | "$JQ" 'length')"
  if [ "$scoped_count" -eq 0 ]; then
    printf '{"scoped":[]}\n'
    exit 1
  fi

  for n in $(printf '%s' "$scoped" | "$JQ" -r '.[]' | tr -d '\r' | sort -n); do
    project_set_iteration "$n" "$nxtid"
    st="$(project_field_get "$n" Status 2>/dev/null || true)"
    [ -n "$st" ] || project_set_single "$n" Status Backlog

    subs="$(gh_subissues "$n")" || subs="[]"
    for s in $(printf '%s' "$subs" | "$JQ" -r '.[].number' 2>/dev/null | tr -d '\r'); do
      project_set_iteration "$s" "$nxtid"
      sst="$(project_field_get "$s" Status 2>/dev/null || true)"
      [ -n "$sst" ] || project_set_single "$s" Status Backlog
    done
  done

  printf '{"scoped":%s,"sprint":"%s"}\n' "$(printf '%s' "$scoped" | "$JQ" -c 'sort')" "$nxttitle"
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
