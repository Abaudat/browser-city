#!/usr/bin/env bash
# `sim::generation::plan` / `generate` are the only way a cross-pass
# caller chains the generator's passes (docs/architecture.md, "Generation").
# A hand-written `land_use::run -> streets::run -> plots::run ->
# envelopes::run -> building_types::run` chain in a harness is a second
# copy of the chain that every new pass then has to be added to -- so any
# call to `plots::run(`, `envelopes::run(` or `building_types::run(`
# under server/sim/tests/ or server/bounds/ fails this check unless the
# line itself carries the marker
#
#     // generation-entry-point: allow
#
# reserved for the few properties that deliberately feed one pass a
# perturbed or repeated predecessor (the two independence properties and
# the golden's pass-2-run-twice determinism test). A marker, not a line
# number, so the allowlist moves with the code it excuses. Single-pass
# unit tests live in the pass's own module under server/sim/src/ and are
# out of scope here.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

OFFENDERS="$(
  git ls-files 'server/sim/tests/*.rs' 'server/bounds/*.rs' -z |
    xargs -0 -r grep -nE '(plots|envelopes|building_types)::run\(' |
    grep -v 'generation-entry-point: allow' || true
)"

if [ -n "$OFFENDERS" ]; then
  echo "check-generation-entry-point: FAIL -- a cross-pass harness hand-chains the generator; call sim::generation::plan or generate instead (or mark the line '// generation-entry-point: allow' if it deliberately perturbs a predecessor):" >&2
  printf '%s\n' "$OFFENDERS" >&2
  exit 1
fi

echo "check-generation-entry-point: every cross-pass harness goes through plan/generate"
