#!/usr/bin/env bash
# Idempotent one-time (and safe-to-rerun) setup for the orchestrator's
# GitHub-side prerequisites: the labels every level-2 script assumes exist,
# and the `project` OAuth scope every project.sh mutation needs. Exit 0 if
# everything was already in place or is now created; exit 2 if the token is
# missing the project scope (nothing this script can fix on its own).
set -u
_BC_SETUP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/config.sh
. "$_BC_SETUP_DIR/lib/config.sh"
bc_init
# shellcheck source=lib/gh-cli.sh
. "$_BC_SETUP_DIR/lib/gh-cli.sh"

echo "setup-github: checking auth scopes..." >&2
SCOPES=" $(gh_auth_scopes) "
if [[ "$SCOPES" != *" project "* ]]; then
  echo "setup-github: token is missing the 'project' scope (has:$SCOPES); run: gh auth refresh -s project" >&2
  exit 2
fi
echo "setup-github: token has the project scope" >&2

EXISTING="$(gh_label_list)" || { echo "setup-github: could not list labels" >&2; exit 2; }

# name | color(no #) | description -- '|' delimited because label names
# themselves contain ':' (lead:derek, lead:tim, lead:artie).
LABEL_DEFS=(
  "${BC_LEAD_LABEL_PREFIX}derek|5319e7|In scope for Derek (Game Designer) review"
  "${BC_LEAD_LABEL_PREFIX}tim|5319e7|In scope for Tim (Tech Lead) review"
  "${BC_LEAD_LABEL_PREFIX}artie|5319e7|In scope for Artie (Art Director) review"
  "$BC_LABEL_DEMO|0e8a16|Marks the weekly Friday demo issue"
  "$BC_LABEL_BREAKER|b60205|Circuit breaker: cycle limit reached, escalated to a human"
)

CREATED=0
SKIPPED=0
for def in "${LABEL_DEFS[@]}"; do
  name="${def%%|*}"
  rest="${def#*|}"
  color="${rest%%|*}"
  desc="${rest#*|}"
  if printf '%s' "$EXISTING" | "$JQ" -e --arg n "$name" 'index($n) != null' >/dev/null 2>&1; then
    echo "setup-github: label '$name' already exists, skipping" >&2
    SKIPPED=$((SKIPPED + 1))
  else
    if gh_label_create "$name" "$color" "$desc"; then
      echo "setup-github: created label '$name'" >&2
      CREATED=$((CREATED + 1))
    else
      echo "setup-github: FAILED to create label '$name'" >&2
      exit 2
    fi
  fi
done

echo "setup-github: done ($CREATED created, $SKIPPED already present)" >&2
exit 0
