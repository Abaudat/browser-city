#!/usr/bin/env bash
# Fixture-driven coverage for scripts/keepalive.sh: the four things it does
# (pull, Orca, stop the old loop, start a new one) and, more importantly,
# every way it is allowed to say "broken" rather than a plausible-looking
# "started". Runs keepalive.sh as a real subprocess so the exit codes and the
# single reason line are exercised exactly as the Task Scheduler sees them.
#
# The polls are what these fixtures are shaped around: `proc_running.seq` and
# `orca_status.seq` (fake.sh's read-side sequence) let one run see "not yet"
# and then "there it is", which a single static fixture cannot express. A
# restart needs all three answers in order -- alive at the gate, gone after
# the kill, up again after the create -- and that is exactly `1 0 1`.
set -u

# keepalive.sh supervises a real Windows Task Scheduler process through Orca
# and a PowerShell/Git-Bash terminal (resolve_git_bash resolves Windows-only
# absolute paths, on purpose -- see lib/paths.sh) -- there is no Linux
# equivalent to fake around, so this whole suite is Windows-only. Declared
# here, loudly, rather than discovered as seven red "git bash not found"
# assertions the day it runs on a CI runner.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "SKIP: test-keepalive.sh requires Windows (keepalive.sh drives a real PowerShell/Git-Bash terminal via Orca)"
    exit 0
    ;;
esac

TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
KEEPALIVE="$TEST_DIR/../keepalive.sh"
. "$TEST_DIR/harness.sh"

READY='{"app":{"running":true},"runtime":{"reachable":true,"state":"ready"}}'
DOWN='{"app":{"running":false},"runtime":{"reachable":false,"state":"stopped"}}'

# ka <fake-dir> [VAR=value...] -- keepalive.sh with the whole environment
# pinned to that fixture directory: no real state dir, no real env file, and
# no waiting (poll interval 0, timeouts 2s unless a case overrides them).
ka() {
  local d="$1"; shift
  env BC_FAKE="$d" \
      BC_STATE_DIR="$d" \
      BC_KEEPALIVE_WORKTREE=WT \
      BC_POLL_INTERVAL_S=0 \
      BC_ORCA_READY_TIMEOUT_S=2 \
      BC_LOOP_START_TIMEOUT_S=2 \
      BC_LOOP_STOP_TIMEOUT_S=2 \
      "$@" bash "$KEEPALIVE"
}

_calls_has()   { grep -Fq -- "$2" "$1"; }
_calls_lacks() { ! grep -Fq -- "$2" "$1"; }
_file_has()    { grep -Fq -- "$2" "$1"; }

# =============================================================================
echo "the loop is already running: it is stopped and a current one started"
# =============================================================================
F1="$(fake_dir)"
printf '%s\n' "$READY" > "$F1/orca_status.json"
printf '1\n0\n1\n' > "$F1/proc_running.seq"   # alive, gone after the kill, up after the create
printf '[]\n' > "$F1/orca_terminals.WT.json"
printf 'term_new' > "$F1/orca_terminal_create.json"
: > "$F1/calls.log"

check_out "already running -> restarted, exit 0" 0 \
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=ready pull=ok restarted=yes" ka "$F1"
check "the worktree is pulled"        0 _calls_has "$F1/calls.log" "git_pull WT"
check "the old loop is killed by name" 0 _calls_has "$F1/calls.log" "proc_kill bash.exe run-orchestrator.sh"
check "a fresh terminal is created"   0 _calls_has "$F1/calls.log" orca_terminal_create
check "the reason file carries the same line" 0 _file_has "$F1/keepalive-reason.txt" "keepalive started"
check "the log carries the same line"         0 _file_has "$F1/keepalive.log" "keepalive started"

# The pull is the first thing that happens, before Orca is even asked about:
# it needs nothing else to be up, and everything after it exists to run the
# code it just fetched.
check "the pull precedes everything else" 0 \
  bash -c 'head -1 "$1" | grep -Fq "git_pull"' _ "$F1/calls.log"

# =============================================================================
echo "the loop is gone: a Git Bash terminal is created and the loop confirmed"
# =============================================================================
F2="$(fake_dir)"
printf '%s\n' "$READY" > "$F2/orca_status.json"
printf '0\n1\n' > "$F2/proc_running.seq"   # gone at the gate, up after the create
printf '[]\n' > "$F2/orca_terminals.WT.json"
printf 'term_new' > "$F2/orca_terminal_create.json"
: > "$F2/calls.log"

check_out "started -> acted, exit 0" 0 \
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=ready pull=ok restarted=no" ka "$F2"
check "nothing is killed when nothing is running" 0 _calls_lacks "$F2/calls.log" proc_kill
check "the terminal is created in the worktree" 0 _calls_has "$F2/calls.log" "orca_terminal_create WT bc-orchestrator"
# The `; exit` is load-bearing, not cosmetic: without it a dead loop leaves a
# PowerShell tab behind that Orca has renamed out of our reach.
check "it is created as git bash running the loop, and exits with it" 0 \
  grep -Eq "orca_terminal_create WT bc-orchestrator & '.*bash\.exe' -l '.*run-orchestrator\.sh'; exit$" "$F2/calls.log"

# =============================================================================
echo "a pull that cannot fast-forward is reported, not fatal"
# =============================================================================
F2b="$(fake_dir)"
printf '%s\n' "$READY" > "$F2b/orca_status.json"
printf '0\n1\n' > "$F2b/proc_running.seq"
printf '[]\n' > "$F2b/orca_terminals.WT.json"
printf 'term_new' > "$F2b/orca_terminal_create.json"
printf '1\n' > "$F2b/git_pull.rc"
: > "$F2b/calls.log"

check_out "a failed pull still starts the loop" 0 \
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=ready pull=failed restarted=no" \
  ka "$F2b"

F2c="$(fake_dir)"
printf '%s\n' "$READY" > "$F2c/orca_status.json"
printf '0\n1\n' > "$F2c/proc_running.seq"
printf '[]\n' > "$F2c/orca_terminals.WT.json"
printf 'term_new' > "$F2c/orca_terminal_create.json"
: > "$F2c/calls.log"

check_out "BC_KEEPALIVE_PULL=0 -> pull=skipped" 0 \
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=ready pull=skipped restarted=no" \
  ka "$F2c" BC_KEEPALIVE_PULL=0
check "no pull is attempted when it is switched off" 0 _calls_lacks "$F2c/calls.log" git_pull

# =============================================================================
echo "a stale tab wearing our title is closed first; a Claude tab is not"
# =============================================================================
F3="$(fake_dir)"
printf '%s\n' "$READY" > "$F3/orca_status.json"
printf '0\n1\n' > "$F3/proc_running.seq"
cat > "$F3/orca_terminals.WT.json" <<'EOF'
[
  {"handle":"term_stale",  "title":"bc-orchestrator", "connected":true, "orphaned":false},
  {"handle":"term_claude", "title":"bc-orchestrator", "agentIdentity":"claude", "connected":true, "orphaned":false},
  {"handle":"term_other",  "title":"✳ bc-tim #3 (aaaa1111)", "agentIdentity":"claude", "connected":true, "orphaned":false}
]
EOF
printf 'term_new' > "$F3/orca_terminal_create.json"
: > "$F3/calls.log"

check_out "stale closed, loop started" 0 \
  "keepalive started loop in WT terminal=term_new closed=1 unclosed=0 orca=ready pull=ok restarted=no" ka "$F3"
check "the stale tab is closed"            0 _calls_has   "$F3/calls.log" "orca_terminal_close term_stale"
check "a Claude tab keeps its title alone" 0 _calls_lacks "$F3/calls.log" "orca_terminal_close term_claude"
check "an unrelated tab is left alone"     0 _calls_lacks "$F3/calls.log" "orca_terminal_close term_other"

# =============================================================================
echo "orca is down: it is opened, then the loop is restarted through it"
# =============================================================================
F4="$(fake_dir)"
printf '%s\n%s\n' "$DOWN" "$READY" > "$F4/orca_status.seq"
printf '1\n0\n1\n' > "$F4/proc_running.seq"
printf '[]\n' > "$F4/orca_terminals.WT.json"
printf 'term_new' > "$F4/orca_terminal_create.json"
: > "$F4/calls.log"

check_out "opened, then the loop was restarted" 0 \
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=opened pull=ok restarted=yes" ka "$F4"
check "orca open is called with the ready timeout" 0 _calls_has "$F4/calls.log" "orca_open 2"

# =============================================================================
echo "the opt-out: a loop left alone is the only way this run sleeps"
# =============================================================================
F4b="$(fake_dir)"
printf '%s\n' "$READY" > "$F4b/orca_status.json"
printf '1\n' > "$F4b/proc_running.json"
: > "$F4b/calls.log"

check_out "BC_KEEPALIVE_RESTART=0 -> sleep, exit 1" 1 \
  "keepalive sleep loop already running for WT orca=ready pull=ok" ka "$F4b" BC_KEEPALIVE_RESTART=0
check "nothing is killed"          0 _calls_lacks "$F4b/calls.log" proc_kill
check "no terminal is created"     0 _calls_lacks "$F4b/calls.log" orca_terminal_create
check "the pull still happened"    0 _calls_has   "$F4b/calls.log" "git_pull WT"

# =============================================================================
echo "the ways this is broken rather than idle"
# =============================================================================
F5="$(fake_dir)"                              # no orca_status fixture at all
printf '1\n' > "$F5/proc_running.json"
check_out "orca never becomes reachable -> broken" 2 \
  "keepalive broken orca runtime not reachable after 0s" ka "$F5" BC_ORCA_READY_TIMEOUT_S=0

F6="$(fake_dir)"                              # no proc_running fixture at all
printf '%s\n' "$READY" > "$F6/orca_status.json"
check_out "an unreadable process table -> broken, never 'not running'" 2 \
  "keepalive broken cannot read the process table" ka "$F6"

# A kill that cannot say whether it worked must not read as "nothing was
# there": a second loop started beside a first one that never died would
# dispatch every wake twice.
F6b="$(fake_dir)"
printf '%s\n' "$READY" > "$F6b/orca_status.json"
printf '1\n' > "$F6b/proc_running.json"
printf 'not-a-count\n' > "$F6b/proc_killed.json"
: > "$F6b/calls.log"
check_out "a kill that cannot report -> broken, not 'started'" 2 \
  "keepalive broken could not stop the running loop for WT" ka "$F6b"
check "no terminal is created after a kill that cannot report" 0 \
  _calls_lacks "$F6b/calls.log" orca_terminal_create

F6c="$(fake_dir)"
printf '%s\n' "$READY" > "$F6c/orca_status.json"
printf '1\n' > "$F6c/proc_running.json"       # still there, kill or no kill
printf '[]\n' > "$F6c/orca_terminals.WT.json"
printf 'term_new' > "$F6c/orca_terminal_create.json"
: > "$F6c/calls.log"
check_out "a loop that will not die -> broken, not a second loop" 2 \
  "keepalive broken the running loop was still there 0s after being stopped" \
  ka "$F6c" BC_LOOP_STOP_TIMEOUT_S=0
check "no terminal is created beside the surviving loop" 0 \
  _calls_lacks "$F6c/calls.log" orca_terminal_create

F7="$(fake_dir)"
printf '%s\n' "$READY" > "$F7/orca_status.json"
printf '0\n' > "$F7/proc_running.json"        # never comes up
printf '[]\n' > "$F7/orca_terminals.WT.json"
printf 'term_new' > "$F7/orca_terminal_create.json"
check_out "a terminal that never runs the loop -> broken, not 'started'" 2 \
  "keepalive broken loop did not appear within 0s in terminal=term_new" ka "$F7" BC_LOOP_START_TIMEOUT_S=0

F8="$(fake_dir)"
printf '%s\n' "$READY" > "$F8/orca_status.json"
printf '0\n' > "$F8/proc_running.json"
printf '[]\n' > "$F8/orca_terminals.WT.json"
printf 'null' > "$F8/orca_terminal_create.json"   # ok:true, no handle in it
check_out "a terminal created with no handle -> broken, not terminal=null" 2 \
  "keepalive broken terminal created but orca named no handle" ka "$F8"

F9="$(fake_dir)"
printf '%s\n' "$READY" > "$F9/orca_status.json"
printf '0\n' > "$F9/proc_running.json"
: > "$F9/calls.log"
check_out "a loop script that is not there -> broken before anything is touched" 2 \
  "keepalive broken loop script not found: /nope/run-orchestrator.sh" \
  ka "$F9" BC_LOOP_SCRIPT=/nope/run-orchestrator.sh
check "not even the pull runs without a loop to supervise" 0 \
  _calls_lacks "$F9/calls.log" git_pull

summary
