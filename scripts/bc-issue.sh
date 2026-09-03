#!/usr/bin/env bash
# LEVEL 2 -- issue-level facts and actions: which sub-issue is active and in
# what status, every Status transition, and the Sprint Demo issue
# (high-level-agentic-flow.mmd's subissue-active/subissue-status,
# demo-active/demo-has-feedback and creating-demo-issue, plus every node that
# moves a Status). Composes project.sh/gh-cli.sh primitives; the one piece of
# judgement it delegates is the Sprint Demo body, via Scotty (claude_oneshot +
# judge-demo-summary.md).
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
  next                        -- highest-priority Backlog sub-issue to start
  current                     -- the single sub-issue in an active status
  transition <issue> <status> -- set Status (and close on Done)
  scope <issue>                -- comma-joined leads in scope, quentin always
  create-demo <n>              -- create the Sprint n Demo issue
  demo-current                 -- the open Sprint Demo issue, if any
  demo-commented <issue>        -- has a human commented on it
  demo-for <n>                  -- does a Sprint n Demo issue exist
EOF
}

_BC_STATUSES="Backlog|To analyze|In progress|Leads review|Reviewed|Done"

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
  cur="$(project_iteration_for_date)"
  [ -n "$cur" ] || exit 1
  curid="$(printf '%s' "$cur" | "$JQ" -r '.id')"

  items="$(project_items)" || { echo "bc-issue next: could not read project items" >&2; exit 2; }

  pick="$(printf '%s' "$items" | "$JQ" -c --arg cur "$curid" '
    def prank: if . == "Blocker" then 0 elif . == "Critical" then 1
                elif . == "Standard" then 2 elif . == "Low" then 3 else 4 end;
    . as $all
    | ($all | map(select(.isParent==true and .sprintId==$cur and .status!="Done"))
             | sort_by([(.priority|prank), .number])) as $parents
    | [ $parents[] as $p
        | ($all | map(select(.parent==$p.number and (.status=="Backlog" or .status==null)))
                 | sort_by([(.priority|prank), .number])) as $subs
        | select($subs | length > 0)
        | {number: $subs[0].number, parent: $p.number}
      ] | .[0] // empty
  ')"
  [ -n "$pick" ] || exit 1

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
  fi
  exit 0
  ;;

scope)
  issue="${1:-}"
  [ -n "$issue" ] || { usage; exit 2; }
  out="$(_bc_issue_scope "$issue")" || { echo "bc-issue scope: could not read labels for #$issue" >&2; exit 2; }
  printf '%s\n' "$out"
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

  summary="$(claude_oneshot "$_BC_ISSUE_DIR/prompts/judge-demo-summary.md" "$input")"
  rm -f "$input"
  summary="$(printf '%s' "$summary" | sed -e 's/[[:space:]]*$//')"
  if [ -z "$summary" ]; then
    echo "bc-issue create-demo: judge-demo-summary.md returned nothing" >&2
    exit 2
  fi

  bodyfile="$(mktemp "${TMPDIR:-${TEMP:-/tmp}}/bc-issue-demo-body.XXXXXX")"
  render_demo_body "$n" "$summary" > "$bodyfile"
  new="$(gh_issue_create "Sprint $n Demo" "$bodyfile" "$BC_LABEL_DEMO")"
  rc=$?
  rm -f "$bodyfile"
  # Check the function's exit code, not whether stdout was empty: under
  # BC_FAKE, gh_issue_create's write-fixture has no return-value support (it
  # only logs and returns 0), so $new is legitimately empty in every fake
  # test even on the success path -- only a nonzero exit means gh actually
  # failed to create the issue.
  if [ "$rc" -ne 0 ]; then
    echo "bc-issue create-demo: gh_issue_create failed" >&2
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

*)
  usage
  exit 2
  ;;
esac
