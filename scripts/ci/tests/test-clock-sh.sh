#!/usr/bin/env bash
# scripts/dev/clock.sh's failure paths: a bad argument must fail before
# any `spacetime call` is made (a stub `spacetime` records every call).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CLOCK="$REPO_ROOT/scripts/dev/clock.sh"

d="$(fake_dir)"
printf '#!/usr/bin/env bash\necho "$@" >> "%s/calls"\n' "$d" > "$d/spacetime"
chmod +x "$d/spacetime"
run() { PATH="$d:$PATH" bash "$CLOCK" "$@"; }

check "a jump calls jump_clock" 0 run db jump 60
check_contains "the call names the reducer and argument" "call db jump_clock 60" "$(cat "$d/calls")"
check "a speed change calls set_clock_speed" 0 run db speed 10
check_contains "the call names the reducer and argument" "call db set_clock_speed 10" "$(cat "$d/calls")"
before="$(wc -l < "$d/calls")"
check "a non-numeric argument fails" 2 run db jump soon
check "a backward jump fails" 2 run db jump -5
check "a zero jump fails" 2 run db jump 0
check "an unknown verb fails" 2 run db rewind 5
check "a missing argument fails" 2 run db jump
after="$(wc -l < "$d/calls")"
check "no bad invocation reached spacetime" 0 test "$before" = "$after"

summary
exit $?
