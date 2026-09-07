#!/usr/bin/env bash
# NFR33's third acceptance criterion, made mechanical: diffs
# server/schema.snapshot.json (bounds/tests/schema_snapshot_current.rs
# keeps it honest against the source it was generated from) against the
# same file at the PR's merge base, and fails loudly on any of the five
# things automigration itself would reject:
#   - a table's primary key changed or removed
#   - a table's unique constraints changed or removed
#   - a table's scheduled status changed (including which reducer it names)
#   - a table or column removed, or a column retyped
#   - a column appended with neither #[default(...)] nor #[auto_inc]
# A brand new table needs none of this -- it has no history to violate.
#
# A guard that cannot resolve a base to diff against must not read as
# "nothing to guard": see check-golden-version-bump.sh, whose base
# resolution this copies verbatim.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SNAPSHOT_PATH="server/schema.snapshot.json"
[ -f "$SNAPSHOT_PATH" ] || { echo "check-schema-additive: $SNAPSHOT_PATH not found" >&2; exit 1; }

# `tr -d '\r'` guards against a jq build that emits CRLF on some hosts (see
# check-ci-gate.sh) -- harmless on any host that doesn't, and load-bearing
# here because every value below is later compared or fed back into jq's
# own `--arg`.
jqr() { jq "$@" | tr -d '\r'; }

_fail_or_skip() { # <message> -- hard fail under GITHUB_ACTIONS, soft skip otherwise
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    echo "check-schema-additive: FAIL -- $1" >&2
    exit 1
  fi
  echo "check-schema-additive: $1 -- skipping" >&2
  exit 0
}

if [ -n "${1:-}" ]; then
  BASE="$1"
elif [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  BASE="${GITHUB_BASE_REF:+origin/$GITHUB_BASE_REF}"
elif [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  BASE="HEAD^"
else
  BASE=""
fi

[ -n "$BASE" ] || _fail_or_skip "no base ref could be resolved"
git rev-parse --verify "$BASE" >/dev/null 2>&1 || _fail_or_skip "base ref '$BASE' not found"

MERGE_BASE="$(git merge-base "$BASE" HEAD)"

OLD_JSON="$(git show "$MERGE_BASE:$SNAPSHOT_PATH" 2>/dev/null || true)"
if [ -z "$OLD_JSON" ]; then
  echo "check-schema-additive: no $SNAPSHOT_PATH at merge base $MERGE_BASE -- this PR introduces it, nothing to diff against" >&2
  exit 0
fi

NEW_JSON="$(cat "$SNAPSHOT_PATH")"
FAILED=0

OLD_ACCESSORS="$(jqr -r '.tables[].accessor' <<<"$OLD_JSON")"
while IFS= read -r acc; do
  [ -n "$acc" ] || continue

  NEW_TABLE="$(jqr -c --arg a "$acc" '.tables[] | select(.accessor == $a)' <<<"$NEW_JSON")"
  if [ -z "$NEW_TABLE" ]; then
    echo "check-schema-additive: FAIL -- table '$acc' was removed" >&2
    FAILED=1
    continue
  fi
  OLD_TABLE="$(jqr -c --arg a "$acc" '.tables[] | select(.accessor == $a)' <<<"$OLD_JSON")"

  OLD_PK="$(jqr -c '[.columns[] | select(.primary_key) | .name] | sort' <<<"$OLD_TABLE")"
  NEW_PK="$(jqr -c '[.columns[] | select(.primary_key) | .name] | sort' <<<"$NEW_TABLE")"
  if [ "$OLD_PK" != "$NEW_PK" ]; then
    echo "check-schema-additive: FAIL -- table '$acc' primary key changed: $OLD_PK -> $NEW_PK" >&2
    FAILED=1
  fi

  OLD_UNIQUE="$(jqr -c '[.columns[] | select(.unique) | .name] | sort' <<<"$OLD_TABLE")"
  NEW_UNIQUE="$(jqr -c '[.columns[] | select(.unique) | .name] | sort' <<<"$NEW_TABLE")"
  if [ "$OLD_UNIQUE" != "$NEW_UNIQUE" ]; then
    echo "check-schema-additive: FAIL -- table '$acc' unique constraints changed: $OLD_UNIQUE -> $NEW_UNIQUE" >&2
    FAILED=1
  fi

  OLD_SCHED="$(jqr -r '.scheduled_reducer // "null"' <<<"$OLD_TABLE")"
  NEW_SCHED="$(jqr -r '.scheduled_reducer // "null"' <<<"$NEW_TABLE")"
  if [ "$OLD_SCHED" != "$NEW_SCHED" ]; then
    echo "check-schema-additive: FAIL -- table '$acc' scheduled status changed: '$OLD_SCHED' -> '$NEW_SCHED'" >&2
    FAILED=1
  fi

  OLD_COLS="$(jqr -r '.columns[].name' <<<"$OLD_TABLE")"
  while IFS= read -r col; do
    [ -n "$col" ] || continue
    NEW_COL="$(jqr -c --arg c "$col" '.columns[] | select(.name == $c)' <<<"$NEW_TABLE")"
    if [ -z "$NEW_COL" ]; then
      echo "check-schema-additive: FAIL -- table '$acc' column '$col' was removed" >&2
      FAILED=1
      continue
    fi
    OLD_TY="$(jqr -r --arg c "$col" '.columns[] | select(.name == $c) | .ty' <<<"$OLD_TABLE")"
    NEW_TY="$(jqr -r '.ty' <<<"$NEW_COL")"
    if [ "$OLD_TY" != "$NEW_TY" ]; then
      echo "check-schema-additive: FAIL -- table '$acc' column '$col' retyped: $OLD_TY -> $NEW_TY" >&2
      FAILED=1
    fi
  done <<<"$OLD_COLS"

  NEW_COLS="$(jqr -r '.columns[].name' <<<"$NEW_TABLE")"
  while IFS= read -r col; do
    [ -n "$col" ] || continue
    if ! jqr -e --arg c "$col" '.columns[] | select(.name == $c)' <<<"$OLD_TABLE" >/dev/null; then
      SAFE="$(jqr -r --arg c "$col" '.columns[] | select(.name == $c) | (.has_default or .auto_inc)' <<<"$NEW_TABLE")"
      if [ "$SAFE" != "true" ]; then
        echo "check-schema-additive: FAIL -- table '$acc' column '$col' was appended without #[default(...)] or #[auto_inc]" >&2
        FAILED=1
      fi
    fi
  done <<<"$NEW_COLS"
done <<<"$OLD_ACCESSORS"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-schema-additive: no permanent decision moved since $MERGE_BASE" >&2
exit 0
