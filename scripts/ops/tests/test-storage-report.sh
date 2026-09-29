#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/storage-report.sh: a stub
# `spacetime sql` serving canned sample tables. The report reads the
# newest fire only, and exits 1 exactly when a breach flag is set.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
REPORT="$REPO_ROOT/scripts/ops/storage-report.sh"

col() { printf '{"name":{"some":"%s"},"algebraic_type":{"U64":[]}}' "$1"; }

# stub_bin <storage-rows-json> <table-rows-json>
stub_bin() {
  local d storage_schema table_schema
  d="$(fake_dir)"
  storage_schema="{\"elements\":[$(col sample_id),$(col sampled_at),$(col total_bytes_est),$(col over_review),$(col over_wall)]}"
  table_schema="{\"elements\":[$(col sample_id),$(col sampled_at),$(col table_accessor),$(col rows),$(col bytes_est),$(col alert_rows),$(col max_rows),$(col over_alert)]}"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$storage_schema" "$1" >"$d/storage.json"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$table_schema" "$2" >"$d/tables.json"
  cat >"$d/spacetime" <<STUB
#!/usr/bin/env bash
case "\$*" in
  *storage_sample*) cat "$d/storage.json" ;;
  *table_sample*) cat "$d/tables.json" ;;
  *) echo "stub spacetime: unhandled: \$*" >&2; exit 1 ;;
esac
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

run_report() { # <storage-rows> <table-rows>
  local bin
  bin="$(stub_bin "$1" "$2")"
  ( PATH="$bin:$PATH" bash "$REPORT" my-db --server http://127.0.0.1:1 --now "${NOW:-150}" )
}

echo "a healthy newest fire"
OUT="$(run_report '[[1,100,5000,false,false]]' '[[1,100,"citizen",10,80,90,100,false]]' 2>&1)"; CODE=$?
check "no flag -> exit 0" 0 bash -c "exit $CODE"
check_contains "prints the estimated total" "estimated total 5000 bytes" "$OUT"
check_contains "prints the table line" "citizen rows=10 alert=90 max=100 over_alert=false" "$OUT"

echo
echo "no samples yet"
OUT="$(run_report '[]' '[]' 2>&1)"; CODE=$?
check "no samples -> exit 0" 0 bash -c "exit $CODE"
check_contains "says so" "no storage samples yet" "$OUT"

echo
echo "breach flags"
OUT="$(run_report '[[1,100,5000,true,false]]' '[]' 2>&1)"; CODE=$?
check "over_review -> exit 1" 1 bash -c "exit $CODE"
OUT="$(run_report '[[1,100,5000,false,true]]' '[]' 2>&1)"; CODE=$?
check "over_wall -> exit 1" 1 bash -c "exit $CODE"
OUT="$(run_report '[[1,100,5000,false,false]]' '[[1,100,"citizen",95,80,90,100,true]]' 2>&1)"; CODE=$?
check "a table over_alert -> exit 1" 1 bash -c "exit $CODE"
check_contains "names the table" "table citizen has 95 rows" "$OUT"

echo
echo "only the newest fire counts"
OUT="$(run_report '[[1,100,5000,true,false],[2,200,6000,false,false]]' '[[1,100,"citizen",95,80,90,100,true],[2,200,"citizen",10,80,90,100,false]]' 2>&1)"; CODE=$?
check "an older breach is history -> exit 0" 0 bash -c "exit $CODE"
check_contains "reports the newest total" "estimated total 6000 bytes" "$OUT"

echo
echo "a sampler that has stopped is a breach: the newest sample older than three periods"
STALE=$((3 * 3600 * 1000000))
OUT="$(NOW=$((100 + STALE)) run_report '[[1,100,5000,false,false]]' '[]' 2>&1)"; CODE=$?
check "exactly three periods old -> exit 0" 0 bash -c "exit $CODE"
OUT="$(NOW=$((100 + STALE + 1)) run_report '[[1,100,5000,false,false]]' '[]' 2>&1)"; CODE=$?
check "one microsecond past three periods -> exit 1" 1 bash -c "exit $CODE"
check_contains "says the sampler stopped" "the sampler has stopped" "$OUT"

echo
echo "usage errors"
check "missing db argument fails" 1 bash "$REPORT"

summary
exit $?
