#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/report-scheduled-failure.sh
# (extracted from windows-install-check.yml, shared with backup.yml --
# Tim's direction): a stub `gh` on PATH logs every call it receives, never
# a real GitHub API call.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPORT="$TEST_DIR/../../../scripts/ci/report-scheduled-failure.sh"

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

echo
echo "green: an existing open issue -> comments instead of duplicating"
D="$(stub_gh "42")"
check "exit 0" 0 run "$D" "backup: scheduled export failed" "body text"
check_out "comments on #42, never creates" 0 "yes" bash -c "grep -qF 'issue comment 42' '$D/calls.log' && ! grep -qF 'issue create' '$D/calls.log' && echo yes"

echo
echo "red: GH_TOKEN not set"
D="$(stub_gh "")"
check "missing GH_TOKEN -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title body )"

echo
echo "red: wrong argument count"
D="$(stub_gh "")"
check "missing body arg -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title-only )"

summary
