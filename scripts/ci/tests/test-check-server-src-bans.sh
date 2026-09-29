#!/usr/bin/env bash
# scripts/ci/check-server-src-bans.sh's own fast, no-real-source-tree
# coverage (story 4.2): plants each banned construct in a throwaway temp
# directory and asserts exit 1, plus clean files (including doc comments
# that merely name the ban) expecting exit 0.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-server-src-bans.sh"

plant() { # <content> -- writes it to a fresh fake dir's only *.rs file
  local d
  d="$(fake_dir)"
  printf '%s\n' "$1" > "$d/schedules.rs"
  printf '%s' "$d"
}

d="$(plant 'pub fn f(ctx: &ReducerContext) -> Result<(), String> { Ok(()) }')"
check "a clean file passes" 0 bash "$CHECK" "$d"

d="$(plant 'scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(1000)),')"
check "ScheduleAt::Interval is banned" 1 bash "$CHECK" "$d"

d="$(plant '//! never ScheduleAt::Interval, anywhere, ever -- see the CI guard.')"
check "ScheduleAt::Interval named only in a doc comment passes" 0 bash "$CHECK" "$d"

d="$(plant 'let x = row.unwrap();')"
check ".unwrap() is banned" 1 bash "$CHECK" "$d"

d="$(plant 'let x = row.expect("must exist");')"
check ".expect(...) is banned" 1 bash "$CHECK" "$d"

d="$(plant 'panic!("unreachable state");')"
check "panic! is banned" 1 bash "$CHECK" "$d"

d="$(plant 'todo!();')"
check "todo! is banned" 1 bash "$CHECK" "$d"

d="$(plant 'unimplemented!();')"
check "unimplemented! is banned" 1 bash "$CHECK" "$d"

d="$(plant 'unreachable!();')"
check "unreachable! is banned" 1 bash "$CHECK" "$d"

d="$(plant 'debug_assert!(x > 0, "x must be positive");')"
check "debug_assert! stays allowed" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
mkdir -p "$d/generated"
printf '%s\n' 'let x = row.unwrap();' > "$d/generated/skip.rs"
check "generated/ is excluded" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s
' 'let at = ctx.timestamp;' > "$d/cadences.rs"
check "ctx.timestamp is banned in cadences.rs" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s
' '//! never reads ctx.timestamp' 'pub fn maintenance(_ctx: &ReducerContext, _m: i64) {}' > "$d/cadences.rs"
check "ctx.timestamp named only in a cadences.rs comment passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s
' 'let e = ctx.db.world_clock().id().find(0);' > "$d/cadences.rs"
check "world_clock is banned in cadences.rs" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s
' 'let e = read_clock(ctx);' > "$d/cadences.rs"
check "read_clock is banned in cadences.rs" 1 bash "$CHECK" "$d"

d="$(plant 'let at = ctx.timestamp; let e = read_clock(ctx);')"
check "ctx.timestamp and read_clock stay allowed outside cadences.rs" 0 bash "$CHECK" "$d"

summary
exit $?
