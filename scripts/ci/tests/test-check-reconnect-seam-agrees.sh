#!/usr/bin/env bash
# scripts/ci/check-reconnect-seam-agrees.sh's own fast coverage (story 4.14).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-reconnect-seam-agrees.sh"

d="$(fake_dir)"
rs() { printf '%s\n' "pub const RECONNECT_SEAM_MS: u32 = $1;" >"$d/m.rs"; }
ts() { printf '%s\n' "export const PROBE_TIMEOUT_MS = $1;" >"$d/p.ts"; }

rs 5_000; ts 5_000
check "agreeing constants pass" 0 bash "$CHECK" "$d/m.rs" "$d/p.ts"
rs 5_000; ts 6_000
check "differing constants fail" 1 bash "$CHECK" "$d/m.rs" "$d/p.ts"
printf '%s\n' "pub const RENAMED_MS: u32 = 5_000;" >"$d/m.rs"; ts 5_000
check "a renamed server constant fails" 1 bash "$CHECK" "$d/m.rs" "$d/p.ts"
rs 5_000; printf '%s\n' "export const OTHER = 5_000;" >"$d/p.ts"
check "a renamed client constant fails" 1 bash "$CHECK" "$d/m.rs" "$d/p.ts"
rs 5_000; ts 5000
check "digit separators are not significant" 0 bash "$CHECK" "$d/m.rs" "$d/p.ts"

summary
