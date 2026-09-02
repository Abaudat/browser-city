#!/usr/bin/env bash
# Smoke canary: proves harness.sh loads and run-all.sh's glob picks up a
# newly added test-*.sh with no wiring. AC2: echo hello prints hello.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/harness.sh"

check_out "echo prints hello" 0 hello echo hello

summary
