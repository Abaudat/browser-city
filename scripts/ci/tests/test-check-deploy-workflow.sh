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
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: bash scripts/ops/check-database-exists.sh "$DB" --server maincloud

  publish-module:
    name: publish-module
    needs: [backup]
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB" --module-path server
      - run: spacetime call --server maincloud --no-config -y "$DB" finish_publish
      - run: spacetime call --server maincloud --no-config -y "$DB" accept_oidc_issuer "${{ vars.OIDC_AUTHORITY }}" "${{ vars.OIDC_CLIENT_ID }}"
      - run: bash scripts/ops/assert-world-invariants.sh "$DB" --server maincloud

  deploy-client:
    name: deploy-client
    needs: [publish-module]
    runs-on: ubuntu-latest
    steps:
      - run: echo deploying client
        env:
          VITE_OIDC_AUTHORITY: ${{ vars.OIDC_AUTHORITY }}
          VITE_OIDC_CLIENT_ID: ${{ vars.OIDC_CLIENT_ID }}

  report-failure:
    name: report-failure
    needs: [backup, publish-module, deploy-client]
    if: always() && (contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))
    runs-on: ubuntu-latest
    steps:
      - run: echo reporting
YAML
}

fresh_workflow() {
  local d
  d="$(fake_dir)"
  write_good_workflow "$d/deploy.yml"
  printf '%s' "$d/deploy.yml"
}

write_good_backup_workflow() { # <path>
  cat > "$1" <<'YAML'
name: backup
on:
  workflow_dispatch:
jobs:
  export:
    name: export
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: bash scripts/ops/export-world.sh "$DB" /tmp/export --server maincloud
YAML
}

fresh_backup_workflow() {
  local d
  d="$(fake_dir)"
  write_good_backup_workflow "$d/backup.yml"
  printf '%s' "$d/backup.yml"
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
echo "YAML mapping keys have no required order -- a key written after steps: must be read the same as one written before (Quentin's cycle-2 direction, PR #288)"
D7B="$(fake_dir)"
cat > "$D7B/deploy.yml" <<'YAML'
name: deploy
on:
  workflow_dispatch:
jobs:
  backup:
    name: backup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: bash scripts/ops/check-database-exists.sh "$DB" --server maincloud

  publish-module:
    name: publish-module
    needs: [backup]
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB" --module-path server
    if: always()
YAML
OUT="$(bash "$CHECK" "$D7B/deploy.yml" 2>&1)"; CODE=$?
check "if: always() written *after* steps: still fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'could still run after'" _ "$OUT"

D7C="$(fake_dir)"
cat > "$D7C/deploy.yml" <<'YAML'
name: deploy
on:
  workflow_dispatch:
jobs:
  backup:
    name: backup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: bash scripts/ops/check-database-exists.sh "$DB" --server maincloud

  publish-module:
    name: publish-module
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB" --module-path server
      - run: spacetime call --server maincloud --no-config -y "$DB" finish_publish
      - run: bash scripts/ops/assert-world-invariants.sh "$DB" --server maincloud
    needs: [backup]

  report-failure:
    name: report-failure
    needs: [backup, publish-module]
    if: always() && (contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))
    runs-on: ubuntu-latest
    steps:
      - run: echo reporting
YAML
check "needs: [backup] written *after* steps: still passes (not a false FAIL)" 0 bash "$CHECK" "$D7C/deploy.yml"

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

echo
echo "story 4.18: the backup job's own checkout must not be shallow"
D11="$(fake_dir)"; write_good_workflow "$D11/deploy.yml"
sed -i 's/fetch-depth: 0/fetch-depth: 1/' "$D11/deploy.yml"
OUT="$(bash "$CHECK" "$D11/deploy.yml" 2>&1)"; CODE=$?
check "fetch-depth: 1 on the backup job's checkout fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'is shallow'" _ "$OUT"

D12="$(fake_dir)"
cat > "$D12/deploy.yml" <<'YAML'
name: deploy
on:
  workflow_dispatch:
jobs:
  backup:
    name: backup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: bash scripts/ops/check-database-exists.sh "$DB" --server maincloud

  publish-module:
    name: publish-module
    needs: [backup]
    runs-on: ubuntu-latest
    steps:
      - run: spacetime publish --server maincloud --no-config -y "$DB" --module-path server
YAML
OUT="$(bash "$CHECK" "$D12/deploy.yml" 2>&1)"; CODE=$?
check "a checkout with no fetch-depth at all (the actions/checkout default, 1) fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'is shallow'" _ "$OUT"

check "the good workflow's own fetch-depth: 0 passes (not a false FAIL)" 0 bash "$CHECK" "$WF"

D13="$(fake_dir)"; write_good_workflow "$D13/deploy.yml"
# A comment mentioning fetch-depth in prose, right above the real key --
# must never be what the check reads (regression: PR #345's own CI run
# hit exactly this, a comment explaining *why* fetch-depth is 0
# containing the literal text "fetch-depth: 1 (a shallow default)" ahead
# of the real, correct "fetch-depth: 0" key).
sed -i "/fetch-depth: 0/i\\      # fetch-depth: 1 (a shallow default) would be wrong here, see below" "$D13/deploy.yml"
check "a comment mentioning a different fetch-depth in prose is ignored -- the real key still passes" 0 bash "$CHECK" "$D13/deploy.yml"

D14="$(fake_dir)"; write_good_workflow "$D14/deploy.yml"
sed -i 's/fetch-depth: 0/fetch-depth: 1/' "$D14/deploy.yml"
sed -i "/fetch-depth: 1/i\\      # fetch-depth: 0 (a comment, not the real key)" "$D14/deploy.yml"
OUT="$(bash "$CHECK" "$D14/deploy.yml" 2>&1)"; CODE=$?
check "a comment mentioning fetch-depth: 0 in prose never masks a real, shallow fetch-depth: 1" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'is shallow'" _ "$OUT"

echo
echo "story 4.18 (Quentin's/Tim's cycle-1 direction): backup.yml's own export job checkout must not be shallow either -- the second real caller of export-world.sh, previously unguarded"
BF="$(fresh_backup_workflow)"
check "a well-formed backup.yml (fetch-depth: 0) passes, alongside the good deploy.yml" 0 bash "$CHECK" "$WF" "$BF"

D15="$(fake_dir)"; write_good_backup_workflow "$D15/backup.yml"
sed -i 's/fetch-depth: 0/fetch-depth: 1/' "$D15/backup.yml"
OUT="$(bash "$CHECK" "$WF" "$D15/backup.yml" 2>&1)"; CODE=$?
check "fetch-depth: 1 on backup.yml's export job fails" 1 bash -c "exit $CODE"
check "names the reason, and the job/file" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"'export' job's checkout in $D15/backup.yml is shallow\"" _ "$OUT"

D16="$(fake_dir)"
cat > "$D16/backup.yml" <<'YAML'
name: backup
on:
  workflow_dispatch:
jobs:
  export:
    name: export
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: bash scripts/ops/export-world.sh "$DB" /tmp/export --server maincloud
YAML
OUT="$(bash "$CHECK" "$WF" "$D16/backup.yml" 2>&1)"; CODE=$?
check "backup.yml's export job with no fetch-depth at all fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'is shallow'" _ "$OUT"

D17="$(fake_dir)"
cat > "$D17/backup.yml" <<'YAML'
name: backup
on:
  workflow_dispatch:
jobs:
  rehearsal:
    name: rehearsal
    runs-on: ubuntu-latest
    steps:
      - run: echo no export job here
YAML
OUT="$(bash "$CHECK" "$WF" "$D17/backup.yml" 2>&1)"; CODE=$?
check "a backup.yml with no 'export:' job at all fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"has no 'export:' job\"" _ "$OUT"

check "a missing backup.yml path fails" 1 bash "$CHECK" "$WF" "$(fake_dir)/nope-backup.yml"

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

echo
echo "story 4.20 (NFR49): report-failure must account for a cancelled job too, not only a failed one"
check "the good workflow's own report-failure condition passes (not a false FAIL)" 0 bash "$CHECK" "$WF"

D18="$(fake_dir)"; write_good_workflow "$D18/deploy.yml"
sed -i "s/if: always() && (contains(needs.\*.result, 'failure') || contains(needs.\*.result, 'cancelled'))/if: always() \&\& failure()/" "$D18/deploy.yml"
OUT="$(bash "$CHECK" "$D18/deploy.yml" 2>&1)"; CODE=$?
check "if: always() && failure() alone (no cancelled) fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"does not contain a contains(needs.*.result, 'cancelled')\"" _ "$OUT"

echo
echo "a bare substring check for the word 'cancelled' is not enough -- !cancelled() contains it too and means the opposite (Tim's direction, cycle 1)"
D18B="$(fake_dir)"; write_good_workflow "$D18B/deploy.yml"
sed -i "s/if: always() && (contains(needs.\*.result, 'failure') || contains(needs.\*.result, 'cancelled'))/if: always() \&\& !cancelled()/" "$D18B/deploy.yml"
OUT="$(bash "$CHECK" "$D18B/deploy.yml" 2>&1)"; CODE=$?
check "if: always() && !cancelled() fails (it's the negation, not the check)" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"does not contain a contains(needs.*.result, 'cancelled')\"" _ "$OUT"

D19="$(fake_dir)"; write_good_workflow "$D19/deploy.yml"
sed -i '/^  report-failure:$/,$d' "$D19/deploy.yml"
OUT="$(bash "$CHECK" "$D19/deploy.yml" 2>&1)"; CODE=$?
check "no report-failure job at all fails" 1 bash -c "exit $CODE"
check "names the missing job" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"has no 'report-failure' job\"" _ "$OUT"

echo
echo "publish-module must call finish_publish, and end with the world-invariants assert"
D20="$(fake_dir)"; write_good_workflow "$D20/deploy.yml"
sed -i '/ finish_publish$/d' "$D20/deploy.yml"
OUT="$(bash "$CHECK" "$D20/deploy.yml" 2>&1)"; CODE=$?
check "publish-module with no finish_publish call fails" 1 bash -c "exit $CODE"
check "names the missing call" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'never calls finish_publish'" _ "$OUT"

D21="$(fake_dir)"; write_good_workflow "$D21/deploy.yml"
sed -i '/assert-world-invariants.sh/d' "$D21/deploy.yml"
OUT="$(bash "$CHECK" "$D21/deploy.yml" 2>&1)"; CODE=$?
check "a publishing job with no assert step fails" 1 bash -c "exit $CODE"
check "names the missing assert" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'assert-world-invariants.sh'" _ "$OUT"

D22="$(fake_dir)"; write_good_workflow "$D22/deploy.yml"
sed -i '/assert-world-invariants.sh/d' "$D22/deploy.yml"
sed -i '/ finish_publish$/i      - run: bash scripts/ops/assert-world-invariants.sh "$DB" --server maincloud' "$D22/deploy.yml"
OUT="$(bash "$CHECK" "$D22/deploy.yml" 2>&1)"; CODE=$?
check "an assert step that is not the job's last step fails" 1 bash -c "exit $CODE"

check "the good workflow's finish_publish-then-assert ending passes (not a false FAIL)" 0 bash "$CHECK" "$WF"

echo "story 4.12: backup.yml's storage report never runs before the artifact upload"
write_report_workflow() { # <path> <report-first|report-last>
  {
    printf 'name: backup
on:
  workflow_dispatch:
jobs:
  export:
    name: export
    runs-on: ubuntu-latest
    steps:
'
    printf '      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
'
    printf '      - run: bash scripts/ops/export-world.sh "$DB" /tmp/export --server maincloud
'
    if [ "$2" = report-first ]; then printf '      - run: bash scripts/ops/storage-report.sh "$DB" --server maincloud
'; fi
    printf '      - uses: actions/upload-artifact@v7
        with:
          name: x
'
    if [ "$2" = report-last ]; then printf '      - if: always()
        run: bash scripts/ops/storage-report.sh "$DB" --server maincloud
'; fi
  } > "$1"
}
D13="$(fake_dir)"; write_good_workflow "$D13/deploy.yml"
write_report_workflow "$D13/backup-first.yml" report-first
OUT="$(bash "$CHECK" "$D13/deploy.yml" "$D13/backup-first.yml" 2>&1)"; CODE=$?
check "a storage report before the upload fails" 1 bash -c "exit $CODE"
check "names the reason" 0 bash -c "printf '%s' \"\$1\" | grep -qF 'storage-report.sh before'" _ "$OUT"
write_report_workflow "$D13/backup-last.yml" report-last
check "a storage report after the upload passes" 0 bash "$CHECK" "$D13/deploy.yml" "$D13/backup-last.yml"

echo
echo "story 4.5: the OIDC provider comes from the repository variables on both halves"
D30="$(fake_dir)"; write_good_workflow "$D30/deploy.yml"
sed -i '/accept_oidc_issuer/d' "$D30/deploy.yml"
OUT="$(bash "$CHECK" "$D30/deploy.yml" 2>&1)"; CODE=$?
check "publish-module that never registers the issuer fails" 1 bash -c "exit $CODE"
check "names the missing call" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"does not use 'accept_oidc_issuer'\"" _ "$OUT"

D31="$(fake_dir)"; write_good_workflow "$D31/deploy.yml"
sed -i '/VITE_OIDC_CLIENT_ID/d' "$D31/deploy.yml"
OUT="$(bash "$CHECK" "$D31/deploy.yml" 2>&1)"; CODE=$?
check "a client build that is not handed the client id fails" 1 bash -c "exit $CODE"


summary
exit $?
