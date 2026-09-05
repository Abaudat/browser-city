#!/usr/bin/env bash
# LEVEL 1 -- the one process-table query. Wraps a single PowerShell
# `Get-CimInstance Win32_Process` call and nothing else, and is fake-aware
# via fake.sh like every other primitive.
#
# It exists because "is the orchestrator loop already running?" is the one
# fact keepalive.sh needs that neither GitHub nor Orca can answer. Orca knows
# a terminal exists; it does not know whether the thing we started in it is
# still alive, and `lastOutputAt` cannot tell a loop sleeping out its ten
# minutes from a shell sitting at a prompt. The process table can, and it is
# a re-derivation rather than a remembered pid file -- nothing to go stale,
# nothing to be wrong about after a reboot.

_BC_PROC_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_PROC_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_PROC_LIB_DIR/fake.sh"

# bc_proc_running <exe> <script> -- is there a live <exe> whose command line
# ENDS in <script>? Exit 0 running, 1 not running, 2 could not tell.
#
# Ends-in, not contains: a smoke test of the substring version reported the
# loop as running because the shell that had just written the script's name
# in a heredoc still had it in its own command line. Anything that merely
# mentions a script -- a grep, an editor, this repo's own tooling -- would
# have counted, and the supervisor would have skipped starting a loop that
# was not there. A process whose command line ends in the path is running it.
# Trailing quotes are trimmed first, because PowerShell re-quotes an argument
# containing spaces on its way into the command line, and the comparison is
# case-insensitive, because Windows paths are.
#
# The third exit code is the point of the other two: a query that fails must
# not read as "not running", or a broken query would restart a loop that is
# already up on every wake, forever. In BC_FAKE mode the fixture is
# `proc_running.json` (or a consumable `proc_running.seq`) holding a bare
# count; no fixture at all is "could not tell", never "nothing running", for
# the same reason the budget gate treats a missing rate-monitor fixture as
# broken.
#
# Needle and executable travel as environment variables rather than inside
# the -Command string: it keeps the PowerShell one-liner free of quotes bash
# would have to escape, which is the usual way this kind of call acquires a
# silent syntax error that reads as "no matching process".
bc_proc_running() { # <exe> <script>
  local exe="$1" script="$2" ps count
  [ -n "$exe" ] && [ -n "$script" ] || { echo "proc: exe and script are both required" >&2; return 2; }
  if [ -n "${BC_FAKE:-}" ]; then
    count="$(bc_fake_read proc_running)" || { echo "proc: no proc_running fixture" >&2; return 2; }
  else
    ps="$(resolve_powershell)" || { echo "proc: powershell not found" >&2; return 2; }
    count="$(BC_PROC_EXE="$exe" BC_PROC_NEEDLE="$script" "$ps" -NoProfile -NonInteractive -Command \
      '$x=$env:BC_PROC_EXE.ToLower(); $n=$env:BC_PROC_NEEDLE.ToLower(); @(Get-CimInstance Win32_Process | Where-Object { $_.Name -and $_.Name.ToLower() -eq $x -and $_.CommandLine -and $_.CommandLine.ToLower().TrimEnd([char]32,[char]34,[char]39).EndsWith($n) }).Count' \
      2>/dev/null)"
  fi
  count="$(printf '%s' "$count" | tr -d '[:space:]')"
  case "$count" in
    ''|*[!0-9]*) echo "proc: unreadable process count: '${count}'" >&2; return 2 ;;
    0)           return 1 ;;
    *)           return 0 ;;
  esac
}
