#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/report-scheduled-failure.sh
# (extracted from windows-install-check.yml, shared with deploy.yml's
# report-failure job -- Tim's direction; backup.yml does NOT call this):
# a stub `gh` on PATH logs every call it receives, never a real GitHub API
# call. Story 4.19 (Tim's direction): the create path labels the issue
# `alert,lead:tim` -- adopt-alerts (bc-issue.sh) is what scores and scopes
# it onto the board -- and the comment path sets no field at all, so a
# repeat failure never yanks an already-triaged report back to Backlog.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPORT="$TEST_DIR/../../../scripts/ci/report-scheduled-failure.sh"

log_has() { grep -Eq -- "$2" "$1"; } # <file> <ere>

# stub_gh <existing-issue-number-or-empty> -- a scratch dir with a fake
# `gh` first on PATH; every call it receives is appended to calls.log.
stub_gh() {
  local existing="$1" d
  d="$(fake_dir)"
  cat > "$d/gh" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$d/calls.log"
if [ "\$1" = "issue" ] && [ "\$2" = "list" ]; then
  echo '$existing'
  exit 0
fi
exit 0
STUB
  chmod +x "$d/gh"
  printf '%s' "$d"
}

run() { # <bin-dir> <title> <body>
  ( PATH="$1:$PATH" GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash "$REPORT" "$2" "$3" )
}

echo "green: no existing open issue -> files a new one"
D="$(stub_gh "")"
check "exit 0" 0 run "$D" "backup: scheduled export failed" "body text"
check_out "creates, never comments" 0 "yes" bash -c "grep -qF 'issue create' '$D/calls.log' && ! grep -qF 'issue comment' '$D/calls.log' && echo yes"
# Story 4.19: the new issue carries the alert + lead:tim labels -- adopt-alerts
# (bc-issue.sh) is what puts it on the board, this script never sets a field.
check "the new issue is labelled alert,lead:tim" 0 \
  log_has "$D/calls.log" '\-\-label alert,lead:tim'

echo
echo "green: an existing open issue -> comments instead of duplicating"
D="$(stub_gh "42")"
check "exit 0" 0 run "$D" "backup: scheduled export failed" "body text"
check_out "comments on #42, never creates" 0 "yes" bash -c "grep -qF 'issue comment 42' '$D/calls.log' && ! grep -qF 'issue create' '$D/calls.log' && echo yes"
# AC3: a report already on the board keeps its place -- a repeat failure
# must not re-triage it (yank it back to Backlog) by touching any field.
check "the comment path sets no label and no field" 0 \
  log_has "$D/calls.log" '^issue comment 42 --repo Abaudat/BrowserCity --body body text$'

echo
echo "red: GH_TOKEN not set"
D="$(stub_gh "")"
check "missing GH_TOKEN -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title body )"

echo
echo "red: wrong argument count"
D="$(stub_gh "")"
check "missing body arg -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title-only )"

summary
