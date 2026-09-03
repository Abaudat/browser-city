#!/usr/bin/env bash
# Constants and tool resolution for the orchestrator scripts. Wraps nothing on
# its own -- sources paths.sh and exposes bc_init, the one function every
# level-1/2 script calls to populate $GH $JQ $ORCA $CLAUDE. The one rule:
# every constant is overridable via environment (: "${X:=default}"), and a
# missing tool exits 2 with a message on stderr -- never guessed, never left
# unset for a later command to fail on mysteriously.

_BC_CONFIG_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=paths.sh
. "$_BC_CONFIG_LIB_DIR/paths.sh"

# Role sessions run in their own Orca terminals and inherit nothing from the
# orchestrator's environment, so an override that has to reach them too (the
# e2e run points BC_BASE_BRANCH at a throwaway base, for instance) is written
# to this file once and sourced by every process. Absent file = defaults.
: "${BC_ENV_FILE:=$(bc_state_dir)/env.sh}"
# shellcheck disable=SC1090
[ -f "$BC_ENV_FILE" ] && . "$BC_ENV_FILE"

: "${BC_REPO:=Abaudat/browser-city}"
: "${BC_PROJECT_OWNER:=Abaudat}"
: "${BC_PROJECT_NUMBER:=1}"
: "${BC_LEADS:=quentin derek tim artie}"
: "${BC_ALWAYS_LEADS:=quentin}"
: "${BC_ROLES:=$BC_LEADS crew}"
: "${BC_IDLE_MS:=300000}"
: "${BC_CYCLE_LIMIT:=8}"
# Git Bash on this machine ships no IANA zoneinfo database (no
# /usr/share/zoneinfo), so TZ=Europe/Zurich is silently taken as UTC by GNU
# date -- wrong every day of the year, and wrong by two hours half of it. A
# POSIX TZ rule string (offset + DST transition rule) needs no database and
# resolves correctly under `date -d ... TZ=...` even without one, so that is
# the default; override with either form if a real zoneinfo db is present.
: "${BC_TZ:=CET-1CEST,M3.5.0,M10.5.0/3}"
: "${BC_DEMO_HOUR:=12}"
: "${BC_HUMAN:=Abaudat}"
: "${BC_LABEL_DEMO:=demo}"
: "${BC_LABEL_BREAKER:=breaker}"
: "${BC_LABEL_STORY:=story}"
: "${BC_LEAD_LABEL_PREFIX:=lead:}"
: "${BC_MERGE_METHOD:=squash}"
: "${BC_WORKSPACES:=$HOME/orca/workspaces/BrowserCity}"
: "${BC_ORCA_REPO_ID:=61a8f373-6a62-4138-a33c-fb4be6d0ddc1}"
: "${BC_MAIN_CHECKOUT:=D:/Projects/BrowserCity}"
: "${BC_BASE_BRANCH:=master}"

# Resolves the four external tools once per process into $GH $JQ $ORCA
# $CLAUDE. Every lib function calls the tool through these vars, never by
# bare name, so a missing tool is caught here rather than as a mystery
# "command not found" three layers down.
bc_init() {
  GH="${GH:-$(resolve_gh || true)}"
  JQ="${JQ:-$(resolve_jq || true)}"
  ORCA="${ORCA:-$(resolve_orca || true)}"
  CLAUDE="${CLAUDE:-$(resolve_claude || true)}"
  # _bc_is_executable (paths.sh): a POSIX x bit, or a Windows launcher
  # (.cmd/.bat/.exe) that merely needs to exist -- git-bash on this machine
  # does not set the x bit on plain-text .cmd/.bat files, so a bare `-x`
  # check here would reject the exact claude.cmd resolve_claude picked.
  [ -n "$GH" ] && _bc_is_executable "$GH"         || { echo "bc_init: gh not found" >&2; exit 2; }
  [ -n "$JQ" ] && _bc_is_executable "$JQ"         || { echo "bc_init: jq not found" >&2; exit 2; }
  [ -n "$ORCA" ] && _bc_is_executable "$ORCA"     || { echo "bc_init: orca not found" >&2; exit 2; }
  [ -n "$CLAUDE" ] && _bc_is_executable "$CLAUDE" || { echo "bc_init: claude not found" >&2; exit 2; }
  export GH JQ ORCA CLAUDE
}

# --- clock, overridable so tests can pin it ---------------------------------
# BC_NOW, if set, is either an epoch (all-digit) or anything `date -d` parses
# (an ISO timestamp). Unset means "really now".
bc_now_epoch() {
  if [ -n "${BC_NOW:-}" ]; then
    case "$BC_NOW" in
      *[!0-9]*) date -d "$BC_NOW" "+%s" ;;
      *)        printf '%s' "$BC_NOW" ;;
    esac
  else
    date "+%s"
  fi
}

bc_zurich_date() { # [epoch] -> YYYY-MM-DD in BC_TZ, default now
  local epoch="${1:-$(bc_now_epoch)}"
  TZ="$BC_TZ" date -d "@$epoch" "+%Y-%m-%d"
}

bc_zurich_hour() { # [epoch] -> 0-23 (no leading zero) in BC_TZ, default now
  local epoch="${1:-$(bc_now_epoch)}" h
  h="$(TZ="$BC_TZ" date -d "@$epoch" "+%H")"
  printf '%d' "$((10#$h))"
}
