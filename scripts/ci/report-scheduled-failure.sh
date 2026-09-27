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
# wants the run URL folded into <body> itself (it usually should be). The
# label requires `alert` to already exist in the repo -- run
# agentic-team/scripts/setup-github.sh (idempotent) once, ahead of the
# first run that could need it.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "report-scheduled-failure: usage: report-scheduled-failure.sh <title> <body>" >&2; exit 1; }
TITLE="$1"
BODY="$2"

[ -n "${GH_TOKEN:-}" ] || { echo "report-scheduled-failure: GH_TOKEN is not set" >&2; exit 1; }
[ -n "${GITHUB_REPOSITORY:-}" ] || { echo "report-scheduled-failure: GITHUB_REPOSITORY is not set" >&2; exit 1; }

EXISTING="$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "in:title \"$TITLE\"" --json number --jq '.[0].number' || true)"
if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --repo "$GITHUB_REPOSITORY" --body "$BODY"
  echo "report-scheduled-failure: commented on existing issue #$EXISTING" >&2
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body "$BODY" --label alert,lead:tim
  echo "report-scheduled-failure: filed a new tracking issue" >&2
fi
