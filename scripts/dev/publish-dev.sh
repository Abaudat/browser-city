#!/usr/bin/env bash
# Builds the module WITH the `time-control` feature (FR163: the dev-only
# `jump_clock`/`set_clock_speed` reducers) and publishes it. The one way
# that flavour is ever published: `spacetime build` cannot pass cargo
# features, and `deploy.yml` (`--module-path server`) never sees the
# feature. Local instances only -- never Maincloud.
#
# Usage: scripts/dev/publish-dev.sh <database-name> [spacetime publish args...]
#   e.g. scripts/dev/publish-dev.sh browser-city --server local
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

[ "$#" -ge 1 ] || { echo "usage: publish-dev.sh <database-name> [spacetime publish args...]" >&2; exit 2; }
DB_NAME="$1"
shift

for a in "$@"; do
  case "$a" in
    *maincloud*) echo "publish-dev: refusing to publish the time-control flavour to Maincloud" >&2; exit 2 ;;
  esac
done

(cd "$REPO_ROOT/server" && cargo build --features time-control --target wasm32-unknown-unknown --release -p browser_city) >&2
WASM="$REPO_ROOT/server/target/wasm32-unknown-unknown/release/browser_city.wasm"
[ -f "$WASM" ] || { echo "publish-dev: $WASM was not built" >&2; exit 1; }

spacetime publish "$DB_NAME" --bin-path "$WASM" -y "$@"
