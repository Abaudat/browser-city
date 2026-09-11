#!/usr/bin/env bash
# LEVEL 2 -- Orca/Claude session lifecycle for one role on one issue: derive
# its worktree, spawn/resume/message/stop the Orca terminal that runs it, and
# read back whether it is working, idle, or gone -- and the same for Scotty's
# one session per Sprint (`scotty`). Composes lib/orca.sh and lib/claude.sh,
# plus lib/project.sh for which Sprint is in play -- never calls the
# `orca`/`claude` binaries directly.
#
# Spike answers (scripts/spike/FINDINGS.md, verified 2026-09-02):
#   - Title source: Claude's `-n` name wins the tab title (Orca's --title is
#     overwritten once Claude starts), prefixed with a one-glyph state marker
#     -- so `state`/`send`/`stop` all match on "(<uuid8>)" inside .title, not
#     on anything we passed to `orca terminal create --title`.
#   - Worktree mode: one Orca worktree per issue (`issue:<n>` selector),
#     `orca worktree create --issue <n>` on first use; the fallback BC_MAIN_
#     CHECKOUT mode is for when Orca is unavailable, not exercised in prod.
#   - Idle signal: the leading glyph is authoritative -- ✳ = idle, any other
#     glyph (◐◑◒◓ spinner, ...) = working. A title with NO glyph yet (Claude
#     still booting, so the title is still the bare name we requested) falls
#     back to `lastOutputAt`: recent (< BC_IDLE_MS) = working, else idle.
#   - Send: readiness is checked once, right after `spawn`/`start` create
#     the terminal -- `terminal wait --for tui-idle` PLUS polling for the ✳
#     title with agentIdentity "claude" (see _bc_wait_ready: tui-idle alone
#     can return while PowerShell is still launching claude). Later `send`
#     calls need no wait -- the orchestrator's `ensure` reconciles state
#     before every send anyway.
#   - Session ids: derived, never recorded -- bc_role_uuid <role> <issue>
#     (lib/claude.sh) gives every tick the same uuid, so `spawn`, `start`,
#     `ensure` and the orchestrator all agree on it without a lookup, and a
#     restart resumes the transcript that id names if one exists.
set -u
_BC_SESSION_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_SESSION_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/orca.sh
. "$_BC_SESSION_DIR/lib/orca.sh"
# shellcheck source=lib/claude.sh
. "$_BC_SESSION_DIR/lib/claude.sh"
# shellcheck source=lib/project.sh
. "$_BC_SESSION_DIR/lib/project.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-session.sh <command> [args]
  worktree <issue>
  uuid <role> <issue>                       -- the role's derived session id
  spawn <role> <issue> <worktree>           -- start it (resume if it has a transcript), print the uuid
  state <uuid> <worktree>
  start <role> <issue> <uuid> <worktree>
  ensure <role> <issue> <uuid> <worktree>
  send <uuid> <worktree> <text>
  stop <uuid> <worktree>
  stop-all <issue> <worktree>
  rm-worktree <issue>
  scotty <promptfile> <inputfile>           -- hand Scotty a job in his sprint session, wait until he is done
EOF
}

# --- small helpers -----------------------------------------------------------

_bc_uuid8() { printf '%s' "${1:0:8}"; } # <uuid> -> first 8 chars


# _bc_glyph_word <title> -> idle|working|none (no glyph yet, still the bare
# name -- caller falls back to lastOutputAt).
_bc_glyph_word() {
  case "$1" in
    "✳"*)                          printf 'idle' ;;
    "◐"*|"◑"*|"◒"*|"◓"*)          printf 'working' ;;
    bc-*)                          printf 'none' ;;
    "")                            printf 'none' ;;
    *)                             printf 'working' ;;
  esac
}

# _bc_last_output_recent <lastOutputAt, epoch millis> -- exit 0 if within
# BC_IDLE_MS of now.
_bc_last_output_recent() {
  local last_ms="${1:-}" now_s last_s idle_s
  [ -n "$last_ms" ] && [ "$last_ms" != "null" ] || return 1
  now_s="$(bc_now_epoch)"
  last_s=$(( last_ms / 1000 ))
  idle_s=$(( BC_IDLE_MS / 1000 ))
  [ $(( now_s - last_s )) -lt "$idle_s" ]
}

# _bc_session_find <worktree> <uuid8> -> the matching terminal's JSON object
# on stdout, or nothing at all (not found, disconnected list, or orca_terminals
# itself failed -- all read the same to a caller: no usable terminal).
_bc_session_find() {
  local worktree="$1" uuid8="$2" terms
  terms="$(orca_terminals "$worktree")" || return 0
  printf '%s' "$terms" | "$JQ" -c --arg pat "(${uuid8})" \
    '([.[] | select(.agentIdentity=="claude" and ((.title // "") | contains($pat)))])[0] // empty'
}

# --- the five commands, as reusable functions (no `exit` inside) -----------
# Each echoes its bare-value result on stdout and communicates status via
# `return`, matching the exit contract; the dispatcher below is what exits.

_bc_worktree() { # <issue> -> path ; 0 found/created, 2 create failed
  local issue="$1" path
  if [ "${BC_SESSION_MODE:-}" = "main" ]; then
    printf '%s' "$BC_MAIN_CHECKOUT"
    return 0
  fi
  path="$(orca_worktree_path "issue:$issue")" && { printf '%s' "$path"; return 0; }
  path="$(orca_worktree_create "issue-$issue" "$issue")" || {
    echo "bc-session: failed to create a worktree for issue $issue" >&2
    return 2
  }
  printf '%s' "$path"
  return 0
}

# _bc_wait_ready <handle> <worktree> <uuid8> <name> -- block until the new
# terminal is a Claude session showing its idle prompt. `terminal wait --for
# tui-idle` is NOT enough on its own: the e2e run (2026-09-02) saw it return
# satisfied ~3s after create, while the terminal was still PowerShell
# booting claude -- agentIdentity was still null, so `send`'s title+identity
# match found nothing ("no session found"), and anything sent then was lost
# before Claude read its stdin. Claude announces itself by rewriting the
# title with the ✳ glyph and Orca flips agentIdentity to "claude" at the
# same time, so that is what this polls for, after the cheap wait. Never
# fatal: a session that is slow past the timeout is still found by the next
# tick's `ensure`.
: "${BC_READY_TIMEOUT_S:=90}"
_bc_wait_ready() {
  local handle="$1" worktree="$2" uuid8="$3" name="$4" t waited=0
  orca_terminal_wait_idle "$handle" 60000 \
    || echo "bc-session: warning: $name did not reach tui-idle within 60s" >&2
  # The fake has no boot sequence to wait out (fixtures are static, so the
  # poll could only spin to the timeout); the tui-idle fixture above is the
  # test contract.
  [ -n "${BC_FAKE:-}" ] && return 0
  while [ "$waited" -lt "$BC_READY_TIMEOUT_S" ]; do
    t="$(_bc_session_find "$worktree" "$uuid8")"
    if [ -n "$t" ] && [ "$(_bc_glyph_word "$(printf '%s' "$t" | "$JQ" -r '.title // ""')")" = "idle" ]; then
      return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  echo "bc-session: warning: $name did not show its idle prompt within ${BC_READY_TIMEOUT_S}s" >&2
  return 1
}

_bc_spawn() { # <role> <issue> <worktree> -> the role's uuid ; 0 started, 2 failed
  local role="$1" issue="$2" worktree="$3" uuid
  uuid="$(bc_role_uuid "$role" "$issue")"
  _bc_start "$role" "$issue" "$uuid" "$worktree" >/dev/null || return 2
  printf '%s' "$uuid"
  return 0
}

_bc_state_word() { # <uuid> <worktree> -> idle|working|absent ; 1/0/2 resp.
  local uuid="$1" worktree="$2"
  local uuid8 t connected orphaned title word last
  uuid8="$(_bc_uuid8 "$uuid")"
  t="$(_bc_session_find "$worktree" "$uuid8")"
  if [ -z "$t" ]; then printf 'absent'; return 2; fi
  connected="$(printf '%s' "$t" | "$JQ" -r '.connected')"
  orphaned="$(printf '%s' "$t" | "$JQ" -r '.orphaned')"
  if [ "$connected" = "false" ] || [ "$orphaned" = "true" ]; then printf 'absent'; return 2; fi
  title="$(printf '%s' "$t" | "$JQ" -r '.title // ""')"
  word="$(_bc_glyph_word "$title")"
  case "$word" in
    idle)    printf 'idle';    return 1 ;;
    working) printf 'working'; return 0 ;;
    *)
      last="$(printf '%s' "$t" | "$JQ" -r '.lastOutputAt // empty')"
      if _bc_last_output_recent "$last"; then
        printf 'working'; return 0
      else
        printf 'idle'; return 1
      fi
      ;;
  esac
}

_bc_start() { # <role> <issue> <uuid> <worktree> -> resume|new ; 0 started, 2 failed
  local role="$1" issue="$2" uuid="$3" worktree="$4"
  local uuid8 name mode handle
  uuid8="$(_bc_uuid8 "$uuid")"
  name="bc-${role} #${issue} (${uuid8})"
  if claude_transcript_exists "$worktree" "$uuid"; then mode=resume; else mode=new; fi
  handle="$(orca_terminal_create "$worktree" "$name" "$(claude_session_argv "$role" "$uuid" "$mode" "$name")")" || {
    echo "bc-session: failed to create terminal for $name" >&2
    return 2
  }
  _bc_wait_ready "$handle" "$worktree" "$uuid8" "$name"
  printf '%s' "$mode"
  return 0
}

_bc_ensure() { # <role> <issue> <uuid> <worktree> -> started|working|idle
  local role="$1" issue="$2" uuid="$3" worktree="$4"
  local word rc
  word="$(_bc_state_word "$uuid" "$worktree")"; rc=$?
  if [ "$rc" -eq 2 ]; then
    _bc_start "$role" "$issue" "$uuid" "$worktree" >/dev/null
    printf 'started'
    return 0
  fi
  printf '%s' "$word"
  return "$rc"
}

_bc_send() { # <uuid> <worktree> <text> -> 0 sent, 2 absent
  local uuid="$1" worktree="$2" text="$3"
  local uuid8 t handle
  uuid8="$(_bc_uuid8 "$uuid")"
  t="$(_bc_session_find "$worktree" "$uuid8")"
  [ -n "$t" ] || {
    echo "bc-session: no session found for (${uuid8})" >&2
    return 2
  }
  handle="$(printf '%s' "$t" | "$JQ" -r '.handle')"
  orca_terminal_send "$handle" "$text"
  return 0
}

_bc_stop() { # <uuid> <worktree> -> 0 closed, 1 already absent, 2 orca refused
  local uuid="$1" worktree="$2"
  local uuid8 t handle
  uuid8="$(_bc_uuid8 "$uuid")"
  t="$(_bc_session_find "$worktree" "$uuid8")"
  [ -n "$t" ] || return 1
  handle="$(printf '%s' "$t" | "$JQ" -r '.handle')"
  orca_terminal_close "$handle" || return 2
  return 0
}

# The handles of this issue's Claude panes in a worktree, one per line.
_bc_issue_handles() { # <issue> <worktree>
  local terms
  terms="$(orca_terminals "$2")" || return 2
  printf '%s' "$terms" | "$JQ" -r --arg pat "#${1} (" \
    '.[] | select(.agentIdentity=="claude" and ((.title // "") | contains($pat))) | .handle'
}

# Close every pane, then list again, and keep going until the list is empty
# or BC_STOP_TIMEOUT_S is spent. Orca refuses to close some busy panes with
# `terminal_handle_stale` (reliably the oldest Claude pane in a worktree) for
# anything from a few seconds to a minute, then accepts the very same call, so
# a single pass counts a pane as closed that is still working -- which is how
# the reboot drill found a "closed" lead still at it. The count printed is what
# is actually gone; anything still there at the end is reported as broken.
: "${BC_STOP_TIMEOUT_S:=120}"
_bc_stop_all() { # <issue> <worktree> -> count ; 0 closed >=1, 1 none found, 2 broken
  local issue="$1" worktree="$2"
  local handles h count left waited=0
  handles="$(_bc_issue_handles "$issue" "$worktree")" || { printf '0'; return 2; }
  [ -n "$handles" ] || { printf '0'; return 1; }
  count="$(printf '%s\n' "$handles" | grep -c .)"
  while :; do
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      BC_CLOSE_RETRIES=1 orca_terminal_close "$h" 2>/dev/null || true
    done <<< "$handles"
    [ -n "${BC_FAKE:-}" ] && { printf '%s' "$count"; return 0; }
    sleep 3; waited=$((waited + 3))
    left="$(_bc_issue_handles "$issue" "$worktree")" || left=""
    [ -n "$left" ] || { printf '%s' "$count"; return 0; }
    [ "$waited" -lt "$BC_STOP_TIMEOUT_S" ] || break
    handles="$left"
  done
  left="$(printf '%s\n' "$left" | grep -c .)"
  echo "bc-session: stop-all: $left of $count pane(s) for #$issue still open after ${BC_STOP_TIMEOUT_S}s" >&2
  printf '%s' $((count - left))
  return 2
}

_bc_rm_worktree() { # <issue>
  orca_worktree_rm "issue:$1"
}

# --- Scotty's sprint session -------------------------------------------------
# Scotty's judgements (the demo, feedback, scoping, breakers, task requests)
# used to be `claude -p` one-shots: the orchestrator waited on a process
# whose output went nowhere, so what he read and why he chose what he chose
# could not be seen by anyone. Now each is a message into one Orca terminal
# per Sprint, like every other role's session -- Adrian can watch it, answer
# it, and scroll back through it -- and the Sprint is its unit of memory: the
# rulings he made mid-sprint, the demo he wrote and the feedback he groomed
# are all still in front of him when he scopes the next one.
#
# It stays synchronous for its callers, as the one-shot was: the job is sent,
# and this returns once the session has gone back to its idle prompt. The
# caller then re-reads the board or the PR to see what he actually wrote --
# his reply is not the product, and a session's environment cannot carry a
# result file back the way a child process's could.
: "${BC_SCOTTY_TIMEOUT_S:=3600}"
: "${BC_SCOTTY_POLL_S:=5}"
: "${BC_SCOTTY_GRACE_S:=60}"

# The sprint in play: the last iteration that has started, so the weekend
# between a Friday demo and Monday belongs to the sprint being reviewed, not
# to a gap. Before the first one, the first one; no iterations at all, 0.
_bc_scotty_sprint() { # -> sprint number
  local n
  n="$(project_iterations 2>/dev/null | "$JQ" -r --arg d "$(bc_zurich_date)" '
    (map(select(.startDate <= $d)) | sort_by(.startDate) | last)
      // (sort_by(.startDate) | first) // empty
    | .title | capture("Sprint (?<n>[0-9]+)").n
  ' 2>/dev/null | tr -d '\r')"
  printf '%s' "${n:-0}"
}

# Last sprint's pane is closed only once this sprint's session exists, so the
# previous one stays readable until there is a new one to read instead. Its
# transcript is kept either way (`claude --resume` finds it).
_bc_scotty_close_stale() { # <worktree> <key>
  local terms h
  terms="$(orca_terminals "$1")" || return 0
  printf '%s' "$terms" | "$JQ" -r --arg keep "#$2 (" '
    .[] | (.title // "") as $t
    | select(.agentIdentity=="claude" and ($t | contains("bc-scotty #sprint-")) and ($t | contains($keep) | not))
    | .handle' | tr -d '\r' | while IFS= read -r h; do
    [ -n "$h" ] && orca_terminal_close "$h" >/dev/null 2>&1
  done
  return 0
}

# _bc_scotty_wait <uuid> <worktree> <grace_s> -> 0 idle, 1 still working at
# BC_SCOTTY_TIMEOUT_S, 2 the session is gone. Idle only counts as "done" once
# he has been seen working, or once <grace_s> has passed without that: the
# title can still show the idle glyph for a moment after a send lands.
_bc_scotty_wait() {
  local uuid="$1" wt="$2" grace="$3" waited=0 seen=0 rc step="$BC_SCOTTY_POLL_S"
  while :; do
    _bc_state_word "$uuid" "$wt" >/dev/null; rc=$?
    case "$rc" in
      0) seen=1 ;;
      1) if [ "$seen" -eq 1 ] || [ "$waited" -ge "$grace" ]; then return 0; fi ;;
      *) return 2 ;;
    esac
    [ "$waited" -lt "$BC_SCOTTY_TIMEOUT_S" ] || return 1
    [ "$step" -gt 0 ] && sleep "$step"
    waited=$((waited + (step > 0 ? step : 1)))
  done
}

_bc_scotty() { # <promptfile> <inputfile> -> 0 he took the job and finished, 2 he could not be given it or never finished
  local prompt="$1" input="$2" key uuid wt word rc msg
  if [ ! -f "$prompt" ] || [ ! -f "$input" ]; then
    echo "bc-session scotty: no such prompt or input file" >&2
    return 2
  fi
  key="sprint-$(_bc_scotty_sprint)"
  uuid="$(bc_role_uuid scotty "$key")"
  wt="$BC_SCOTTY_WORKTREE"

  word="$(_bc_ensure scotty "$key" "$uuid" "$wt")"
  [ "$word" = "started" ] && _bc_scotty_close_stale "$wt" "$key"

  # Busy with an earlier job, or with Adrian: never talk over it.
  _bc_scotty_wait "$uuid" "$wt" 0; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "bc-session scotty: his $key session is $([ "$rc" -eq 1 ] && echo 'still busy' || echo 'not running')" >&2
    return 2
  fi

  msg="$(cat "$prompt")

The input for this call is in \`$input\` -- read it with \`cat\` before anything else."
  _bc_send "$uuid" "$wt" "$msg" || return 2

  _bc_scotty_wait "$uuid" "$wt" "$BC_SCOTTY_GRACE_S"; rc=$?
  case "$rc" in
    0) return 0 ;;
    1) echo "bc-session scotty: still working after ${BC_SCOTTY_TIMEOUT_S}s in his $key session" >&2 ;;
    *) echo "bc-session scotty: his $key session went away mid-job" >&2 ;;
  esac
  return 2
}

# --- dispatch ----------------------------------------------------------------

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
  worktree)
    out="$(_bc_worktree "$@")"; rc=$?
    [ -n "$out" ] && printf '%s\n' "$out"
    exit "$rc"
    ;;
  uuid)
    [ $# -eq 2 ] || { usage; exit 2; }
    printf '%s\n' "$(bc_role_uuid "$1" "$2")"
    exit 0
    ;;
  spawn)
    out="$(_bc_spawn "$@")"; rc=$?
    [ -n "$out" ] && printf '%s\n' "$out"
    exit "$rc"
    ;;
  state)
    out="$(_bc_state_word "$@")"; rc=$?
    printf '%s\n' "$out"
    exit "$rc"
    ;;
  start)
    out="$(_bc_start "$@")"; rc=$?
    [ -n "$out" ] && printf '%s\n' "$out"
    exit "$rc"
    ;;
  ensure)
    out="$(_bc_ensure "$@")"; rc=$?
    printf '%s\n' "$out"
    exit "$rc"
    ;;
  send)
    _bc_send "$@"
    exit $?
    ;;
  stop)
    _bc_stop "$@"
    exit $?
    ;;
  stop-all)
    out="$(_bc_stop_all "$@")"; rc=$?
    printf '%s\n' "$out"
    exit "$rc"
    ;;
  rm-worktree)
    _bc_rm_worktree "$@"
    exit $?
    ;;
  scotty)
    [ $# -eq 2 ] || { usage; exit 2; }
    # Under BC_FAKE the callers' tests stand in for Scotty with a fixture
    # overlay (bc_fake_overlay) rather than an Orca terminal fixture per
    # poll; BC_FAKE_SCOTTY_SESSION=1 runs the real composition against the
    # orca fixtures instead, which is how test-bc-session.sh covers it.
    if [ -n "${BC_FAKE:-}" ] && [ -z "${BC_FAKE_SCOTTY_SESSION:-}" ]; then
      bc_fake_write bc_scotty "$(basename "$1")"
      # What he was handed, kept where a test can read it after the caller
      # has deleted its temp file.
      cp -f "$2" "$BC_FAKE/bc_scotty.$(basename "$1").input" 2>/dev/null || true
      bc_fake_overlay "bc_scotty.$(basename "$1")"
      exit 0
    fi
    _bc_scotty "$@"
    exit $?
    ;;
  *)
    usage
    exit 2
    ;;
esac
