#!/usr/bin/env bash
# Fast, no-instance coverage for scripts/ops/check-database-exists.sh
# (Quentin's direction, PR #288 cycle 1): a stub `spacetime describe`
# covering the three cases that matter -- found, positively not-found
# (the CLI's own wording), and a generic error, which must never be read
# as "not found".
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ops/check-database-exists.sh"

stub_bin() { # <mode>
  local mode="$1" d
  d="$(fake_dir)"
  cat > "$d/spacetime" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "describe" ]; then
  case "$mode" in
    exists)
      echo '{"sections":[]}'
      exit 0
      ;;
    not-found)
      echo "Error: failed to find database \\\`\$2\\\`." >&2
      exit 1
      ;;
    generic-error)
      echo "Error: error sending request for url (http://127.0.0.1:1/v1/database/\$2/identity)" >&2
      exit 1
      ;;
    silent-error)
      exit 1
      ;;
  esac
fi
echo "stub spacetime: unhandled subcommand: \$*" >&2
exit 1
STUB
  chmod +x "$d/spacetime"
  printf '%s' "$d"
}

run_check() { # <mode> <args...>
  local mode="$1"; shift
  local bin
  bin="$(stub_bin "$mode")"
  ( PATH="$bin:$PATH" bash "$CHECK" "$@" )
}

echo "the database exists"
OUT="$(run_check exists my-db --server http://127.0.0.1:1 2>&1)"; CODE=$?
check "exists -> exit 0" 0 bash -c "exit $CODE"
check_contains "prints true" "true" "$OUT"

echo
echo "the database positively does not exist yet (NFR39's one allowed exception)"
OUT="$(run_check not-found my-db --server http://127.0.0.1:1 2>&1)"; CODE=$?
check "not-found -> exit 0" 0 bash -c "exit $CODE"
check_contains "prints false" "false" "$OUT"

echo
echo "a generic error must never be read as 'not found' -- hard fail"
OUT="$(run_check generic-error my-db --server http://127.0.0.1:1 2>&1)"; CODE=$?
check "generic error -> exit 1" 1 bash -c "exit $CODE"
check_contains "names the reason" "failed for a reason other than 'database not found'" "$OUT"

echo
echo "a silent, message-less failure is also a hard fail, never 'not found'"
OUT="$(run_check silent-error my-db --server http://127.0.0.1:1 2>&1)"; CODE=$?
check "silent failure -> exit 1" 1 bash -c "exit $CODE"

echo
echo "usage errors"
check "missing db argument fails" 1 bash "$CHECK"
check "unrecognized trailing argument fails" 1 run_check exists my-db --server http://127.0.0.1:1 --extra

summary
exit $?
