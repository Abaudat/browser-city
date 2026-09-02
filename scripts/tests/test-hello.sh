#!/usr/bin/env bash
# Smoke canary: proves the harness and run-all.sh's glob still pick up a
# bare test-*.sh file with no fixtures, no lib, nothing but bash.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/harness.sh"

check_out "echo prints hello" 0 hello echo hello

summary
