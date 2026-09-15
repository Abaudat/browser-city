#!/usr/bin/env bash
# scripts/ci/check-deploy-workflow.sh's own fast, no-real-workflow
# coverage: a minimal but structurally real deploy.yml, then each way it
# must fail -- a destructive long-form flag, the short -c form, and a
# publish job that does not needs: the backup job.
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
      - run: echo backing up

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
check "names the destructive flag" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'destructive publish flag'" _ "$OUT"

D2="$(fake_dir)"; write_good_workflow "$D2/deploy.yml"
sed -i 's/spacetime publish --server maincloud --no-config -y "\$DB" --module-path server/spacetime publish --server maincloud --no-config -y -c always "$DB" --module-path server/' "$D2/deploy.yml"
OUT="$(bash "$CHECK" "$D2/deploy.yml" 2>&1)"; CODE=$?
check "the short -c flag fails" 1 bash -c "exit $CODE"
check "names the short flag" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'standalone -c flag'" _ "$OUT"

D3="$(fake_dir)"; write_good_workflow "$D3/deploy.yml"
sed -i 's/spacetime publish --server maincloud --no-config -y "\$DB" --module-path server/spacetime publish --server maincloud --no-config -y --break-clients "$DB" --module-path server/' "$D3/deploy.yml"
OUT="$(bash "$CHECK" "$D3/deploy.yml" 2>&1)"; CODE=$?
check "--break-clients fails" 1 bash -c "exit $CODE"

D4="$(fake_dir)"; write_good_workflow "$D4/deploy.yml"
sed -i 's/needs: \[backup\]/needs: []/' "$D4/deploy.yml"
OUT="$(bash "$CHECK" "$D4/deploy.yml" 2>&1)"; CODE=$?
check "a publish job that does not needs: backup fails" 1 bash -c "exit $CODE"
check "names the missing needs:" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"does not needs: a 'backup' job\"" _ "$OUT"

D5="$(fake_dir)"
cat > "$D5/deploy.yml" <<'YAML'
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
OUT="$(bash "$CHECK" "$D5/deploy.yml" 2>&1)"; CODE=$?
check "no job runs spacetime publish at all fails" 1 bash -c "exit $CODE"
check "names the missing publish job" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'no job in'" _ "$OUT"

check "a missing workflow file fails" 1 bash "$CHECK" "$(fake_dir)/nope.yml"

summary
exit $?
