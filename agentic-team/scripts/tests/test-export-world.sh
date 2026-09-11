#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/export-world.sh's failure
# paths (Quentin's direction): a stub `spacetime` placed first on PATH,
# never a real instance -- this file belongs in the cheap job, proving an
# export never reports success, and never leaves a file at the final
# path, on any of: a non-zero exit, an unreachable server, a SQL error on
# one table, garbled output, or a table-set mismatch against the real
# server/schema.snapshot.json. The happy path (and every table/column
# actually round-tripping) is scripts/ci/check-backup-restore.sh's job,
# against a real instance.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
EXPORT="$REPO_ROOT/scripts/ops/export-world.sh"
PY="${BC_PYTHON:-python3}"

# stub_bin <mode> -- a scratch dir with a fake `spacetime` first on PATH.
# <mode> selects which failure this run's `spacetime sql`/`describe`
# simulates; a real `python3` still resolves the real repo's own
# schema.snapshot.json to build a truthful table list for every mode
# except 'garbled-describe'/'wrong-tables'.
stub_bin() {
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
  "$PY" -c "
import json
snap = json.load(open(r'''\$SNAPSHOT'''))
tables = [{'source_name': t['accessor']} for t in snap['tables']]
print(json.dumps({'sections': [{'Tables': tables}]}))
"
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
  echo '[{"schema":{"elements":[]},"rows":[]}]'
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

echo "red: 'spacetime describe' fails outright"
OUT="$(fake_dir)/export"
run_export describe-fails "$OUT" >/tmp/out.log 2>&1
CODE=$?
check "describe failure -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: 'spacetime describe --json' returns garbled output"
OUT="$(fake_dir)/export"
run_export garbled-describe "$OUT" >/dev/null 2>&1
CODE=$?
check "garbled describe -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: the live table set does not match server/schema.snapshot.json"
OUT="$(fake_dir)/export"
run_export wrong-tables "$OUT" >/dev/null 2>&1
CODE=$?
check "table mismatch -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: the server is unreachable for a SQL query"
OUT="$(fake_dir)/export"
run_export unreachable "$OUT" >/dev/null 2>&1
CODE=$?
check "unreachable server -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: one table's SQL query errors"
OUT="$(fake_dir)/export"
run_export sql-error-on-table "$OUT" STUB_FAIL_TABLE=demo_ping >/dev/null 2>&1
CODE=$?
check "one table's SQL error -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

echo
echo "red: one table's SQL response is garbled/truncated JSON"
OUT="$(fake_dir)/export"
run_export garbled-sql "$OUT" STUB_FAIL_TABLE=demo_ping >/dev/null 2>&1
CODE=$?
check "garbled table response -> exit non-zero" 1 bash -c "exit $CODE"
check "no file left at the final export path" 1 bash -c "[ -e '$OUT' ]"

summary
