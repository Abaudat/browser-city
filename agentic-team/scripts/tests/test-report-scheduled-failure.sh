#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/report-scheduled-failure.sh
# (extracted from windows-install-check.yml, shared with deploy.yml's
# report-failure job -- Tim's direction; backup.yml does NOT call this):
# a stub `gh` on PATH logs every call it receives, never a real GitHub API
# call. Story 4.19 (Tim's direction): the create path labels the issue
# `alert,lead:tim` -- adopt-alerts (bc-issue.sh) is what scores and scopes
# it onto the board -- and the comment path sets no field at all, so a
# repeat failure never yanks an already-triaged report back to Backlog.
#
# Quentin's direction, cycle 1: the create path must not depend on the
# label already existing (a by-hand `setup-github.sh` run is not a test),
# so it creates its own labels first, idempotently, and the seam this test
# guards -- BC_LABEL_ALERT/BC_LEAD_LABEL_PREFIX are bc-issue.sh's own
# strings, `alert`/`lead:tim` are this script's -- is asserted by sourcing
# lib/config.sh and comparing against those variables, never a retyped
# literal: a rename on the bc-issue.sh side with this script left behind
# must fail here, not read green by coincidence.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
# shellcheck source=lib/config.sh
. "$TEST_DIR/../lib/config.sh"
REPORT="$TEST_DIR/../../../scripts/ci/report-scheduled-failure.sh"
EXPECTED_LABEL="${BC_LABEL_ALERT},${BC_LEAD_LABEL_PREFIX}tim"

log_has() { grep -Eq -- "$2" "$1"; } # <file> <ere>
# line_no <file> <ere> -- the 1-based line number of the first match, or
# empty if none.
line_no() { grep -nE -- "$2" "$1" | head -1 | cut -d: -f1; }

# stub_gh <existing-issue-number-or-empty> [fail-label-create:yes|no] -- a
# scratch dir with a fake `gh` first on PATH; every call it receives is
# appended to calls.log. fail-label-create simulates a `gh label create`
# that cannot write (a token with no write access, an API hiccup).
stub_gh() {
  local existing="$1" fail_label="${2:-no}" d
  d="$(fake_dir)"
  cat > "$d/gh" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$d/calls.log"
if [ "\$1" = "issue" ] && [ "\$2" = "list" ]; then
  # --json number,title: the script matches the title exactly itself.
  if [ -n '$existing' ]; then
    printf '[{"number":%s,"title":"%s"}]' '$existing' "\$STUB_TITLE"
  else
    echo '[]'
  fi
  exit 0
fi
if [ "\$1" = "label" ] && [ "\$2" = "create" ] && [ "$fail_label" = "yes" ]; then
  exit 1
fi
exit 0
STUB
  chmod +x "$d/gh"
  printf '%s' "$d"
}

run() { # <bin-dir> <title> <body>
  ( PATH="$1:$PATH" STUB_TITLE="$2" GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash "$REPORT" "$2" "$3" )
}

echo "green: no existing open issue -> makes its own labels exist, then files a new one"
D="$(stub_gh "")"
check "exit 0" 0 run "$D" "backup: scheduled export failed" "body text"
check_out "creates, never comments" 0 "yes" bash -c "grep -qF 'issue create' '$D/calls.log' && ! grep -qF 'issue comment' '$D/calls.log' && echo yes"
# The new issue's --label value is derived from bc-issue.sh's own
# BC_LABEL_ALERT/BC_LEAD_LABEL_PREFIX (via config.sh), never retyped --
# a rename on that side with this script left behind fails here.
check "the new issue's label is derived from BC_LABEL_ALERT and BC_LEAD_LABEL_PREFIX, not retyped" 0 \
  log_has "$D/calls.log" "\-\-label ${EXPECTED_LABEL}\$"
check "created the alert label (idempotent, --force)" 0 \
  log_has "$D/calls.log" '^label create alert .*--force$'
check "created the lead:tim label (idempotent, --force)" 0 \
  log_has "$D/calls.log" '^label create lead:tim .*--force$'
# Never depends on a by-hand setup-github.sh run: both label creates
# happen before the issue is ever created.
ALERT_LINE="$(line_no "$D/calls.log" '^label create alert ')"
TIM_LINE="$(line_no "$D/calls.log" '^label create lead:tim ')"
CREATE_LINE="$(line_no "$D/calls.log" '^issue create ')"
check "the label creates precede the issue create" 0 \
  test "$ALERT_LINE" -lt "$CREATE_LINE" -a "$TIM_LINE" -lt "$CREATE_LINE"

echo
echo "green: an existing open issue -> comments instead of duplicating"
D="$(stub_gh "42")"
check "exit 0" 0 run "$D" "backup: scheduled export failed" "body text"
check_out "comments on #42, never creates" 0 "yes" bash -c "grep -qF 'issue comment 42' '$D/calls.log' && ! grep -qF 'issue create' '$D/calls.log' && echo yes"
# AC3: a report already on the board keeps its place -- a repeat failure
# must not re-triage it (yank it back to Backlog) by touching any field.
check "the comment path sets no label and no field" 0 \
  log_has "$D/calls.log" '^issue comment 42 --repo Abaudat/BrowserCity --body body text$'
check "the comment path never touches a label" 1 log_has "$D/calls.log" '^label create'

echo
echo "red: creating the alert label fails -> exit non-zero, named on stderr, never files the issue"
D="$(stub_gh "" yes)"
check "label create failure -> exit non-zero" 1 run "$D" "backup: scheduled export failed" "body text"
check_out "names why on stderr" 0 "yes" bash -c "( PATH='$D:'\$PATH GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' t b ) 2>&1 | grep -q \"could not create the 'alert' label\" && echo yes"
check "never reached issue create" 1 log_has "$D/calls.log" '^issue create'

echo
echo "red: GH_TOKEN not set"
D="$(stub_gh "")"
check "missing GH_TOKEN -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title body )"

echo
echo "red: wrong argument count"
D="$(stub_gh "")"
check "missing body arg -> exit non-zero" 1 bash -c "( PATH='$D:'\$PATH GH_TOKEN=x GITHUB_REPOSITORY=Abaudat/BrowserCity bash '$REPORT' title-only )"

summary
