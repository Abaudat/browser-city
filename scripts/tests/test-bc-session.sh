#!/usr/bin/env bash
# Fixture-driven coverage for scripts/bc-session.sh: every terminal shape
# `state` must classify, the reconcile behaviour of `ensure` (create with
# --session-id vs --resume, nothing logged when already alive), `send`/`stop`
# handle resolution and absence, `stop-all` issue-scoping, and `worktree`'s
# find-or-create. Runs bc-session.sh as a real subprocess (not sourced) so
# the dispatcher and exit codes get exercised exactly as a caller sees them.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SESSION="$TEST_DIR/../bc-session.sh"
. "$TEST_DIR/harness.sh"
. "$TEST_DIR/../lib/config.sh"
bc_init

bcs() { bash "$SESSION" "$@"; }
with_fake()      { local d="$1"; shift; BC_FAKE="$d" "$@"; }
with_fake_now()  { local d="$1" n="$2"; shift 2; BC_FAKE="$d" BC_NOW="$n" "$@"; }
with_fake_home() { local d="$1" h="$2"; shift 2; BC_FAKE="$d" BC_CLAUDE_HOME="$h" "$@"; }
with_main_mode() { local m="$1"; shift; BC_SESSION_MODE=main BC_MAIN_CHECKOUT="$m" "$@"; }

# Plain-substring / pattern lookups against a calls.log, factored out so the
# check(...) lines below never need nested-quoting bash -c gymnastics.
_calls_has()            { grep -Fq -- "$2" "$1"; }               # <log> <substring>
_calls_lacks()           { ! grep -Fq -- "$2" "$1"; }             # <log> <substring>
_calls_count_matching()  { grep -cE -- "$2" "$1"; }               # <log> <ere>
_looks_like_uuid()       { printf '%s' "$1" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; }

# --- shared clock for the booting/lastOutputAt fallback cases ---------------
NOW_ISO="2026-09-02T12:00:00Z"
NOW_S="$(date -d "$NOW_ISO" "+%s")"
NOW_MS=$((NOW_S * 1000))
RECENT_MS=$((NOW_MS - 5000))    # 5s ago: well inside the default 300000ms idle window
STALE_MS=$((NOW_MS - 400000))   # 400s ago: outside it

# =============================================================================
echo "state: every terminal shape in one worktree fixture"
# =============================================================================
F1="$(fake_dir)"
cat > "$F1/orca_terminals.WT3.json" <<EOF
[
  {"handle":"term_idle",    "title":"✳ bc-tim #3 (aaaa1111)", "agentIdentity":"claude", "connected":true,  "orphaned":false, "lastOutputAt":$NOW_MS},
  {"handle":"term_work",    "title":"◑ bc-tim #3 (bbbb2222)", "agentIdentity":"claude", "connected":true,  "orphaned":false, "lastOutputAt":$NOW_MS},
  {"handle":"term_bootrec", "title":"bc-tim #3 (cccc3333)",   "agentIdentity":"claude", "connected":true,  "orphaned":false, "lastOutputAt":$RECENT_MS},
  {"handle":"term_bootold", "title":"bc-tim #3 (77778888)",   "agentIdentity":"claude", "connected":true,  "orphaned":false, "lastOutputAt":$STALE_MS},
  {"handle":"term_disc",    "title":"✳ bc-tim #3 (dddd4444)", "agentIdentity":"claude", "connected":false, "orphaned":false, "lastOutputAt":$NOW_MS},
  {"handle":"term_orph",    "title":"✳ bc-tim #3 (eeee5555)", "agentIdentity":"claude", "connected":true,  "orphaned":true,  "lastOutputAt":$NOW_MS},
  {"handle":"term_shell",   "title":"bc-tim #3 (ffff6666)",   "agentIdentity":"pwsh",   "connected":true,  "orphaned":false, "lastOutputAt":$NOW_MS},
  {"handle":"term_other",   "title":"✳ bc-derek #9 (11112222)","agentIdentity":"claude","connected":true,  "orphaned":false, "lastOutputAt":$NOW_MS}
]
EOF

check_out "idle glyph -> idle, exit 1"                 1 idle    with_fake_now "$F1" "$NOW_ISO" bcs state aaaa1111-0000-0000-0000-000000000000 WT3
check_out "spinner glyph -> working, exit 0"           0 working with_fake_now "$F1" "$NOW_ISO" bcs state bbbb2222-0000-0000-0000-000000000000 WT3
check_out "no glyph, recent lastOutputAt -> working"   0 working with_fake_now "$F1" "$NOW_ISO" bcs state cccc3333-0000-0000-0000-000000000000 WT3
check_out "no glyph, stale lastOutputAt -> idle"       1 idle    with_fake_now "$F1" "$NOW_ISO" bcs state 77778888-0000-0000-0000-000000000000 WT3
check_out "connected:false -> absent, exit 2"          2 absent  with_fake_now "$F1" "$NOW_ISO" bcs state dddd4444-0000-0000-0000-000000000000 WT3
check_out "orphaned:true -> absent, exit 2"            2 absent  with_fake_now "$F1" "$NOW_ISO" bcs state eeee5555-0000-0000-0000-000000000000 WT3
check_out "non-claude tab with matching title -> absent" 2 absent with_fake_now "$F1" "$NOW_ISO" bcs state ffff6666-0000-0000-0000-000000000000 WT3
check_out "no matching title at all -> absent"         2 absent  with_fake_now "$F1" "$NOW_ISO" bcs state 00000000-0000-0000-0000-000000000000 WT3
check_out "a different issue's tab does not confuse this uuid's lookup" 0 working with_fake_now "$F1" "$NOW_ISO" bcs state bbbb2222-0000-0000-0000-000000000000 WT3

echo
echo "worktree: fixture path when present, find-or-create when missing, BC_SESSION_MODE=main fallback"
F2="$(fake_dir)"
printf '%s' "C:/Users/granb/orca/workspaces/BrowserCity/issue-5" > "$F2/orca_worktree_path.issue:5.json"
check_out "existing worktree: prints the fixture path" 0 "C:/Users/granb/orca/workspaces/BrowserCity/issue-5" with_fake "$F2" bcs worktree 5
check_out "BC_SESSION_MODE=main skips Orca entirely" 0 "M:/main-checkout" with_main_mode "M:/main-checkout" bcs worktree 5
check "BC_SESSION_MODE=main logs nothing to calls.log" 1 test -f "$F2/calls.log"

check "missing worktree: creates one (exit 0)" 0 with_fake "$F2" bcs worktree 6
check_out "missing worktree: logs the create call" 0 "orca_worktree_create issue-6 6" sed -n '1p' "$F2/calls.log"

echo
echo "spawn: prints a fresh uuid, creates with --session-id, tolerates a wait-idle timeout"
F3="$(fake_dir)"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F3/orca_terminal_wait_idle.json"
UUID_OUT="$(with_fake "$F3" bcs spawn tim 3 WT3)"; RC=$?
check_out "spawn exits 0" 0 0 printf '%s' "$RC"
check "spawn prints something uuid-shaped" 0 _looks_like_uuid "$UUID_OUT"
U8="${UUID_OUT:0:8}"
check "spawn logged the create against the derived name" 0 _calls_has "$F3/calls.log" "orca_terminal_create WT3 bc-tim #3 ($U8)"
check "spawn's create used --session-id with the new uuid" 0 _calls_has "$F3/calls.log" "--session-id $UUID_OUT"
check "spawn never passes --resume" 1 grep -Fq -- '--resume' "$F3/calls.log"

F3B="$(fake_dir)"
echo '{"result":{"wait":{"satisfied":false}}}' > "$F3B/orca_terminal_wait_idle.json"
OUT="$(with_fake "$F3B" bcs spawn tim 3 WT3 2>"$F3B/stderr.txt")"; RC=$?
check_out "a wait-idle timeout is not fatal to spawn" 0 0 printf '%s' "$RC"
check "spawn still printed a uuid despite the timeout" 0 _looks_like_uuid "$OUT"
check "a wait-idle timeout still prints a warning to stderr" 0 grep -qi warning "$F3B/stderr.txt"

echo
echo "ensure: absent -> start (session-id vs resume by transcript), working/idle -> nothing logged"
F4="$(fake_dir)"
echo '[]' > "$F4/orca_terminals.WT3.json"    # nobody home -> absent
echo '{"result":{"wait":{"satisfied":true}}}' > "$F4/orca_terminal_wait_idle.json"
CHOME="$(fake_dir)"
UUID_NEW="11112222-3333-4444-5555-666677778888"
UUID_RESUME="99990000-1111-2222-3333-444455556666"
mkdir -p "$CHOME/.claude/projects/WT3"
: > "$CHOME/.claude/projects/WT3/$UUID_RESUME.jsonl"

check_out "ensure on absent (no transcript) prints started, exit 0" 0 started \
  with_fake_home "$F4" "$CHOME" bcs ensure tim 3 "$UUID_NEW" WT3
check "logged create used --session-id for a session with no transcript" 0 _calls_has "$F4/calls.log" "--session-id $UUID_NEW"
check "that create line did not use --resume" 0 _calls_lacks "$F4/calls.log" "--resume $UUID_NEW"

F4B="$(fake_dir)"
echo '[]' > "$F4B/orca_terminals.WT3.json"
echo '{"result":{"wait":{"satisfied":true}}}' > "$F4B/orca_terminal_wait_idle.json"
check_out "ensure on absent (transcript exists) prints started, exit 0" 0 started \
  with_fake_home "$F4B" "$CHOME" bcs ensure tim 3 "$UUID_RESUME" WT3
check "logged create used --resume for the session with a transcript" 0 _calls_has "$F4B/calls.log" "--resume $UUID_RESUME"

check_out "ensure on a working session prints working, exit 0, logs nothing" 0 working \
  with_fake_now "$F1" "$NOW_ISO" bcs ensure tim 3 bbbb2222-0000-0000-0000-000000000000 WT3
check "no calls.log exists after ensure on a live session" 1 test -f "$F1/calls.log"

check_out "ensure on an idle session prints idle, exit 1, logs nothing" 1 idle \
  with_fake_now "$F1" "$NOW_ISO" bcs ensure tim 3 aaaa1111-0000-0000-0000-000000000000 WT3
check "still no calls.log after ensure on an idle session" 1 test -f "$F1/calls.log"

echo
echo "send: resolves the right handle, exits 2 when absent"
F5="$(fake_dir)"
cp "$F1/orca_terminals.WT3.json" "$F5/orca_terminals.WT3.json"
check "send to a live session exits 0" 0 with_fake_now "$F5" "$NOW_ISO" bcs send bbbb2222-0000-0000-0000-000000000000 WT3 "hello there"
check_out "send logged against the right handle and text" 0 "orca_terminal_send term_work hello there" sed -n '1p' "$F5/calls.log"

F5B="$(fake_dir)"
cp "$F1/orca_terminals.WT3.json" "$F5B/orca_terminals.WT3.json"
check "send to an absent session exits 2" 2 with_fake_now "$F5B" "$NOW_ISO" bcs send 00000000-0000-0000-0000-000000000000 WT3 "hi"
check "send to an absent session logs nothing" 1 test -f "$F5B/calls.log"

echo
echo "stop: closes when present, exits 1 when already absent"
F6="$(fake_dir)"
cp "$F1/orca_terminals.WT3.json" "$F6/orca_terminals.WT3.json"
check "stop on a live session exits 0" 0 with_fake_now "$F6" "$NOW_ISO" bcs stop aaaa1111-0000-0000-0000-000000000000 WT3
check_out "stop logged against the right handle" 0 "orca_terminal_close term_idle" sed -n '1p' "$F6/calls.log"

F6B="$(fake_dir)"
cp "$F1/orca_terminals.WT3.json" "$F6B/orca_terminals.WT3.json"
check "stop on an absent session exits 1" 1 with_fake_now "$F6B" "$NOW_ISO" bcs stop 00000000-0000-0000-0000-000000000000 WT3
check "stop on an absent session logs nothing" 1 test -f "$F6B/calls.log"

echo
echo "stop-all: closes only this issue's claude tabs"
F7="$(fake_dir)"
cat > "$F7/orca_terminals.WT9.json" <<'EOF'
[
  {"handle":"h1","title":"✳ bc-tim #3 (aaaa1111)",  "agentIdentity":"claude","connected":true,"orphaned":false},
  {"handle":"h2","title":"◑ bc-derek #3 (bbbb2222)","agentIdentity":"claude","connected":true,"orphaned":false},
  {"handle":"h3","title":"✳ bc-crew #3 (cccc3333)", "agentIdentity":"claude","connected":true,"orphaned":false},
  {"handle":"h4","title":"✳ bc-tim #9 (dddd4444)",  "agentIdentity":"claude","connected":true,"orphaned":false},
  {"handle":"h5","title":"bc-tim #3 (eeee5555)",     "agentIdentity":"pwsh","connected":true,"orphaned":false}
]
EOF
check_out "stop-all counts only issue 3's claude tabs" 0 3 with_fake "$F7" bcs stop-all 3 WT9
check_out "stop-all closes exactly h1,h2,h3 and no others" 0 3 _calls_count_matching "$F7/calls.log" '^orca_terminal_close h[123]$'
check "stop-all does not touch issue 9's tab" 1 grep -q h4 "$F7/calls.log"
check "stop-all does not touch the non-claude tab" 1 grep -q h5 "$F7/calls.log"

F7B="$(fake_dir)"
echo '[]' > "$F7B/orca_terminals.WT9.json"
check_out "stop-all with nothing to close prints 0, exit 1" 1 0 with_fake "$F7B" bcs stop-all 3 WT9

echo
echo "rm-worktree: passes the issue selector straight through"
F8="$(fake_dir)"
check "rm-worktree exits 0 and logs the selector" 0 with_fake "$F8" bcs rm-worktree 998
check_out "rm-worktree logged the issue: selector" 0 "orca_worktree_rm issue:998" sed -n '1p' "$F8/calls.log"

F8B="$(fake_dir)"
echo 2 > "$F8B/orca_worktree_rm.exit"
check "rm-worktree passes a forced non-zero exit through" 2 with_fake "$F8B" bcs rm-worktree 998

echo
echo "unknown command: usage on stderr, exit 2"
check "unknown command exits 2" 2 bcs bogus-command

summary
