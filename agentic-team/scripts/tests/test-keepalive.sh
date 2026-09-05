#!/usr/bin/env bash
# Fixture-driven coverage for scripts/keepalive.sh: the three things it
# supervises (Orca, the terminal, the loop) and, more importantly, every way
# it is allowed to say "broken" rather than a plausible-looking "started".
# Runs keepalive.sh as a real subprocess so the exit codes and the single
# reason line are exercised exactly as the Task Scheduler sees them.
#
# The polls are what these fixtures are shaped around: `proc_running.seq` and
# `orca_status.seq` (fake.sh's read-side sequence) let one run see "not yet"
# and then "there it is", which a single static fixture cannot express.
set -u
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
      "$@" bash "$KEEPALIVE"
}

_calls_has()   { grep -Fq -- "$2" "$1"; }
_calls_lacks() { ! grep -Fq -- "$2" "$1"; }
_file_has()    { grep -Fq -- "$2" "$1"; }

# =============================================================================
echo "the loop is already running: nothing is touched"
# =============================================================================
F1="$(fake_dir)"
printf '%s\n' "$READY" > "$F1/orca_status.json"
printf '1\n' > "$F1/proc_running.json"
: > "$F1/calls.log"

check_out "already running -> sleep, exit 1" 1 \
  "keepalive sleep loop already running for WT orca=ready" ka "$F1"
check "no terminal is created" 0 _calls_lacks "$F1/calls.log" orca_terminal_create
check "no terminal is closed"  0 _calls_lacks "$F1/calls.log" orca_terminal_close
check "orca is not opened"     0 _calls_lacks "$F1/calls.log" orca_open
check "the reason file carries the same line" 0 _file_has "$F1/keepalive-reason.txt" "keepalive sleep"
check "the log carries the same line"         0 _file_has "$F1/keepalive.log" "keepalive sleep"

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
  "keepalive started loop in WT terminal=term_new closed=0 unclosed=0 orca=ready" ka "$F2"
check "the terminal is created in the worktree" 0 _calls_has "$F2/calls.log" "orca_terminal_create WT bc-orchestrator"
# The `; exit` is load-bearing, not cosmetic: without it a dead loop leaves a
# PowerShell tab behind that Orca has renamed out of our reach.
check "it is created as git bash running the loop, and exits with it" 0 \
  grep -Eq "orca_terminal_create WT bc-orchestrator & '.*bash\.exe' -l '.*run-orchestrator\.sh'; exit$" "$F2/calls.log"

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
  "keepalive started loop in WT terminal=term_new closed=1 unclosed=0 orca=ready" ka "$F3"
check "the stale tab is closed"            0 _calls_has   "$F3/calls.log" "orca_terminal_close term_stale"
check "a Claude tab keeps its title alone" 0 _calls_lacks "$F3/calls.log" "orca_terminal_close term_claude"
check "an unrelated tab is left alone"     0 _calls_lacks "$F3/calls.log" "orca_terminal_close term_other"

# =============================================================================
echo "orca is down: it is opened, then the wait is satisfied"
# =============================================================================
F4="$(fake_dir)"
printf '%s\n%s\n' "$DOWN" "$READY" > "$F4/orca_status.seq"
printf '1\n' > "$F4/proc_running.json"
: > "$F4/calls.log"

check_out "opened, then the loop was already up" 1 \
  "keepalive sleep loop already running for WT orca=opened" ka "$F4"
check "orca open is called with the ready timeout" 0 _calls_has "$F4/calls.log" "orca_open 2"

# =============================================================================
echo "the five ways this is broken rather than idle"
# =============================================================================
F5="$(fake_dir)"                              # no orca_status fixture at all
printf '1\n' > "$F5/proc_running.json"
check_out "orca never becomes reachable -> broken" 2 \
  "keepalive broken orca runtime not reachable after 0s" ka "$F5" BC_ORCA_READY_TIMEOUT_S=0

F6="$(fake_dir)"                              # no proc_running fixture at all
printf '%s\n' "$READY" > "$F6/orca_status.json"
check_out "an unreadable process table -> broken, never 'not running'" 2 \
  "keepalive broken cannot read the process table" ka "$F6"

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
check_out "a loop script that is not there -> broken before anything is opened" 2 \
  "keepalive broken loop script not found: /nope/run-orchestrator.sh" \
  ka "$F9" BC_LOOP_SCRIPT=/nope/run-orchestrator.sh

summary
