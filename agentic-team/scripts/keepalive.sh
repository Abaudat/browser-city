#!/usr/bin/env bash
# OFF THE WAKE -- the scheduled supervisor. This is what the Windows Task
# Scheduler runs every dozen minutes (see keepalive.cmd and scripts/README.md).
# It takes no decision about the project at all; it owns exactly one fact --
# that the run-orchestrator.sh running on this machine is a CURRENT one --
# and it makes that fact true again every time it wakes:
#
#   1. The supervised worktree is fast-forwarded to its upstream (git pull).
#   2. Orca is up and its runtime reachable (`orca status`, else `orca open`).
#   3. Any orchestrator loop already running is stopped, and confirmed gone.
#   4. Any stale terminal wearing our title is closed, a fresh Git Bash
#      terminal is created in the worktree running the loop, and the loop is
#      confirmed to have actually appeared in the process table.
#
# Steps 1 and 3 are one idea in two halves. A loop is a bash that read
# run-orchestrator.sh and orchestrator.sh once, when it started, and then
# ticked them for as long as it lived -- so a pull that brings in a fixed
# orchestrator changes nothing at all until something restarts the loop, and
# a loop that has survived for days is a loop running code nobody has looked
# at for days. Restarting unconditionally costs at most one tick (the loop
# holds nothing; every tick re-derives the whole board, see orchestrator.sh)
# and buys the guarantee that the code on disk is the code that is running.
# A tick in flight when the kill lands is a separate bash that finishes on
# its own, and whatever it did not reach the next tick re-derives.
#
# The pull is --ff-only and never fatal (see bc_git_pull): the checkout is
# also a human's working tree, so a supervisor running unattended must not
# write merge commits into it, and a pull that cannot fast-forward is a line
# in the reason rather than a reason to leave the team stopped.
#
# Step 4 recreates rather than types into whatever tab it finds, and that is
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
# Exit contract, the orchestrator's: 0 acted, 1 slept, 2 broken. A healthy
# run now always ACTS -- it always ends with a loop it started itself -- so
# unlike every other script here, 1 is not a resting state but the single
# case where a loop was running and the supervisor was told to leave it
# alone (BC_KEEPALIVE_RESTART=0). One line "keepalive <verb> <details>" goes
# to stdout, to $BC_KEEPALIVE_REASON and to $BC_KEEPALIVE_LOG -- the Task
# Scheduler keeps no output of its own, so the log is the only place a 3am
# run leaves a trace.
set -u
_BC_KA_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_KA_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/orca.sh
. "$_BC_KA_DIR/lib/orca.sh"
# shellcheck source=lib/proc.sh
. "$_BC_KA_DIR/lib/proc.sh"
# shellcheck source=lib/git.sh
. "$_BC_KA_DIR/lib/git.sh"

: "${BC_KEEPALIVE_WORKTREE:=$BC_MAIN_CHECKOUT}"
: "${BC_KEEPALIVE_TITLE:=bc-orchestrator}"
: "${BC_LOOP_SCRIPT:=$_BC_KA_DIR/run-orchestrator.sh}"
: "${BC_ORCA_READY_TIMEOUT_S:=180}"
: "${BC_LOOP_START_TIMEOUT_S:=60}"
: "${BC_LOOP_STOP_TIMEOUT_S:=30}"
: "${BC_KEEPALIVE_PULL:=1}"
: "${BC_KEEPALIVE_RESTART:=1}"
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

# _wait_for_loop_gone -- the mirror: 0 gone, 1 still there at the deadline,
# 2 could not tell. Stop-Process returns before the process has actually
# left the table, and the terminal Orca is about to create must not race a
# loop that is still shutting down -- two loops ticking the same board
# dispatch everything twice.
_wait_for_loop_gone() {
  local deadline rc
  deadline=$(( $(date "+%s") + BC_LOOP_STOP_TIMEOUT_S ))
  while :; do
    _loop_alive; rc=$?
    [ "$rc" -eq 1 ] && return 0
    [ "$rc" -eq 2 ] && return 2
    [ "$(date "+%s")" -lt "$deadline" ] || return 1
    sleep "$BC_POLL_INTERVAL_S"
  done
}

# The whole run lives in one function, called on the last line, for a reason
# that applies to no other script here: step 1 pulls the very checkout this
# file was read from. Bash reads a script lazily, remembering a byte offset,
# so a file that changes length underneath a running top-level body resumes
# in the middle of some other line -- a supervisor that garbles itself the
# first time a colleague pushes. A function body is parsed in full before
# any of it runs, and the libraries above are sourced before the pull; so by
# the time git touches the working tree, every line still to execute is
# already in memory.
main() {
  # --- what we are supervising, in both path forms --------------------------
  # The loop script is named to PowerShell in Windows form and tested for
  # existence in bash form; the needle we hunt in the process table is its
  # bare name, so a loop somebody started by hand from a bash prompt counts
  # as running too. Two loops ticking the same board would dispatch
  # everything twice, and this is what makes that impossible to cause by
  # accident.
  LOOP_POSIX="$(winpath "$BC_LOOP_SCRIPT")"
  LOOP_WIN="$(posix2win "$BC_LOOP_SCRIPT")"
  LOOP_NEEDLE="$(basename "$BC_LOOP_SCRIPT")"
  [ -f "$LOOP_POSIX" ] || finish 2 "keepalive broken loop script not found: $BC_LOOP_SCRIPT"

  # --- 1. the pull ----------------------------------------------------------
  # First, and ahead of Orca: it is the cheapest step, it needs nothing else
  # to be up, and everything after it exists to put the code it just fetched
  # to work. Never fatal -- see the header.
  PULL_STATE=skipped
  if [ "$BC_KEEPALIVE_PULL" != "0" ]; then
    if bc_git_pull "$BC_KEEPALIVE_WORKTREE"; then
      PULL_STATE=ok
    else
      PULL_STATE=failed
      echo "keepalive: git pull failed in $BC_KEEPALIVE_WORKTREE; starting the loop on the code that is there" >&2
    fi
  fi

  # --- 2. Orca --------------------------------------------------------------
  ORCA_STATE=ready
  if ! orca_ready; then
    echo "keepalive: orca is not reachable, opening it" >&2
    # The deadline is taken before the launch, not after it: `orca open`
    # blocks for up to this long by itself, so starting the clock on its
    # return would make a wedged launch cost two budgets and outlive the run
    # limit the scheduled task is given.
    ORCA_DEADLINE=$(( $(date "+%s") + BC_ORCA_READY_TIMEOUT_S ))
    orca_open "$BC_ORCA_READY_TIMEOUT_S"
    until orca_ready; do
      [ "$(date "+%s")" -lt "$ORCA_DEADLINE" ] || \
        finish 2 "keepalive broken orca runtime not reachable after ${BC_ORCA_READY_TIMEOUT_S}s"
      sleep "$BC_POLL_INTERVAL_S"
    done
    ORCA_STATE=opened
  fi

  # --- 3. stop the loop that is already running -----------------------------
  # An unreadable process table is still broken rather than "nothing is
  # running": starting a loop beside one we merely failed to see is the
  # duplicate-dispatch failure, and it is worse than a run that does nothing
  # and says so. The same reasoning governs the two ways the stop can fail --
  # a kill that cannot report, and a loop still in the table when the
  # deadline passes -- so neither goes on to create a terminal.
  RESTARTED=no
  _loop_alive
  case $? in
    2) finish 2 "keepalive broken cannot read the process table" ;;
    0)
      if [ "$BC_KEEPALIVE_RESTART" = "0" ]; then
        finish 1 "keepalive sleep loop already running for $BC_KEEPALIVE_WORKTREE orca=$ORCA_STATE pull=$PULL_STATE"
      fi
      bc_proc_kill bash.exe "$LOOP_NEEDLE"; kill_rc=$?
      [ "$kill_rc" -eq 2 ] && \
        finish 2 "keepalive broken could not stop the running loop for $BC_KEEPALIVE_WORKTREE"
      _wait_for_loop_gone
      case $? in
        1) finish 2 "keepalive broken the running loop was still there ${BC_LOOP_STOP_TIMEOUT_S}s after being stopped" ;;
        2) finish 2 "keepalive broken cannot read the process table" ;;
      esac
      RESTARTED=yes
      ;;
  esac

  # --- 4. close what is stale, create the terminal, confirm the loop --------
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
    0) finish 0 "keepalive started loop in $BC_KEEPALIVE_WORKTREE terminal=$HANDLE closed=$CLOSED unclosed=$UNCLOSED orca=$ORCA_STATE pull=$PULL_STATE restarted=$RESTARTED" ;;
    2) finish 2 "keepalive broken cannot read the process table" ;;
    *) finish 2 "keepalive broken loop did not appear within ${BC_LOOP_START_TIMEOUT_S}s in terminal=$HANDLE" ;;
  esac
}

main "$@"; exit "$?"
