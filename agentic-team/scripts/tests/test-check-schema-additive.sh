#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-schema-additive.sh. Never
# reads the live repo's own schema.snapshot.json -- every fixture is a
# scratch git repo built here, with a `base` tag standing in for the PR's
# merge base. Each case is checked for its OWN failure reason (grepped out
# of the script's message), not merely a non-zero exit -- a guard that only
# ever goes green for the right reason, and red for any reason, is not
# protection (per Quentin's review of PR #268).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-schema-additive.sh"

BASE_JSON='{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'

# fresh_repo <json> -- a scratch git repo with one commit (tagged "base")
# carrying server/schema.snapshot.json = <json>, and the real script copied
# in at scripts/ci/ so REPO_ROOT (derived from $BASH_SOURCE) resolves
# inside the fixture rather than the real repo.
fresh_repo() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d/server" "$d/scripts/ci"
  cp "$CHECK" "$d/scripts/ci/check-schema-additive.sh"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.com
  git -C "$d" config user.name t
  printf '%s' "$1" > "$d/server/schema.snapshot.json"
  git -C "$d" add -A
  git -C "$d" commit -q -m base
  git -C "$d" tag base
  printf '%s' "$d"
}

# set_new <dir> <json> -- overwrites the working tree's snapshot (HEAD, in
# effect) without committing -- the script only ever reads the working
# tree file for the "new" side, and `git show base:...` for the "old" side.
set_new() {
  printf '%s' "$2" > "$1/server/schema.snapshot.json"
}

run_check() { # <dir> [base-ref]
  ( cd "$1" && bash scripts/ci/check-schema-additive.sh "${2:-base}" )
}

run_check_env() { # <dir> <GITHUB_ACTIONS value> [base-ref]
  ( cd "$1" && GITHUB_ACTIONS="$2" bash scripts/ci/check-schema-additive.sh "${3:-}" )
}

assert_fails_with() { # <name> <dir> <grep-pattern>
  local name="$1" d="$2" pattern="$3"
  local out code
  out="$(run_check "$d" 2>&1)"
  code=$?
  check "$name: exits non-zero" 1 bash -c "exit $code"
  check "$name: names the reason" 0 bash -c \
    "printf '%s' \"\$1\" | grep -qF \"\$2\"" _ "$out" "$pattern"
}

assert_passes() { # <name> <dir>
  local name="$1" d="$2"
  local out code
  out="$(run_check "$d" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    printf '  FAIL %s -> expected exit 0, got %s\n       %s\n' "$name" "$code" "$out"
    fail=$((fail + 1))
  else
    printf '  ok   %s\n' "$name"
    pass=$((pass + 1))
  fi
}

echo "green: no change at all"
D="$(fresh_repo "$BASE_JSON")"
assert_passes "identical snapshot" "$D"

echo
echo "green: a brand-new table needs no history"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]},{"accessor":"bar","struct_name":"Bar","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_passes "new table alongside the old one" "$D"

echo
echo "green: column appended with a default"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},{"name":"extra","ty":"u32","primary_key":false,"auto_inc":false,"unique":false,"has_default":true,"indexed":false}]}]}'
assert_passes "appended with #[default(...)]" "$D"

echo
echo "green: column appended with auto_inc"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},{"name":"extra","ty":"u32","primary_key":false,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_passes "appended with #[auto_inc]" "$D"

echo
echo "red: column appended with neither default nor auto_inc"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},{"name":"extra","ty":"u32","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "appended without default or auto_inc" "$D" "appended without"

echo
echo "red: primary key moved to a different column"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":true,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "primary key changed" "$D" "primary key changed"

echo
echo "red: a unique constraint added to an existing column"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":true,"has_default":false,"indexed":false}]}]}'
assert_fails_with "unique constraint added" "$D" "unique constraints changed"

echo
echo "red: a unique constraint removed"
UNIQUE_BASE='{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":true,"has_default":false,"indexed":false}]}]}'
D="$(fresh_repo "$UNIQUE_BASE")"
set_new "$D" "$BASE_JSON"
assert_fails_with "unique constraint removed" "$D" "unique constraints changed"

echo
echo "red: table starts being scheduled"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":"tick","wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "scheduled status flipped false -> true" "$D" "scheduled status changed"

echo
echo "red: table stops being scheduled"
SCHED_BASE='{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":"tick","wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
D="$(fresh_repo "$SCHED_BASE")"
set_new "$D" "$BASE_JSON"
assert_fails_with "scheduled status flipped true -> false" "$D" "scheduled status changed"

echo
echo "red: the scheduled reducer's own name changes"
D="$(fresh_repo "$SCHED_BASE")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":"other_tick","wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "scheduled reducer renamed" "$D" "scheduled status changed"

echo
echo "red: a whole table removed"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[]}'
assert_fails_with "table removed" "$D" "table 'foo' was removed"

echo
echo "red: a column removed"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "column removed" "$D" "column 'label' was removed"

echo
echo "red: a column retyped"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"u32","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "column retyped" "$D" "retyped"

echo
echo "red: two existing columns swapped (an insertion-free reorder)"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false},{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "columns reordered" "$D" "reordered or removed"

echo
echo "red: a new column inserted ahead of an existing one"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"extra","ty":"u32","primary_key":false,"auto_inc":false,"unique":false,"has_default":true,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":false}]}]}'
assert_fails_with "column inserted ahead of an existing one" "$D" "reordered or removed"

echo
echo "green: an index added or dropped is not an additivity failure"
D="$(fresh_repo "$BASE_JSON")"
set_new "$D" '{"tables":[{"accessor":"foo","struct_name":"Foo","public":false,"scheduled_reducer":null,"wide_table_waiver":null,"columns":[{"name":"id","ty":"u64","primary_key":true,"auto_inc":true,"unique":false,"has_default":false,"indexed":false},{"name":"label","ty":"String","primary_key":false,"auto_inc":false,"unique":false,"has_default":false,"indexed":true}]}]}'
assert_passes "index presence alone" "$D"

echo
echo "green: no snapshot at the merge base -- this PR introduces it"
D="$(fake_dir)"
rm -rf "$D"
mkdir -p "$D/server" "$D/scripts/ci"
cp "$CHECK" "$D/scripts/ci/check-schema-additive.sh"
git -C "$D" init -q
git -C "$D" config user.email t@t.com
git -C "$D" config user.name t
echo nothing > "$D/README"
git -C "$D" add -A
git -C "$D" commit -q -m nosnap
git -C "$D" tag base
printf '%s' "$BASE_JSON" > "$D/server/schema.snapshot.json"
assert_passes "no prior snapshot to violate" "$D"

echo
echo "hard fail: unresolvable base under GITHUB_ACTIONS"
D="$(fresh_repo "$BASE_JSON")"
OUT="$(run_check_env "$D" true "no-such-ref" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "fails loudly rather than silently" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'FAIL'" _ "$OUT"

echo
echo "soft skip: unresolvable base outside GITHUB_ACTIONS"
D="$(fresh_repo "$BASE_JSON")"
OUT="$(run_check_env "$D" "" "no-such-ref" 2>&1)"; CODE=$?
check "exits zero (nothing to guard locally)" 0 bash -c "exit $CODE"

summary
