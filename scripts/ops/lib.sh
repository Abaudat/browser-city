#!/usr/bin/env bash
# Shared plumbing for export-world.sh/restore-world.sh/verify-world.sh/
# seed-edge-rows.sh -- the one place `spacetime` and the `world_backup`
# native binary (`server/tools/world_backup`) are located, so all four
# scripts agree on how to find them. Sourced, never executed directly.

BC_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BC_REPO_ROOT="$(cd -- "$BC_OPS_DIR/../.." && pwd)"
BC_SNAPSHOT="$BC_REPO_ROOT/server/schema.snapshot.json"

bc_ops_die() { # <script-name> <message>
  echo "$1: FAIL -- $2" >&2
  exit 1
}

# Builds world_backup once, right here at source time -- never inside
# `bc_wb()` itself (Quentin's cycle-3 direction fixed a stale-binary bug
# by rebuilding on every `bc_wb` call, but `export-world.sh` alone calls
# `bc_wb` dozens of times per table, and each was a full `cargo build`
# invocation: the spike's own export numbers measured that tooling
# overhead, not export cost -- a flat ~6.7s regardless of row count).
# `BC_WB_READY`, exported, is what makes "once" mean once per *process
# tree*, not once per script file: a script this one sources into
# directly sees the variable already set in its own shell; a script
# invoked as a **child process** (`bash other-script.sh`, never a
# `$(...)` subshell, whose own `export`s never reach back to the
# caller) inherits the exported variable too, since an exported
# environment variable does reach a child process, confirmed. A fresh
# top-level `bash` process -- a new CI step, a human's own terminal --
# always starts with `BC_WB_READY` unset, so it always rebuilds once;
# stale-binary safety is kept, just no longer paid for on every call.
if [ -z "${BC_WB_READY:-}" ]; then
  ( cd "$BC_REPO_ROOT/server" && cargo build -q -p world_backup --release ) \
    || bc_ops_die "lib.sh" "could not build server/tools/world_backup"
  export BC_WB_READY=1
fi

# bc_wb <args...> -- runs the already-built world_backup binary (see the
# build, above, sourced exactly once per process tree).
bc_wb() {
  local bin="$BC_REPO_ROOT/server/target/release/world_backup"
  [ -x "$bin" ] || bin="$bin.exe"
  [ -x "$bin" ] || bc_ops_die "bc_wb" "world_backup binary not found -- lib.sh's own build did not produce it"
  "$bin" "$@"
}

# bc_sql_json <script> <db> <server-args...> -- <query> -- runs a query and
# prints its `--format json` response on stdout. A non-zero exit, or any
# stderr line containing "Error", is a hard, loud failure -- an UNSTABLE
# CLI's transient wording is never trusted enough to grep stdout instead.
bc_sql_json() {
  local script="$1" db="$2"; shift 2
  local -a server_args=()
  while [ "$#" -gt 1 ]; do
    server_args+=("$1")
    shift
  done
  local query="$1"
  local errlog
  errlog="$(mktemp)"
  local out
  if ! out="$(spacetime sql "$db" "${server_args[@]}" --no-config -y --format json "$query" 2>"$errlog")"; then
    bc_ops_die "$script" "'spacetime sql' failed for: $query
$(cat "$errlog")"
  fi
  if grep -qiE '^Error' "$errlog"; then
    bc_ops_die "$script" "'spacetime sql' reported an error for: $query
$(cat "$errlog")"
  fi
  rm -f "$errlog"
  printf '%s' "$out"
}

# bc_sql_exec <script> <db> <server-args...> -- <statement> -- runs a
# non-SELECT statement (INSERT/DELETE), discarding stdout. Same fail-loud
# contract as bc_sql_json, no `--format json` (nothing to parse).
bc_sql_exec() {
  local script="$1" db="$2"; shift 2
  local -a server_args=()
  while [ "$#" -gt 1 ]; do
    server_args+=("$1")
    shift
  done
  local statement="$1"
  local errlog
  errlog="$(mktemp)"
  if ! spacetime sql "$db" "${server_args[@]}" --no-config -y "$statement" >/dev/null 2>"$errlog"; then
    bc_ops_die "$script" "'spacetime sql' failed for: $statement
$(cat "$errlog")"
  fi
  if grep -qiE '^Error' "$errlog"; then
    bc_ops_die "$script" "'spacetime sql' reported an error for: $statement
$(cat "$errlog")"
  fi
  rm -f "$errlog"
}

# bc_call <script> <db> <server-args...> -- <reducer> <arg...> -- calls a
# reducer, one CLI positional argument per reducer parameter, in order
# (confirmed empirically: `spacetime call`'s own `[ARGUMENTS...]` -- a
# two-parameter reducer like `restore_<table>(rows: Vec<Row>,
# sequence_floor: u64)` takes two positional args, `rows-json` then
# `floor-json`, never one combined array). Same fail-loud contract as
# bc_sql_json. `spacetime call` writes its error, if any, to stderr; the
# message text itself (not just the exit code) is what callers grep for
# a specific refusal reason.
bc_call() {
  local script="$1" db="$2"; shift 2
  local -a server_args=()
  # `--server <url>` or nothing -- detected by name, never by counting
  # remaining arguments: a fixed "2 non-server args left" cutoff (the
  # reducer name and its one JSON blob) stopped working once a
  # `restore_<table>` reducer started taking a second, `sequence_floor`,
  # argument, so which reducer this call is for no longer determines a
  # single fixed count of arguments left over.
  if [ "$#" -ge 2 ] && [ "$1" = "--server" ]; then
    server_args=("$1" "$2")
    shift 2
  fi
  local reducer="$1"; shift
  local errlog
  errlog="$(mktemp)"
  if ! spacetime call "$db" "${server_args[@]}" --no-config -y "$reducer" "$@" >/dev/null 2>"$errlog"; then
    bc_ops_die "$script" "'spacetime call $reducer' failed:
$(cat "$errlog")"
  fi
  rm -f "$errlog"
}

# bc_table_names <snapshot-path> <role> -- every accessor from
# <snapshot-path>, one per line, in snapshot order. <role> is 'all',
# 'scheduled' or 'non-scheduled'. `restore_state` is never included: it is
# the restore mechanism's own gate, not a table export-world.sh/
# restore-world.sh ever touch. <snapshot-path> is always explicit (Tim's
# direction, story 4.18): export-world.sh reads the *selected* candidate
# snapshot, which is not always $BC_SNAPSHOT, so this never reads that
# global itself.
bc_table_names() {
  local snapshot="$1" role="$2"
  bc_wb snapshot-tables "$snapshot" | while IFS=$'\t' read -r name scheduled; do
    [ "$name" = "restore_state" ] && continue
    case "$role" in
      all) printf '%s\n' "$name" ;;
      scheduled) [ "$scheduled" = "1" ] && printf '%s\n' "$name" ;;
      non-scheduled) [ "$scheduled" = "0" ] && printf '%s\n' "$name" ;;
    esac
  done
}

# bc_snapshot_candidates <out-dir> <repo-root> <worktree-snapshot-path> --
# writes candidate schema snapshot files into <out-dir>/0, <out-dir>/1, ...
# and a matching <out-dir>/labels.txt (one "<index>\t<label>" line per
# candidate, in the same newest-to-oldest order printed to stdout), plus
# <out-dir>/shallow ('true'/'false'/'non-git').
#
# A worktree candidate (label 'worktree', <worktree-snapshot-path>'s own
# current content) is emitted *only* when it actually differs from HEAD's
# own committed content -- a human's own uncommitted edit against a local
# instance. When the working tree is clean (every real caller in CI: the
# checkout is never dirty), there is nothing distinct about it to name
# `schema_commit` after, so it is never emitted at all (Quentin's
# direction, cycle 1): naming it 'worktree' in the common case -- live
# equals HEAD, every nightly export after a successful deploy, every
# redeploy -- pointed the README's own recovery sentence at nothing.
#
# Every first-parent ancestor of <repo-root>'s HEAD that changed
# server/schema.snapshot.json is a further candidate, newest first (label:
# that commit's own sha) -- `check-schema-additive.sh`'s append-only rule
# is what makes this walk meaningful at all: table names plus column names
# identify exactly one point on that history (story 4.18, Tim's
# direction). Never partial: a candidate whose `git show` fails (the path
# did not exist yet at that commit) is skipped, not aborted on.
#
# <out-dir>/shallow: 'non-git' if <repo-root> is not a git checkout at
# all (only the worktree candidate exists, unconditionally, dirty or not
# -- there is no HEAD to compare it against or walk history from); 'true'
# if it is a *shallow* git checkout (`git rev-parse --is-
# shallow-repository`) -- git treats a shallow clone's own boundary commit
# as introducing every file, so `git log --first-parent -- <path>` prints
# exactly that one commit even when it never really touched the file
# (confirmed empirically, Quentin's direction, cycle 1): a live database
# that is perfectly healthy then gets a plain "does not match" instead of
# "fetch full history", the one case this flag exists to name distinctly;
# 'false' otherwise. The `rev-parse --is-inside-work-tree` probe below
# never swallows stderr (Quentin's direction): a real git failure other
# than "not a repository" (a container's "detected dubious ownership"
# refusal, for one) must be visible in the caller's own log, not silently
# misread as "non-git checkout".
#
# Story 4.18: export-world.sh matches the *live* database against this
# list to find which commit's schema is actually live, never a record it
# would then have to keep consistent -- see world_backup's `select-schema`.
#
# No test-only override (Tim's direction, cycle 1): the git-backed walk
# below is the only path, exercised directly by its own dedicated test
# (scripts/ops/tests/test-bc-snapshot-candidates.sh, against a real
# throwaway git repo, including a real `--depth 1` shallow clone) and end
# to end by scripts/ci/check-backup-restore.sh against a real instance.
bc_snapshot_candidates() {
  local out_dir="$1" repo_root="$2" worktree_snapshot="$3"
  mkdir -p "$out_dir"
  : > "$out_dir/labels.txt"

  if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null; then
    printf 'non-git' > "$out_dir/shallow"
    cp "$worktree_snapshot" "$out_dir/0"
    printf '0\tworktree\n' >> "$out_dir/labels.txt"
    cat "$out_dir/labels.txt"
    return 0
  fi

  if [ "$(git -C "$repo_root" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
    printf 'true' > "$out_dir/shallow"
  else
    printf 'false' > "$out_dir/shallow"
  fi

  local i=0
  local head_content worktree_content
  # `tr -d '\r'` on both sides: git always stores this file LF-only (`git
  # show` reads the blob directly, untranslated), but a Windows checkout
  # with `core.autocrlf=true` normalises the *working tree* copy to CRLF
  # on the way out -- comparing the two raw would call every single such
  # checkout "dirty" even with zero real edits (confirmed empirically).
  # The file actually copied to candidate 0 below is still the worktree's
  # own untouched bytes; only this dirty/clean decision ignores line
  # endings.
  head_content="$(git -C "$repo_root" show HEAD:server/schema.snapshot.json 2>/dev/null | tr -d '\r' || true)"
  worktree_content="$(tr -d '\r' < "$worktree_snapshot" 2>/dev/null || true)"
  if [ "$head_content" != "$worktree_content" ]; then
    cp "$worktree_snapshot" "$out_dir/0"
    printf '0\tworktree\n' >> "$out_dir/labels.txt"
    i=1
  fi

  local sha
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    if git -C "$repo_root" show "$sha:server/schema.snapshot.json" > "$out_dir/$i" 2>/dev/null; then
      printf '%s\t%s\n' "$i" "$sha" >> "$out_dir/labels.txt"
      i=$((i + 1))
    fi
  done < <(git -C "$repo_root" log --first-parent --format=%H HEAD -- server/schema.snapshot.json 2>/dev/null)
  cat "$out_dir/labels.txt"
}

bc_sha256() { # <file> -- `sha256sum` prepends a bare `\` to the digest
              # (GNU coreutils' escaping convention) whenever the path
              # argument itself contains a backslash, e.g. a Windows-style
              # path -- stripped here so every caller gets a plain hex
              # digest regardless of path style.
  sha256sum "$1" | awk '{print $1}' | sed 's/^\\//'
}

# bc_schema_sha256 <file> -- like bc_sha256, but line-ending-insensitive
# (`tr -d '\r'` first) -- schema.snapshot.json specifically, never a row
# export file (byte-exact by design, verify-world.sh's own contract).
# Story 4.18: a selected candidate is read via `git show`, always LF (a
# git blob's own stored form); `$BC_SNAPSHOT` on disk is whatever the
# local checkout's own `core.autocrlf` made it -- CRLF on a Windows box
# with it set `true` (confirmed empirically). export-world.sh's own
# schema_sha256 and restore-world.sh's comparison against $BC_SNAPSHOT
# must agree regardless of which candidate was selected or which platform
# either script runs on, so both hash through this, never bc_sha256
# directly, for the schema snapshot.
bc_schema_sha256() {
  tr -d '\r' < "$1" | sha256sum | awk '{print $1}' | sed 's/^\\//'
}

# bc_reject_unknown_args <script> <usage> <recognized-flags-pattern> <args...>
# -- a typo'd flag (`--sever` for `--server`) must never be silently
# ignored and fall through to a default server (Quentin's direction).
# Callers parse their own recognized flags first; anything left over is a
# hard, immediate failure.
bc_reject_unknown_args() {
  local script="$1" usage="$2"; shift 2
  if [ "$#" -gt 0 ]; then
    bc_ops_die "$script" "unrecognized argument(s): $* -- $usage"
  fi
}
