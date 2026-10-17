#!/usr/bin/env bash
# Generates the city's district on a world that has none. Owner-only, run by
# `deploy.yml`'s `publish-module` job after `finish_publish` and before the
# invariants assertion; safe on every deploy because it calls
# `create_district` only when the private `district` table is empty
# (counted by an owner SQL query, never by matching an error string).
#
# Usage: ensure-district.sh <db> --server <server>
set -uo pipefail

USAGE="usage: ensure-district.sh <db> --server <server>"
DB="${1:-}"
[ -n "$DB" ] || { echo "ensure-district: $USAGE" >&2; exit 1; }
[ "${2:-}" = "--server" ] && [ -n "${3:-}" ] && [ "$#" -eq 3 ] || { echo "ensure-district: $USAGE" >&2; exit 1; }
SERVER="$3"

command -v spacetime >/dev/null 2>&1 || { echo "ensure-district: 'spacetime' is not on PATH" >&2; exit 1; }

OUT="$(spacetime sql "$DB" --server "$SERVER" --no-config -y "SELECT district_id FROM district" 2>&1)" \
  || { echo "ensure-district: FAIL -- could not count district rows of '$DB':" >&2; echo "$OUT" >&2; exit 1; }
N="$(printf '%s\n' "$OUT" | tr -d '\r' | awk '/^[- +]+$/ { seen=1; next } seen && NF' | grep -c . || true)"

if [ "$N" -ge 1 ]; then
  echo "ensure-district: '$DB' already has $N district row(s); nothing to generate" >&2
  exit 0
fi

echo "ensure-district: '$DB' has no district; generating the city" >&2
spacetime call "$DB" --server "$SERVER" --no-config -y create_district \
  || { echo "ensure-district: FAIL -- create_district failed on '$DB'" >&2; exit 1; }
echo "ensure-district: the city's district is generated on '$DB'" >&2
