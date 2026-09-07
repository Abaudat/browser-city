#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-ci-gate.sh. Fixtures are
# needs/changes JSON blobs plus a minimal fabricated workflow YAML file --
# never the real repo's ci.yml, so this suite keeps testing the script's
# logic even after that file's shape changes.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-ci-gate.sh"

# write_good_workflow <path> -- a minimal but structurally real ci.yml: a
# `changes` job, two simply-gated jobs (server, client filters), one
# compound-condition job (e2e, mirroring the real one's
# always()/needs.client-build.result shape), and the `ci` aggregate.
write_good_workflow() {
  cat > "$1" <<'YAML'
name: CI
on:
  pull_request:
jobs:
  changes:
    name: changes
    runs-on: ubuntu-latest
    steps:
      - run: echo noop

  check:
    name: check
    needs: changes
    if: needs.changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo noop

  client-check:
    name: client-check
    needs: changes
    if: needs.changes.outputs.client == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo noop

  client-build:
    name: client-build
    needs: changes
    if: needs.changes.outputs.client == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo noop

  e2e:
    name: e2e
    needs: [changes, client-build]
    if: |
      always() &&
      needs.changes.outputs.e2e == 'true' &&
      (needs.client-build.result == 'success' || needs.client-build.result == 'skipped')
    runs-on: ubuntu-latest
    steps:
      - run: echo noop

  ci:
    name: ci
    runs-on: ubuntu-latest
    needs: [changes, check, client-check, client-build, e2e]
    if: ${{ !cancelled() }}
    steps:
      - run: bash scripts/ci/check-ci-gate.sh '${{ toJSON(needs) }}' '${{ toJSON(needs.changes.outputs) }}'
YAML
}

fresh_workflow() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  mkdir -p "$d"
  write_good_workflow "$d/ci.yml"
  printf '%s' "$d/ci.yml"
}

run_check() { bash "$CHECK" "$1" "$2" "$3"; }

ALL_SUCCESS='{
  "changes": {"result": "success"},
  "check": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
NOTHING_CHANGED='{"server":"false","client":"false","e2e":"false"}'
ALL_CHANGED='{"server":"true","client":"true","e2e":"true"}'

echo "green: every job succeeded, regardless of what changed"
WF="$(fresh_workflow)"
check "all-success + nothing-changed passes" 0 run_check "$ALL_SUCCESS" "$NOTHING_CHANGED" "$WF"
check "all-success + all-changed passes" 0 run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$WF"

echo
echo "green: server jobs skipped because server did not change, client jobs ran"
WF="$(fresh_workflow)"
CLIENT_ONLY_RAN='{
  "changes": {"result": "success"},
  "check": {"result": "skipped"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
CLIENT_ONLY_CHANGED='{"server":"false","client":"true","e2e":"true"}'
check "server job correctly gated off passes" 0 run_check "$CLIENT_ONLY_RAN" "$CLIENT_ONLY_CHANGED" "$WF"

echo
echo "green: e2e still runs (compound if:) when client-build was skipped (server-only change)"
WF="$(fresh_workflow)"
SERVER_ONLY_RAN='{
  "changes": {"result": "success"},
  "check": {"result": "success"},
  "client-check": {"result": "skipped"},
  "client-build": {"result": "skipped"},
  "e2e": {"result": "success"}
}'
SERVER_ONLY_CHANGED='{"server":"true","client":"false","e2e":"true"}'
check "e2e's compound condition resolves to the 'e2e' filter" 0 run_check "$SERVER_ONLY_RAN" "$SERVER_ONLY_CHANGED" "$WF"

echo
echo "red: a job was skipped even though its filter says its paths changed"
WF="$(fresh_workflow)"
SKIPPED_BUT_CHANGED='{
  "changes": {"result": "success"},
  "check": {"result": "skipped"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$SKIPPED_BUT_CHANGED" "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the offending job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'check' was skipped but its filter 'server' reports 'true'\"" _ "$OUT"

echo
echo "red: a job failed outright"
WF="$(fresh_workflow)"
ONE_FAILED='{
  "changes": {"result": "success"},
  "check": {"result": "failure"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$ONE_FAILED" "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the failed job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'check' did not succeed (result: 'failure')\"" _ "$OUT"

echo
echo "red: a job was cancelled"
WF="$(fresh_workflow)"
ONE_CANCELLED='{
  "changes": {"result": "success"},
  "check": {"result": "success"},
  "client-check": {"result": "cancelled"},
  "client-build": {"result": "success"},
  "e2e": {"result": "success"}
}'
OUT="$(run_check "$ONE_CANCELLED" "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"

echo
echo "red: needs-json is missing an entry for a job ci.yml's 'ci:' needs"
WF="$(fresh_workflow)"
MISSING_JOB='{
  "changes": {"result": "success"},
  "check": {"result": "success"},
  "client-check": {"result": "success"},
  "client-build": {"result": "success"}
}'
OUT="$(run_check "$MISSING_JOB" "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing entry" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"no entry for job 'e2e'\"" _ "$OUT"

echo
echo "red: needs-json has a job the workflow's 'ci:' needs: does not know about (the hole)"
WF="$(fresh_workflow)"
GHOST_JOB="$(echo "$ALL_SUCCESS" | sed 's/"e2e": {"result": "success"}/"e2e": {"result": "success"}, "ghost-job": {"result": "failure"}/')"
OUT="$(run_check "$GHOST_JOB" "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the unknown job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'ghost-job', which is neither 'changes' nor a job\"" _ "$OUT"

echo
echo "red: a job exists in the workflow but is not in ci.yml's 'ci:' needs: (the reverse hole)"
D5="$(fake_dir)"; rm -rf "$D5"; mkdir -p "$D5"
write_good_workflow "$D5/ci.yml"
cat >> "$D5/ci.yml" <<'YAML'

  orphan-job:
    name: orphan-job
    needs: changes
    if: needs.changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo noop
YAML
OUT="$(run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$D5/ci.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the orphaned job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"job 'orphan-job' exists\"" _ "$OUT"
check "explains it is invisible to the gate" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"is not in the 'ci:' job's needs:\"" _ "$OUT"

echo
echo "red: the changes job itself did not succeed"
WF="$(fresh_workflow)"
CHANGES_FAILED='{
  "changes": {"result": "failure"},
  "check": {"result": "skipped"},
  "client-check": {"result": "skipped"},
  "client-build": {"result": "skipped"},
  "e2e": {"result": "skipped"}
}'
OUT="$(run_check "$CHANGES_FAILED" "$NOTHING_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the changes job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'changes' did not succeed (result: 'failure')\"" _ "$OUT"

echo
echo "red: a job in ci.yml's needs: has no if: filter reference at all"
D="$(fake_dir)"; rm -rf "$D"; mkdir -p "$D"
write_good_workflow "$D/ci.yml"
sed -i "/^  check:\$/,/^  client-check:\$/{ /if: needs.changes.outputs.server/d }" "$D/ci.yml"
OUT="$(run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$D/ci.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the ungated job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"job 'check' has no 'needs.changes.outputs.<filter>' reference\"" _ "$OUT"

echo
echo "red: a job's block references more than one distinct changes filter -- ambiguous"
D2="$(fake_dir)"; rm -rf "$D2"; mkdir -p "$D2"
write_good_workflow "$D2/ci.yml"
sed -i "s/if: needs.changes.outputs.server == 'true'/if: needs.changes.outputs.server == 'true' || needs.changes.outputs.client == 'true'/" "$D2/ci.yml"
OUT="$(run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$D2/ci.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the ambiguity" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"references more than one changes filter\"" _ "$OUT"

echo
echo "red: needs: in the ci job is not a single-line flow list"
D3="$(fake_dir)"; rm -rf "$D3"; mkdir -p "$D3"
write_good_workflow "$D3/ci.yml"
sed -i "s/needs: \[changes, check, client-check, client-build, e2e\]/needs:\n      - changes\n      - check/" "$D3/ci.yml"
OUT="$(run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$D3/ci.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the parse failure" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'single-line flow list'" _ "$OUT"

echo
echo "red: the workflow file has no 'ci:' job"
D4="$(fake_dir)"; rm -rf "$D4"; mkdir -p "$D4"
cat > "$D4/ci.yml" <<'YAML'
jobs:
  changes:
    runs-on: ubuntu-latest
    steps:
      - run: echo noop
YAML
OUT="$(run_check "$ALL_SUCCESS" "$ALL_CHANGED" "$D4/ci.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing ci job" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"has no 'ci:' job\"" _ "$OUT"

echo
echo "red: malformed JSON"
WF="$(fresh_workflow)"
OUT="$(bash "$CHECK" '{not json' "$ALL_CHANGED" "$WF" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the parse failure" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'does not parse as JSON'" _ "$OUT"

echo
echo "red: missing arguments"
OUT="$(bash "$CHECK" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing argument" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'missing <needs-json>'" _ "$OUT"

echo
echo "red: the workflow file does not exist"
OUT="$(bash "$CHECK" "$ALL_SUCCESS" "$ALL_CHANGED" "$(fake_dir)/nope.yml" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'not found'" _ "$OUT"

summary
