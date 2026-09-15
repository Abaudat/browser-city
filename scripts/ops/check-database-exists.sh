#!/usr/bin/env bash
# The deploy story's NFR39 exception, made positive rather than `|| true`
# in disguise (Quentin's direction, PR #288 cycle 1): "the database does
# not exist yet" is recognised by the CLI's own specific not-found
# wording, pinned to the version scripts/ci/install-spacetimedb-cli.sh
# installs (2.9.0, confirmed against a real local instance) -- any other
# `spacetime describe` failure (a network blip, a Maincloud 5xx, an auth
# problem, a CLI wording change) is a hard failure, never silently read as
# "doesn't exist yet". `.github/workflows/deploy.yml`'s `backup` job is
# the one caller; `scripts/ci/check-deploy-workflow.sh` asserts that job
# uses this script rather than inlining its own `spacetime describe`.
#
# Usage: check-database-exists.sh <db> [--server <server>]
# Prints "true" or "false" on stdout and exits 0 when the answer is known
# either way; exits 1 (with the CLI's own stderr) on anything else.
set -uo pipefail

USAGE="usage: check-database-exists.sh <db> [--server <server>]"
DB="${1:-}"
[ -n "$DB" ] || { echo "check-database-exists: $USAGE" >&2; exit 1; }
shift
SERVER_ARGS=()
if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
  SERVER_ARGS=(--server "$2")
  shift 2
fi
[ "$#" -eq 0 ] || { echo "check-database-exists: unrecognized argument(s): $* -- $USAGE" >&2; exit 1; }

command -v spacetime >/dev/null 2>&1 || { echo "check-database-exists: 'spacetime' is not on PATH" >&2; exit 1; }

ERRLOG="$(mktemp)"
trap 'rm -f "$ERRLOG"' EXIT

if spacetime describe "$DB" "${SERVER_ARGS[@]}" --no-config -y --json >/dev/null 2>"$ERRLOG"; then
  echo "true"
  exit 0
fi

# The CLI's own specific not-found wording -- anything else (including no
# output at all) is a hard failure, never treated as "doesn't exist yet".
if grep -qF "failed to find database" "$ERRLOG"; then
  echo "false"
  exit 0
fi

echo "check-database-exists: 'spacetime describe $DB' failed for a reason other than 'database not found' -- refusing to guess:" >&2
cat "$ERRLOG" >&2
exit 1
