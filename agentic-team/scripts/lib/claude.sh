#!/usr/bin/env bash
# Claude session argv construction, the answer-only judgement one-shot, and
# transcript lookup. Wraps `claude` -- one function per concern, no branching
# beyond picking --session-id vs --resume. The one rule: session/one-shot
# flags are spelled out ONCE, here; nothing above this file builds a `claude`
# command line itself.
#
# Scotty's judge-*.md calls are not one-shots any more: each produces an
# artefact, and each now runs as a message into his sprint session (see
# `bc-session.sh scotty`), so his reasoning stays on screen and one call
# remembers the last. claude_oneshot has no caller today. It is kept because
# a judgement whose answer is only an answer must not be given tools, and
# this is the form that gives it none.
#
# It passes its prompt as a FILE, never as an argv string. `--system-prompt
# "$(cat prompt.md)"` was measured on this machine to arrive truncated at the
# first non-ASCII byte -- every judge-*.md prompt is prose with em dashes in
# it, so each was silently losing everything after its first one. The -file
# form takes a path (in Windows form, `claude` being a Windows process) and
# the whole prompt arrives.
#
# claude_oneshot is fake-aware via fake.sh; the rest is pure string/filesystem
# logic and needs no external tool to test.

_BC_CLAUDE_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_CLAUDE_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_CLAUDE_LIB_DIR/fake.sh"

claude_session_argv() { # <role> <uuid> <new|resume> <name> -> command string
  local role="$1" uuid="$2" mode="$3" name="$4" idflag claude_win
  case "$mode" in
    new)    idflag="--session-id $uuid" ;;
    resume) idflag="--resume $uuid" ;;
    *) return 2 ;;
  esac
  # This command string is typed into the Orca terminal's own shell
  # (PowerShell on Windows), not bash -- $CLAUDE is resolved in POSIX form
  # ("/c/Users/...") for every other caller in these scripts, all of which
  # run under bash, but PowerShell has no such path syntax and reports
  # CommandNotFoundException on it. Convert to Windows form here only.
  claude_win="$(posix2win "$CLAUDE")"
  printf "%s --agent %s %s -n '%s' --permission-mode bypassPermissions" \
    "$claude_win" "$role" "$idflag" "$name"
}

# Session ids are derived, never recorded: md5 of "browser-city <role> #<issue>"
# shaped like a v4 uuid so `claude --session-id` accepts it. Every tick can
# recompute who to talk to from role + issue alone -- no stub has to carry a
# uuid, a half-finished starting-dev-cycle has nothing to repair -- and after a restart
# `bc-session start` resumes the transcript that id names, if one exists.
bc_role_uuid() { # <role> <issue> -> uuid
  local h
  h="$(printf 'browser-city %s #%s' "$1" "$2" | md5sum | cut -c1-32)"
  printf '%s-%s-4%s-8%s-%s' "${h:0:8}" "${h:8:4}" "${h:13:3}" "${h:17:3}" "${h:20:12}"
}

claude_oneshot() { # <promptfile> <inputfile> -> claude's stdout (the input is piped to stdin)
  [ -n "${BC_FAKE:-}" ] && { bc_fake_read claude_oneshot "$(basename "$1")"; return; }
  "$CLAUDE" -p --model sonnet --tools "" --no-session-persistence \
    --system-prompt-file "$(posix2win "$1")" < "$2" 2>/dev/null
}

# claude_render_prompt <file> key=value... -> the prompt with every {{key}}
# replaced, on stdout. Only Scotty's judge-*.md prompts need this: they have
# to be told which issue/PR they are writing for, where to put their body
# file, and where the scripts live. orchestrator.sh keeps its own copy for the
# dispatch-*.md prompts because level 3 never sources this file; the one
# difference is that paths stay POSIX here -- they are only ever used by
# Scotty's Bash tool, which is a bash.
claude_render_prompt() {
  local file="$1"; shift
  local sed_args=() kv key val
  for kv in "$@"; do
    key="${kv%%=*}"
    val="${kv#*=}"
    val="${val//&/\\&}"
    sed_args+=(-e "s#{{${key}}}#${val}#g")
  done
  [ "${#sed_args[@]}" -gt 0 ] || { cat "$file"; return; }
  sed "${sed_args[@]}" "$file"
}

claude_transcript_exists() { # <worktree-path, posix or windows form> <uuid> -> exit 0/1
  local winp encoded home="${BC_CLAUDE_HOME:-$HOME}"
  winp="$(posix2win "$1")"
  encoded="$(printf '%s' "$winp" | sed -e 's/[:\/\\]/-/g')"
  [ -f "$home/.claude/projects/$encoded/$2.jsonl" ]
}
