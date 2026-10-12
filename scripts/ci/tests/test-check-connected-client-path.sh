#!/usr/bin/env bash
# scripts/ci/check-connected-client-path.sh's own fast coverage (story 4.14).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-connected-client-path.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/tables"
  cat >"$d/lib.rs" <<'RS'
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) -> Result<(), String> {
    tables::metrics::record_connect(ctx);
    Ok(())
}

#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    tables::metrics::record_disconnect(ctx);
}
RS
  cat >"$d/tables/metrics.rs" <<'RS'
pub fn record_connect(ctx: &ReducerContext) { ctx.db.connected_client().insert(row); }
pub fn record_disconnect(ctx: &ReducerContext) { ctx.db.connected_client().connection_id().delete(id); }
RS
  printf '%s\n' '// connected_client is mentioned in a comment only' 'pub fn other() {}' > "$d/tables/other.rs"
  printf '%s' "$d"
}

d="$(tree)"
check "the one writer path passes" 0 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn bad(ctx: &ReducerContext) { ctx.db.connected_client().iter(); }' >> "$d/tables/other.rs"
check "another file naming the accessor fails" 1 bash "$CHECK" "$d"

d="$(tree)"
printf '%s\n' 'pub fn bad(ctx: &ReducerContext) { super::metrics::record_disconnect(ctx); }' >> "$d/tables/other.rs"
check "another file calling record_disconnect fails" 1 bash "$CHECK" "$d"

d="$(tree)"
sed -i 's/record_disconnect(ctx);/record_connect(ctx);/' "$d/lib.rs"
check "a lifecycle reducer calling the wrong writer fails" 1 bash "$CHECK" "$d"

d="$(tree)"
rm "$d/tables/metrics.rs"
check "a tree with no metrics module fails loudly" 1 bash "$CHECK" "$d"

summary
