#!/usr/bin/env bash
# The structured-comment vocabulary: parse and render the
# `<!-- bc:name value -->` markers embedded in GitHub comment/issue bodies.
# Wraps no external tool (no gh/orca/claude calls) -- pure text in, text out,
# so every function here is safe to call with or without BC_FAKE set. The one
# rule: marker syntax is spelled out ONCE, in these functions; nothing above
# this file ever matches "<!-- bc:" itself.

# Escapes a marker name for use inside an ERE (grep -E / sed -E).
_bc_marker_escape() { printf '%s' "$1" | sed -e 's/[][\.^$*+?(){}|]/\\&/g'; }

# Escapes replacement text for use as a sed -E replacement with '@' delimiter.
_bc_sed_repl_escape() { printf '%s' "$1" | sed -e 's/[\&@]/\\&/g'; }

# has_marker <body> <name> -- true if the marker is present at all, whether it
# carries a value ("<!-- bc:name value -->") or is presence-only
# ("<!-- bc:name -->", e.g. bc:status, bc:crew, bc:breaker).
has_marker() {
  local body="$1" namere
  namere="$(_bc_marker_escape "$2")"
  printf '%s\n' "$body" | grep -Eq -- "<!-- bc:${namere}( [^>]*)? -->"
}

# marker_get <body> <name> -- prints the value on stdout; exit 1 if the
# marker is absent, or present but carries no value (presence-only marker).
marker_get() {
  local body="$1" name="$2" namere line
  namere="$(_bc_marker_escape "$name")"
  line="$(printf '%s\n' "$body" | grep -E -- "<!-- bc:${namere} .* -->" | head -1)"
  [ -n "$line" ] || return 1
  printf '%s' "$line" | sed -E "s/.*<!-- bc:${namere} (.*) -->.*/\1/"
}

# marker_set <body> <name> <value> -- prints the new body on stdout. Replaces
# an existing "<!-- bc:name ... -->" line in place (never duplicates it); if
# the marker is not yet present, appends a fresh line.
marker_set() {
  local body="$1" name="$2" value="$3" namere newline repl
  namere="$(_bc_marker_escape "$name")"
  newline="<!-- bc:${name} ${value} -->"
  repl="$(_bc_sed_repl_escape "$newline")"
  if printf '%s\n' "$body" | grep -Eq -- "<!-- bc:${namere}( [^>]*)? -->"; then
    printf '%s\n' "$body" | sed -E "s@<!-- bc:${namere}( [^>]*)? -->@${repl}@"
  else
    printf '%s\n%s' "$body" "$newline"
  fi
}

# is_human_comment <body> -- true when the body carries no bc: marker at all.
is_human_comment() {
  ! printf '%s' "$1" | grep -Fq -- '<!-- bc:'
}

# --- renderers: full comment bodies, heading + short prose + markers -------

render_analysis_stub() { # <role>
  local role="$1"
  cat <<EOF
### Analysis — ${role}

_pending_

<!-- bc:lead:${role} -->
<!-- bc:direction PENDING -->
EOF
}

render_status() { # <issue> <scope-csv> <cycle>
  local issue="$1" scope="$2" cycle="$3"
  cat <<EOF
### Status

<!-- bc:status -->
<!-- bc:issue ${issue} -->
<!-- bc:scope ${scope} -->
<!-- bc:cycle ${cycle} -->
EOF
}

render_review_stub() { # <role>
  local role="$1"
  cat <<EOF
### Review — ${role}

_Not yet reviewed._

<!-- bc:lead:${role} -->
<!-- bc:reviewed - -->
EOF
}

render_crew_review_stub() {
  cat <<EOF
### Crew

_Not yet addressed._

<!-- bc:crew -->
<!-- bc:addressed - -->
EOF
}

render_breaker() { # <text>
  local text="$1"
  cat <<EOF
### Breaker

@${BC_HUMAN:-Abaudat} ${text}

<!-- bc:breaker -->
EOF
}

render_demo_body() { # <sprint-number> <summary>
  local n="$1" summary="$2"
  cat <<EOF
### Sprint ${n} Demo

${summary}

<!-- bc:demo ${n} -->
EOF
}

# --- appended by the bc-epic.sh work: the migration's provenance markers ----
# `bc:epic <n>` and `bc:story <id>` are what make the epic import idempotent
# and what the round-trip check reads. They are provenance ONLY -- Story 0.20
# requires that epic membership stay the sub-issue link, lead scope stay a
# label and status stay the board's field, none of the three restated in a
# body, so neither renderer writes any of them. The bodies themselves are the
# epic's preamble and the story's own prose, carried through unchanged.

render_epic_body() { # <epic-number> <preamble>
  local n="$1" preamble="$2"
  cat <<EOF
${preamble}

<!-- bc:epic ${n} -->
EOF
}

render_story_body() { # <story-id> <story-body>
  local id="$1" body="$2"
  cat <<EOF
${body}

<!-- bc:story ${id} -->
EOF
}
