#!/usr/bin/env bash
# Walk any seed's district on a local instance: publishes the dev flavour
# (the `time-control` build, `debug_create_district`), generates the district
# for <seed> (default: the committed `city.seed`) and prints how to open the
# client on it. Local instances only -- never Maincloud.
#
# Usage: scripts/dev/walk-district.sh [seed] [database-name]
#   then: (cd client && npm run dev)  and open the printed URL.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SEED="${1:-}"
DB="${2:-browser-city-walk}"

bash "$REPO_ROOT/scripts/dev/publish-dev.sh" "$DB" --server local --delete-data=always
if [ -n "$SEED" ]; then
  spacetime call "$DB" --server local -y debug_create_district "$SEED"
else
  spacetime call "$DB" --server local -y create_district
fi
echo "walk-district: $DB holds the district (seed ${SEED:-city.seed}); run \`npm run dev\` in client/ and open the printed URL" >&2
