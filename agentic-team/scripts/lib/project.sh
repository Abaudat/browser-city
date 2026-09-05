#!/usr/bin/env bash
# GitHub Project v2 primitives (GraphQL) for $BC_PROJECT_OWNER's project
# $BC_PROJECT_NUMBER. Wraps `gh api graphql` and `gh project item-*`. The
# one rule: field and option ids are resolved BY NAME at runtime through
# _project_fields (cached once per process, deleted on exit), never
# hardcoded -- and every function here is fake-aware via fake.sh.

_BC_PROJECT_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_PROJECT_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_PROJECT_LIB_DIR/fake.sh"

_BC_PROJECT_CACHE_FILE="${TMPDIR:-$(winpath "${TEMP:-/tmp}")}/bc-project-fields.$$.json"
trap 'rm -f "$_BC_PROJECT_CACHE_FILE"' EXIT

# Resolves (and caches for the life of this process) the project's node id
# plus the Status/Priority/Size option ids and the Sprint field id, all by name.
# {id, statusF:{id,options:[{id,name}]}, priorityF:{...}, sizeF:{...}, sprintF:{id}}
_project_fields() {
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read project_fields; return; }
  if [ ! -s "$_BC_PROJECT_CACHE_FILE" ]; then
    "$GH" api graphql -f query='
      query($owner:String!,$number:Int!) {
        user(login:$owner) {
          projectV2(number:$number) {
            id
            statusF: field(name:"Status")     { ... on ProjectV2SingleSelectField { id options { id name } } }
            priorityF: field(name:"Priority") { ... on ProjectV2SingleSelectField { id options { id name } } }
            sizeF: field(name:"Size")         { ... on ProjectV2SingleSelectField { id options { id name } } }
            sprintF: field(name:"Sprint")     { ... on ProjectV2IterationField { id } }
          }
        }
      }' -F owner="$BC_PROJECT_OWNER" -F number="$BC_PROJECT_NUMBER" \
      --jq '.data.user.projectV2' > "$_BC_PROJECT_CACHE_FILE" 2>/dev/null \
      || { rm -f "$_BC_PROJECT_CACHE_FILE"; return 1; }
  fi
  cat "$_BC_PROJECT_CACHE_FILE"
}

project_item() { # <issue-number> -> project item id (adds the issue if missing)
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read project_item "$1"; return; }
  "$GH" project item-add "$BC_PROJECT_NUMBER" --owner "$BC_PROJECT_OWNER" \
    --url "https://github.com/$BC_REPO/issues/$1" --format json --jq '.id' 2>/dev/null
}

project_field_get() { # <issue-number> <Status|Priority|Size|Sprint> -> value name
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read project_field_get "$1" "$2"; return; }
  local key val
  case "$2" in
    Status)   key=status ;;
    Priority) key=priority ;;
    Size)     key=size ;;
    Sprint)   key=sprintTitle ;;
    *) return 2 ;;
  esac
  val="$(project_items | "$JQ" -r --argjson n "$1" --arg k "$key" \
    'map(select(.number==$n)) | .[0][$k] // empty')" || return 1
  [ -n "$val" ] || return 1
  printf '%s' "$val"
}

project_set_single() { # <issue-number> <Status|Priority|Size> <option-name>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write project_set_single "$@"; return; }
  local issue="$1" field="$2" option="$3" cache proj fieldid optid item
  cache="$(_project_fields)" || return 1
  proj="$(printf '%s' "$cache" | "$JQ" -r '.id')"
  case "$field" in
    Status)   fieldid="$(printf '%s' "$cache" | "$JQ" -r '.statusF.id')"
              optid="$(printf '%s' "$cache" | "$JQ" -r --arg n "$option" '.statusF.options[] | select(.name==$n) | .id')" ;;
    Priority) fieldid="$(printf '%s' "$cache" | "$JQ" -r '.priorityF.id')"
              optid="$(printf '%s' "$cache" | "$JQ" -r --arg n "$option" '.priorityF.options[] | select(.name==$n) | .id')" ;;
    Size)     fieldid="$(printf '%s' "$cache" | "$JQ" -r '.sizeF.id')"
              optid="$(printf '%s' "$cache" | "$JQ" -r --arg n "$option" '.sizeF.options[] | select(.name==$n) | .id')" ;;
    *) return 2 ;;
  esac
  [ -n "$fieldid" ] && [ "$fieldid" != "null" ] && [ -n "$optid" ] || return 1
  item="$(project_item "$issue")" || return 1
  "$GH" project item-edit --id "$item" --field-id "$fieldid" --project-id "$proj" \
    --single-select-option-id "$optid" >/dev/null 2>&1
}

project_set_iteration() { # <issue-number> <iteration-id|clear>
  [ -n "${BC_FAKE:-}" ] && { bc_fake_write project_set_iteration "$@"; return; }
  local issue="$1" iter="$2" cache proj fieldid item
  cache="$(_project_fields)" || return 1
  proj="$(printf '%s' "$cache" | "$JQ" -r '.id')"
  fieldid="$(printf '%s' "$cache" | "$JQ" -r '.sprintF.id')"
  [ -n "$fieldid" ] && [ "$fieldid" != "null" ] || return 1
  item="$(project_item "$issue")" || return 1
  if [ "$iter" = "clear" ]; then
    "$GH" project item-edit --id "$item" --field-id "$fieldid" --project-id "$proj" --clear >/dev/null 2>&1
  else
    "$GH" project item-edit --id "$item" --field-id "$fieldid" --project-id "$proj" --iteration-id "$iter" >/dev/null 2>&1
  fi
}

project_items() { # -> JSON array of {number,title,state,status,priority,size,sprintId,sprintTitle,labels,isParent,parent}
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read project_items; return; }
  local raw
  raw="$("$GH" api graphql --paginate --slurp -f query='
    query($owner:String!,$number:Int!,$endCursor:String) {
      user(login:$owner) {
        projectV2(number:$number) {
          items(first: 100, after: $endCursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              content {
                ... on Issue {
                  number title state
                  labels(first: 20) { nodes { name } }
                  parent { number }
                  subIssues(first: 1) { totalCount }
                }
              }
              status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
              priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
              size: fieldValueByName(name: "Size") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
              sprint: fieldValueByName(name: "Sprint") { ... on ProjectV2ItemFieldIterationValue { iterationId title } }
            }
          }
        }
      }
    }' -F owner="$BC_PROJECT_OWNER" -F number="$BC_PROJECT_NUMBER" 2>/dev/null)" || return 1
  printf '%s' "$raw" | "$JQ" -c '
    [.[].data.user.projectV2.items.nodes[]]
    | map(select(.content != null))
    | map({
        number: .content.number,
        title: .content.title,
        state: .content.state,
        status: (.status.name // null),
        priority: (.priority.name // null),
        size: (.size.name // null),
        sprintId: (.sprint.iterationId // null),
        sprintTitle: (.sprint.title // null),
        labels: [.content.labels.nodes[].name],
        isParent: (.content.subIssues.totalCount > 0),
        parent: (.content.parent.number // null)
      })'
}

# The end-date arithmetic (end = start + duration - 1 days) runs identically
# whether the {id,title,startDate,duration} list came from a real query or a
# BC_FAKE fixture, so a fixture can drive the same jq math a real call would.
_project_iter_end() { # <raw JSON array of {id,title,startDate,duration}> on stdin -> +end
  "$JQ" -c 'map(. + {end: ((.startDate | strptime("%Y-%m-%d") | mktime)
                           + ((.duration - 1) * 86400)
                           | strftime("%Y-%m-%d"))})'
}

project_iterations() { # -> JSON array of {id,title,startDate,duration,end}, current + completed
  local raw
  if [ -n "${BC_FAKE:-}" ]; then
    raw="$(bc_fake_read project_iterations)" || return 1
  else
    raw="$("$GH" api graphql -f query='
      query($owner:String!,$number:Int!) {
        user(login:$owner) {
          projectV2(number:$number) {
            field(name:"Sprint") {
              ... on ProjectV2IterationField {
                configuration {
                  iterations { id title startDate duration }
                  completedIterations { id title startDate duration }
                }
              }
            }
          }
        }
      }' -F owner="$BC_PROJECT_OWNER" -F number="$BC_PROJECT_NUMBER" \
      --jq '(.data.user.projectV2.field.configuration.iterations
             + .data.user.projectV2.field.configuration.completedIterations)' \
      2>/dev/null)" || return 1
  fi
  printf '%s' "$raw" | _project_iter_end
}

# --- appended by the bc-sprint.sh/bc-issue.sh work (level-2 date-matching
# facts both scripts need; pure jq over project_iterations, no new gh call) --

project_iteration_for_date() { # [date YYYY-MM-DD, default today in BC_TZ] -> {id,title,startDate,duration,end} or empty
  local d="${1:-$(bc_zurich_date)}"
  project_iterations | "$JQ" -c --arg d "$d" \
    'map(select(.startDate <= $d and $d <= .end)) | .[0] // empty'
}

project_iteration_after() { # <date YYYY-MM-DD> -> earliest iteration starting strictly after it, or empty
  local d="$1"
  project_iterations | "$JQ" -c --arg d "$d" \
    'map(select(.startDate > $d)) | sort_by(.startDate) | .[0] // empty'
}
