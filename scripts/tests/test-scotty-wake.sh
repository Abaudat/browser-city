#!/usr/bin/env bash
# Branch-coverage test for scotty-wake.sh, driven by fixtures.
WAKE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scotty-wake.sh"
D="${TMPDIR:-/tmp}/bc-wake-fix"; rm -rf "$D"; mkdir -p "$D"
pass=0; fail=0

SHA1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA2=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

echo '[]' > "$D/no-pr.json"
echo '[]' > "$D/no-issue.json"
printf '[{"number":7,"title":"Story 1.4","headRefOid":"%s"}]\n' "$SHA1" > "$D/pr-sha1.json"
printf '[{"number":7,"title":"Story 1.4","headRefOid":"%s"}]\n' "$SHA2" > "$D/pr-sha2.json"
printf '[{"number":7,"headRefOid":"%s"},{"number":8,"headRefOid":"%s"}]\n' "$SHA1" "$SHA1" > "$D/two-pr.json"
echo '[{"number":3,"title":"Story 1.4"}]' > "$D/one-issue.json"
echo '[{"number":3},{"number":4}]' > "$D/two-issue.json"

status() { printf '{"id":1,"body":"<!-- bc:status -->\\n<!-- bc:story 1.4 -->\\n<!-- bc:scope %s -->\\n<!-- bc:cycle %s -->"}' "$1" "$2"; }
lead()   { printf '{"id":%s,"body":"<!-- bc:lead:%s -->\\nfindings\\n<!-- bc:verdict %s -->\\n<!-- bc:reviewed %s -->\\n<!-- bc:session s1 -->"}' "$RANDOM" "$1" "$2" "$3"; }
stub()   { printf '{"id":%s,"body":"<!-- bc:lead:%s -->\\n_Not yet reviewed._\\n<!-- bc:reviewed - -->\\n<!-- bc:session - -->"}' "$RANDOM" "$1"; }
task()   { printf '{"id":2,"body":"<!-- bc:task -->\\n<!-- bc:story 1.4 -->\\n<!-- bc:scope %s -->"}' "$1"; }
dir()    { printf '{"id":%s,"body":"<!-- bc:lead:%s -->\\ndirection\\n<!-- bc:direction %s -->\\n<!-- bc:session s1 -->"}' "$RANDOM" "$1" "$2"; }

echo '[{"id":9,"body":"Opened by Crew. Consistency gate: pass."}]' > "$D/c0.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin APPROVED $SHA1),$(lead tim APPROVED $SHA1)]" > "$D/approved-sha1.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin CHANGES $SHA1),$(lead tim APPROVED $SHA1)]" > "$D/changes-sha1.json"
echo "[$(status 'quentin,tim' 2),$(stub quentin),$(stub tim)]"                               > "$D/fresh.json"
echo "[$(status 'quentin,tim' 8),$(lead quentin CHANGES $SHA1),$(lead tim APPROVED $SHA1)]" > "$D/cycle8.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin APPROVED $SHA1)]"                            > "$D/pr-missing.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin WAT $SHA1),$(lead tim APPROVED $SHA1)]"      > "$D/pr-badverdict.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin APPROVED -),$(lead tim APPROVED $SHA1)]"     > "$D/pr-orphan.json"
echo "[$(status 'quentin,tim' 2),$(stub quentin),$(lead tim APPROVED $SHA1)]"                > "$D/pr-halfway.json"

echo "[$(task 'quentin,tim'),$(dir quentin READY),$(dir tim READY)]"     > "$D/dirs-ready.json"
echo "[$(task 'quentin,tim'),$(dir quentin PENDING),$(dir tim READY)]"   > "$D/dirs-partial.json"
echo "[$(task 'quentin,tim'),$(dir quentin READY)]"                      > "$D/dirs-missing.json"
echo "[$(task 'quentin,tim'),$(dir quentin NOPE),$(dir tim READY)]"      > "$D/dirs-badstate.json"
echo '[{"id":5,"body":"a stray comment"}]'                               > "$D/no-task-comment.json"

BUSY='{"busy":true,"terminal":"bc-crew","idle_ms":34}'
IDLE='{"busy":false,"terminal":"bc-crew","idle_ms":33585}'

check() { # name, want_branch, want_exit, prs, pr_comments, issues, issue_comments, crew
  local out code got
  # BC_WAKE_REASON keeps the suite out of the real reason file, which the
  # watchdog reads and must not find test runs in.
  out="$(BC_PRS_FIXTURE="$4" BC_COMMENTS_FIXTURE="$5" BC_ISSUES_FIXTURE="$6" \
         BC_ISSUE_COMMENTS_FIXTURE="$7" BC_CREW_OVERRIDE="$8" \
         BC_WAKE_REASON="$D/reason" bash "$WAKE" 2>&1)"
  code=$?
  got="$(printf '%s' "$out" | jq -r '.branch' 2>/dev/null)"
  if [ "$got" = "$2" ] && [ "$code" = "$3" ]; then
    printf '  ok   %-34s -> %-6s exit %s\n' "$1" "$got" "$code"; pass=$((pass+1))
  else
    printf '  FAIL %-34s -> got %s exit %s (want %s exit %s)\n       %s\n' "$1" "$got" "$code" "$2" "$3" "$out"; fail=$((fail+1))
  fi
}

echo "task phase - directions on the issue, before any PR exists:"
check "t.1 no issue, crew idle"        t.1 0 "$D/no-pr.json" "$D/fresh.json" "$D/no-issue.json"  "$D/dirs-ready.json"   "$IDLE"
check "c.3 no issue, crew busy"        c.3 1 "$D/no-pr.json" "$D/fresh.json" "$D/no-issue.json"  "$D/dirs-ready.json"   "$BUSY"
check "t.2 a direction outstanding"    t.2 0 "$D/no-pr.json" "$D/fresh.json" "$D/one-issue.json" "$D/dirs-partial.json" "$IDLE"
check "t.2 fires even while crew busy" t.2 0 "$D/no-pr.json" "$D/fresh.json" "$D/one-issue.json" "$D/dirs-partial.json" "$BUSY"
check "t.3 all directions ready"       t.3 0 "$D/no-pr.json" "$D/fresh.json" "$D/one-issue.json" "$D/dirs-ready.json"   "$IDLE"
check "c.3 directions ready, crew busy" c.3 1 "$D/no-pr.json" "$D/fresh.json" "$D/one-issue.json" "$D/dirs-ready.json"  "$BUSY"

echo "review phase - the head commit decides whose turn it is:"
check "c.0 new PR, no status"          c.0 0 "$D/pr-sha1.json" "$D/c0.json"           "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.4 never reviewed"             c.4 0 "$D/pr-sha1.json" "$D/fresh.json"        "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.4 one reviewed, one stub"     c.4 0 "$D/pr-sha1.json" "$D/pr-halfway.json"   "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.5 changes, nothing new pushed" c.5 0 "$D/pr-sha1.json" "$D/changes-sha1.json" "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.4 crew pushed since CHANGES"  c.4 0 "$D/pr-sha2.json" "$D/changes-sha1.json" "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.1 approved at head"           c.1 0 "$D/pr-sha1.json" "$D/approved-sha1.json" "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.4 crew pushed after APPROVED" c.4 0 "$D/pr-sha2.json" "$D/approved-sha1.json" "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"
check "c.6 breaker at cycle 8"         c.6 0 "$D/pr-sha1.json" "$D/cycle8.json"       "$D/no-issue.json" "$D/dirs-ready.json" "$IDLE"

echo "defects must break loudly, not be guessed:"
check "two story PRs"                  broken 2 "$D/two-pr.json"  "$D/approved-sha1.json" "$D/no-issue.json"  "$D/dirs-ready.json"    "$IDLE"
check "two task issues"                broken 2 "$D/no-pr.json"   "$D/fresh.json"         "$D/two-issue.json" "$D/dirs-ready.json"    "$IDLE"
check "PR lead comment missing"        broken 2 "$D/pr-sha1.json" "$D/pr-missing.json"    "$D/no-issue.json"  "$D/dirs-ready.json"    "$IDLE"
check "PR unreadable verdict"          broken 2 "$D/pr-sha1.json" "$D/pr-badverdict.json" "$D/no-issue.json"  "$D/dirs-ready.json"    "$IDLE"
check "verdict with no reviewed sha"   broken 2 "$D/pr-sha1.json" "$D/pr-orphan.json"     "$D/no-issue.json"  "$D/dirs-ready.json"    "$IDLE"
check "issue lead comment missing"     broken 2 "$D/no-pr.json"   "$D/fresh.json"         "$D/one-issue.json" "$D/dirs-missing.json"  "$IDLE"
check "issue unreadable direction"     broken 2 "$D/no-pr.json"   "$D/fresh.json"         "$D/one-issue.json" "$D/dirs-badstate.json" "$IDLE"
check "task label but no bc:task"      broken 2 "$D/no-pr.json"   "$D/fresh.json"         "$D/one-issue.json" "$D/no-task-comment.json" "$IDLE"
check "crew state unknown"             broken 2 "$D/no-pr.json"   "$D/fresh.json"         "$D/no-issue.json"  "$D/dirs-ready.json"    '{"busy":null}'

echo "the Crew probe, against the shapes orca actually returns:"
# Captured from `orca terminal list --worktree path:<windows-form> --json`.
# Both failures below answer with exit 0, which is why the probe must read the
# body rather than the exit code.
cat > "$D/term-busy.json" <<'JSON'
{"ok":true,"result":{"terminals":[{"title":"bc-crew","lastOutputAt":99999999999999,"worktreePath":"C:/x"}]}}
JSON
cat > "$D/term-none.json" <<'JSON'
{"ok":true,"result":{"terminals":[{"title":"some other tab","lastOutputAt":99999999999999}]}}
JSON
cat > "$D/term-stale.json" <<'JSON'
{"ok":true,"result":{"terminals":[{"title":"bc-crew","lastOutputAt":1,"worktreePath":"C:/x"}]}}
JSON
cat > "$D/term-badselector.json" <<'JSON'
{"ok":false,"error":{"code":"selector_not_found","message":"selector_not_found"}}
JSON
cat > "$D/term-garbage.json" <<'JSON'
not json
JSON

probe() { # name, want_branch, want_exit, terminals fixture
  local out code got
  out="$(BC_PRS_FIXTURE="$D/no-pr.json" BC_COMMENTS_FIXTURE="$D/fresh.json"          BC_ISSUES_FIXTURE="$D/no-issue.json" BC_ISSUE_COMMENTS_FIXTURE="$D/dirs-ready.json"          BC_TERMINALS_FIXTURE="$4" BC_WAKE_REASON="$D/reason" bash "$WAKE" 2>&1)"
  code=$?
  got="$(printf '%s' "$out" | jq -r '.branch' 2>/dev/null)"
  if [ "$got" = "$2" ] && [ "$code" = "$3" ]; then
    printf '  ok   %-34s -> %-6s exit %s
' "$1" "$got" "$code"; pass=$((pass+1))
  else
    printf '  FAIL %-34s -> got %s exit %s (want %s exit %s)
       %s
' "$1" "$got" "$code" "$2" "$3" "$out"; fail=$((fail+1))
  fi
}

probe "fresh output means crew is busy"  c.3    1 "$D/term-busy.json"
probe "no bc-crew terminal means idle"   t.1    0 "$D/term-none.json"
probe "stale output means idle"          t.1    0 "$D/term-stale.json"
probe "a rejected selector is not idle"  broken 2 "$D/term-badselector.json"
probe "unparseable output is not idle"   broken 2 "$D/term-garbage.json"

rm -rf "$D"
echo; echo "passed $pass, failed $fail"; [ "$fail" -eq 0 ]
