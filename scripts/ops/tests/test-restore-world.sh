#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/restore-world.sh's failure
# paths (Quentin's direction): a stub `spacetime` placed first on PATH,
# never a real instance. Every red case asserts a specific failure
# message. The happy path (a real restore, including every table
# actually round-tripping and the auto_inc sequence advancing correctly)
# is scripts/ci/check-backup-restore.sh's job, against a real instance --
# this file is only for the wiring: refusals and error propagation.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
RESTORE="$REPO_ROOT/scripts/ops/restore-world.sh"
SNAPSHOT="$REPO_ROOT/server/schema.snapshot.json"
WB="$REPO_ROOT/server/target/release/world_backup"

( cd "$REPO_ROOT/server" && cargo build -p world_backup --release >/dev/null ) \
  || { echo "could not build world_backup" >&2; exit 1; }
[ -x "$WB" ] || WB="$WB.exe"

REAL_OWNER_HEX="0xc200279199e24f46fe6947912389eb3ef546be8c560f8e6968ebc3a531ec02d4"

# make_export -- a real, valid, all-empty export directory built by
# world_backup itself (schema-correct manifest, one empty .jsonl per
# table, a real `module_owner` row, a real `sequence_floors` entry -- "0"
# -- for every auto_inc table, matching what export-world.sh itself
# always writes) -- the fixture every restore test starts from and edits.
make_export() {
  local dir
  dir="$(fake_dir)/export"
  mkdir -p "$dir"
  while IFS=$'\t' read -r table scheduled; do
    [ "$table" = "restore_state" ] && continue
    : > "$dir/$table.jsonl"
  done < <("$WB" snapshot-tables "$SNAPSHOT")
  printf '[0,["%s"]]\n' "$REAL_OWNER_HEX" > "$dir/module_owner.jsonl"
  local sha
  sha="$(sha256sum "$SNAPSHOT" | awk '{print $1}' | sed 's/^\\//')"
  local floors="" first=1
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    [ "$first" -eq 1 ] || floors="$floors,"
    first=0
    floors="$floors\"$table\":0"
  done < <("$WB" autoinc-tables "$SNAPSHOT")
  printf '{\n  "schema_sha256": "%s",\n  "sequence_floors": {%s}\n}\n' "$sha" "$floors" > "$dir/manifest.json"
  printf '%s' "$dir"
}

# stub_bin <mode> -- MODE selects the scenario; STUB_FAIL_TABLE (env)
# names which table's `restore_<table>` call fails, for the modes that
# need one.
stub_bin() {
  local mode="$1" d
  d="$(fake_dir)"
  cat > "$d/spacetime" <<STUB
#!/usr/bin/env bash
MODE="$mode"
SNAPSHOT="$SNAPSHOT"
WB="$WB"
if [ "\$1" = "describe" ]; then
  if [ "\$MODE" = "describe-fails" ]; then
    echo "Error: could not reach server" >&2
    exit 1
  fi
  "\$WB" snapshot-tables "\$SNAPSHOT" | awk -F'\t' '
    BEGIN { printf "{\"sections\":[{\"Tables\":[" }
    { if (n++) printf ","; printf "{\"source_name\":\"%s\"}", \$1 }
    END { printf "]}]}" }
  '
  exit 0
fi
if [ "\$1" = "sql" ]; then
  if [ "\$MODE" = "owner-read-fails" ]; then
    echo "Error: could not read module_owner" >&2
    exit 1
  fi
  echo '[{"schema":{"elements":[]},"rows":[[0,["$REAL_OWNER_HEX"]]]}]'
  exit 0
fi
if [ "\$1" = "call" ]; then
  # The reducer name is never at a fixed offset from the end: it is
  # followed by zero args (begin_restore/finish_restore), one (most
  # restore_<table> reducers) or two (an auto_inc table's own rows +
  # sequence_floor) -- but it is always the argument right after \`-y\`,
  # regardless of how many follow it. REST captures every argument after
  # the reducer name, in order, for MODE=call-log to record.
  REDUCER=""
  REST=""
  prev=""
  after=0
  for a in "\$@"; do
    if [ "\$after" = 1 ]; then
      [ -n "\$REST" ] && REST="\$REST "
      REST="\$REST\$a"
    fi
    if [ "\$prev" = "-y" ]; then
      REDUCER="\$a"
      after=1
    fi
    prev="\$a"
  done
  if [ "\$MODE" = "call-log" ] && [ -n "\${CALL_LOG:-}" ]; then
    echo "\$REDUCER \$REST" >> "\$CALL_LOG"
  fi
  if [ "\$REDUCER" = "begin_restore" ] || [ "\$REDUCER" = "finish_restore" ]; then
    exit 0
  fi
  if [ "\$MODE" = "call-fails-on-table" ] && [ "\$REDUCER" = "restore_\$STUB_FAIL_TABLE" ]; then
    echo "Error: something went wrong calling \$REDUCER" >&2
    exit 1
  fi
  exit 0
fi
echo "stub spacetime: unhandled subcommand: \$*" >&2
exit 1
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

run_restore() { # <mode> <export-dir> [env...]
  local mode="$1" dir="$2"; shift 2
  local bin
  bin="$(stub_bin "$mode")"
  ( PATH="$bin:$PATH" env "$@" bash "$RESTORE" bc-test "$dir" --server http://127.0.0.1:1 )
}

LOGDIR="$(fake_dir)"

echo "green: a fully stubbed happy path (all tables empty) succeeds"
DIR="$(make_export)"
run_restore ok "$DIR" >"$LOGDIR/happy.log" 2>&1; CODE=$?
check "stubbed happy path -> exit 0" 0 bash -c "exit $CODE"

echo
echo "red: no manifest.json at the given export directory"
EMPTY="$(fake_dir)/not-an-export"
mkdir -p "$EMPTY"
run_restore ok "$EMPTY" >"$LOGDIR/out1.log" 2>&1; CODE=$?
check "missing manifest -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the missing manifest" "manifest.json not found" "$(cat "$LOGDIR/out1.log")"

echo
echo "red: the export's schema_sha256 does not match server/schema.snapshot.json"
DIR="$(make_export)"
sed -i 's/"schema_sha256": "[0-9a-f]*"/"schema_sha256": "0000000000000000000000000000000000000000000000000000000000000000"/' "$DIR/manifest.json"
run_restore ok "$DIR" >"$LOGDIR/out2.log" 2>&1; CODE=$?
check "schema mismatch -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the mismatch" "does not match" "$(cat "$LOGDIR/out2.log")"

echo
echo "red: 'spacetime describe' fails outright"
DIR="$(make_export)"
run_restore describe-fails "$DIR" >"$LOGDIR/out3.log" 2>&1; CODE=$?
check "describe failure -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the describe failure" "spacetime describe" "$(cat "$LOGDIR/out3.log")"

echo
echo "red: reading module_owner fails (an identity-mismatch symptom)"
DIR="$(make_export)"
run_restore owner-read-fails "$DIR" >"$LOGDIR/out4.log" 2>&1; CODE=$?
check "owner read failure -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the restoring-identity mismatch" "restoring identity does not match" "$(cat "$LOGDIR/out4.log")"

echo
echo "red: a restore_<table> call fails, naming that table, stopping the run"
DIR="$(make_export)"
# A table with 0 exported rows is skipped entirely (nothing to call) --
# this scenario needs at least one row so restore-world.sh actually
# calls restore_demo_ping.
printf '[1,"seeded for this test",[0]]\n' > "$DIR/demo_ping.jsonl"
run_restore call-fails-on-table "$DIR" STUB_FAIL_TABLE=demo_ping >"$LOGDIR/out5.log" 2>&1; CODE=$?
check "restore_demo_ping failure -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names restore_demo_ping" "restore_demo_ping" "$(cat "$LOGDIR/out5.log")"

echo
echo "green: an auto_inc table with 0 exported rows but a nonzero manifest floor still gets a restore_<table> call (to advance the sequence, not skipped as if there were nothing to do)"
DIR="$(make_export)"
sed -i 's/"demo_ping":0/"demo_ping":4097/' "$DIR/manifest.json"
CALLS_LOG="$LOGDIR/calls.log"
rm -f "$CALLS_LOG"
run_restore call-log "$DIR" CALL_LOG="$CALLS_LOG" >"$LOGDIR/out7.log" 2>&1; CODE=$?
check "0-row auto_inc table with a floor -> exit 0" 0 bash -c "exit $CODE"
check_contains "calls restore_demo_ping with the recorded floor" "restore_demo_ping [] 4097" "$(cat "$CALLS_LOG" 2>/dev/null)"

echo
echo "red: an auto_inc table missing from the manifest's own sequence_floors fails before begin_restore, never silently as if its floor were 0"
DIR="$(make_export)"
sed -i -E 's/"demo_ping":[0-9]+,//; s/,"demo_ping":[0-9]+//; s/"demo_ping":[0-9]+//' "$DIR/manifest.json"
CALL_LOG_MISSING="$LOGDIR/calls-missing.log"
rm -f "$CALL_LOG_MISSING"
run_restore call-log "$DIR" CALL_LOG="$CALL_LOG_MISSING" >"$LOGDIR/out8.log" 2>&1; CODE=$?
check "missing sequence_floors entry -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the table missing its floor" "demo_ping" "$(cat "$LOGDIR/out8.log")"
check "never calls begin_restore (stops before it)" 0 test ! -s "$CALL_LOG_MISSING"

echo
echo "red: an unrecognized flag is rejected, never silently defaulted"
DIR="$(make_export)"
bin="$(stub_bin ok)"
( PATH="$bin:$PATH" bash "$RESTORE" bc-test "$DIR" --sever http://127.0.0.1:1 ) >"$LOGDIR/out6.log" 2>&1
CODE=$?
check "typo'd flag -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the unrecognized argument" "unrecognized argument" "$(cat "$LOGDIR/out6.log")"

summary
