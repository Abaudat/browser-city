#!/usr/bin/env bash
# OFF THE WAKE -- the scheduled supervisor. This is what the Windows Task
# Scheduler runs every dozen minutes (see keepalive.cmd and scripts/README.md).
# It takes no decision about the project at all; it owns exactly one fact --
# that run-orchestrator.sh is alive somewhere on this machine -- and it makes
# that fact true again when it is not:
#
#   1. Orca is up and its runtime reachable (`orca status`, else `orca open`).
#   2. The orchestrator loop is running (a bash.exe whose command line names
#      run-orchestrator.sh). If it is, this run is over -- nothing else is
#      touched.
#   3. If it is not: any stale terminal wearing our title is closed, a fresh
#      Git Bash terminal is created in the worktree running the loop, and the
#      loop is confirmed to have actually appeared in the process table.
#
# Step 3 recreates rather than types into whatever tab it finds, and that is
# the whole design. Orca terminals are PowerShell (spike/FINDINGS.md #2), so
# our Git Bash tab is PowerShell running bash.exe -- and the moment that bash
# ends, Orca retitles the tab to its own executable path, because PowerShell
# is the foreground process again. So a tab whose loop has died is neither
# ours by title nor a bash to type into: a bash command line sent to it would
# produce a PowerShell parse error nobody reads, and this script would report
# "started" every twelve minutes forever while the team never moved. A
# terminal we just created, running a loop we just watched appear in the
# process table, is the only claim worth making.
#
# Nothing is remembered between runs: the process table, `orca status` and
# `orca terminal list` are re-read every time, so a reboot, a killed loop or
# a closed Orca all heal on the next run without this script having known
# anything about the last one.
#
# Exit contract, the orchestrator's: 0 acted, 1 slept (already running), 2
# broken. One line "keepalive <verb> <details>" goes to stdout, to
# $BC_KEEPALIVE_REASON and to $BC_KEEPALIVE_LOG -- the Task Scheduler keeps
# no output of its own, so the log is the only place a 3am run leaves a
# trace. Note that a healthy run exits 1 far more often than 0; the Task
# Scheduler shows that as "0x1", which is this script saying there was
# nothing to do, not a failure.
set -u
_BC_KA_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_KA_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/orca.sh
. "$_BC_KA_DIR/lib/orca.sh"
# shellcheck source=lib/proc.sh
. "$_BC_KA_DIR/lib/proc.sh"

: "${BC_KEEPALIVE_WORKTREE:=$BC_MAIN_CHECKOUT}"
: "${BC_KEEPALIVE_TITLE:=bc-orchestrator}"
: "${BC_LOOP_SCRIPT:=$_BC_KA_DIR/run-orchestrator.sh}"
: "${BC_ORCA_READY_TIMEOUT_S:=180}"
: "${BC_LOOP_START_TIMEOUT_S:=60}"
: "${BC_POLL_INTERVAL_S:=5}"
: "${BC_KEEPALIVE_REASON:=$(bc_state_dir)/keepalive-reason.txt}"
: "${BC_KEEPALIVE_LOG:=$(bc_state_dir)/keepalive.log}"
: "${BC_KEEPALIVE_LOG_LINES:=1000}"

# finish <exit-code> <words...> -- the one report this run makes, to stdout,
# to the reason file and appended to the log. Nothing after it runs.
finish() {
  local code="$1"; shift
  local line="$*"
  printf '%s\n' "$line" > "$BC_KEEPALIVE_REASON" 2>/dev/null
  if [ -n "$BC_KEEPALIVE_LOG" ]; then
    printf '%s %s\n' "$(stamp)" "$line" >> "$BC_KEEPALIVE_LOG" 2>/dev/null
    if [ "$(wc -l < "$BC_KEEPALIVE_LOG" 2>/dev/null || echo 0)" -gt "$BC_KEEPALIVE_LOG_LINES" ]; then
      tail -n "$BC_KEEPALIVE_LOG_LINES" "$BC_KEEPALIVE_LOG" > "$BC_KEEPALIVE_LOG.trim" 2>/dev/null &&
        cp "$BC_KEEPALIVE_LOG.trim" "$BC_KEEPALIVE_LOG" 2>/dev/null
      rm -f "$BC_KEEPALIVE_LOG.trim" 2>/dev/null
    fi
  fi
  printf '%s\n' "$line"
  exit "$code"
}

# --- what we are supervising, in both path forms ----------------------------
# The loop script is named to PowerShell in Windows form and tested for
# existence in bash form; the needle we hunt in the process table is its bare
# name, so a loop somebody started by hand from a bash prompt counts as
# running too. Two loops ticking the same board would dispatch everything
# twice, and this is what makes that impossible to cause by accident.
LOOP_POSIX="$(winpath "$BC_LOOP_SCRIPT")"
LOOP_WIN="$(posix2win "$BC_LOOP_SCRIPT")"
LOOP_NEEDLE="$(basename "$BC_LOOP_SCRIPT")"
[ -f "$LOOP_POSIX" ] || finish 2 "keepalive broken loop script not found: $BC_LOOP_SCRIPT"

# _loop_alive -- 0 running, 1 not, 2 could not tell. bash.exe is the
# executable because that is what PowerShell launches for the tab (and
# what a hand-started loop runs in too).
_loop_alive() { bc_proc_running bash.exe "$LOOP_NEEDLE"; }

# _wait_for_loop -- same three codes, polled until BC_LOOP_START_TIMEOUT_S.
# "Could not tell" ends the wait immediately: retrying a query that cannot
# answer only spends the timeout to reach the same place.
_wait_for_loop() {
  local deadline rc
  deadline=$(( $(date "+%s") + BC_LOOP_START_TIMEOUT_S ))
  while :; do
    _loop_alive; rc=$?
    [ "$rc" -ne 1 ] && return "$rc"
    [ "$(date "+%s")" -lt "$deadline" ] || return 1
    sleep "$BC_POLL_INTERVAL_S"
  done
}

# --- 1. Orca ----------------------------------------------------------------
ORCA_STATE=ready
if ! orca_ready; then
  echo "keepalive: orca is not reachable, opening it" >&2
  # The deadline is taken before the launch, not after it: `orca open` blocks
  # for up to this long by itself, so starting the clock on its return would
  # make a wedged launch cost two budgets and outlive the run limit the
  # scheduled task is given.
  ORCA_DEADLINE=$(( $(date "+%s") + BC_ORCA_READY_TIMEOUT_S ))
  orca_open "$BC_ORCA_READY_TIMEOUT_S"
  until orca_ready; do
    [ "$(date "+%s")" -lt "$ORCA_DEADLINE" ] || \
      finish 2 "keepalive broken orca runtime not reachable after ${BC_ORCA_READY_TIMEOUT_S}s"
    sleep "$BC_POLL_INTERVAL_S"
  done
  ORCA_STATE=opened
fi

# --- 2. is the loop already running? ----------------------------------------
_loop_alive
case $? in
  0) finish 1 "keepalive sleep loop already running for $BC_KEEPALIVE_WORKTREE orca=$ORCA_STATE" ;;
  2) finish 2 "keepalive broken cannot read the process table" ;;
esac

# --- 3. close what is stale, create the Git Bash terminal, confirm the loop --
GIT_BASH="$(resolve_git_bash)" || finish 2 "keepalive broken git bash not found; set BC_GIT_BASH"
# The trailing `; exit` is what keeps tabs from piling up. Orca creates the
# terminal as PowerShell and runs this line in it; when the loop ends,
# PowerShell would otherwise stay at a prompt and Orca would rename the tab
# to its own executable path -- a leftover this script can no longer
# recognise by title, one per killed loop, forever. Exiting the shell closes
# the tab instead, so a dead loop leaves nothing behind to tidy.
LOOP_COMMAND="& '$(posix2win "$GIT_BASH")' -l '$LOOP_WIN'; exit"

TERMINALS="$(orca_terminals "$BC_KEEPALIVE_WORKTREE")" || \
  finish 2 "keepalive broken cannot list terminals for $BC_KEEPALIVE_WORKTREE"

# A pane wearing our title but running Claude is somebody else's work that
# happens to collide -- Claude rewrites the title it was given, so this can
# only be a coincidence, and coincidences are not ours to close.
#
# A tab that will not close has already had orca_terminal_close's three
# rounds and its --tab fallback, so it is Orca persistently refusing rather
# than a race. The run still creates the loop -- a team that does not move is
# worse than an untidy tab bar -- but the count goes in the reason line, so a
# leak that grows by one every twelve minutes shows up in the log instead of
# in a warning on a stderr nobody keeps.
CLOSED=0
UNCLOSED=0
for handle in $(printf '%s' "$TERMINALS" | "$JQ" -r --arg t "$BC_KEEPALIVE_TITLE" \
  '.[] | select(.title == $t) | select((.agentIdentity // "") != "claude") | .handle'); do
  if orca_terminal_close "$handle"; then
    CLOSED=$(( CLOSED + 1 ))
  else
    UNCLOSED=$(( UNCLOSED + 1 ))
    echo "keepalive: could not close stale terminal $handle" >&2
  fi
done

HANDLE="$(orca_terminal_create "$BC_KEEPALIVE_WORKTREE" "$BC_KEEPALIVE_TITLE" "$LOOP_COMMAND")" || \
  finish 2 "keepalive broken could not create a terminal in $BC_KEEPALIVE_WORKTREE"
# orca_terminal_create already refuses a null handle; this is the same check
# from the other side, because a handle nothing can address must never be
# printed as the terminal this run claims to have started.
case "$HANDLE" in
  ""|null) finish 2 "keepalive broken terminal created but orca named no handle" ;;
esac

_wait_for_loop
case $? in
  0) finish 0 "keepalive started loop in $BC_KEEPALIVE_WORKTREE terminal=$HANDLE closed=$CLOSED unclosed=$UNCLOSED orca=$ORCA_STATE" ;;
  2) finish 2 "keepalive broken cannot read the process table" ;;
  *) finish 2 "keepalive broken loop did not appear within ${BC_LOOP_START_TIMEOUT_S}s in terminal=$HANDLE" ;;
esac
