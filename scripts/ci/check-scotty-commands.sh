#!/usr/bin/env bash
# Keeps every `bc-issue.sh <subcommand>` named in the Scotty agent doc
# (.claude/agents/scotty.md), the dispatch prompts
# (agentic-team/scripts/prompts/*.md) and the bc-sdlc skill table
# (.claude/skills/bc-sdlc/SKILL.md) honest against bc-issue.sh's own usage()
# -- a doc naming a subcommand that does not exist is a call nobody can make
# -- and keeps `write-feedback-reply` and `write-demo` (Story 4.17's
# integrating-feedback reply step) named in scotty.md, the bc-sdlc skill and
# the ONE prompt that actually owns each call -- "named in any prompt" would
# pass a command that drifted into the wrong prompt entirely, so each is
# pinned to its own file rather than the prompts directory as a whole. Pure
# static check over the working tree: no gh, no orca, no claude.
#
# Usage: check-scotty-commands.sh [root_dir]
# root_dir defaults to the repo root; the unit tests point it at a fixture
# directory instead so this never has to read the live tree to be exercised.
set -euo pipefail

DEFAULT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${1:-$DEFAULT_ROOT}"
BC_ISSUE="$ROOT/agentic-team/scripts/bc-issue.sh"
SCOTTY="$ROOT/.claude/agents/scotty.md"
PROMPTS_DIR="$ROOT/agentic-team/scripts/prompts"
SKILL="$ROOT/.claude/skills/bc-sdlc/SKILL.md"

# <subcommand> -> the one prompt (basename under $PROMPTS_DIR) that owns the
# call -- judge-demo-summary.md is creating-demo-issue's job, judge-feedback.md
# is integrating-feedback's, and neither call belongs in the other's prompt.
declare -A REQUIRED_PROMPT=(
  [write-demo]="judge-demo-summary.md"
  [write-feedback-reply]="judge-feedback.md"
)

FAILED=0
fail() { echo "check-scotty-commands: FAIL -- $1" >&2; FAILED=1; }

[ -f "$BC_ISSUE" ] || { fail "$BC_ISSUE not found"; exit 1; }
[ -f "$SCOTTY" ] || { fail "$SCOTTY not found"; exit 1; }
[ -d "$PROMPTS_DIR" ] || { fail "$PROMPTS_DIR not found"; exit 1; }
[ -f "$SKILL" ] || { fail "$SKILL not found"; exit 1; }

PROMPT_FILES=("$PROMPTS_DIR"/*.md)
if [ ! -e "${PROMPT_FILES[0]}" ]; then
  fail "$PROMPTS_DIR has no *.md prompt files"
  exit 1
fi

# Every subcommand bc-issue.sh actually supports, read from its own usage()
# heredoc -- the first whitespace-delimited token of every line indented by
# exactly two spaces (a continuation line, indented further to align under
# "--", never starts with a letter there).
USAGE_CMDS="$(awk '
  /^usage\(\) \{/ { inusage=1; next }
  inusage && /<<.?EOF.?$/ { inheredoc=1; next }
  inheredoc && /^EOF$/ { inheredoc=0; inusage=0; next }
  inheredoc && /^  [a-zA-Z]/ { print $1 }
' "$BC_ISSUE" | sort -u)"

if [ -z "$USAGE_CMDS" ]; then
  fail "could not find any subcommand in $BC_ISSUE's usage() -- the heredoc markers may have moved"
  exit 1
fi

# named_in <file> -- every subcommand referenced there as "bc-issue.sh <cmd>".
named_in() {
  grep -ohE 'bc-issue\.sh [a-zA-Z][a-zA-Z-]*' "$@" 2>/dev/null | awk '{print $2}' | sort -u
}

# --- direction 1: every doc-named subcommand actually exists -----------------
check_source() { # <file>
  local file="$1" cmd
  while IFS= read -r cmd; do
    [ -n "$cmd" ] || continue
    if ! printf '%s\n' "$USAGE_CMDS" | grep -qxF "$cmd"; then
      fail "$file names 'bc-issue.sh $cmd', which is not a subcommand bc-issue.sh's usage lists"
    fi
  done <<< "$(named_in "$file")"
}

check_source "$SCOTTY"
check_source "$SKILL"
for p in "${PROMPT_FILES[@]}"; do
  check_source "$p"
done

# --- direction 2: the reply step is named everywhere it must be --------------
for cmd in "${!REQUIRED_PROMPT[@]}"; do
  prompt_file="$PROMPTS_DIR/${REQUIRED_PROMPT[$cmd]}"
  if ! grep -qF "bc-issue.sh $cmd" "$SCOTTY"; then
    fail "'$cmd' is not named in $SCOTTY"
  fi
  if [ ! -f "$prompt_file" ] || ! grep -qF "bc-issue.sh $cmd" "$prompt_file"; then
    fail "'$cmd' is not named in $prompt_file"
  fi
  if ! grep -qF "bc-issue.sh $cmd" "$SKILL"; then
    fail "'$cmd' is not named in $SKILL"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-scotty-commands: scotty.md, the prompts and the bc-sdlc skill agree with bc-issue.sh" >&2
exit 0
