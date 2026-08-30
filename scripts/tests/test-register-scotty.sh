#!/usr/bin/env bash
# Shape test for register-scotty.sh, via its --print mode.
#
# The automation itself lives in Orca's state, which a test must not mutate.
# What can be pinned is the call that would create it -- and every flag below
# is one the story turns on, so a silent drop is what this catches.
REG="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/automation/register-scotty.sh"
pass=0; fail=0

OUT="$(bash "$REG" --print 2>&1)"; code=$?

want() { # description, substring
  if printf '%s' "$OUT" | grep -qF -- "$2"; then
    printf '  ok   %s\n' "$1"; pass=$((pass+1))
  else
    printf '  FAIL %s\n       wanted: %s\n' "$1" "$2"; fail=$((fail+1))
  fi
}
reject() { # description, substring that must NOT appear
  if printf '%s' "$OUT" | grep -qF -- "$2"; then
    printf '  FAIL %s\n       found: %s\n' "$1" "$2"; fail=$((fail+1))
  else
    printf '  ok   %s\n' "$1"; pass=$((pass+1))
  fi
}

echo "--print changes nothing and describes the call:"
if [ "$code" = 0 ]; then
  printf '  ok   dry run exits 0\n'; pass=$((pass+1))
else
  printf '  FAIL dry run exits %s\n       %s\n' "$code" "$OUT"; fail=$((fail+1))
fi

echo "the schedule the story asks for:"
# Every 10-15 minutes. */12 is inside the band and divides the hour evenly.
want "fires every 12 minutes"            "--trigger '*/12 * * * *'"
want "a missed night is not replayed"    "--missed-run-grace-minutes '10'"

echo "gated, and gated by the chained precheck:"
want "precheck is a single .cmd path"    "scripts\precheck.cmd'"
want "precheck path is Windows-form"     "--precheck 'D:\\"
reject "no shell in the precheck value"  "&&"
reject "no pipeline in the precheck"     "|"

echo "stateless by construction:"
# --reuse-session would hand Scotty the previous wake's transcript, which is
# the one thing his definition says must never happen.
want "a fresh session every wake"        "--fresh-session"
reject "never reuses a session"          "--reuse-session"

echo "runs where master is, and does not create worktrees:"
want "existing workspace"                "--workspace-mode 'existing'"
want "the main checkout, discovered"     "--workspace 'path:"
reject "no per-run worktree"             "--repo"

echo "safe by default:"
# An enabled automation dispatches real agents against real budget. Story 0.4's
# watchdog does not exist yet, so the default must not be live.
want "disabled unless --enable is given" "--disabled"
reject "not enabled by default"          "--enabled"

echo "the prompt launches the agent rather than impersonating it:"
PROMPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/automation/scotty-prompt.md"
pwant() { # description, extended regex
  if grep -qE -- "$2" "$PROMPT"; then
    printf '  ok   %s
' "$1"; pass=$((pass+1))
  else
    printf '  FAIL %s
       no match for: %s
' "$1" "$2"; fail=$((fail+1))
  fi
}
preject() { # description, extended regex that must NOT appear
  if grep -qE -- "$2" "$PROMPT"; then
    printf '  FAIL %s
       matched: %s
' "$1" "$2"; fail=$((fail+1))
  else
    printf '  ok   %s
' "$1"; pass=$((pass+1))
  fi
}

# Starting Scotty by name is what applies his model and tool classes -- the only
# two boundaries the runtime enforces. A prompt that acts as Scotty instead gets
# neither, however faithfully it describes him.
pwant   "starts the agent by name"        "claude --agent scotty"
preject "never resumes a previous wake"   "claude .*--resume"

# The prompt must stay a launcher. Any role content here is a second copy of
# scotty.md to drift from, which is the failure the PR protocol is built around.
preject "does not restate the cycle"      "c\.[0-6]|t\.[1-3]"
preject "does not restate the protocol"   "bc:(status|verdict|lead|scope)"

echo; echo "passed $pass, failed $fail"; [ "$fail" -eq 0 ]
