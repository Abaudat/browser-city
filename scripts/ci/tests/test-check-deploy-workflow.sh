#!/usr/bin/env bash
# scripts/ci/check-deploy-workflow.sh's own fast, no-real-workflow
# coverage: a minimal but structurally real deploy.yml, then each way it
# must fail -- a destructive long-form flag, the short -c form,
# `spacetime delete`, a publish job that does not needs: the backup job,
# a *second* publish job that does not, and a publish job whose own
# `always()`/`failure()`/`!cancelled()` condition can still run it after
# a failed backup (Quentin's cycle-1 direction, PR #288: `needs:
# [backup]` alone is decorative against any of those three).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-deploy-workflow.sh"

write_good_workflow() { # <path>
  cat > "$1" <<'YAML'
name: deploy
on:
  workflow_dispatch:
jobs:
  backup:
    name: backup
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/ops/check-database-exists.sh "$DB" --server maincloud

  publish-module:
    name: publish-module
    needs: [backup]
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB" --module-path server

  deploy-client:
    name: deploy-client
    needs: [publish-module]
    runs-on: ubuntu-latest
    steps:
      - run: echo deploying client
YAML
}

fresh_workflow() {
  local d
  d="$(fake_dir)"
  write_good_workflow "$d/deploy.yml"
  printf '%s' "$d/deploy.yml"
}

WF="$(fresh_workflow)"
check "a well-formed deploy.yml passes" 0 bash "$CHECK" "$WF"

D1="$(fake_dir)"; write_good_workflow "$D1/deploy.yml"
sed -i 's/spacetime publish --server maincloud --no-config -y "\$DB" --module-path server/spacetime publish --server maincloud --no-config -y --delete-data "$DB" --module-path server/' "$D1/deploy.yml"
OUT="$(bash "$CHECK" "$D1/deploy.yml" 2>&1)"; CODE=$?
check "--delete-data fails" 1 bash -c "exit $CODE"
check "names the destructive flag" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'destructive command or flag'" _ "$OUT"

D2="$(fake_dir)"; write_good_workflow "$D2/deploy.yml"
sed -i 's/spacetime publish --server maincloud --no-config -y "\$DB" --module-path server/spacetime publish --server maincloud --no-config -y -c always "$DB" --module-path server/' "$D2/deploy.yml"
OUT="$(bash "$CHECK" "$D2/deploy.yml" 2>&1)"; CODE=$?
check "the short -c flag fails" 1 bash -c "exit $CODE"
check "names the short flag" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'standalone -c flag'" _ "$OUT"

D3="$(fake_dir)"; write_good_workflow "$D3/deploy.yml"
sed -i 's/spacetime publish --server maincloud --no-config -y "\$DB" --module-path server/spacetime publish --server maincloud --no-config -y --break-clients "$DB" --module-path server/' "$D3/deploy.yml"
OUT="$(bash "$CHECK" "$D3/deploy.yml" 2>&1)"; CODE=$?
check "--break-clients fails" 1 bash -c "exit $CODE"

D3B="$(fake_dir)"; write_good_workflow "$D3B/deploy.yml"
cat >> "$D3B/deploy.yml" <<'YAML'

  cleanup:
    name: cleanup
    runs-on: ubuntu-latest
    steps:
      - run: spacetime delete --server maincloud --no-config -y "$DB"
YAML
OUT="$(bash "$CHECK" "$D3B/deploy.yml" 2>&1)"; CODE=$?
check "'spacetime delete' anywhere in the workflow fails" 1 bash -c "exit $CODE"
check "names the destructive command" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'destructive command or flag'" _ "$OUT"

D4="$(fake_dir)"; write_good_workflow "$D4/deploy.yml"
sed -i 's/needs: \[backup\]/needs: []/' "$D4/deploy.yml"
OUT="$(bash "$CHECK" "$D4/deploy.yml" 2>&1)"; CODE=$?
check "a publish job that does not needs: backup fails" 1 bash -c "exit $CODE"
check "names the missing needs:" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"does not needs: a 'backup' job\"" _ "$OUT"

echo
echo "a second publishing job is checked too, not only the first"
D5="$(fake_dir)"; write_good_workflow "$D5/deploy.yml"
cat >> "$D5/deploy.yml" <<'YAML'

  publish-second:
    name: publish-second
    needs: []
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB2" --module-path server2
YAML
OUT="$(bash "$CHECK" "$D5/deploy.yml" 2>&1)"; CODE=$?
check "a second publish job with no needs: backup fails" 1 bash -c "exit $CODE"
check "names the second job" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"'publish-second'\"" _ "$OUT"

echo
echo "needs: [backup] is decorative if the job's own condition can still run it after a failed backup"
for cond in "always()" "failure()" "!cancelled()"; do
  D6="$(fake_dir)"; write_good_workflow "$D6/deploy.yml"
  sed -i "/^  publish-module:\$/a\\    if: ${cond}" "$D6/deploy.yml"
  OUT="$(bash "$CHECK" "$D6/deploy.yml" 2>&1)"; CODE=$?
  check "if: ${cond} on the publish job fails" 1 bash -c "exit $CODE"
  check "names the reason for '${cond}'" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'could still run after'" _ "$OUT"
done

D7="$(fake_dir)"; write_good_workflow "$D7/deploy.yml"
sed -i "/^  publish-module:\$/a\\    if: needs.changes.outputs.client == 'true'" "$D7/deploy.yml"
check "an ordinary if: (no always/failure/!cancelled) on the publish job still passes" 0 bash "$CHECK" "$D7/deploy.yml"

echo
echo "the backup job's first-deploy exception must be the positive script, never an inline describe"
D9="$(fake_dir)"; write_good_workflow "$D9/deploy.yml"
sed -i 's#bash scripts/ops/check-database-exists.sh "\$DB" --server maincloud#spacetime describe "$DB" --server maincloud --no-config -y --json#' "$D9/deploy.yml"
OUT="$(bash "$CHECK" "$D9/deploy.yml" 2>&1)"; CODE=$?
check "an inline 'spacetime describe' in backup fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'inlines its own'" _ "$OUT"

D10="$(fake_dir)"; write_good_workflow "$D10/deploy.yml"
sed -i 's#bash scripts/ops/check-database-exists.sh "\$DB" --server maincloud#echo skip#' "$D10/deploy.yml"
OUT="$(bash "$CHECK" "$D10/deploy.yml" 2>&1)"; CODE=$?
check "a backup job that never calls check-database-exists.sh fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'never calls scripts/ops/check-database-exists.sh'" _ "$OUT"

D8="$(fake_dir)"
cat > "$D8/deploy.yml" <<'YAML'
name: deploy
on:
  workflow_dispatch:
jobs:
  backup:
    name: backup
    runs-on: ubuntu-latest
    steps:
      - run: echo backing up
YAML
OUT="$(bash "$CHECK" "$D8/deploy.yml" 2>&1)"; CODE=$?
check "no job runs spacetime publish at all fails" 1 bash -c "exit $CODE"
check "names the missing publish job" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'no job in'" _ "$OUT"

check "a missing workflow file fails" 1 bash "$CHECK" "$(fake_dir)/nope.yml"

summary
exit $?
