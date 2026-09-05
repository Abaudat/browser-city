#!/usr/bin/env bash
# The epic-markdown grammar: turn `_bmad-output/planning-artifacts/epics/epic-N.md`
# into JSON. Wraps no external tool but `jq` -- no gh/orca/claude calls, no
# network, so every function here is safe to call with or without BC_FAKE set,
# exactly like markers.sh. The one rule: the markdown grammar is spelled out
# ONCE, in the awk program below; nothing above this file ever matches
# "### Story " itself.
#
# The grammar, stable across all fifteen epic files:
#   ## Epic <n>: <title>          one per file; everything up to the first
#                                 story heading is the epic's preamble
#   ### Story <n>.<m>: <title>    opens a story, runs to the next `### ` or EOF
#   **Leads:** quentin, tim       the story's first line; consumed, never kept
#                                 in the body (lead scope becomes labels, and
#                                 Story 0.20 forbids restating it in the body)
# Everything else -- the As/I want/So that triple and the acceptance criteria
# -- is the body, carried through verbatim.

_BC_EPICS_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_EPICS_LIB_DIR/config.sh"

: "${BC_EPICS_DIR:=$_BC_EPICS_LIB_DIR/../../_bmad-output/planning-artifacts/epics}"

epics_file() { # <epic-number> -> path to that epic's markdown file
  printf '%s/epic-%s.md' "$BC_EPICS_DIR" "$1"
}

# The awk half: records separated by \036, each of four fields --
# id ("EPIC" for the epic record), title, leads-csv (the epic number, for the
# epic record), then the body over the remaining lines. Keeping the escaping
# out of awk entirely is deliberate: jq -Rs below does all of it.
_BC_EPICS_AWK='
function trim(s) {
  sub(/[ \t\r\n]+$/, "", s)
  sub(/\n---$/, "", s)
  sub(/^---$/, "", s)
  sub(/[ \t\r\n]+$/, "", s)
  sub(/^[ \t\r\n]+/, "", s)
  return s
}
function flush(   b) {
  if (mode == "") return
  b = trim(buf)
  if (mode == "epic") printf "%s%s\n%s\n%s\n%s", (first ? "" : SEP), "EPIC", epictitle, epicnum, b
  else                printf "%s%s\n%s\n%s\n%s", (first ? "" : SEP), id, title, leads, b
  first = 0
  buf = ""
}
BEGIN { SEP = "\036"; first = 1; mode = "" }
{ sub(/\r$/, "") }
/^## Epic [0-9]+:/ {
  flush()
  line = $0; sub(/^## Epic /, "", line)
  epicnum = line; sub(/:.*$/, "", epicnum)
  epictitle = line; sub(/^[0-9]+:[ \t]*/, "", epictitle)
  mode = "epic"; buf = ""
  next
}
/^### Story [0-9]+\.[0-9]+:/ {
  flush()
  line = $0; sub(/^### Story /, "", line)
  id = line; sub(/:.*$/, "", id)
  title = line; sub(/^[0-9]+\.[0-9]+:[ \t]*/, "", title)
  mode = "story"; buf = ""; leads = ""; gotleads = 0
  next
}
/^### / { flush(); mode = ""; next }
mode == "story" && gotleads == 0 && /^\*\*Leads:\*\*/ {
  leads = $0
  sub(/^\*\*Leads:\*\*[ \t]*/, "", leads)
  gsub(/[ \t]*,[ \t]*/, ",", leads)
  sub(/[ \t]+$/, "", leads)
  gotleads = 1
  next
}
mode != "" { buf = buf $0 "\n" }
END { flush() }
'

# epics_parse <file> -- the whole epic as one JSON object:
#   {epic, title, preamble, stories:[{id, title, leads:[...], body}]}
# Exit 2 if the file has no `## Epic <n>:` heading, which is the only way a
# file can be unparseable -- a file with no stories is empty, not broken.
epics_parse() {
  local file="$1" out
  [ -f "$file" ] || { echo "epics_parse: no such file: $file" >&2; return 2; }
  out="$(awk "$_BC_EPICS_AWK" "$file" | "$JQ" -Rs '
    split("\u001e")
    | map(select(length > 0))
    | map(split("\n") | {k: .[0], t: .[1], l: .[2], body: (.[3:] | join("\n"))})
    | (map(select(.k == "EPIC")) | .[0]) as $e
    | if $e == null then null else
      { epic: ($e.l | tonumber),
        title: $e.t,
        preamble: $e.body,
        stories: [ .[] | select(.k != "EPIC")
                   | {id: .k, title: .t,
                      leads: (if .l == "" then [] else (.l | split(",")) end),
                      body: .body} ] }
      end
  ')" || return 2
  [ -n "$out" ] && [ "$out" != "null" ] || {
    echo "epics_parse: no '## Epic <n>:' heading in $file" >&2; return 2
  }
  printf '%s' "$out"
}

# epics_story_ids <parsed-json> -- one id per line, file order. The check's
# set arithmetic works on these and on the `bc:story` markers, nothing else.
epics_story_ids() {
  printf '%s' "$1" | "$JQ" -r '.stories[].id'
}

# epics_select <parsed-json> <ids-csv|""> -- the same object with .stories
# filtered to the listed ids (empty csv = keep them all), plus .excluded, the
# ids that were dropped. An id in the csv that no story carries is neither:
# it comes back in .unknown, so a typo in --only is visible rather than silent.
epics_select() {
  printf '%s' "$1" | "$JQ" -c --arg only "$2" '
    if ($only | length) == 0 then . + {excluded: [], unknown: []}
    else ($only | split(",") | map(select(length > 0))) as $want
      | (.stories | map(.id)) as $have
      | .stories as $all
      | .stories = ($all | map(select(.id as $i | $want | index($i))))
      | .excluded = ($all | map(.id) | map(select(. as $i | ($want | index($i)) | not)))
      | .unknown = ($want | map(select(. as $i | ($have | index($i)) | not)))
    end'
}
