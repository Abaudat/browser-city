#!/usr/bin/env bash
# scripts/ci/check-deploy-client-paths-current.sh's own fast, no-real-
# file coverage: every paths-file line present in the workflow passes;
# one missing fails, naming it.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-deploy-client-paths-current.sh"

write_paths_file() { # <path>
  cat > "$1" <<'EOF'
# a comment, ignored
client/**
ModernTileset/thing/**
EOF
}

write_covering_workflow() { # <path>
  cat > "$1" <<'YAML'
jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@v4
        with:
          filters: |
            client:
              - 'client/**'
              - 'ModernTileset/thing/**'
YAML
}

D1="$(fake_dir)"
write_paths_file "$D1/paths.txt"
write_covering_workflow "$D1/ci.yml"
check "every path covered passes" 0 bash "$CHECK" "$D1/paths.txt" "$D1/ci.yml"

D2="$(fake_dir)"
write_paths_file "$D2/paths.txt"
cat > "$D2/ci.yml" <<'YAML'
jobs:
  changes:
    steps:
      - uses: dorny/paths-filter@v4
        with:
          filters: |
            client:
              - 'client/**'
YAML
OUT="$(bash "$CHECK" "$D2/paths.txt" "$D2/ci.yml" 2>&1)"; CODE=$?
check "a missing path fails" 1 bash -c "exit $CODE"
check "names the missing path" 0 bash -c "printf '%s' \"\$1\" | grep -qF \"'ModernTileset/thing/**'\"" _ "$OUT"

check "a missing paths-file fails" 1 bash "$CHECK" "$(fake_dir)/nope.txt" "$D1/ci.yml"
check "a missing ci workflow fails" 1 bash "$CHECK" "$D1/paths.txt" "$(fake_dir)/nope.yml"

summary
exit $?
