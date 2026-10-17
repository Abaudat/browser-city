#!/usr/bin/env bash
# check-routing-graph-persistence.sh drives a real instance and is run by
# CI's `migrate` job. What this fast test pins is that the script and what
# it relies on stay wired: its port is unique, the test-only reducer
# exists only behind the `time-control` feature and is held out of the
# production flavour, and the migrate job runs the script.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci/check-routing-graph-persistence.sh"
DISTRICT="$REPO_ROOT/server/src/tables/district.rs"
CI="$REPO_ROOT/.github/workflows/ci.yml"

PORT="$(sed -nE 's/^PORT=([0-9]+)$/\1/p' "$SCRIPT" | head -1)"
check "the script names its port" 0 test -n "$PORT"
OTHERS="$(grep -lE "^PORT=$PORT\$" "$REPO_ROOT"/scripts/ci/check-*.sh | grep -v check-routing-graph-persistence || true)"
check "no other instance script uses its port" 0 test -z "$OTHERS"

REDUCER_GATE="$(grep -B3 'pub fn debug_write_graph_then_fail' "$DISTRICT")"
check_contains "the test-only reducer is cfg-gated on time-control" 'feature = "time-control"' "$REDUCER_GATE"

# The production-absence checks derive their list from the source, so the
# reducer is held out of the production module and required in the flavour
# by being in that list and by both checks reading it.
LISTED="$(bash "$REPO_ROOT/scripts/ci/list-time-control-reducers.sh")"
check_contains "the derived time-control list names it" 'debug_write_graph_then_fail' "$LISTED"
USES_IN_CI="$(grep -c 'list-time-control-reducers.sh' "$CI")"
check "ci.yml holds the derived list out of the production module and requires it in the flavour" 0 test "$USES_IN_CI" -ge 2
check "the authoritative-loop leg refuses the derived list on the production build" 0   grep -q 'list-time-control-reducers.sh' "$REPO_ROOT/scripts/ci/check-authoritative-loop.sh"
check "the migrate job runs the script" 0 grep -q 'check-routing-graph-persistence.sh' "$CI"

summary
exit $?
