#!/usr/bin/env bash
# Branch-coverage test for scotty-wake.sh, driven by fixtures.
WAKE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scotty-wake.sh"
D="${TMPDIR:-/tmp}/bc-wake-fix"; mkdir -p "$D"
pass=0; fail=0

echo '[]' > "$D/no-pr.json"
echo '[{"number":7,"title":"Story 1.4","headRefName":"s14"}]' > "$D/one-pr.json"
echo '[{"number":7},{"number":8}]' > "$D/two-pr.json"

status() { # $1 scope, $2 cycle
  printf '{"id":1,"body":"<!-- bc:status -->\\n### Task status\\n\\n<!-- bc:story 1.4 -->\\n<!-- bc:scope %s -->\\n<!-- bc:cycle %s -->"}' "$1" "$2"
}
lead() { # $1 role, $2 verdict
  printf '{"id":%s,"body":"<!-- bc:lead:%s -->\\n### %s\\n\\nfindings\\n\\n<!-- bc:verdict %s -->\\n<!-- bc:session abc123 -->"}' "$RANDOM" "$1" "$1" "$2"
}

echo '[{"id":9,"body":"Opened by Crew. Consistency gate: pass."}]' > "$D/c0.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin APPROVED),$(lead tim APPROVED)]" > "$D/c1.json"
echo "[$(status 'quentin,tim' 8),$(lead quentin CHANGES),$(lead tim APPROVED)]" > "$D/c6.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin PENDING),$(lead tim APPROVED)]" > "$D/c4.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin CHANGES),$(lead tim APPROVED)]" > "$D/c5.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin PENDING),$(lead tim CHANGES)]" > "$D/c4-wins.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin APPROVED)]" > "$D/missing.json"
echo "[$(status 'quentin,tim' 2),$(lead quentin WAT),$(lead tim APPROVED)]" > "$D/badverdict.json"

check() { # name, expected_branch, expected_exit, prs, comments, crew
  local out code
  out="$(BC_PRS_FIXTURE="$4" BC_COMMENTS_FIXTURE="$5" BC_CREW_OVERRIDE="$6" bash "$WAKE" 2>&1)"
  code=$?
  local got; got="$(printf '%s' "$out" | jq -r '.branch' 2>/dev/null)"
  if [ "$got" = "$2" ] && [ "$code" = "$3" ]; then
    printf '  ok   %-24s -> %-6s exit %s\n' "$1" "$got" "$code"; pass=$((pass+1))
  else
    printf '  FAIL %-24s -> got %s exit %s (want %s exit %s)\n     %s\n' "$1" "$got" "$code" "$2" "$3" "$out"; fail=$((fail+1))
  fi
}

BUSY='{"busy":true,"terminal":"bc-crew","idle_ms":34}'
IDLE='{"busy":false,"terminal":"bc-crew","idle_ms":33585}'
NONE='{"busy":false,"terminal":null,"idle_ms":null}'

echo "branch classification:"
check "c.2 no PR, crew idle"   c.2    0 "$D/no-pr.json"  "$D/c1.json"        "$IDLE"
check "c.3 no PR, crew busy"   c.3    1 "$D/no-pr.json"  "$D/c1.json"        "$BUSY"
check "c.2 no PR, no terminal" c.2    0 "$D/no-pr.json"  "$D/c1.json"        "$NONE"
check "c.0 new PR, no status"  c.0    0 "$D/one-pr.json" "$D/c0.json"        "$IDLE"
check "c.1 all approved"       c.1    0 "$D/one-pr.json" "$D/c1.json"        "$IDLE"
check "c.6 breaker at cycle 8" c.6    0 "$D/one-pr.json" "$D/c6.json"        "$IDLE"
check "c.4 a lead pending"     c.4    0 "$D/one-pr.json" "$D/c4.json"        "$IDLE"
check "c.5 changes requested"  c.5    0 "$D/one-pr.json" "$D/c5.json"        "$IDLE"
check "c.4 outranks c.5"       c.4    0 "$D/one-pr.json" "$D/c4-wins.json"   "$IDLE"

echo "defects must break loudly, not be guessed:"
check "two story PRs"          broken 2 "$D/two-pr.json" "$D/c1.json"        "$IDLE"
check "lead comment missing"   broken 2 "$D/one-pr.json" "$D/missing.json"   "$IDLE"
check "unreadable verdict"     broken 2 "$D/one-pr.json" "$D/badverdict.json" "$IDLE"
check "crew state unknown"     broken 2 "$D/no-pr.json"  "$D/c1.json"        '{"busy":null}'

rm -rf "$D"
echo; echo "passed $pass, failed $fail"; [ "$fail" -eq 0 ]
