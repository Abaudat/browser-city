#!/usr/bin/env bash
# scripts/ci/check-reducer-counted.sh's own fast coverage (story 4.13,
# NFR17): plants reducers and procedures in a throwaway directory and
# asserts the first-statement rule.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-reducer-counted.sh"

COUNTED='#[spacetimedb::reducer]
pub fn ok(ctx: &ReducerContext) {
    count_call(ctx, ReducerClass::Player);
}'

plant() { # <content> -- writes it to a fresh fake dir's only *.rs file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/lib.rs"
  printf '%s' "$d"
}

d="$(plant '#[spacetimedb::reducer]
pub fn a(ctx: &ReducerContext) -> Result<(), String> {
    count_call(ctx, ReducerClass::Player);
    Ok(())
}')"
check "a counted reducer passes" 0 bash "$CHECK" "$d"

d="$(plant '#[spacetimedb::reducer]
pub fn a(ctx: &ReducerContext) -> Result<(), String> {
    Ok(())
}')"
check "an uncounted reducer fails" 1 bash "$CHECK" "$d"
OUT="$(bash "$CHECK" "$d" 2>&1)"
check_contains "names the reducer" "`a` does not start with count_call" "$OUT"

d="$(plant '#[spacetimedb::reducer]
pub fn a(ctx: &ReducerContext) -> Result<(), String> {
    require_owner(ctx)?;
    count_call(ctx, ReducerClass::Operator);
    Ok(())
}')"
check "count_call not first fails" 1 bash "$CHECK" "$d"

d="$(plant '#[spacetimedb::reducer]
pub fn a(
    ctx: &ReducerContext,
    rows: Vec<Row>,
) -> Result<(), String> {
    // counted first
    count_call(ctx, ReducerClass::Operator);
    Ok(())
}')"
check "a multi-line signature and a leading comment pass" 0 bash "$CHECK" "$d"

d="$(plant '#[spacetimedb::procedure]
pub fn p(ctx: &mut ProcedureContext) -> Timestamp {
    ctx.timestamp
}')"
check "an uncounted procedure fails" 1 bash "$CHECK" "$d"

d="$(plant '#[spacetimedb::procedure]
pub fn p(ctx: &mut ProcedureContext) -> Timestamp {
    ctx.with_tx(|tx| count_call(tx, ReducerClass::Player));
    ctx.timestamp
}')"
check "a procedure counting through with_tx passes" 0 bash "$CHECK" "$d"

d="$(plant "$COUNTED"'
#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> { Ok(()) }
#[spacetimedb::reducer(client_connected)]
pub fn c(_ctx: &ReducerContext) {
}
#[spacetimedb::reducer(client_disconnected)]
pub fn d(_ctx: &ReducerContext) {
}')"
check "lifecycle reducers are exempt" 0 bash "$CHECK" "$d"

d="$(plant "$COUNTED"'
/// mentions #[spacetimedb::reducer] in prose
pub fn helper(ctx: &ReducerContext) {
    do_thing(ctx);
}')"
check "a doc comment naming the attribute is not a reducer" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
mkdir -p "$d/generated"
printf '%s
' "$COUNTED" > "$d/lib.rs"
printf '%s\n' '#[spacetimedb::reducer]
pub fn g(ctx: &ReducerContext) {
    x();
}' > "$d/generated/skip.rs"
check "generated/ is excluded" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s\n' 'pub fn nothing() {}' > "$d/lib.rs"
check "a tree with no reducer at all fails (the scan found nothing)" 1 bash "$CHECK" "$d"

check "the real server/src passes" 0 bash "$CHECK"

summary
exit $?
