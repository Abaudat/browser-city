#!/usr/bin/env bash
# Canary on the harness contract itself: AC1 harness.sh loads, AC2 a
# check_out call observes stdout, AC3 run-all.sh's glob picks this file up.
set -u
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/harness.sh"

check_out "echo hello prints hello" 0 hello echo hello

summary
