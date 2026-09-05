#!/usr/bin/env bash
# LEVEL 2 -- the epic breakdown as issues: one GitHub issue per epic, one
# sub-issue per story, each carrying the story's role sentence and acceptance
# criteria, its lead scope as labels, and a Size and Priority on the board
# (Story 0.20, and Story 0.21's "each carries a size and a priority as board
# fields, set at creation" -- both now sub-issues of the Epic 0 issue this
# script created, epic-0.md having been the first file it replaced).
#
# This is a migration tool run by hand, like setup-github.sh -- orchestrator.sh
# never calls it. What it must be instead is idempotent and resumable: it is a
# bulk write of several hundred issues against a rate-limited API, and a run
# that dies halfway must be finishable by running it again. Every step is
# therefore guarded by what is already on GitHub, keyed on the two provenance
# markers `<!-- bc:epic <n> -->` and `<!-- bc:story <id> -->` that markers.sh
# renders. Nothing is keyed on a title, which a human may reword, and nothing
# is keyed on GitHub's search index, which lags a bulk write.
#
# Story 0.20 also forbids restating three things in a body: epic membership
# (it is the sub-issue link), lead scope (it is a label) and status (it is the
# board's field). The bodies this writes carry none of them.
#
# The one judgement here is size and priority, which the epic files do not
# record, so it goes the way every other judgement in these scripts goes: a
# `judge-*.md` one-shot as Scotty, once per run, for the stories that still
# lack one. A story Scotty does not answer for is reported UNPLACED, never
# guessed.
set -u
_BC_EPIC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_EPIC_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/epics.sh
. "$_BC_EPIC_DIR/lib/epics.sh"
# shellcheck source=lib/gh-cli.sh
. "$_BC_EPIC_DIR/lib/gh-cli.sh"
# shellcheck source=lib/project.sh
. "$_BC_EPIC_DIR/lib/project.sh"
# shellcheck source=lib/claude.sh
. "$_BC_EPIC_DIR/lib/claude.sh"
# shellcheck source=lib/markers.sh
. "$_BC_EPIC_DIR/lib/markers.sh"

usage() {
  cat >&2 <<'USAGEEOF'
usage: bc-epic.sh <command> <epic> [--only <ids-csv>]
  parse  <epic>   -- the epic file as JSON; reads the file only, never GitHub
  plan   <epic>   -- what import would create, skip and repair. Writes nothing.
  import <epic>   -- create/repair the epic issue, its sub-issues and their fields
  check  <epic>   -- round-trip the file against the board, both directions

  --only 0.3,0.4  -- restrict to these stories; the rest are reported as
                     `excluded` and are never counted as drift.
USAGEEOF
}


# --- argument parsing -------------------------------------------------------

cmd="${1:-}"
[ -n "$cmd" ] || { usage; exit 2; }
shift || true
EPIC="${1:-}"
[ -n "$EPIC" ] || { usage; exit 2; }
shift || true
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || { usage; exit 2; }; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

# --- the file side ----------------------------------------------------------

EPIC_FILE="$(epics_file "$EPIC")"
PARSED="$(epics_parse "$EPIC_FILE")" || exit 2
SEL="$(epics_select "$PARSED" "$ONLY")" || { echo "bc-epic: could not apply --only" >&2; exit 2; }

UNKNOWN="$(printf '%s' "$SEL" | "$JQ" -r '.unknown | join(",")' | tr -d '\r')"
if [ -n "$UNKNOWN" ]; then
  echo "bc-epic: --only names stories epic-$EPIC.md does not have: $UNKNOWN" >&2
  exit 2
fi

sel_field() { printf '%s' "$SEL" | "$JQ" -r "$1" | tr -d '\r'; }
sel_ids() { sel_field '.stories[].id'; }
story_field() { # <id> <jq-expression-against-the-story>
  printf '%s' "$SEL" | "$JQ" -r --arg i "$1" '.stories[] | select(.id==$i) | '"$2" | tr -d '\r'
}

# The lead labels a story carries. BC_ALWAYS_LEADS (quentin) gets none:
# bc-issue.sh's _bc_issue_scope puts him in scope on every issue whether or
# not a label says so, and setup-github.sh deliberately creates no
# `lead:quentin`. Labelling him would be a second, weaker statement of a fact
# the config already makes.
story_labels() { # <id> -> comma-joined label names, possibly empty
  local id="$1" role out=()
  for role in $(story_field "$id" '.leads[]'); do
    case " $BC_ALWAYS_LEADS " in *" $role "*) continue ;; esac
    out+=("${BC_LEAD_LABEL_PREFIX}${role}")
  done
  local IFS=','
  printf '%s' "${out[*]:-}"
}

# json_array <values...> -- the values as a JSON array of strings, first
# occurrence kept and later repeats dropped: a story that failed on its size
# and again on its priority is one unplaced story, not two. A single empty
# argument is the no-values case, which is how "${ARR[@]:-}" arrives under
# `set -u` when ARR is empty.
json_array() {
  if [ $# -eq 0 ] || { [ $# -eq 1 ] && [ -z "${1:-}" ]; }; then printf '[]'; return; fi
  printf '%s\n' "$@" | "$JQ" -R . \
    | "$JQ" -sc 'reduce .[] as $x ([]; if index($x) then . else . + [$x] end)'
}

# --- the GitHub side --------------------------------------------------------

BODIES=""
EPIC_ISSUE=""
LINKED=""   # newline-separated issue numbers that really are sub-issues
FOUND=""    # newline-separated "<story-id> <issue-number>" for every story issue
ITEMS="[]"

read_board() {
  BODIES="$(gh_issue_list_bodies)" || { echo "bc-epic: could not list issues" >&2; exit 2; }
  [ -n "$BODIES" ] || BODIES='[]'
  EPIC_ISSUE="$(printf '%s' "$BODIES" | "$JQ" -r --arg m "<!-- bc:epic $EPIC -->" \
    '[.[] | select((.body // "") | contains($m))] | .[0].number // empty' | tr -d '\r')"
  FOUND="$(printf '%s' "$BODIES" | "$JQ" -r '
    .[] | . as $i
    | (.body // "")
    | capture("<!-- bc:story (?<id>[0-9]+\\.[0-9]+) -->")
    | "\(.id) \($i.number)"' 2>/dev/null | tr -d '\r')"
  if [ -n "$EPIC_ISSUE" ]; then
    LINKED="$(gh_subissues "$EPIC_ISSUE" 2>/dev/null | "$JQ" -r '.[].number' 2>/dev/null | tr -d '\r')"
  else
    LINKED=""
  fi
  ITEMS="$(project_items)" || ITEMS='[]'
  [ -n "$ITEMS" ] || ITEMS='[]'
}

number_for() { # <story-id> -> the issue number that carries its marker, if any
  printf '%s\n' "$FOUND" | awk -v id="$1" '$1 == id { print $2; exit }'
}

is_linked() { # <issue-number>
  printf '%s\n' "$LINKED" | grep -Fxq -- "$1"
}

board_field() { # <issue-number> <status|priority|size> -> value or empty
  printf '%s' "$ITEMS" | "$JQ" -r --argjson n "$1" --arg k "$2" \
    'map(select(.number==$n)) | .[0][$k] // empty' 2>/dev/null | tr -d '\r'
}

# --- the size/priority judgement -------------------------------------------

SIZES="{}"

# ask_scotty <ids...> -- one claude_oneshot for every story that still has no
# size or priority, whatever the reason. Called once per run and never for an
# empty list, so a rerun with nothing left to size spends no quota at all.
ask_scotty() {
  [ $# -gt 0 ] || return 0
  local input id reply extracted
  input="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-epic-size.XXXXXX")"
  # The input has to READ as a request, not as reference material. `claude -p`
  # takes stdin as the user turn, and a turn that opens with a heading and
  # then runs to twenty thousand words of acceptance criteria was answered,
  # once, with "I don't see an actual request in this conversation" -- the
  # system prompt said what to do and nothing in the turn asked for it. So the
  # ask comes first and is repeated last, with the epic in between.
  {
    printf 'Size and prioritise the %s stories below.\n\n' "$#"
    printf '# Epic %s: %s\n\n%s\n' "$EPIC" "$(sel_field '.title')" "$(sel_field '.preamble')"
    for id in "$@"; do
      printf '\n---\n\n## Story %s: %s\n\nLeads: %s\n\n%s\n' \
        "$id" "$(story_field "$id" '.title')" \
        "$(story_field "$id" '.leads | join(", ")')" \
        "$(story_field "$id" '.body')"
    done
    printf '\n---\n\nReply now with ONLY the JSON object, keyed by story id, one entry\n'
    printf 'per story above -- no prose, no fences.\n'
  } > "$input"

  reply="$(claude_oneshot "$_BC_EPIC_DIR/prompts/judge-story-size.md" "$input")"
  rm -f "$input"

  # The prompt asks for a bare JSON object and nothing else, so the reply is
  # parsed as JSON rather than fished out of prose with a regex: sizes are
  # nested objects, and no regex that tolerates surrounding text can find the
  # right pair of braces around them. A markdown fence is the one deviation
  # worth forgiving -- it costs one grep and is the habitual one.
  extracted="$(printf '%s' "$reply" | tr -d '\r' | grep -v '^[[:space:]]*```')"
  if [ -z "$(printf '%s' "$extracted" | tr -d '[:space:]')" ] \
     || ! printf '%s' "$extracted" | "$JQ" -e 'type=="object"' >/dev/null 2>&1; then
    echo "bc-epic: judge-story-size.md did not return a JSON object (got: $reply)" >&2
    return 0
  fi
  # Keep only well-formed entries -- a size and a priority the board actually
  # offers. Anything else is dropped here rather than rejected by GitHub three
  # calls later, and the story it belonged to comes out unplaced.
  SIZES="$(printf '%s' "$extracted" | "$JQ" -c '
    with_entries(. as $e | select(
      ($e.value | type == "object")
      and ((["XS","S","M","L","XL"] | index($e.value.size // "")) != null)
      and ((["Blocker","Critical","Standard","Low"] | index($e.value.priority // "")) != null)))')"
}

judged() { # <id> <size|priority> -> value or empty
  printf '%s' "$SIZES" | "$JQ" -r --arg i "$1" --arg k "$2" '.[$i][$k] // empty' | tr -d '\r'
}

# --- commands ---------------------------------------------------------------

CREATED=() ; SKIPPED=() ; REPAIRED=() ; UNPLACED=()

case "$cmd" in

parse)
  printf '%s' "$SEL" | "$JQ" .
  exit 0
  ;;

plan)
  read_board
  n_create=0 ; n_skip=0 ; n_repair=0
  if [ -n "$EPIC_ISSUE" ]; then
    printf 'epic %s: #%s exists\n' "$EPIC" "$EPIC_ISSUE" >&2
  else
    printf 'epic %s: would create "Epic %s: %s"\n' "$EPIC" "$EPIC" "$(sel_field '.title')" >&2
  fi
  for id in $(sel_ids); do
    num="$(number_for "$id")"
    if [ -z "$num" ]; then
      printf '  %-5s would CREATE  "Story %s: %s"  labels=%s\n' \
        "$id" "$id" "$(story_field "$id" '.title')" "$(story_labels "$id")" >&2
      n_create=$((n_create + 1))
      continue
    fi
    fixes=""
    is_linked "$num" || fixes="$fixes link"
    [ -n "$(board_field "$num" status)" ] || fixes="$fixes status"
    [ -n "$(board_field "$num" size)" ] || fixes="$fixes size"
    [ -n "$(board_field "$num" priority)" ] || fixes="$fixes priority"
    if [ -n "$fixes" ]; then
      printf '  %-5s #%s would REPAIR:%s\n' "$id" "$num" "$fixes" >&2
      n_repair=$((n_repair + 1))
    else
      printf '  %-5s #%s in place\n' "$id" "$num" >&2
      n_skip=$((n_skip + 1))
    fi
  done
  printf 'would create %s, repair %s, leave %s alone; excluded %s\n' \
    "$n_create" "$n_repair" "$n_skip" \
    "$(printf '%s' "$SEL" | "$JQ" -r '.excluded | length')" >&2
  [ "$n_create" -gt 0 ] || [ "$n_repair" -gt 0 ] || exit 1
  exit 0
  ;;

import)
  read_board

  # The epic issue first: everything else is a sub-issue of it.
  if [ -z "$EPIC_ISSUE" ]; then
    ebody="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-epic-body.XXXXXX")"
    render_epic_body "$EPIC" "$(sel_field '.preamble')" > "$ebody"
    EPIC_ISSUE="$(gh_issue_create "Epic $EPIC: $(sel_field '.title')" "$ebody" "$BC_LABEL_EPIC")"
    rc=$?
    rm -f "$ebody"
    [ "$rc" -eq 0 ] || { echo "bc-epic import: could not create the epic issue" >&2; exit 2; }
    EPIC_ISSUE="$(printf '%s' "$EPIC_ISSUE" | tr -d '\r\n')"
    # Board membership only. Status and Sprint stay unset on purpose:
    # bc-sprint.sh start scopes parents with sprintId==null and sets Backlog
    # itself, so setting either here would hide the epic from the next sprint.
    [ -n "$EPIC_ISSUE" ] && project_item "$EPIC_ISSUE" >/dev/null
    echo "bc-epic import: created epic issue #${EPIC_ISSUE:-?}" >&2
  else
    echo "bc-epic import: epic issue #$EPIC_ISSUE already exists" >&2
  fi

  # One judgement call, covering every selected story that has no Size or
  # Priority yet -- whether because it does not exist or because a previous
  # run died before setting one.
  need_size=()
  for id in $(sel_ids); do
    num="$(number_for "$id")"
    if [ -z "$num" ] || [ -z "$(board_field "$num" size)" ] || [ -z "$(board_field "$num" priority)" ]; then
      need_size+=("$id")
    fi
  done
  [ "${#need_size[@]}" -gt 0 ] && ask_scotty "${need_size[@]}"

  for id in $(sel_ids); do
    num="$(number_for "$id")"
    fixed=0

    if [ -z "$num" ]; then
      sbody="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-epic-story.XXXXXX")"
      render_story_body "$id" "$(story_field "$id" '.body')" > "$sbody"
      num="$(gh_issue_create "Story $id: $(story_field "$id" '.title')" "$sbody" "$(story_labels "$id")")"
      rc=$?
      rm -f "$sbody"
      num="$(printf '%s' "$num" | tr -d '\r\n')"
      if [ "$rc" -ne 0 ]; then
        echo "  $id UNPLACED: gh_issue_create failed" >&2
        UNPLACED+=("$id")
        continue
      fi
      CREATED+=("$id")
      echo "  $id created #${num:-?}" >&2
    else
      SKIPPED+=("$id")
    fi

    # No number, nothing left to place. Under BC_FAKE with no gh_issue_create
    # fixture this is the normal case, and the calls already logged are what
    # the test asserts on.
    [ -n "$num" ] || continue

    if ! is_linked "$num"; then
      dbid="$(gh_issue_id "$num" | tr -d '\r\n')"
      if [ -z "$dbid" ] || ! gh_issue_add_subissue "$EPIC_ISSUE" "$dbid"; then
        echo "  $id UNPLACED: could not link #$num under #$EPIC_ISSUE" >&2
        UNPLACED+=("$id")
        continue
      fi
      fixed=1
    fi

    project_item "$num" >/dev/null

    if [ -z "$(board_field "$num" status)" ]; then
      project_set_single "$num" Status Backlog
      fixed=1
    fi

    if [ -z "$(board_field "$num" size)" ]; then
      s="$(judged "$id" size)"
      if [ -n "$s" ] && project_set_single "$num" Size "$s"; then
        fixed=1
      else
        echo "  $id UNPLACED: no size for #$num" >&2
        UNPLACED+=("$id")
      fi
    fi

    if [ -z "$(board_field "$num" priority)" ]; then
      p="$(judged "$id" priority)"
      if [ -n "$p" ] && project_set_single "$num" Priority "$p"; then
        fixed=1
      else
        echo "  $id UNPLACED: no priority for #$num" >&2
        UNPLACED+=("$id")
      fi
    fi

    # Lead scope is a label and nothing else, so a story whose Leads line
    # changed gets the new label on a rerun rather than a reworded body.
    want="$(story_labels "$id")"
    if [ -n "$want" ]; then
      have="$(gh_issue_labels "$num" 2>/dev/null)"
      [ -n "$have" ] || have='[]'
      missing=""
      old_ifs="$IFS"; IFS=','
      for l in $want; do
        printf '%s' "$have" | "$JQ" -e --arg n "$l" 'index($n) != null' >/dev/null 2>&1 \
          || missing="${missing:+$missing,}$l"
      done
      IFS="$old_ifs"
      if [ -n "$missing" ]; then
        gh_issue_add_labels "$num" "$missing" && fixed=1
      fi
    fi

    if [ "$fixed" -eq 1 ]; then
      case " ${CREATED[*]:-} " in
        *" $id "*) : ;;
        *) REPAIRED+=("$id") ;;
      esac
    fi
  done

  printf '{"epic":%s,"issue":%s,"created":%s,"skipped":%s,"repaired":%s,"unplaced":%s,"excluded":%s}\n' \
    "$EPIC" "${EPIC_ISSUE:-null}" \
    "$(json_array "${CREATED[@]:-}")" \
    "$(json_array "${SKIPPED[@]:-}")" \
    "$(json_array "${REPAIRED[@]:-}")" \
    "$(json_array "${UNPLACED[@]:-}")" \
    "$(printf '%s' "$SEL" | "$JQ" -c '.excluded')"

  [ "${#UNPLACED[@]}" -eq 0 ] || exit 2
  [ "${#CREATED[@]}" -gt 0 ] || [ "${#REPAIRED[@]}" -gt 0 ] || exit 1
  exit 0
  ;;

check)
  read_board
  if [ -z "$EPIC_ISSUE" ]; then
    echo "bc-epic check: no issue carries <!-- bc:epic $EPIC -->" >&2
    printf 'epic %s: absent\n' "$EPIC"
    printf 'only-in-file: %s\n' "$(sel_ids | tr '\n' ' ' | sed 's/ *$//')"
    printf 'only-on-board: \n'
    exit 1
  fi

  # The board side is the epic issue's ACTUAL sub-issues, not every issue
  # carrying a story marker: a story issue that exists but was never linked is
  # exactly the half-finished state this check has to name.
  onboard="$(for n in $LINKED; do
    printf '%s\n' "$FOUND" | awk -v n="$n" '$2 == n { print $1 }'
  done | grep -v '^$' | sort -u)"
  infile="$(sel_ids | grep -v '^$' | sort -u)"
  excluded="$(printf '%s' "$SEL" | "$JQ" -r '.excluded[]' | tr -d '\r' | grep -v '^$' | sort -u)"

  only_file="$(comm -23 <(printf '%s\n' "$infile" | grep -v '^$') \
                        <(printf '%s\n' "$onboard" | grep -v '^$') | tr '\n' ' ' | sed 's/ *$//')"
  raw_board="$(comm -13 <(printf '%s\n' "$infile" | grep -v '^$') \
                        <(printf '%s\n' "$onboard" | grep -v '^$'))"
  # An excluded story that is on the board is not drift: it was deliberately
  # left out of THIS import, not lost by it.
  only_board=""
  for i in $raw_board; do
    printf '%s\n' "$excluded" | grep -Fxq -- "$i" && continue
    only_board="${only_board:+$only_board }$i"
  done

  printf 'epic %s: #%s\n' "$EPIC" "$EPIC_ISSUE"
  printf 'only-in-file: %s\n' "$only_file"
  printf 'only-on-board: %s\n' "$only_board"
  printf 'excluded: %s\n' "$(printf '%s\n' "$excluded" | grep -v '^$' | tr '\n' ' ' | sed 's/ *$//')"
  [ -z "$only_file" ] && [ -z "$only_board" ] || exit 1
  exit 0
  ;;

*)
  usage
  exit 2
  ;;
esac
