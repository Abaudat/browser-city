#!/usr/bin/env bash
# Files or updates one tracking issue on a scheduled workflow's failure --
# extracted from windows-install-check.yml (Tim's direction for story
# 1.4), which used this exact shape inline first. windows-install-check.yml
# and deploy.yml's report-failure job both call this, so the "search for an
# existing open issue by title, comment instead of duplicating" logic lives
# in exactly one place. backup.yml does NOT call it -- it is
# workflow_dispatch-only, deliberately (see its own header) -- so wiring its
# reporting is a story of its own, not this one. A weekly/daily schedule
# reports to nobody by default -- the Actions tab is not something anyone
# watches.
#
# Story 4.19 (Tim's direction): the new issue is labelled `alert,lead:tim`,
# never scored or scoped here -- CI's token cannot write to the project
# board at all (no `project` scope, and none should ever be handed to it).
# `bc-issue.sh adopt-alerts` is what puts an open `alert` issue on the
# board, as a Blocker/XS, before the orchestrator's next pick; the comment
# path below sets no field at all, so a report that has already been
# triaged (moved off Backlog) is never dragged back by a repeat failure.
#
# Usage: report-scheduled-failure.sh <title> <body>
#
# Requires GH_TOKEN and GITHUB_REPOSITORY (both already exported by every
# GitHub Actions job), and GITHUB_SERVER_URL/GITHUB_RUN_ID when the caller
# wants the run URL folded into <body> itself (it usually should be).
#
# Quentin's direction, cycle 1: the label the create path needs must never
# depend on someone having run `setup-github.sh` by hand first -- that is a
# code path nobody tests, and the first real failure after a fresh repo (or
# a label deleted by hand) would otherwise abort on an unknown label and
# file NOTHING, worse than no triage at all. So this script makes its own
# labels exist first, `gh label create --force` (idempotent: a no-op colour/
# description overwrite when the label is already there, same as
# setup-github.sh's own `gh_label_create`), same colour/description as
# setup-github.sh's own `LABEL_DEFS` entries.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "report-scheduled-failure: usage: report-scheduled-failure.sh <title> <body>" >&2; exit 1; }
TITLE="$1"
BODY="$2"

[ -n "${GH_TOKEN:-}" ] || { echo "report-scheduled-failure: GH_TOKEN is not set" >&2; exit 1; }
[ -n "${GITHUB_REPOSITORY:-}" ] || { echo "report-scheduled-failure: GITHUB_REPOSITORY is not set" >&2; exit 1; }

# GitHub's `in:title` search is a fuzzy phrase match (`watcher: table
# citizen over alert` also finds `... citizen_state over alert`), so the
# candidates are post-filtered on exact title equality.
CANDIDATES="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --limit 100 --search "in:title \"$TITLE\"" --json number,title || true)"
EXISTING="$(printf '%s' "$CANDIDATES" | jq -r --arg title "$TITLE" '[.[]? | select(.title == $title)][0].number // empty' | tr -d "\r" || true)"
if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --repo "$GITHUB_REPOSITORY" --body "$BODY"
  echo "report-scheduled-failure: commented on existing issue #$EXISTING" >&2
else
  gh label create alert --repo "$GITHUB_REPOSITORY" --color e11d21 \
    --description "A CI-filed failure report; adopt-alerts puts it on the board as a Blocker" --force \
    || { echo "report-scheduled-failure: could not create the 'alert' label" >&2; exit 1; }
  gh label create lead:tim --repo "$GITHUB_REPOSITORY" --color 5319e7 \
    --description "In scope for Tim (Tech Lead) review" --force \
    || { echo "report-scheduled-failure: could not create the 'lead:tim' label" >&2; exit 1; }
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body "$BODY" --label alert,lead:tim
  echo "report-scheduled-failure: filed a new tracking issue" >&2
fi
