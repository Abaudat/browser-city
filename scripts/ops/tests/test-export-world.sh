#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/export-world.sh's failure
# paths (Quentin's direction): a stub `spacetime` placed first on PATH,
# never a real instance. Every red case asserts a specific failure
# message, not only a non-zero exit -- a stub loose enough to pass
# whether or not the real check works proves nothing (Quentin's cycle-1
# finding against this file's predecessor). The happy path (and every
# table/column actually round-tripping) is
# scripts/ci/check-backup-restore.sh's job, against a real instance.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
EXPORT="$REPO_ROOT/scripts/ops/export-world.sh"

# Build world_backup once, for real -- its own pure logic is covered by
# `cargo test -p world_backup`; here it is exercised as a real tool, the
# same way export-world.sh uses it in production.
( cd "$REPO_ROOT/server" && cargo build -p world_backup --release >/dev/null ) \
  || { echo "could not build world_backup" >&2; exit 1; }

stub_bin() { # <mode>
  local mode="$1" d
  d="$(fake_dir)"
  cat > "$d/spacetime" <<STUB
#!/usr/bin/env bash
MODE="$mode"
SNAPSHOT="$REPO_ROOT/server/schema.snapshot.json"
if [ "\$1" = "--version" ]; then
  echo "spacetimedb tool version 2.9.0; spacetimedb-lib version 2.9.0;"
  exit 0
fi
if [ "\$1" = "describe" ]; then
  if [ "\$MODE" = "describe-fails" ]; then
    echo "Error: could not reach server" >&2
    exit 1
  fi
  if [ "\$MODE" = "garbled-describe" ]; then
    echo "not json at all {{{"
    exit 0
  fi
  if [ "\$MODE" = "wrong-tables" ]; then
    echo '{"sections":[{"Tables":[{"source_name":"not_a_real_table"}]}]}'
    exit 0
  fi
  WB="$REPO_ROOT/server/target/release/world_backup"
  [ -x "\$WB" ] || WB="\$WB.exe"
  "\$WB" snapshot-tables "\$SNAPSHOT" | awk -F'\t' '
    BEGIN { printf "{\"sections\":[{\"Tables\":[" }
    { if (n++) printf ","; printf "{\"source_name\":\"%s\"}", \$1 }
    END { printf "]}]}" }
  '
  exit 0
fi
if [ "\$1" = "list" ]; then
  echo "Associated databases for user 00"
  exit 0
fi
if [ "\$1" = "sql" ]; then
  QUERY="\${@: -1}"
  TABLE="\$(printf '%s' "\$QUERY" | grep -oE 'FROM [a-z_]+' | awk '{print \$2}')"
  if [ "\$MODE" = "unreachable" ]; then
    echo "Error: could not connect to server" >&2
    exit 1
  fi
  if [ "\$MODE" = "sql-error-on-table" ] && [ "\$TABLE" = "\$STUB_FAIL_TABLE" ]; then
    echo "Error: something went wrong querying \$TABLE" >&2
    exit 1
  fi
  if [ "\$MODE" = "garbled-sql" ] && [ "\$TABLE" = "\$STUB_FAIL_TABLE" ]; then
    echo "not json { rows: ["
    exit 0
  fi
  WB="$REPO_ROOT/server/target/release/world_backup"
  [ -x "\$WB" ] || WB="\$WB.exe"
  if [ "\$TABLE" = "st_sequence" ]; then
    # Not one of this module's own tables -- SpacetimeDB's system table,
    # export-world.sh's own sequence-floor read (story 1.4, cycle 4).
    # One plausible row per real auto_inc table, never a table this
    # module does not actually have.
    ROWS=""
    while IFS= read -r t; do
      [ -n "\$t" ] || continue
      COL="\$("\$WB" auto-inc-column "\$SNAPSHOT" "\$t")"
      [ -n "\$ROWS" ] && ROWS="\$ROWS,"
      ROWS="\${ROWS}[1,\"\${t}_\${COL}_seq\",1,0,1,1,1,170141183460469231731687303715884105727,1]"
    done <<< "\$("\$WB" autoinc-tables "\$SNAPSHOT")"
    printf '[{"schema":{"elements":[{"name":{"some":"sequence_id"},"algebraic_type":{"U32":[]}},{"name":{"some":"sequence_name"},"algebraic_type":{"String":[]}},{"name":{"some":"table_id"},"algebraic_type":{"U32":[]}},{"name":{"some":"col_pos"},"algebraic_type":{"U16":[]}},{"name":{"some":"increment"},"algebraic_type":{"I64":[]}},{"name":{"some":"start"},"algebraic_type":{"I128":[]}},{"name":{"some":"min_value"},"algebraic_type":{"I128":[]}},{"name":{"some":"max_value"},"algebraic_type":{"I128":[]}},{"name":{"some":"allocated"},"algebraic_type":{"I128":[]}}]},"rows":[%s]}]' "\$ROWS"
    exit 0
  fi
  COLS="\$("\$WB" snapshot-columns "\$SNAPSHOT" "\$TABLE")"
  ELEMENTS="\$(printf '%s\n' "\$COLS" | awk '{ if (n++) printf ","; printf "{\"name\":{\"some\":\"%s\"},\"algebraic_type\":{\"String\":[]}}", \$0 }')"
  printf '[{"schema":{"elements":[%s]},"rows":[]}]' "\$ELEMENTS"
  exit 0
fi
echo "stub spacetime: unhandled subcommand: \$*" >&2
exit 1
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

run_export() { # <mode> <out-dir> [env...]
  local mode="$1" out="$2"; shift 2
  local bin
  bin="$(stub_bin "$mode")"
  ( PATH="$bin:$PATH" env "$@" bash "$EXPORT" bc-test "$out" --server http://127.0.0.1:1 )
}

LOGDIR="$(fake_dir)"

echo "green: a fully stubbed happy path writes a manifest and every table file"
OUT="$(fake_dir)/export"
run_export ok "$OUT" >"$LOGDIR/happy.log" 2>&1
check "stubbed happy path -> exit 0" 0 bash -c "[ -f '$OUT/manifest.json' ]"

echo
echo "red: 'spacetime describe' fails outright"
OUT2="$(fake_dir)/describe-out"
run_export describe-fails "$OUT2" >"$LOGDIR/out1.log" 2>&1; CODE=$?
check "describe failure -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the describe failure" "spacetime describe" "$(cat "$LOGDIR/out1.log")"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT2' ]"

echo
echo "red: 'spacetime describe --json' returns garbled output"
OUT="$(fake_dir)/export"
run_export garbled-describe "$OUT" >"$LOGDIR/out2.log" 2>&1; CODE=$?
check "garbled describe -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names it as a parse/shape problem" "not valid JSON" "$(cat "$LOGDIR/out2.log")"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: the live table set does not match server/schema.snapshot.json"
OUT="$(fake_dir)/export"
run_export wrong-tables "$OUT" >"$LOGDIR/out3.log" 2>&1; CODE=$?
check "table mismatch -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the mismatch" "does not match" "$(cat "$LOGDIR/out3.log")"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: the server is unreachable for a SQL query"
OUT="$(fake_dir)/export"
run_export unreachable "$OUT" >"$LOGDIR/out4.log" 2>&1; CODE=$?
check "unreachable server -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the SQL failure" "spacetime sql" "$(cat "$LOGDIR/out4.log")"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: one table's SQL query errors"
OUT="$(fake_dir)/export"
run_export sql-error-on-table "$OUT" STUB_FAIL_TABLE=demo_ping >"$LOGDIR/out5.log" 2>&1; CODE=$?
check "one table's SQL error -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names demo_ping" "demo_ping" "$(cat "$LOGDIR/out5.log")"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: one table's SQL response is garbled/truncated JSON"
OUT="$(fake_dir)/export"
run_export garbled-sql "$OUT" STUB_FAIL_TABLE=demo_ping >"$LOGDIR/out6.log" 2>&1; CODE=$?
check "garbled table response -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: an unrecognized flag is rejected, never silently defaulted"
OUT="$(fake_dir)/export"
bin="$(stub_bin ok)"
( PATH="$bin:$PATH" bash "$EXPORT" bc-test "$OUT" --sever http://127.0.0.1:1 ) >"$LOGDIR/out8.log" 2>&1
CODE=$?
check "typo'd flag -> exit non-zero" 1 bash -c "exit $CODE"
check_contains "names the unrecognized argument" "unrecognized argument" "$(cat "$LOGDIR/out8.log")"

summary
