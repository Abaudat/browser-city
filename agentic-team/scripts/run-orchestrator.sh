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
# else, and the loop would go on ticking at 600s with no error to say why.
# bc_init is deliberately NOT called: the tools are orchestrator.sh's to
# resolve and to fail loudly about, once per tick.
set -u
_BC_LOOP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_LOOP_DIR/lib/config.sh"
: "${BC_LOOP_INTERVAL_S:=600}"

echo "run-orchestrator: ticking $_BC_LOOP_DIR/orchestrator.sh every ${BC_LOOP_INTERVAL_S}s"
while true; do
  bash "$_BC_LOOP_DIR/orchestrator.sh"
  code=$?
  printf '%s tick -> exit %s\n' "$(date -u "+%Y-%m-%dT%H:%M:%SZ")" "$code"
  sleep "$BC_LOOP_INTERVAL_S"
done
