#!/usr/bin/env bash
# Story 4.5 (FR141): the device's identity token is a credential in a public
# repository whose Playwright reports are uploaded. It lives in one module
# and goes nowhere else:
#   - the storage key `bc.identity.v1` appears only in
#     client/src/identity/identity-storage.ts (tests excluded);
#   - `withToken` appears only under client/src/net/ (the one SDK caller);
#   - identity-storage.ts and identity/link-flow.ts never call `console.`;
#   - client/src/net/e2e-hooks.ts never names a token outside comments;
#   - no client source builds a URL query parameter named token.
#
# Usage: check-identity-token-confined.sh [client-src-dir]   (default: client/src)
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${1:-"$REPO_ROOT/client/src"}"
[ -d "$SRC" ] || { echo "check-identity-token-confined: $SRC not found" >&2; exit 1; }
STORE="$SRC/identity/identity-storage.ts"
[ -f "$STORE" ] || { echo "check-identity-token-confined: FAIL -- $STORE not found (the scan matched nothing)" >&2; exit 1; }

BAD=""
note() { BAD="$BAD$1"$'\n'; }
code() { grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "$1" | tr -d '\r'; }

while IFS= read -r f; do
  rel="${f#"$SRC"/}"
  case "$rel" in net/bindings/*) continue ;; esac
  if [ "$rel" != "identity/identity-storage.ts" ] && code "$f" | grep -qF 'bc.identity'; then
    note "$rel: names the identity storage key"
  fi
  case "$rel" in
    net/*) ;;
    *) code "$f" | grep -q 'withToken' && note "$rel: calls withToken outside net/" ;;
  esac
  if code "$f" | grep -Eq '[?&]token='; then
    note "$rel: builds a URL query parameter named token"
  fi
done < <(find "$SRC" \( -name '*.ts' -o -name '*.tsx' \) | sort)

for m in identity/identity-storage.ts identity/link-flow.ts; do
  [ -f "$SRC/$m" ] || continue
  code "$SRC/$m" | grep -Eq '(^|[^[:alnum:]_])console[[:space:]]*\.' && note "$m: calls console (it handles a credential)"
done

HOOKS="$SRC/net/e2e-hooks.ts"
if [ -f "$HOOKS" ] && code "$HOOKS" | grep -qi 'token'; then
  note "net/e2e-hooks.ts: names a token (window.__bc may expose the identity and character id, never the token)"
fi

if [ -n "$BAD" ]; then
  echo "check-identity-token-confined: FAIL -- the identity token must stay in identity-storage.ts and net/:" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-identity-token-confined: the token is confined to identity-storage.ts and net/ (FR141)" >&2
