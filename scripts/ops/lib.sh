#!/usr/bin/env bash
# Shared plumbing for export-world.sh/restore-world.sh/verify-world.sh/
# seed-edge-rows.sh -- the one place `spacetime` and the `world_backup`
# native binary (`server/tools/world_backup`) are located, so all four
# scripts agree on how to find them. Sourced, never executed directly.

BC_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BC_REPO_ROOT="$(cd -- "$BC_OPS_DIR/../.." && pwd)"
BC_SNAPSHOT="$BC_REPO_ROOT/server/schema.snapshot.json"
BC_WB_BUILT=""

bc_ops_die() { # <script-name> <message>
  echo "$1: FAIL -- $2" >&2
  exit 1
}

# bc_wb <args...> -- runs the world_backup binary, building it (release,
# idempotent -- a no-op rebuild when nothing changed) on first use rather
# than requiring a separate CI step. Never `jq` for a row value: see
# server/tools/world_backup/src/lib.rs's module doc for why (u64/
# chunk_key precision, confirmed empirically).
bc_wb() {
  local bin="$BC_REPO_ROOT/server/target/release/world_backup"
  [ -x "$bin" ] || bin="$bin.exe"
  if [ ! -x "$bin" ]; then
    # `cargo build` is idempotent (a no-op the moment nothing changed),
    # but re-invoking it once per call still costs a process spawn and
    # prints a status line every time -- built once, eagerly, by whichever
    # caller (a shell function, so this runs at most once per process
    # regardless of how many subshells later call `bc_wb`) hits a missing
    # binary first, quietly (stdout discarded, stderr kept for a real
    # build failure).
    ( cd "$BC_REPO_ROOT/server" && cargo build -p world_backup --release >/dev/null ) \
      || bc_ops_die "bc_wb" "could not build server/tools/world_backup"
  fi
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
