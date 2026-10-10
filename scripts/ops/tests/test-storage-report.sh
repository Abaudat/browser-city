#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/storage-report.sh (the
# watcher's one reader): a stub `spacetime sql` serving canned sample
# tables. The report reads the newest fire only. Exit 0 = healthy, 1 = a
# breach, 2 = the watcher could not read (never conflated). The stub's
# column lists are read from server/schema.snapshot.json, so a renamed
# column fails here instead of on Maincloud.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
REPORT="$REPO_ROOT/scripts/ops/storage-report.sh"
SNAPSHOT="$REPO_ROOT/server/schema.snapshot.json"

col() { printf '{"name":{"some":"%s"},"algebraic_type":{"U64":[]}}' "$1"; }

# columns_of <table> -- comma-joined column names from the schema snapshot.
columns_of() {
  jq -r --arg t "$1" '.tables[] | select(.accessor == $t) | [.columns[].name] | join(",")' "$SNAPSHOT" | tr -d "\r"
}

# schema_of <table> -- the SATS schema object for a table, columns read
# from the committed schema snapshot.
schema_of() {
  local names elements="" n
  names="$(jq -r --arg t "$1" '.tables[] | select(.accessor == $t) | .columns[].name' "$SNAPSHOT" | tr -d "\r")"
  [ -n "$names" ] || { echo "no table $1 in $SNAPSHOT" >&2; return 1; }
  for n in $names; do
    elements="${elements:+$elements,}$(col "$n")"
  done
  printf '{"elements":[%s]}' "$elements"
}

# The column order the canned rows below are written in.
echo "the canned rows' columns are the schema snapshot's"
check_contains "storage_sample columns" "sample_id,sampled_at,total_bytes_est,over_review,over_wall,review_bytes,wall_bytes" "$(columns_of storage_sample)"
check_contains "table_sample columns" "sample_id,sampled_at,table_accessor,rows,bytes_est,alert_rows,max_rows,over_alert" "$(columns_of table_sample)"
check_contains "cadence_liveness columns" "cadence,last_target_at,last_fired_at,fires,missed" "$(columns_of cadence_liveness)"
check_contains "reducer_class_sample columns" "sample_id,sampled_at,class,calls_total,calls_delta" "$(columns_of reducer_class_sample)"

# stub_bin <storage-rows> <table-rows> <class-rows> [fail-mode]
stub_bin() {
  local d
  d="$(fake_dir)"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$(schema_of storage_sample)" "$1" >"$d/storage.json"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$(schema_of table_sample)" "$2" >"$d/tables.json"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$(schema_of reducer_class_sample)" "${3:-[]}" >"$d/classes.json"
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$(schema_of cadence_liveness)" "${LIVENESS:-[]}" >"$d/liveness.json"
  cat >"$d/spacetime" <<STUB
#!/usr/bin/env bash
case "${4:-}" in
  network) echo "Error: connection refused" >&2; exit 1 ;;
  auth) echo "Error: 401 unauthorized" >&2; exit 0 ;;
esac
case "\$*" in
  *cadence_liveness*) echo liveness >>"$CALLS_LOG"; [ "${4:-}" = "liveness-fail" ] && { echo "Error: boom" >&2; exit 1; }; cat "$d/liveness.json" ;;
  *storage_sample*) cat "$d/storage.json" ;;
  *reducer_class_sample*) cat "$d/classes.json" ;;
  *table_sample*) cat "$d/tables.json" ;;
  *) echo "stub spacetime: unhandled: \$*" >&2; exit 1 ;;
esac
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

# run_report <storage-rows> <table-rows> [class-rows] [fail-mode] -- prints
# the report's output; the findings file it wrote is $FINDINGS.
run_report() {
  local bin
  rm -f "$CALLS_LOG"
  bin="$(stub_bin "$1" "$2" "${3:-[]}" "${4:-}")"
  ( PATH="$bin:$PATH" bash "$REPORT" my-db --server http://127.0.0.1:1 --now "${NOW:-150}" --findings "$FINDINGS" )
}

FINDINGS="$(fake_dir)/findings.tsv"
CALLS_LOG="$(fake_dir)/calls.log"
is_empty() { [ ! -s "$1" ]; }
same_nonempty() { [ "$1" = "$2" ] && [ -n "$1" ]; }
line_count_is() { [ "$(grep -c . "$1")" -eq "$2" ]; }
distinct_titles_are() { [ "$(cut -f1 "$1" | sort -u | wc -l)" -eq "$2" ]; }
lacks() { ! printf '%s' "$1" | grep -qF "$2"; }
TAB="$(printf '\t')"

echo
echo "a healthy newest fire"
OUT="$(run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",10,80,90,100,false]]' 2>&1)"; CODE=$?
check "no flag -> exit 0" 0 bash -c "exit $CODE"
check_contains "prints the estimated total" "estimated total 5000 bytes" "$OUT"
check_contains "prints the table line" "citizen rows=10 alert=90 max=100 over_alert=false" "$OUT"
check "no findings written" 0 is_empty "$FINDINGS"

echo
echo "no samples yet"
OUT="$(run_report '[]' '[]' 2>&1)"; CODE=$?
check "no samples -> exit 0" 0 bash -c "exit $CODE"
check_contains "says so" "no storage samples yet" "$OUT"

echo
echo "breach flags exit 1 and are written as findings"
OUT="$(run_report '[[1,100,5000,true,false,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "over_review -> exit 1" 1 bash -c "exit $CODE"
FINDING="$(cat "$FINDINGS")"
check_contains "review finding has its stable title" "watcher: storage over review$TAB" "$FINDING"
check_contains "review line names the total against the review trigger" "estimated storage total 5000 bytes is past the review trigger of 10737418240 bytes" "$FINDING"
OUT="$(run_report '[[1,100,5000,true,true,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "over_wall -> exit 1" 1 bash -c "exit $CODE"
FINDING="$(cat "$FINDINGS")"
check_contains "wall finding has its stable title" "watcher: storage over wall$TAB" "$FINDING"
check_contains "wall line names the wall" "past the wall of 42949672960 bytes" "$FINDING"
check "wall and review are one finding, not two" 0 line_count_is "$FINDINGS" 1
OUT="$(run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",95,80,90,100,true]]' 2>&1)"; CODE=$?
check "a table over_alert -> exit 1" 1 bash -c "exit $CODE"
check_contains "names the table and the figure on stderr" "table citizen has 95 rows, past its alert of 90" "$OUT"
FINDING="$(cat "$FINDINGS")"
check_contains "the finding's title is the table only" "watcher: table citizen over alert$TAB" "$FINDING"
check_contains "the finding's body carries the exact line" "table citizen has 95 rows, past its alert of 90" "$FINDING"

echo
echo "the alerted-against thresholds are the ones the row carries, never the script's own"
OUT="$(run_report '[[1,100,5000,true,false,7000,9000]]' '[]' 2>&1)"; CODE=$?
check_contains "the review line reads review_bytes from the row" "past the review trigger of 7000 bytes" "$OUT"
OUT="$(run_report '[[1,100,5000,true,true,7000,9000]]' '[]' 2>&1)"; CODE=$?
check_contains "the wall line reads wall_bytes from the row" "past the wall of 9000 bytes" "$OUT"

echo
echo "the title for one finding is stable across figures (dedupe key)"
run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",95,80,90,100,true]]' >/dev/null 2>&1
T1="$(cut -f1 "$FINDINGS")"
run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",99,80,90,100,true]]' >/dev/null 2>&1
T2="$(cut -f1 "$FINDINGS")"
check "95 rows and 99 rows file under the same title" 0 same_nonempty "$T1" "$T2"
run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",95,80,90,100,true],[1,100,"building",95,80,90,100,true]]' >/dev/null 2>&1
check "two tables over alert are two findings" 0 distinct_titles_are "$FINDINGS" 2

echo
echo "only the newest fire counts"
OUT="$(run_report '[[1,100,5000,true,false,10737418240,42949672960],[2,200,6000,false,false,10737418240,42949672960]]' '[[1,100,"citizen",95,80,90,100,true],[2,200,"citizen",10,80,90,100,false]]' 2>&1)"; CODE=$?
check "an older breach is history -> exit 0" 0 bash -c "exit $CODE"
check_contains "reports the newest total" "estimated total 6000 bytes" "$OUT"
check "history writes no finding" 0 is_empty "$FINDINGS"

echo
echo "a sampler that has stopped is a breach: the newest sample older than three periods"
STALE=$((3 * 3600 * 1000000))
OUT="$(NOW=$((100 + STALE)) run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "exactly three periods old -> exit 0" 0 bash -c "exit $CODE"
OUT="$(NOW=$((100 + STALE + 1)) run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "one microsecond past three periods -> exit 1" 1 bash -c "exit $CODE"
check_contains "says the sampler stopped" "the sampler has stopped" "$OUT"
check_contains "stale finding has its stable title" "watcher: sampler stale$TAB" "$(cat "$FINDINGS")"

echo
echo "cadence liveness is printed on every run and carried by the stale finding"
# Real shapes: cadence is a u32 code, the instants are Timestamps ([micros]).
SAMPLE_AT=100
FAR=$((SAMPLE_AT + STALE + 13321000000))
LIVE="[[1,[$((FAR - 20000000))],[$((FAR - 19000000))],40,2],[2,[$((FAR - 13322000000))],[$((FAR - 13321000000))],187,3],[9,[1],[2],1,0]]"
OUT="$(LIVENESS="$LIVE" NOW=$FAR run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "stale with liveness -> exit 1" 1 bash -c "exit $CODE"
check_contains "prints the METRICS cadence by code with ages" "cadence 2: last fired 13321s ago, last target 13322s ago, fires=187 missed=3" "$OUT"
check_contains "prints the other cadence" "cadence 1: last fired 19s ago, last target 20s ago" "$OUT"
check_contains "an unknown code is printed, not dropped" "cadence 9:" "$OUT"
check "a stale run queries cadence_liveness exactly once" 0 bash -c "[ \"\$(grep -c liveness '$CALLS_LOG')\" -eq 1 ]"
check "stale finding is still one line" 0 line_count_is "$FINDINGS" 1
FINDING="$(cat "$FINDINGS")"
check_contains "detail carries the stale line" "the sampler has stopped" "$FINDING"
check_contains "detail carries the METRICS row with its age" "cadence 2: last fired 13321s ago" "$FINDING"
check_contains "detail carries every cadence" "cadence 1: last fired" "$FINDING"
OUT="$(LIVENESS="$LIVE" NOW=150 run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' 2>&1)"; CODE=$?
check "a healthy run -> exit 0" 0 bash -c "exit $CODE"
check_contains "a healthy run prints liveness too" "cadence 2:" "$OUT"
check "and queries it exactly once" 0 bash -c "[ \"\$(grep -c liveness '$CALLS_LOG')\" -eq 1 ]"
check "and writes no finding" 0 is_empty "$FINDINGS"
OUT="$(LIVENESS="$LIVE" NOW=$((100 + STALE + 1)) run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' '[]' liveness-fail 2>&1)"; CODE=$?
check "liveness unreadable while stale -> still exit 1" 1 bash -c "exit $CODE"
check_contains "says liveness was unreadable" "cadence liveness unreadable" "$(cat "$FINDINGS")"
check_contains "the failed read's reason reaches the log" "boom" "$OUT"
OUT="$(LIVENESS="$LIVE" NOW=150 run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' '[]' liveness-fail 2>&1)"; CODE=$?
check "liveness unreadable on a healthy run -> exit 0, never 1 or 2" 0 bash -c "exit $CODE"
check "and writes no finding" 0 is_empty "$FINDINGS"
check_contains "and says liveness was unreadable" "cadence liveness unreadable" "$OUT"

echo
echo "cost per reducer class is printed for the newest fire, never alerted on"
CLASSES='[[1,100,"scheduled",5,5],[2,100,"player",1,1],[3,50,"scheduled",2,2]]'
OUT="$(run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' "$CLASSES" 2>&1)"; CODE=$?
check "class rows never breach -> exit 0" 0 bash -c "exit $CODE"
check_contains "prints the scheduled class's total and delta" "class scheduled calls_total=5 calls_delta=5" "$OUT"
check_contains "prints the player class" "class player calls_total=1 calls_delta=1" "$OUT"
check "an older fire's class row is not printed" 0 lacks "$OUT" "calls_total=2 "

echo
echo "unreadable is exit 2, never a breach"
OUT="$(run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' '[]' network 2>&1)"; CODE=$?
check "a network failure -> exit 2" 2 bash -c "exit $CODE"
check "and writes no finding" 0 is_empty "$FINDINGS"
OUT="$(run_report '[[1,100,5000,false,false,10737418240,42949672960]]' '[]' '[]' auth 2>&1)"; CODE=$?
check "an auth failure -> exit 2" 2 bash -c "exit $CODE"
check_contains "says it could not read" "could not read" "$OUT"

echo
echo "usage errors are exit 2"
check "missing db argument -> exit 2" 2 bash "$REPORT"

summary
exit $?
