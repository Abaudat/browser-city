#!/usr/bin/env bash
# The Orca automation's precheck, end to end. See team-charter.md §3 and §8.
#
# Two gates in series, both free of tokens:
#   1. quota-gate.sh   -- is there budget? (§8)
#   2. scotty-wake.sh  -- is there anything to do? (§3)
#
# Exit 0 -> dispatch Scotty. The classifier's JSON is on stdout, so he arrives
#           knowing the branch rather than rediscovering it.
# Exit 1 -> skip. Either the budget is spent or the cycle has nothing to do.
#           Normal, expected, quiet.
# Exit 2 -> something is broken. NOT the same thing. Alarm on it.
#
# The order matters: budget first, because classification costs `gh` and `orca`
# calls, and there is no point learning what to do when nothing may be done.
#
# Each stage writes its own reason file next to the worktree, and this script
# does not merge them. Two files with one writer each is the same discipline
# the PR protocol uses, and for the same reason: a single shared record with
# two writers loses whichever wrote first.

set -o pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/quota-gate.sh" >/dev/null
case $? in
  0) ;;
  1) exit 1 ;;
  *) exit 2 ;;
esac

"$SCRIPT_DIR/scotty-wake.sh"
case $? in
  0) exit 0 ;;
  1) exit 1 ;;
  *) exit 2 ;;
esac
