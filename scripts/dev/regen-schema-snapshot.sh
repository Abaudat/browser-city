#!/usr/bin/env bash
# Regenerates server/schema.snapshot.json from server/src's current
# source and writes it in place. Run this after adding, removing or
# changing any #[spacetimedb::table] field, then commit the result --
# `bounds/tests/schema_snapshot_current.rs` fails CI otherwise.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/server"
cargo run -p bounds --bin regen-schema-snapshot
