#!/usr/bin/env bash
# Exit-coverage test for quota-gate.sh, driven by fixtures.
#
# The gate's three exits are the point of it, and two of them are indistinguish-
# able from the outside: a spent budget and a broken gate both stop the team.
# So every case below asserts the reason line as well as the exit code.
GATE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/quota-gate.sh"
D="${TMPDIR:-/tmp}/bc-gate-fix"; rm -rf "$D"; mkdir -p "$D"
pass=0; fail=0

# Reset epochs: 2026-08-30T21:00:00Z and 2026-09-04T09:00:00Z.
rate() { # $1 overallStatus, $2 session util, $3 weekly util
  printf '{"overallStatus":"%s","session":{"utilization":%s,"reset":"1788123600","status":"%s"},"weekly":{"utilization":%s,"reset":"1788512400","status":"%s"},"overageStatus":"rejected"}\n' \
    "$1" "$2" "$1" "$3" "$1"
}

rate allowed  0.23 0.38 > "$D/plenty.json"
rate allowed  0.00 0.00 > "$D/zero.json"
rate allowed  0.85 0.10 > "$D/session-at-cap.json"
rate allowed  0.86 0.10 > "$D/session-over.json"
rate allowed  0.10 0.80 > "$D/weekly-at-cap.json"
rate rejected 0.10 0.10 > "$D/rejected.json"
echo 'not json at all'                                    > "$D/garbage.json"
echo '{"overallStatus":"allowed","weekly":{"utilization":0.1}}' > "$D/no-session.json"
echo '{"overallStatus":"allowed","session":{"utilization":"lots"},"weekly":{"utilization":0.1}}' > "$D/nan.json"

check() { # name, want_exit, want_reason_prefix, fixture, extra env assignments...
  local name="$1" want_code="$2" want="$3" fixture="$4"; shift 4
  local reason="$D/reason" code got
  rm -f "$reason"
  env BC_QUOTA_REASON="$reason" BC_RATE_JSON_FIXTURE="$fixture" "$@" bash "$GATE" >/dev/null 2>&1
  code=$?
  got="$(cut -d' ' -f2- < "$reason" 2>/dev/null)"
  if [ "$code" = "$want_code" ] && case "$got" in $want*) true ;; *) false ;; esac; then
    printf '  ok   %-32s -> exit %s  %s\n' "$name" "$code" "$got"; pass=$((pass+1))
  else
    printf '  FAIL %-32s -> exit %s (want %s)\n       reason: %s\n       want:   %s...\n' \
      "$name" "$code" "$want_code" "${got:-<no reason written>}" "$want"; fail=$((fail+1))
  fi
}

echo "exit 0 - there is budget:"
check "well under both caps"      0 "RUN"         "$D/plenty.json"
check "a genuine zero is not null" 0 "RUN"        "$D/zero.json"

echo "exit 1 - the budget is spent, quietly, and says when it comes back:"
check "session at the cap"        1 "SKIP-BUDGET session=0.85" "$D/session-at-cap.json"
check "session over the cap"      1 "SKIP-BUDGET session=0.86" "$D/session-over.json"
check "weekly at the cap"         1 "SKIP-BUDGET weekly=0.80"  "$D/weekly-at-cap.json"
check "status not allowed"        1 "SKIP-BUDGET status=rejected" "$D/rejected.json"
check "caps are overridable"      1 "SKIP-BUDGET session=0.23" "$D/plenty.json" BC_SESSION_CAP=0.20

echo "exit 2 - the gate is broken, which is not the same thing:"
check "unparseable response"      2 "GATE-BROKEN unparseable"  "$D/garbage.json"
check "no session utilisation"    2 "GATE-BROKEN rate monitor response missing" "$D/no-session.json"
check "utilisation is not a number" 2 "GATE-BROKEN session utilisation is not a number" "$D/nan.json"
check "fixture unreadable"        2 "GATE-BROKEN rate fixture unreadable" "$D/absent.json"
check "jq missing"                2 "GATE-BROKEN jq not found" "$D/plenty.json" BC_JQ="$D/no-jq"

# The rate monitor is only resolved when there is no fixture, so this case runs
# without one and must still fail broken rather than skip.
rm -f "$D/reason"
env BC_QUOTA_REASON="$D/reason" BC_RATE_MONITOR="$D/no-monitor" bash "$GATE" >/dev/null 2>&1
code=$?; got="$(cut -d' ' -f2- < "$D/reason" 2>/dev/null)"
if [ "$code" = 2 ] && case "$got" in "GATE-BROKEN claude-rate-monitor not found"*) true ;; *) false ;; esac; then
  printf '  ok   %-32s -> exit %s  %s\n' "rate monitor missing" "$code" "$got"; pass=$((pass+1))
else
  printf '  FAIL %-32s -> exit %s reason: %s\n' "rate monitor missing" "$code" "${got:-<none>}"; fail=$((fail+1))
fi

echo "the gate is not tied to one worktree:"
# Copied somewhere else entirely, it must still run and must write its reason
# beside its own worktree rather than beside the one it was authored in.
FAKE="$D/elsewhere/some-other-worktree"
mkdir -p "$FAKE"
cp -r "$(dirname -- "$GATE")" "$FAKE/scripts"
( cd / && env -u BC_QUOTA_REASON BC_STATE_DIR="$D/state" BC_RATE_JSON_FIXTURE="$D/plenty.json" \
    bash "$FAKE/scripts/quota-gate.sh" >/dev/null 2>&1 )
code=$?
# Nothing beside the worktree: that rule is what scattered the file across
# D:/Projects once the automation ran outside the authoring worktree.
if [ "$code" = 0 ] && [ ! -f "$D/elsewhere/.quota-gate-reason" ]; then
  printf '  ok   %-32s -> exit %s, and wrote nothing beside itself\n' "runs from a copied worktree" "$code"
  pass=$((pass+1))
else
  printf '  FAIL %-32s -> exit %s, stray file beside the worktree\n' "runs from a copied worktree" "$code"
  fail=$((fail+1))
fi

echo "the reason file has one home, whatever worktree ran:"
# The obvious rule -- beside the worktree -- puts it under .../BrowserCity/ for
# an Orca workspace and in D:/Projects/ for the main checkout, so a watchdog
# has no fixed path to watch. It derives from the user instead.
STATE="$D/state"
( env -u BC_QUOTA_REASON BC_STATE_DIR="$STATE" BC_RATE_JSON_FIXTURE="$D/plenty.json"     bash "$FAKE/scripts/quota-gate.sh" >/dev/null 2>&1 )
codeA=$?
( cd / && env -u BC_QUOTA_REASON BC_STATE_DIR="$STATE" BC_RATE_JSON_FIXTURE="$D/plenty.json"     bash "$GATE" >/dev/null 2>&1 )
codeB=$?
if [ "$codeA" = 0 ] && [ "$codeB" = 0 ] && [ -f "$STATE/quota-gate-reason" ]; then
  printf '  ok   %-32s -> both worktrees wrote %s
' "two worktrees, one reason file" "\$BC_STATE_DIR/quota-gate-reason"
  pass=$((pass+1))
else
  printf '  FAIL %-32s -> exits %s/%s, no file at %s
' "two worktrees, one reason file" "$codeA" "$codeB" "$STATE/quota-gate-reason"
  fail=$((fail+1))
fi

# The shared library is a hard dependency, and a missing one must be loud.
rm -f "$D/reason"; rm -f "$FAKE/scripts/lib/paths.sh"
env BC_QUOTA_REASON="$D/reason" BC_RATE_JSON_FIXTURE="$D/plenty.json"     bash "$FAKE/scripts/quota-gate.sh" >/dev/null 2>&1
code=$?; got="$(cut -d' ' -f2- < "$D/reason" 2>/dev/null)"
if [ "$code" = 2 ] && case "$got" in "GATE-BROKEN lib/paths.sh missing"*) true ;; *) false ;; esac; then
  printf '  ok   %-32s -> exit %s  %s
' "library missing is exit 2, not 1" "$code" "$got"; pass=$((pass+1))
else
  printf '  FAIL %-32s -> exit %s reason: %s
' "library missing is exit 2, not 1" "$code" "${got:-<none>}"; fail=$((fail+1))
fi

rm -rf "$D"
echo; echo "passed $pass, failed $fail"; [ "$fail" -eq 0 ]
