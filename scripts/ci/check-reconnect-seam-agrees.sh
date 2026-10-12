#!/usr/bin/env bash
# Story 4.14 (FR172): a silent drop is noticed up to the client's
# PROBE_TIMEOUT_MS after it happened, so the reconnection-continuity seam
# (sim::gameplay_metrics::RECONNECT_SEAM_MS) must equal it; changing one
# flags the other. Read as text on both sides (NFR30: no shared code).
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RS="${1:-$REPO_ROOT/server/sim/src/gameplay_metrics.rs}"
TS="${2:-$REPO_ROOT/client/src/net/reconnect-policy.ts}"
num() { tr -d '\r' <"$1" | grep -E "$2" | head -n1 | sed -E 's/.*=[[:space:]]*([0-9_]+).*/\1/' | tr -d '_'; }
SEAM="$(num "$RS" 'pub const RECONNECT_SEAM_MS')"
PROBE="$(num "$TS" 'export const PROBE_TIMEOUT_MS')"
[ -n "$SEAM" ] && [ -n "$PROBE" ] || { echo "check-reconnect-seam-agrees: FAIL -- could not read both constants (seam='$SEAM', probe='$PROBE')" >&2; exit 1; }
[ "$SEAM" = "$PROBE" ] || { echo "check-reconnect-seam-agrees: FAIL -- RECONNECT_SEAM_MS ($SEAM) != PROBE_TIMEOUT_MS ($PROBE): change them together" >&2; exit 1; }
echo "check-reconnect-seam-agrees: seam and probe timeout are both ${SEAM} ms" >&2
