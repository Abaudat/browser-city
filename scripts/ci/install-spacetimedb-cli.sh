#!/usr/bin/env bash
# Installs the SpacetimeDB CLI on a Linux CI runner from a pinned GitHub
# release artefact, verified by checksum -- never a remote install script
# piped into a shell. Shared by ci.yml's `e2e` job and deploy.yml's module
# job, so the pin lives in exactly one place. Bump VERSION and SHA256
# together, from `spacetime-x86_64-unknown-linux-gnu.tar.gz`'s digest on
# https://github.com/clockworklabs/SpacetimeDB/releases/tag/v<VERSION> --
# the same 2.9.x line server/Cargo.toml pins the spacetimedb crate to.
set -euo pipefail

VERSION="2.9.0"
SHA256="47ae6878595afe888c71a12e269584e188e6a7cefe54f9301ccf22405bad9b3b"
ASSET="spacetime-x86_64-unknown-linux-gnu.tar.gz"
URL="https://github.com/clockworklabs/SpacetimeDB/releases/download/v${VERSION}/${ASSET}"

INSTALL_DIR="${1:-$HOME/.local/spacetimedb}"
mkdir -p "$INSTALL_DIR"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -sSL -o "$WORK/$ASSET" "$URL"

ACTUAL_SHA256="$(sha256sum "$WORK/$ASSET" | awk '{print $1}')"
if [ "$ACTUAL_SHA256" != "$SHA256" ]; then
  echo "install-spacetimedb-cli: FAIL -- checksum mismatch for $ASSET" >&2
  echo "  expected: $SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  exit 1
fi

tar -xzf "$WORK/$ASSET" -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/spacetimedb-cli" "$INSTALL_DIR/spacetimedb-standalone"
ln -sf "$INSTALL_DIR/spacetimedb-cli" "$INSTALL_DIR/spacetime"

echo "install-spacetimedb-cli: installed $VERSION to $INSTALL_DIR" >&2
echo "$INSTALL_DIR"
