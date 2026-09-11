#!/usr/bin/env bash
# Shared plumbing for export-world.sh/restore-world.sh/verify-world.sh/
# seed-edge-rows.sh -- the one place `spacetime`, `python3` and the schema
# snapshot are located, so all four scripts agree on how to find them.
# Sourced, never executed directly.

BC_OPS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BC_REPO_ROOT="$(cd -- "$BC_OPS_DIR/../.." && pwd)"
BC_SNAPSHOT="$BC_REPO_ROOT/server/schema.snapshot.json"
BC_CANON="$BC_OPS_DIR/python/canon.py"
BC_PYTHON="${BC_PYTHON:-python3}"
# PEP 540 UTF-8 mode: every `open()` in every Python snippet these scripts
# run (canon.py's own, and the small inline ones in restore-world.sh/
# check-backup-restore.sh) then defaults to UTF-8 regardless of the host's
# locale/codepage, rather than each call site having to pass
# `encoding="utf-8"` itself. Confirmed necessary on Windows: a Windows dev
# box's default codepage otherwise silently mangles an adversarial
# non-ASCII seed string (Quentin's direction) the moment any of these
# scripts reads it back.
export PYTHONUTF8=1

bc_ops_die() { # <script-name> <message>
  echo "$1: FAIL -- $2" >&2
  exit 1
}

bc_canon() { # <subcommand...> -- never `jq`: see python/canon.py's module
             # doc for why (u64/chunk_key precision, confirmed empirically).
  "$BC_PYTHON" "$BC_CANON" "$@"
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

# bc_sql_exec <script> <db> <server-args...> -- <statement> -- same
# contract as bc_sql_json, for a statement whose result nobody reads
# (INSERT/DELETE).
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

# bc_table_names <role> -- every accessor from schema.snapshot.json, one
# per line, in snapshot order. <role> is 'all', 'scheduled' or
# 'non-scheduled'.
bc_table_names() {
  bc_canon snapshot-tables "$BC_SNAPSHOT" | while IFS=$'\t' read -r name scheduled; do
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
