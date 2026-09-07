#!/usr/bin/env bash
# OFF THE WAKE -- the loop. orchestrator.sh, forever, BC_LOOP_INTERVAL_S
# apart. This is what keepalive.sh starts in an Orca Git Bash terminal and
# what it looks for in the process table to decide whether the team is
# already running.
#
# It holds nothing and decides nothing: every tick re-derives the whole board
# (see orchestrator.sh), so killing this loop costs at most one interval and
# a reboot that loses it loses no work. Its cwd is deliberately not assumed
# -- keepalive.sh names it by absolute path from a PowerShell terminal, so
# `./scripts/orchestrator.sh` would resolve against whatever directory Orca
# opened the tab in.
#
# It sources lib/config.sh for one reason: config.sh is what reads
# $BC_ENV_FILE, and that file is the project's only channel to a process that
# inherits nothing. Orca creates this terminal, so the loop inherits Orca's
# environment, not the supervisor's -- without this line BC_LOOP_INTERVAL_S
# could be set in ~/.browsercity/env.sh, on the scheduled task, or anywhere
# else, and the loop would go on ticking at its default with no error to say
# why. bc_init is deliberately NOT called: the tools are orchestrator.sh's to
# resolve and to fail loudly about, once per tick.
#
# Everything the loop and its ticks print is teed to $BC_ORCHESTRATOR_LOG.
# The terminal keeps showing it live, but the terminal is the only place it
# used to exist: Orca's scrollback dies with the tab, so a tick that failed
# overnight left nothing to read in the morning. The board is still the
# durable record of what the team DECIDED -- this file is the record of what
# the loop DID, including the ticks that crashed before writing anything.
# It is appended to and never rotated: it grows slowly (a handful of lines
# per tick), and a log the supervisor trims is a log that has thrown away the
# evening you wanted.
set -u
_BC_LOOP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_LOOP_DIR/lib/config.sh"
: "${BC_LOOP_INTERVAL_S:=180}"
: "${BC_ORCHESTRATOR_LOG:=$(bc_state_dir)/orchestrator.log}"

# The tee wraps the whole loop rather than each tick so that stderr from the
# loop itself lands in the file too, and so the file holds one continuous
# stream instead of one interleaving per tick. bash.exe's command line is
# unchanged by the pipe, so keepalive.sh still finds this process.
{
  printf '%s run-orchestrator: ticking %s every %ss\n' \
    "$(date -u "+%Y-%m-%dT%H:%M:%SZ")" "$_BC_LOOP_DIR/orchestrator.sh" "$BC_LOOP_INTERVAL_S"
  while true; do
    bash "$_BC_LOOP_DIR/orchestrator.sh"
    code=$?
    printf '%s tick -> exit %s\n' "$(date -u "+%Y-%m-%dT%H:%M:%SZ")" "$code"
    sleep "$BC_LOOP_INTERVAL_S"
  done
} 2>&1 | tee -a "$BC_ORCHESTRATOR_LOG"
