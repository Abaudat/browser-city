#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-scotty-commands.sh. Never
# reads the live repo tree -- every fixture is a scratch dir built here, so
# this suite keeps testing the checker's logic even after the real
# scotty.md, a prompt or SKILL.md changes shape.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-scotty-commands.sh"

# write_good_fixture <dir> -- a bc-issue.sh usage(), a scotty.md, one prompt
# and a SKILL.md that all agree, including write-feedback-reply and
# write-demo named in every one of the three doc sources.
write_good_fixture() {
  local d="$1"
  mkdir -p "$d/agentic-team/scripts/prompts" "$d/.claude/agents" "$d/.claude/skills/bc-sdlc"
  cat > "$d/agentic-team/scripts/bc-issue.sh" <<'SH'
#!/usr/bin/env bash
usage() {
  cat >&2 <<'EOF'
usage: bc-issue.sh <command> [args]
  write-demo <n> <bodyfile>     -- Scotty, creating-demo-issue: open it + scope it
  integrate-feedback <issue>     -- turn the demo's feedback into backlog work
  write-feedback-reply <issue> <bodyfile>
                                 -- Scotty, integrating-feedback: reply to Adrian
  write-epic <n> <title> <bodyfile> <priority>
                                 -- Scotty, integrating-feedback: open an epic
EOF
}
SH
  cat > "$d/.claude/agents/scotty.md" <<'MD'
# Scotty

Create the demo (`bash <scripts>/bc-issue.sh write-demo <n> <bodyfile>`).

Reply to Adrian (`bash <scripts>/bc-issue.sh write-feedback-reply <issue> <bodyfile>`).
MD
  cat > "$d/agentic-team/scripts/prompts/judge-feedback.md" <<'MD'
Open an epic:

    bash {{scripts}}/bc-issue.sh write-epic <n> "<title>" <bodyfile> <priority>

Reply to Adrian:

    bash {{scripts}}/bc-issue.sh write-feedback-reply {{demo}} <bodyfile>
MD
  cat > "$d/agentic-team/scripts/prompts/judge-demo-summary.md" <<'MD'
Open the issue:

    bash {{scripts}}/bc-issue.sh write-demo {{sprint}} {{bodyfile}}
MD
  cat > "$d/.claude/skills/bc-sdlc/SKILL.md" <<'MD'
| Command | What it does |
|---|---|
| `bash <scripts>/bc-issue.sh write-demo <sprint> <bodyfile>` | Opens the demo issue. |
| `bash <scripts>/bc-issue.sh write-feedback-reply <demo-issue> <bodyfile>` | Replies to Adrian. |
| `bash <scripts>/bc-issue.sh write-epic <n> "<title>" <bodyfile> <priority>` | Opens an epic. |
MD
}

fresh_fixture() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  write_good_fixture "$d"
  printf '%s' "$d"
}

run_check() { bash "$CHECK" "$1"; }

echo "green: scotty.md, the prompts and the bc-sdlc skill all agree with bc-issue.sh"
GOOD="$(fresh_fixture)"
check "a matching set of docs passes" 0 run_check "$GOOD"

echo
echo "red: a prompt names a subcommand that does not exist"
D1="$(fresh_fixture)"
cat >> "$D1/agentic-team/scripts/prompts/judge-feedback.md" <<'MD'

    bash {{scripts}}/bc-issue.sh write-ghost-story <n>
MD
OUT="$(run_check "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"names 'bc-issue.sh write-ghost-story', which is not a subcommand\"" _ "$OUT"

echo
echo "red: the skill table is missing write-feedback-reply"
D2="$(fresh_fixture)"
sed -i '/write-feedback-reply/d' "$D2/.claude/skills/bc-sdlc/SKILL.md"
OUT="$(run_check "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'write-feedback-reply' is not named in \$2/.claude/skills/bc-sdlc/SKILL.md\"" _ "$OUT" "$D2"

echo
echo "red: scotty.md never mentions write-demo"
D3="$(fresh_fixture)"
sed -i '/write-demo/d' "$D3/.claude/agents/scotty.md"
OUT="$(run_check "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'write-demo' is not named in \$2/.claude/agents/scotty.md\"" _ "$OUT" "$D3"

echo
echo "red: judge-feedback.md never mentions write-feedback-reply"
D4="$(fresh_fixture)"
sed -i '/write-feedback-reply/d' "$D4/agentic-team/scripts/prompts/judge-feedback.md"
OUT="$(run_check "$D4" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'write-feedback-reply' is not named in \$2/agentic-team/scripts/prompts/judge-feedback.md\"" _ "$OUT" "$D4"

echo
echo "red: write-feedback-reply is named in the WRONG prompt -- 'any prompt' is not enough, it must be judge-feedback.md's own"
D6="$(fresh_fixture)"
sed -i '/write-feedback-reply/d' "$D6/agentic-team/scripts/prompts/judge-feedback.md"
cat >> "$D6/agentic-team/scripts/prompts/judge-demo-summary.md" <<'MD'

Reply to Adrian (misplaced on purpose):

    bash {{scripts}}/bc-issue.sh write-feedback-reply {{demo}} <bodyfile>
MD
OUT="$(run_check "$D6" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'write-feedback-reply' is not named in \$2/agentic-team/scripts/prompts/judge-feedback.md\"" _ "$OUT" "$D6"

echo
echo "red: write-demo is named in the WRONG prompt -- must be judge-demo-summary.md's own"
D7="$(fresh_fixture)"
sed -i '/write-demo/d' "$D7/agentic-team/scripts/prompts/judge-demo-summary.md"
cat >> "$D7/agentic-team/scripts/prompts/judge-feedback.md" <<'MD'

Open the demo (misplaced on purpose):

    bash {{scripts}}/bc-issue.sh write-demo {{sprint}} {{bodyfile}}
MD
OUT="$(run_check "$D7" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'write-demo' is not named in \$2/agentic-team/scripts/prompts/judge-demo-summary.md\"" _ "$OUT" "$D7"

echo
echo "red: bc-issue.sh missing entirely"
D5="$(fake_dir)"
rm -rf "$D5"
mkdir -p "$D5"
OUT="$(run_check "$D5" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'bc-issue.sh not found'" _ "$OUT"

summary
