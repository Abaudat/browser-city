#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ops/python/canon.py -- the pure part
# of the backup/restore pipeline (value <-> SQL literal, JSON
# canonicalisation, big-integer exactness), kept below the integration
# test (scripts/ci/check-backup-restore.sh) per the test-pyramid
# direction: an escaping or precision bug fails here, in seconds, with no
# `spacetime` instance involved.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CANON="$REPO_ROOT/scripts/ops/python/canon.py"
PY="${BC_PYTHON:-python3}"

canon() { "$PY" "$CANON" "$@"; }

write_response() { # <file> <schema-json> <rows-json>
  printf '[{"schema":%s,"rows":%s,"total_duration_micros":1,"stats":{}}]' "$2" "$3" > "$1"
}

# --- exact big-integer round trip (the reason this is python, not jq) ---
echo "green: u64::MAX and a high-bit-set value survive columns/rows-canonical byte for byte"
R="$(fake_dir)/r.json"
write_response "$R" \
  '{"elements":[{"name":{"some":"chunk_key"},"algebraic_type":{"U64":[]}}]}' \
  '[[18446744073709551615],[9223372036854775808]]'
check_out "rows-canonical preserves u64::MAX exactly, sorted ascending" 0 \
  '[9223372036854775808]
[18446744073709551615]' \
  canon rows-canonical "$R"

echo
echo "green: rows are sorted by the first column as an exact integer, not string order"
R="$(fake_dir)/r.json"
write_response "$R" \
  '{"elements":[{"name":{"some":"id"},"algebraic_type":{"U64":[]}},{"name":{"some":"n"},"algebraic_type":{"String":[]}}]}' \
  '[[9,"nine"],[10,"ten"],[2,"two"]]'
check_out "numeric sort, not lexicographic (2 < 9 < 10)" 0 \
  '[2,"two"]
[9,"nine"]
[10,"ten"]' \
  canon rows-canonical "$R"

echo
echo "red: rows-canonical on an unparseable response"
R="$(fake_dir)/r.json"
printf 'not json' > "$R"
check "garbled input -> exit 1" 1 canon rows-canonical "$R"

echo
echo "red: rows-canonical on a response missing 'rows'/'schema'"
R="$(fake_dir)/r.json"
printf '[{"foo":"bar"}]' > "$R"
check "missing keys -> exit 1" 1 canon rows-canonical "$R"

# --- column-type classification --------------------------------------------
echo
echo "green: coltypes classifies every scalar, Identity, Timestamp and ScheduleAt"
R="$(fake_dir)/r.json"
write_response "$R" \
  '{"elements":[
     {"name":{"some":"a"},"algebraic_type":{"U64":[]}},
     {"name":{"some":"b"},"algebraic_type":{"String":[]}},
     {"name":{"some":"c"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}}},
     {"name":{"some":"d"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"__timestamp_micros_since_unix_epoch__"},"algebraic_type":{"I64":[]}}]}}},
     {"name":{"some":"e"},"algebraic_type":{"Sum":{"variants":[{"name":{"some":"Interval"},"algebraic_type":{}},{"name":{"some":"Time"},"algebraic_type":{}}]}}},
     {"name":{"some":"f"},"algebraic_type":{"Product":{"elements":[{"name":{"some":"mystery"},"algebraic_type":{}}]}}}
   ]}' \
  '[]'
check_out "U64/String/Identity/Timestamp/Schedule/Other, in order" 0 \
  'U64
STRING
IDENTITY
TIMESTAMP
SCHEDULE
OTHER' \
  canon coltypes "$R"

# --- SQL literal rendering ---------------------------------------------------
echo
echo "green: row-tuple escapes a quote, a real tab, a real newline and an emoji"
OUT="$(canon row-tuple "U64,STRING" '[7,"a'"'"'b\tc\nd😀e"]')"
EXPECT="(7,'a''b	c
d😀e')"
check_out "quote doubled, control bytes preserved raw inside the literal" 0 "$EXPECT" printf '%s' "$OUT"

echo
echo "green: row-tuple renders every integer extreme exactly"
check_out "i32::MIN" 0 "(-2147483648)" canon row-tuple "I32" "[-2147483648]"
check_out "i8 floor" 0 "(-128)" canon row-tuple "I8" "[-128]"
check_out "u64::MAX" 0 "(18446744073709551615)" canon row-tuple "U64" "[18446744073709551615]"
check_out "bool true/false" 0 "(true,false)" canon row-tuple "BOOL,BOOL" "[true,false]"

echo
echo "green: row-tuple left-pads a trimmed Identity hex literal back to 64 digits"
check_out "short hex -> 64-digit literal" 0 "(0x$(printf '0%.0s' $(seq 1 59))dbba4)" canon row-tuple "IDENTITY" '["0xdbba4"]'

echo
echo "red: row-tuple refuses a Timestamp field -- no SQL literal exists"
check "TIMESTAMP -> exit 1" 1 canon row-tuple "TIMESTAMP" "[1000]"

echo
echo "red: row-tuple refuses a field/coltype count mismatch"
check "count mismatch -> exit 1" 1 canon row-tuple "U64,STRING" "[1]"

# --- schema-driven seeding ---------------------------------------------------
echo
echo "green: seed-tuples fills every column from server/schema.snapshot.json's own types"
SNAP="$(fake_dir)/snap.json"
cat > "$SNAP" <<'JSON'
{"tables":[{"accessor":"widget","columns":[
  {"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false},
  {"name":"code","ty":"u32","primary_key":false,"auto_inc":false,"unique":true},
  {"name":"n","ty":"i32","primary_key":false,"auto_inc":false,"unique":false}
]}]}
JSON
OUT="$(canon seed-tuples "$SNAP" widget 2 1000)"
check_out "auto_inc pk is always 0; unique gets base+i; other cycles EDGE_VALUES" 0 \
  "(0,1000,-2147483648),(0,1001,2147483647)" \
  printf '%s' "$OUT"

echo
echo "red: seed-tuples on a Timestamp column names the table/column and refuses"
SNAP="$(fake_dir)/snap.json"
cat > "$SNAP" <<'JSON'
{"tables":[{"accessor":"widget","columns":[
  {"name":"created_at","ty":"Timestamp","primary_key":false,"auto_inc":false,"unique":false}
]}]}
JSON
OUT="$(canon seed-tuples "$SNAP" widget 1 1000 2>&1)"
CODE=$?
check "Timestamp column -> exit 1" 1 bash -c "exit $CODE"
check_out "message names the table and column" 0 "yes" bash -c "printf '%s' \"\$1\" | grep -qF \"'widget.created_at'\" && echo yes" _ "$OUT"

echo
echo "red: seed-tuples on a type with no edge-value entry fails loudly, not silently"
SNAP="$(fake_dir)/snap.json"
cat > "$SNAP" <<'JSON'
{"tables":[{"accessor":"widget","columns":[
  {"name":"weird","ty":"f64","primary_key":false,"auto_inc":false,"unique":false}
]}]}
JSON
check "unknown type -> exit 1" 1 canon seed-tuples "$SNAP" widget 1 1000

# --- name normalisation -------------------------------------------------------
echo
echo "green: normalize strips underscores and lowercases (x_0 and x0 agree)"
check_out "x_0 -> x0" 0 "x0" canon normalize "x_0"
check_out "x0 -> x0" 0 "x0" canon normalize "x0"

# --- manifest writing ---------------------------------------------------------
echo
echo "green: write-manifest produces valid, sorted-key JSON with the tables sub-object inlined"
TABLES="$(fake_dir)/tables.json"
printf '{"widget": {"rows": 2, "sha256": "abc"}}' > "$TABLES"
OUT="$(fake_dir)/manifest.json"
canon write-manifest "$OUT" "cli_version=2.9.0" "schema_sha256=deadbeef" "tables_file=$TABLES" >/dev/null
check_out "manifest round trips through json.load with the right fields" 0 "yes" bash -c "
\"$PY\" -c \"
import json
m = json.load(open(r'''$OUT''', encoding='utf-8'))
assert m['cli_version'] == '2.9.0'
assert m['schema_sha256'] == 'deadbeef'
assert m['tables']['widget']['rows'] == 2
print('yes')
\"
"

summary
