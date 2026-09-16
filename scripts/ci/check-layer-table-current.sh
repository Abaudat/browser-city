#!/usr/bin/env bash
# The client's one mirror of sim::codes::layer (client/src/render/
# layer-table.ts, story 1.6 cycle 2) and tools/defs-build's own deprecated-
# layer-name copy (layer_codes.rs's DEPRECATED_LAYER_NAMES, story 2.2
# cycle 1) must never drift from the server's golden-pinned mapping --
# Quentin/Tim's direction: a hand-maintained copy with no guard is not
# acceptable a second time. Parses server/sim/tests/goldens/codes_v1.golden's
# `layer` rows (code, name, rank, in order) and server/sim/src/codes.rs's
# own `DEPRECATED_CODES` list, and fails if either mirror disagrees: the
# client's `LAYER_TABLE` on any code, name, rank or deprecated flag, or
# defs-build's `DEPRECATED_LAYER_NAMES` on the exact set of deprecated
# names. No cargo, no node: every side is read as plain text, so this
# runs in client-check (whose filter already includes server/**) at
# effectively zero cost.
# Usage: check-layer-table-current.sh [golden] [codes.rs] [layer-table.ts]
#   [layer_codes.rs] -- every argument optional, defaulting to the real
#   repo paths; `scripts/ci/tests/test-check-layer-table-current.sh` is
#   the only caller that ever overrides them, with throwaway fakes
#   planting a drift.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

GOLDEN="${1:-$REPO_ROOT/server/sim/tests/goldens/codes_v1.golden}"
CODES_RS="${2:-$REPO_ROOT/server/sim/src/codes.rs}"
LAYER_TABLE_TS="${3:-$REPO_ROOT/client/src/render/layer-table.ts}"
LAYER_CODES_RS="${4:-$REPO_ROOT/tools/defs-build/src/layer_codes.rs}"

for f in "$GOLDEN" "$CODES_RS" "$LAYER_TABLE_TS" "$LAYER_CODES_RS"; do
  [ -f "$f" ] || { echo "check-layer-table-current: $f not found" >&2; exit 1; }
done

# --- the server's own truth: golden rows plus the deprecated set -----------
GOLDEN_ROWS="$(grep -E '^layer ' "$GOLDEN")"
DEPRECATED_LINE="$(grep -oE 'DEPRECATED_CODES: &\[u32\] = &\[[^]]*\]' "$CODES_RS" || true)"
if [ -z "$DEPRECATED_LINE" ]; then
  echo "check-layer-table-current: FAIL -- could not find DEPRECATED_CODES in $CODES_RS" >&2
  exit 1
fi
DEPRECATED_CODES="$(printf '%s' "$DEPRECATED_LINE" | grep -oE '\[[0-9, ]*\]$' | tr -d '[]' | tr ',' '\n' | tr -d ' ' | sed '/^$/d' | sort -n)"

# --- the client's claimed truth ---------------------------------------------
# One row per line: "code name rank deprecated" -- pulled out of the
# object-literal array with a tolerant regex rather than a JS parser,
# same idiom check-codes-append-only.sh uses for the Rust side.
CLIENT_ROWS="$(
  awk '
    /code:[[:space:]]*[0-9]+/ {
      code=$0; name=$0; rank=$0; dep=$0
      gsub(/.*code:[[:space:]]*/, "", code); gsub(/[^0-9].*/, "", code)
      gsub(/.*name:[[:space:]]*"/, "", name); gsub(/".*/, "", name)
      gsub(/.*rank:[[:space:]]*/, "", rank); gsub(/[^0-9].*/, "", rank)
      gsub(/.*deprecated:[[:space:]]*/, "", dep); gsub(/[^a-z].*/, "", dep)
      print code, name, rank, dep
    }
  ' "$LAYER_TABLE_TS"
)"

if [ -z "$CLIENT_ROWS" ]; then
  echo "check-layer-table-current: FAIL -- no rows parsed out of $LAYER_TABLE_TS -- did its shape change?" >&2
  exit 1
fi

FAILED=0

GOLDEN_COUNT="$(printf '%s\n' "$GOLDEN_ROWS" | wc -l | tr -d ' ')"
CLIENT_COUNT="$(printf '%s\n' "$CLIENT_ROWS" | wc -l | tr -d ' ')"
if [ "$GOLDEN_COUNT" != "$CLIENT_COUNT" ]; then
  echo "check-layer-table-current: FAIL -- $GOLDEN has $GOLDEN_COUNT layer rows but $LAYER_TABLE_TS has $CLIENT_COUNT -- regenerate the client table" >&2
  FAILED=1
fi

i=1
while [ "$i" -le "$GOLDEN_COUNT" ] && [ "$i" -le "$CLIENT_COUNT" ]; do
  g_row="$(printf '%s\n' "$GOLDEN_ROWS" | sed -n "${i}p")"
  c_row="$(printf '%s\n' "$CLIENT_ROWS" | sed -n "${i}p")"
  g_code="$(printf '%s' "$g_row" | awk '{print $2}')"
  g_name="$(printf '%s' "$g_row" | awk '{print $3}')"
  g_rank="$(printf '%s' "$g_row" | awk '{print $4}')"
  c_code="$(printf '%s' "$c_row" | awk '{print $1}')"
  c_name="$(printf '%s' "$c_row" | awk '{print $2}')"
  c_rank="$(printf '%s' "$c_row" | awk '{print $3}')"
  c_dep="$(printf '%s' "$c_row" | awk '{print $4}')"

  if [ "$g_code" != "$c_code" ] || [ "$g_name" != "$c_name" ] || [ "$g_rank" != "$c_rank" ]; then
    echo "check-layer-table-current: FAIL -- row $i disagrees: golden '$g_code $g_name $g_rank' vs client '$c_code $c_name $c_rank'" >&2
    FAILED=1
  fi

  is_deprecated="false"
  if printf '%s\n' "$DEPRECATED_CODES" | grep -qxF "$c_code"; then
    is_deprecated="true"
  fi
  if [ "$is_deprecated" != "$c_dep" ]; then
    echo "check-layer-table-current: FAIL -- code $c_code: sim::codes::layer::DEPRECATED_CODES says deprecated=$is_deprecated, $LAYER_TABLE_TS says deprecated=$c_dep" >&2
    FAILED=1
  fi

  i=$((i + 1))
done

# --- defs-build's own deprecated-name copy ----------------------------------
# The names DEPRECATED_CODES's own codes resolve to, via the golden --
# never a second, independent list of deprecated names.
DEPRECATED_NAMES=""
for code in $DEPRECATED_CODES; do
  name="$(printf '%s\n' "$GOLDEN_ROWS" | awk -v c="$code" '$2 == c { print $3 }')"
  [ -n "$name" ] && DEPRECATED_NAMES="$DEPRECATED_NAMES
$name"
done
DEPRECATED_NAMES="$(printf '%s\n' "$DEPRECATED_NAMES" | sed '/^$/d' | sort)"

LAYER_CODES_DEPRECATED_LINE="$(grep -oE 'DEPRECATED_LAYER_NAMES: &\[&str\] = &\[[^]]*\]' "$LAYER_CODES_RS" || true)"
if [ -z "$LAYER_CODES_DEPRECATED_LINE" ]; then
  echo "check-layer-table-current: FAIL -- could not find DEPRECATED_LAYER_NAMES in $LAYER_CODES_RS" >&2
  exit 1
fi
DEFS_BUILD_DEPRECATED="$(
  printf '%s' "$LAYER_CODES_DEPRECATED_LINE" |
    grep -oE '\[[^]]*\]$' | tr -d '[]"' | tr ',' '\n' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' |
    sed '/^$/d' | sort
)"

if [ "$DEPRECATED_NAMES" != "$DEFS_BUILD_DEPRECATED" ]; then
  echo "check-layer-table-current: FAIL -- sim::codes::layer::DEPRECATED_CODES resolves to names [$(printf '%s' "$DEPRECATED_NAMES" | tr '\n' ' ')] but $LAYER_CODES_RS's DEPRECATED_LAYER_NAMES is [$(printf '%s' "$DEFS_BUILD_DEPRECATED" | tr '\n' ' ')]" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-layer-table-current: client/src/render/layer-table.ts and tools/defs-build's DEPRECATED_LAYER_NAMES both match codes_v1.golden and DEPRECATED_CODES exactly" >&2
exit 0
