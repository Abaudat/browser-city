#!/usr/bin/env bash
# LEVEL 2 -- Orca/Claude session lifecycle for one role on one issue: derive
# its worktree, spawn/resume/message/stop the Orca terminal that runs it, and
# read back whether it is working, idle, or gone. Composes lib/orca.sh and
# lib/claude.sh only -- never calls the `orca`/`claude` binaries directly.
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
#   - Send: `terminal wait --for tui-idle` is only needed once, right after
#     `spawn`/`start` create the terminal (a fresh or resuming Claude takes
#     ~10s to paint its first prompt); later `send` calls need no wait -- the
#     orchestrator's `ensure` reconciles state before every send anyway.
set -u
_BC_SESSION_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_SESSION_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/orca.sh
. "$_BC_SESSION_DIR/lib/orca.sh"
# shellcheck source=lib/claude.sh
. "$_BC_SESSION_DIR/lib/claude.sh"

usage() {
  cat >&2 <<'EOF'
usage: bc-session.sh <command> [args]
  worktree <issue>
  spawn <role> <issue> <worktree>
  state <uuid> <worktree>
  start <role> <issue> <uuid> <worktree>
  ensure <role> <issue> <uuid> <worktree>
  send <uuid> <worktree> <text>
  stop <uuid> <worktree>
  stop-all <issue> <worktree>
  rm-worktree <issue>
EOF
}

# --- small helpers -----------------------------------------------------------

_bc_uuid8() { printf '%s' "${1:0:8}"; } # <uuid> -> first 8 chars

_bc_new_uuid() { # -> a fresh uuid, lowercase
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif command -v python >/dev/null 2>&1; then
    python -c "import uuid; print(uuid.uuid4())"
  else
    return 1
  fi
}

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

_bc_spawn() { # <role> <issue> <worktree> -> new uuid ; 0 spawned, 2 failed
  local role="$1" issue="$2" worktree="$3"
  local uuid uuid8 name handle
  uuid="$(_bc_new_uuid)" || {
    echo "bc-session: could not generate a uuid (no uuidgen or python on PATH)" >&2
    return 2
  }
  uuid8="$(_bc_uuid8 "$uuid")"
  name="bc-${role} #${issue} (${uuid8})"
  handle="$(orca_terminal_create "$worktree" "$name" "$(claude_session_argv "$role" "$uuid" new "$name")")" || {
    echo "bc-session: failed to create terminal for $name" >&2
    return 2
  }
  orca_terminal_wait_idle "$handle" 60000 \
    || echo "bc-session: warning: $name did not reach tui-idle within 60s" >&2
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
  orca_terminal_wait_idle "$handle" 60000 \
    || echo "bc-session: warning: $name did not reach tui-idle within 60s" >&2
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

_bc_stop() { # <uuid> <worktree> -> 0 closed, 1 already absent
  local uuid="$1" worktree="$2"
  local uuid8 t handle
  uuid8="$(_bc_uuid8 "$uuid")"
  t="$(_bc_session_find "$worktree" "$uuid8")"
  [ -n "$t" ] || return 1
  handle="$(printf '%s' "$t" | "$JQ" -r '.handle')"
  orca_terminal_close "$handle"
  return 0
}

_bc_stop_all() { # <issue> <worktree> -> count ; 0 closed >=1, 1 none found, 2 broken
  local issue="$1" worktree="$2"
  local terms handles h count=0
  terms="$(orca_terminals "$worktree")" || { printf '0'; return 2; }
  handles="$(printf '%s' "$terms" | "$JQ" -r --arg pat "#${issue} (" \
    '.[] | select(.agentIdentity=="claude" and ((.title // "") | contains($pat))) | .handle')"
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    orca_terminal_close "$h"
    count=$((count + 1))
  done <<< "$handles"
  printf '%s' "$count"
  [ "$count" -gt 0 ] && return 0 || return 1
}

_bc_rm_worktree() { # <issue>
  orca_worktree_rm "issue:$1"
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
  *)
    usage
    exit 2
    ;;
esac
