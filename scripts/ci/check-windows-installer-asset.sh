#!/usr/bin/env bash
# The cheapest possible drift detector for the upstream Windows installer
# windows-install-check.yml downloads directly (Quentin's direction,
# story 4.20): asserts the installer script served at
# https://windows.spacetimedb.com still fetches the exact asset name the
# workflow itself downloads, before the workflow trusts that URL. Never
# fetches the script itself -- the caller downloads it (a real network
# call belongs in the workflow, not in something this script's own tests
# must run offline) and hands its content here as a file or on stdin, so
# this is testable with a plain fixture and no network.
#
# Usage: check-windows-installer-asset.sh <asset-name> [installer-script-file]
#   [installer-script-file] defaults to stdin.
set -euo pipefail

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || {
  echo "check-windows-installer-asset: usage: check-windows-installer-asset.sh <asset-name> [installer-script-file]" >&2
  exit 1
}
ASSET_NAME="$1"
SCRIPT_FILE="${2:-/dev/stdin}"

[ -n "$ASSET_NAME" ] || { echo "check-windows-installer-asset: <asset-name> must not be empty" >&2; exit 1; }

if [ "$SCRIPT_FILE" != "/dev/stdin" ] && [ ! -f "$SCRIPT_FILE" ]; then
  echo "check-windows-installer-asset: $SCRIPT_FILE not found" >&2
  exit 1
fi

CONTENT="$(cat -- "$SCRIPT_FILE")"

if [ -z "$(printf '%s' "$CONTENT" | tr -d '[:space:]')" ]; then
  echo "check-windows-installer-asset: the installer script content is empty" >&2
  exit 1
fi

if ! printf '%s' "$CONTENT" | grep -qF "$ASSET_NAME"; then
  echo "check-windows-installer-asset: upstream installer changed -- https://windows.spacetimedb.com no longer downloads '$ASSET_NAME'" >&2
  exit 1
fi

echo "check-windows-installer-asset: upstream installer still downloads '$ASSET_NAME'" >&2
