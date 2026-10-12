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

d="$(plant 'static mut GRAPH: Option<Vec<u32>> = None;')"
check "static mut is banned" 1 bash "$CHECK" "$d"

d="$(plant 'thread_local! { static G: RefCell<Vec<u32>> = RefCell::new(Vec::new()); }')"
check "thread_local! is banned" 1 bash "$CHECK" "$d"

d="$(plant 'static G: std::sync::OnceLock<Vec<u32>> = std::sync::OnceLock::new();')"
check "OnceLock is banned" 1 bash "$CHECK" "$d"

d="$(plant 'static G: once_cell::sync::OnceCell<u32> = OnceCell::new();')"
check "OnceCell is banned" 1 bash "$CHECK" "$d"

d="$(plant 'static G: std::sync::LazyLock<u32> = LazyLock::new(|| 1);')"
check "LazyLock is banned" 1 bash "$CHECK" "$d"

d="$(plant 'lazy_static! { static ref G: u32 = 1; }')"
check "lazy_static! is banned" 1 bash "$CHECK" "$d"

d="$(plant '//! never a OnceLock or a thread_local! graph cache -- tables only.')"
check "module-global state named only in a comment passes" 0 bash "$CHECK" "$d"

d="$(plant 'static CACHE: Mutex<Option<Vec<u32>>> = Mutex::new(None);')"
check "a static Mutex is banned" 1 bash "$CHECK" "$d"

d="$(plant 'pub(crate) static COUNT: AtomicU64 = AtomicU64::new(0);')"
check "a static atomic is banned" 1 bash "$CHECK" "$d"

d="$(plant 'const SIZE: u32 = 4; fn f(x: &'"'"'static str) {}')"
check "const items and the 'static lifetime pass" 0 bash "$CHECK" "$d"

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
d="$(plant 'for n in ctx.db.route_node().iter() {}')"
check "iterating route_node in a reducer file is banned" 1 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s\n' 'for n in ctx.db.route_edge().iter() {}' > "$d/restore.rs"
check "iterating route_edge in restore.rs is allowed" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
printf '%s\n' 'use sim::routing::search::search;' > "$d/a.rs"
check "one file naming routing::search is allowed" 0 bash "$CHECK" "$d"
printf '%s\n' 'use sim::routing::search::search;' > "$d/b.rs"
check "a second file naming routing::search is banned" 1 bash "$CHECK" "$d"

summary
exit $?
