#!/usr/bin/env bash
# Drives the dev-only city clock (FR163) over `spacetime call`, against a
# database published by `scripts/dev/publish-dev.sh`:
#   clock.sh <database> jump <city-minutes>   skip the clock forward
#   clock.sh <database> speed <n>             set the multiplier (1..100)
# Extra `spacetime call` args (e.g. --server local) may follow. Arguments
# are validated before any call is made.
set -euo pipefail

usage() { echo "usage: clock.sh <database> jump <city-minutes> | speed <n> [spacetime call args...]" >&2; exit 2; }
[ "$#" -ge 3 ] || usage
DB="$1"; VERB="$2"; N="$3"
shift 3

case "$N" in
  ''|*[!0-9]*) echo "clock: '$N' is not a positive whole number" >&2; exit 2 ;;
esac
[ "$N" -ge 1 ] || { echo "clock: '$N' must be at least 1 (a jump is forward only)" >&2; exit 2; }

case "$VERB" in
  jump) REDUCER=jump_clock ;;
  speed) REDUCER=set_clock_speed ;;
  *) usage ;;
esac

spacetime call "$DB" "$REDUCER" "$N" "$@"
