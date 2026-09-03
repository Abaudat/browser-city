#!/usr/bin/env bash
# Claude session argv construction, the two judgement one-shots, and
# transcript lookup. Wraps `claude` -- one function per concern, no branching
# beyond picking --session-id vs --resume. The one rule: session/one-shot
# flags are spelled out ONCE, here; nothing above this file builds a `claude`
# command line itself. claude_oneshot answers a question and returns the
# answer; claude_oneshot_acting answers it by writing the artefact itself.
# Both are fake-aware via fake.sh; the rest is pure string/filesystem logic
# and needs no external tool to test.

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
    --system-prompt "$(cat "$1")" < "$2" 2>/dev/null
}

# claude_oneshot_acting <promptfile> <inputfile> -> exit 0/1, stdout discarded
# The same one-shot, for the two judgements whose answer IS an artefact: the
# Sprint Demo issue and the breaker comment. Scotty thinks from the input,
# then calls the bc-sdlc `write-*` method himself, so the prose and the thing
# that carries it are created in one step and there is no window in which one
# exists without the other. His reply is not the product and is thrown away
# -- what he wrote is on GitHub, and its number comes back through
# BC_WRITE_RESULT (see bc_record_result in config.sh).
#
# Bash is what runs the method; Write is how he gets his prose into the body
# file the prompt names. bypassPermissions because nothing is watching to
# answer a prompt.
#
# --agent scotty, and therefore --append-system-prompt rather than
# --system-prompt: --system-prompt REPLACES an agent's prompt outright
# (measured, not assumed), which would leave --agent contributing nothing but
# a tool list and throw away the identity in .claude/agents/scotty.md. The
# append keeps that identity as the base and puts the judge prompt -- this
# call's job -- on top of it. Run from the repo root so `--agent scotty`
# resolves: agent lookup is relative to the cwd, and nothing guarantees the
# orchestrator was started from there.
#
# Under BC_FAKE this cannot spawn anything, so it logs the call like any
# other write and, when a claude_oneshot_acting.<prompt>.json fixture is
# present, stands in for Scotty by recording that fixture's contents as the
# result -- present fixture = "Scotty wrote it and it is #N", absent = "Scotty
# did nothing", which is the failure path the callers must handle.
claude_oneshot_acting() {
  if [ -n "${BC_FAKE:-}" ]; then
    bc_fake_write claude_oneshot_acting "$(basename "$1")"
    if [ -n "${BC_WRITE_RESULT:-}" ]; then
      bc_fake_read claude_oneshot_acting "$(basename "$1")" > "$BC_WRITE_RESULT" 2>/dev/null || true
    fi
    return 0
  fi
  ( cd "$_BC_CLAUDE_LIB_DIR/../.." || return 2
    "$CLAUDE" -p --model sonnet --agent scotty --tools "Bash,Write" \
      --permission-mode bypassPermissions --no-session-persistence \
      --append-system-prompt "$(cat "$1")" < "$2" >/dev/null 2>&1 )
}

# claude_render_prompt <file> key=value... -> the prompt with every {{key}}
# replaced, on stdout. Only the acting prompts need this: they have to be
# told which issue/PR they are writing for, where to put their body file, and
# where the scripts live. orchestrator.sh keeps its own copy for the
# dispatch-*.md prompts because level 3 never sources this file; the one
# difference is that paths stay POSIX here -- an acting prompt is read by a
# `claude -p` whose Bash tool is a bash, not by the PowerShell that runs a
# role session's terminal.
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
