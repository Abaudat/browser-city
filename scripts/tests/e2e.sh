#!/usr/bin/env bash
# End-to-end dry run of the orchestrator against the REAL GitHub repo, the
# REAL Project board, and REAL Orca/Claude sessions. Not part of run-all.sh
# (it hits live services, three real Claude sessions do real work, and a
# full run takes 15-45 minutes) -- run it directly:
#
#   bash scripts/tests/e2e.sh
#
# What it does: pushes a throwaway base branch (e2e-base) and points
# BC_BASE_BRANCH at it via the env file every bc-* process sources, creates
# a throwaway parent+sub issue on the board, ticks `orchestrator.sh` in a
# loop (printing exit/reason/current every tick, recording every Status
# transition with a timestamp) until the sub-issue reaches Done or 60
# minutes pass, drills a simulated Orca restart once along the way (closes
# every role terminal, then verifies the next tick brings each uuid back as
# exactly one non-duplicate terminal), and then tears every bit of this back
# down -- worktree, sessions, PR, both issues (deleted, not just closed),
# branches, and the env-file override -- via a trap so cleanup runs even on
# Ctrl-C or a timeout. The final block prints "E2E SUMMARY" once, which is
# what a caller waiting on the log greps for.
set -u
_BC_E2E_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
_BC_SCRIPTS_DIR="$(cd -- "$_BC_E2E_DIR/.." && pwd)"
# shellcheck source=../lib/config.sh
. "$_BC_SCRIPTS_DIR/lib/config.sh"
bc_init
# shellcheck source=../lib/gh.sh
. "$_BC_SCRIPTS_DIR/lib/gh.sh"
# shellcheck source=../lib/project.sh
. "$_BC_SCRIPTS_DIR/lib/project.sh"
# shellcheck source=../lib/orca.sh
. "$_BC_SCRIPTS_DIR/lib/orca.sh"
# shellcheck source=../lib/claude.sh
. "$_BC_SCRIPTS_DIR/lib/claude.sh"

ORCHESTRATOR="$_BC_SCRIPTS_DIR/orchestrator.sh"
bci() { bash "$_BC_SCRIPTS_DIR/bc-issue.sh" "$@"; }
bcc() { bash "$_BC_SCRIPTS_DIR/bc-comment.sh" "$@"; }
bcp() { bash "$_BC_SCRIPTS_DIR/bc-pr.sh" "$@"; }
bcs() { bash "$_BC_SCRIPTS_DIR/bc-session.sh" "$@"; }

TMP="${TEMP:-${TMPDIR:-/tmp}}"
ts() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

echo "=== e2e: starting $(ts) ==="
echo "=== e2e: repo=$BC_REPO project=$BC_PROJECT_OWNER/$BC_PROJECT_NUMBER ==="

# =============================================================================
# state tracked across setup/loop/cleanup
# =============================================================================
PARENT_NUM=""
SUB_NUM=""
ENV_FILE="$(bc_state_dir)/env.sh"
ENV_BACKUP=""
HAD_ENV_FILE=0
WT_PATH=""
declare -a TRANSITIONS=()
SCRIPT_FIXES=""
CLEANUP_NOTES=""
DRILL_RESULTS=""
CLEANUP_DONE=0

# =============================================================================
# cleanup -- idempotent, best-effort, runs on any exit (normal, Ctrl-C, or
# the 75-minute outer budget killing this process).
# =============================================================================
cleanup() {
  [ "$CLEANUP_DONE" -eq 1 ] && return
  CLEANUP_DONE=1
  echo
  echo "=== e2e: cleanup starting $(ts) ==="

  local pr_json pr_num pr_state pr_merged="no"

  if [ -n "$SUB_NUM" ]; then
    local wt
    wt="${WT_PATH:-}"
    if [ -z "$wt" ]; then
      wt="$(bcs worktree "$SUB_NUM" 2>/dev/null || true)"
    fi
    if [ -n "$wt" ]; then
      bcs stop-all "$SUB_NUM" "$wt" >/dev/null 2>&1 || true
    fi
    bcs rm-worktree "$SUB_NUM" >/dev/null 2>&1 || true

    # PR: search across all states so we can report merged? even if it's
    # already merged (bc-pr for-issue only ever finds OPEN PRs).
    pr_json="$("$GH" pr list --repo "$BC_REPO" --state all \
      --search "\"Closes #$SUB_NUM\" in:body" --json number,state 2>/dev/null || true)"
    if [ -n "$pr_json" ] && [ "$(printf '%s' "$pr_json" | "$JQ" 'length' 2>/dev/null || echo 0)" -gt 0 ]; then
      pr_num="$(printf '%s' "$pr_json" | "$JQ" -r '.[0].number')"
      pr_state="$(printf '%s' "$pr_json" | "$JQ" -r '.[0].state')"
      [ "$pr_state" = "MERGED" ] && pr_merged=yes
      if [ "$pr_state" = "OPEN" ]; then
        "$GH" pr close "$pr_num" --repo "$BC_REPO" >/dev/null 2>&1 || true
        pr_state="CLOSED"
      fi
      CLEANUP_NOTES="${CLEANUP_NOTES}PR #$pr_num state=$pr_state merged=$pr_merged
"
    else
      CLEANUP_NOTES="${CLEANUP_NOTES}no PR ever found for #$SUB_NUM
"
    fi
  fi

  # DELETE (not close) both issues via GraphQL -- removes them from the
  # project board too.
  _delete_issue() {
    local n="$1" node_id
    [ -n "$n" ] || return 0
    node_id="$("$GH" api "repos/$BC_REPO/issues/$n" --jq .node_id 2>/dev/null || true)"
    if [ -n "$node_id" ]; then
      "$GH" api graphql -f query='mutation($id:ID!){deleteIssue(input:{issueId:$id}){clientMutationId}}' \
        -F id="$node_id" >/dev/null 2>&1 \
        && CLEANUP_NOTES="${CLEANUP_NOTES}deleted issue #$n
" \
        || CLEANUP_NOTES="${CLEANUP_NOTES}FAILED to delete issue #$n
"
    else
      CLEANUP_NOTES="${CLEANUP_NOTES}could not resolve node_id for issue #$n (already gone?)
"
    fi
  }
  _delete_issue "$SUB_NUM"
  _delete_issue "$PARENT_NUM"

  local remaining
  remaining="$(project_items 2>/dev/null | "$JQ" 'length' 2>/dev/null || echo '?')"
  CLEANUP_NOTES="${CLEANUP_NOTES}project board item count after delete: $remaining
"

  # branches
  if [ -n "$SUB_NUM" ]; then
    git push origin --delete "Abaudat/issue-$SUB_NUM" >/dev/null 2>&1 \
      && CLEANUP_NOTES="${CLEANUP_NOTES}deleted remote branch Abaudat/issue-$SUB_NUM
" \
      || CLEANUP_NOTES="${CLEANUP_NOTES}remote branch Abaudat/issue-$SUB_NUM already gone (likely deleted by merge)
"
    git -C D:/Projects/BrowserCity branch -D "Abaudat/issue-$SUB_NUM" >/dev/null 2>&1 \
      && CLEANUP_NOTES="${CLEANUP_NOTES}deleted local branch Abaudat/issue-$SUB_NUM in D:/Projects/BrowserCity
" || true
  fi
  git push origin --delete "e2e-base" >/dev/null 2>&1 \
    && CLEANUP_NOTES="${CLEANUP_NOTES}deleted remote branch e2e-base
" \
    || CLEANUP_NOTES="${CLEANUP_NOTES}FAILED (or already gone) deleting remote branch e2e-base
"

  # env file
  if [ "$HAD_ENV_FILE" -eq 1 ] && [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE" && rm -f "$ENV_BACKUP"
    CLEANUP_NOTES="${CLEANUP_NOTES}restored original $ENV_FILE
"
  else
    rm -f "$ENV_FILE"
    CLEANUP_NOTES="${CLEANUP_NOTES}removed $ENV_FILE (none existed before this run)
"
  fi

  echo "=== e2e: cleanup done $(ts) ==="
  echo
  echo "E2E SUMMARY"
  echo "-----------"
  echo "parent issue: #${PARENT_NUM:-none}   sub issue: #${SUB_NUM:-none}"
  echo
  echo "Status transitions:"
  if [ "${#TRANSITIONS[@]}" -eq 0 ]; then
    echo "  (none observed)"
  else
    local t
    for t in "${TRANSITIONS[@]}"; do echo "  $t"; done
  fi
  echo
  echo "PR / cleanup notes:"
  printf '%s' "$CLEANUP_NOTES" | sed 's/^/  /'
  echo
  echo "Reboot drill results:"
  if [ -n "$DRILL_RESULTS" ]; then
    printf '%s' "$DRILL_RESULTS" | sed 's/^/  /'
  else
    echo "  drill never ran (sub-issue never reached 'To analyze' with sessions present, or run ended before it could)"
  fi
  echo
  if [ -n "$SCRIPT_FIXES" ]; then
    echo "Script fixes made during this run:"
    printf '%s' "$SCRIPT_FIXES" | sed 's/^/  /'
  else
    echo "Script fixes made during this run: none"
  fi
  echo
  echo "Note: a merged PR record itself cannot be deleted (GitHub has no PR-delete API) -- it is left as a permanent, harmless record of this run."
}
trap cleanup EXIT INT TERM

# =============================================================================
# 1. Setup
# =============================================================================
echo "=== e2e: setup: pushing throwaway base branch e2e-base from origin/master ==="
git fetch origin master
# The destination must be a fully qualified ref (refs/heads/e2e-base) --
# with a remote-tracking ref as the source ("origin/master"), git cannot
# guess an unqualified "e2e-base" destination and errors out with "not a
# full refname" instead of creating/updating the branch.
if ! git push origin origin/master:refs/heads/e2e-base 2>"$TMP/e2e-push.err"; then
  echo "=== e2e: setup: e2e-base likely already exists, force-pushing ==="
  git push -f origin origin/master:refs/heads/e2e-base
fi
rm -f "$TMP/e2e-push.err"

echo "=== e2e: setup: writing $ENV_FILE (BC_BASE_BRANCH=e2e-base) ==="
if [ -f "$ENV_FILE" ]; then
  HAD_ENV_FILE=1
  ENV_BACKUP="$(mktemp "$TMP/bc-env-backup.XXXXXX")"
  cp "$ENV_FILE" "$ENV_BACKUP"
  echo "=== e2e: setup: backed up existing env file to $ENV_BACKUP ==="
fi
printf 'BC_BASE_BRANCH=e2e-base\n' > "$ENV_FILE"

echo "=== e2e: setup: creating parent + sub issue ==="
PARENT_BODY="$(mktemp "$TMP/bc-e2e-parent.XXXXXX")"
printf 'Throwaway parent issue created by scripts/tests/e2e.sh for the orchestrator dry run. It and its sub-issue will be deleted by this script'\''s cleanup.\n' > "$PARENT_BODY"
PARENT_NUM="$(gh_issue_create "E2E: orchestrator smoke" "$PARENT_BODY" "")"
rm -f "$PARENT_BODY"
[ -n "$PARENT_NUM" ] || { echo "=== e2e: FATAL: could not create parent issue ==="; exit 2; }
echo "=== e2e: setup: parent issue #$PARENT_NUM ==="

SUB_BODY="$(mktemp "$TMP/bc-e2e-sub.XXXXXX")"
cat > "$SUB_BODY" <<'EOF'
Add `scripts/tests/test-hello.sh` that sources `scripts/tests/harness.sh`,
runs one `check` asserting `echo hello` prints `hello`, and wire it into
`scripts/tests/run-all.sh` if that file globs tests automatically (then no
change needed). Keep it under 20 lines.
EOF
SUB_NUM="$(gh_issue_create "Add a hello test in scripts/tests/" "$SUB_BODY" "lead:tim")"
rm -f "$SUB_BODY"
[ -n "$SUB_NUM" ] || { echo "=== e2e: FATAL: could not create sub issue ==="; exit 2; }
echo "=== e2e: setup: sub issue #$SUB_NUM ==="

SUB_DB_ID="$("$GH" api "repos/$BC_REPO/issues/$SUB_NUM" --jq .id)"
gh_issue_add_subissue "$PARENT_NUM" "$SUB_DB_ID" \
  || { echo "=== e2e: FATAL: could not link #$SUB_NUM as a sub-issue of #$PARENT_NUM ==="; exit 2; }

project_item "$PARENT_NUM" >/dev/null
project_item "$SUB_NUM" >/dev/null
CUR_SPRINT="$(project_iteration_for_date)"
CUR_SPRINT_ID="$(printf '%s' "$CUR_SPRINT" | "$JQ" -r '.id')"
[ -n "$CUR_SPRINT_ID" ] && [ "$CUR_SPRINT_ID" != "null" ] \
  || { echo "=== e2e: FATAL: no current sprint iteration for today ==="; exit 2; }
project_set_iteration "$PARENT_NUM" "$CUR_SPRINT_ID"
project_set_iteration "$SUB_NUM" "$CUR_SPRINT_ID"
project_set_single "$PARENT_NUM" Status Backlog
project_set_single "$SUB_NUM" Status Backlog
project_set_single "$PARENT_NUM" Priority Standard
project_set_single "$SUB_NUM" Priority Standard

echo "=== e2e: setup done: parent=#$PARENT_NUM sub=#$SUB_NUM sprint=$CUR_SPRINT_ID ==="

# =============================================================================
# 2. Tick loop, with the reboot drill (step 3) folded in
# =============================================================================
BUDGET_SECS=$((60 * 60))
START_TS=$(date +%s)
tick=0
last_status="__unset__"
drill_done=0
drill_pending=0
drill_wt=""
declare -a drill_uuids=()
declare -A drill_role_of=()
declare -A drill_transcript_before=()

echo
echo "=== e2e: entering tick loop (60 min budget, 60s between ticks) ==="

while :; do
  now_ts=$(date +%s)
  elapsed=$((now_ts - START_TS))
  if [ "$elapsed" -ge "$BUDGET_SECS" ]; then
    echo "=== e2e: tick loop: 60 minute budget exhausted, stopping ==="
    break
  fi

  tick=$((tick + 1))
  reason="$(bash "$ORCHESTRATOR" 2>>"$TMP/e2e-orchestrator-stderr.log")"
  ec=$?
  cur_out="$(bci current 2>/dev/null || true)"
  echo "tick $tick: exit=$ec reason=$reason current=$cur_out"

  # If the drill's stop-all ran last iteration, this tick is the "reboot"
  # tick -- verify (b) uuids are back, (c) exactly one terminal each, (d)
  # transcripts existed before restart (implying --resume).
  if [ "$drill_pending" -eq 1 ]; then
    echo "=== e2e: reboot drill: post-tick verification ==="
    DRILL_RESULTS="${DRILL_RESULTS}(a) before this tick, all uuids read 'absent' (see log above)
"
    term_json="$(orca_terminals "$drill_wt" 2>/dev/null || echo '[]')"
    for uuid in "${drill_uuids[@]}"; do
      role="${drill_role_of[$uuid]}"
      state="$(bcs state "$uuid" "$drill_wt" 2>/dev/null || true)"
      uuid8="${uuid:0:8}"
      count="$(printf '%s' "$term_json" | "$JQ" --arg p "($uuid8)" \
        '[.[] | select(.agentIdentity=="claude" and ((.title // "") | contains($p)))] | length' 2>/dev/null || echo '?')"
      tb="${drill_transcript_before[$uuid]:-unknown}"
      DRILL_RESULTS="${DRILL_RESULTS}(b) $role ($uuid8) state after tick = $state (want idle or working)
(c) $role ($uuid8) terminal count = $count (want exactly 1)
(d) $role ($uuid8) transcript existed before restart = $tb (implies --resume was used if yes)
"
    done
    drill_pending=0
  fi

  # figure out the sub-issue's actual status (works even once it's closed,
  # unlike `bci current` which only sees active statuses).
  sub_status="$(project_field_get "$SUB_NUM" Status 2>/dev/null || true)"
  sub_state="$("$GH" api "repos/$BC_REPO/issues/$SUB_NUM" --jq .state 2>/dev/null || true)"

  if [ "$sub_status" != "$last_status" ]; then
    TRANSITIONS+=("$(ts) -> ${sub_status:-<none>}")
    echo "*** transition: $(ts) -> ${sub_status:-<none>} ***"
    last_status="$sub_status"
  fi

  # Reboot drill trigger: first time we see "To analyze" with session uuids
  # already stubbed. Runs once only.
  if [ "$drill_done" -eq 0 ] && [ "$sub_status" = "To analyze" ]; then
    sessions_json="$(bcc sessions "$SUB_NUM" 2>/dev/null || true)"
    if [ -n "$sessions_json" ] && [ "$sessions_json" != "{}" ] && [ "$sessions_json" != "null" ]; then
      echo "=== e2e: reboot drill: triggering (sessions=$sessions_json) ==="
      drill_wt="$(bcs worktree "$SUB_NUM" 2>/dev/null || true)"
      WT_PATH="$drill_wt"
      drill_uuids=()
      while IFS='=' read -r role uuid; do
        [ -n "$uuid" ] || continue
        drill_uuids+=("$uuid")
        drill_role_of["$uuid"]="$role"
        if claude_transcript_exists "$drill_wt" "$uuid"; then
          drill_transcript_before["$uuid"]=yes
        else
          drill_transcript_before["$uuid"]=no
        fi
      done < <(printf '%s' "$sessions_json" | "$JQ" -r 'to_entries[] | "\(.key)=\(.value)"')

      echo "=== e2e: reboot drill: stopping all role terminals for #$SUB_NUM on $drill_wt ==="
      bcs stop-all "$SUB_NUM" "$drill_wt" >/dev/null 2>&1 || true

      for uuid in "${drill_uuids[@]}"; do
        role="${drill_role_of[$uuid]}"
        state="$(bcs state "$uuid" "$drill_wt" 2>/dev/null || true)"
        echo "=== e2e: reboot drill: (a) $role (${uuid:0:8}) state right after stop-all = $state (want absent) ==="
      done

      drill_done=1
      drill_pending=1
    fi
  fi

  if [ "$ec" -eq 2 ]; then
    echo "=== e2e: tick loop: exit==2 (broken), stopping ==="
    break
  fi
  if [ "$sub_status" = "Done" ] || [ "$sub_state" = "CLOSED" ]; then
    echo "=== e2e: tick loop: sub-issue #$SUB_NUM reached Done/closed ==="
    break
  fi

  sleep 60
done

echo
echo "=== e2e: tick loop finished after $tick ticks, elapsed $(( $(date +%s) - START_TS ))s ==="
# cleanup runs via the EXIT trap
