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

# bc_wb <args...> -- runs the world_backup binary. `cargo build` runs on
# every call, deliberately, not guarded behind "does a binary already
# exist": a stale binary left from a previous `world_backup` edit would
# otherwise be used silently (confirmed: a bash-level "built once" guard
# does not actually run once per process, since most callers invoke
# `bc_wb` from a `$(...)` subshell, which never shares that guard variable
# back with the caller -- every subshell saw "not built yet" and skipped
# straight to using the stale binary any earlier sibling call had left).
# `cargo build` itself is the idempotent check (a few tens of
# milliseconds once nothing changed) -- `-q` keeps that quiet, stderr
# kept for a real build failure.
bc_wb() {
  ( cd "$BC_REPO_ROOT/server" && cargo build -q -p world_backup --release ) \
    || bc_ops_die "bc_wb" "could not build server/tools/world_backup"
  local bin="$BC_REPO_ROOT/server/target/release/world_backup"
  [ -x "$bin" ] || bin="$bin.exe"
  [ -x "$bin" ] || bc_ops_die "bc_wb" "world_backup binary not found after building it"
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

# bc_call <script> <db> <server-args...> -- <reducer> <args-json> -- calls
# a reducer with one JSON argument (a `Vec<Row>`, per story 1.4's
# restore_<table> reducers). Same fail-loud contract as bc_sql_json.
# `spacetime call` writes its error, if any, to stderr; the message text
# itself (not just the exit code) is what callers grep for a specific
# refusal reason.
bc_call() {
  local script="$1" db="$2"; shift 2
  local -a server_args=()
  while [ "$#" -gt 2 ]; do
    server_args+=("$1")
    shift
  done
  local reducer="$1" args_json="$2"
  local errlog
  errlog="$(mktemp)"
  if ! spacetime call "$db" "${server_args[@]}" --no-config -y "$reducer" "$args_json" >/dev/null 2>"$errlog"; then
    bc_ops_die "$script" "'spacetime call $reducer' failed:
$(cat "$errlog")"
  fi
  rm -f "$errlog"
}

# bc_table_names <role> -- every accessor from schema.snapshot.json, one
# per line, in snapshot order. <role> is 'all', 'scheduled' or
# 'non-scheduled'. `restore_state` is never included: it is the restore
# mechanism's own gate, not a table export-world.sh/restore-world.sh ever
# touch.
bc_table_names() {
  bc_wb snapshot-tables "$BC_SNAPSHOT" | while IFS=$'\t' read -r name scheduled; do
    [ "$name" = "restore_state" ] && continue
    case "$1" in
      all) printf '%s\n' "$name" ;;
      scheduled) [ "$scheduled" = "1" ] && printf '%s\n' "$name" ;;
      non-scheduled) [ "$scheduled" = "0" ] && printf '%s\n' "$name" ;;
    esac
  done
}

bc_sha256() { # <file> -- `sha256sum` prepends a bare `\` to the digest
              # (GNU coreutils' escaping convention) whenever the path
              # argument itself contains a backslash, e.g. a Windows-style
              # path -- stripped here so every caller gets a plain hex
              # digest regardless of path style.
  sha256sum "$1" | awk '{print $1}' | sed 's/^\\//'
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
