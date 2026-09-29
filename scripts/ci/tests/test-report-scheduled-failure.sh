#!/usr/bin/env bash
# scripts/ci/report-scheduled-failure.sh's dedupe: an existing open issue is
# matched on its exact title, never on GitHub's fuzzy `in:title` phrase
# search (story 4.13). A stub `gh` serves canned search results and logs
# what the script does.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
REPORT="$REPO_ROOT/scripts/ci/report-scheduled-failure.sh"

# run_report <title> <search-results-json> -- prints the gh calls made.
run_report() {
  local d
  d="$(fake_dir)"
  printf '%s' "$2" > "$d/list.json"
  cat > "$d/gh" <<STUB
#!/usr/bin/env bash
echo "gh \$*" >> "$d/calls.log"
case "\$1 \$2" in
  "issue list") cat "$d/list.json" ;;
esac
STUB
  chmod +x "$d/gh"
  ( PATH="$d:$PATH" GH_TOKEN=x GITHUB_REPOSITORY=o/r bash "$REPORT" "$1" "body" >/dev/null 2>&1 )
  cat "$d/calls.log"
}

LIST='[{"number":7,"title":"watcher: table citizen_state over alert"},{"number":9,"title":"watcher: table citizen over alert"}]'
CALLS="$(run_report 'watcher: table citizen over alert' "$LIST")"
check_contains "an exact-title match is commented on" "gh issue comment 9 " "$CALLS"

CALLS="$(run_report 'watcher: table citizen over alert' '[{"number":7,"title":"watcher: table citizen_state over alert"}]')"
check_contains "a fuzzy match on another table is not commented on: a new issue is filed" "gh issue create " "$CALLS"
check "and nothing is commented on issue 7" 1 bash -c 'printf "%s" "$1" | grep -q "issue comment 7"' _ "$CALLS"

CALLS="$(run_report 'watcher: table citizen over alert' '[]')"
check_contains "no candidate files a new issue" "gh issue create " "$CALLS"

summary
exit $?
