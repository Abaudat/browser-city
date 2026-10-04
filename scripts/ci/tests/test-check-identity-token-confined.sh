#!/usr/bin/env bash
# scripts/ci/check-identity-token-confined.sh's own fast coverage (story 4.5):
# plants each violation in a throwaway tree.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
CHECK="$REPO_ROOT/scripts/ci/check-identity-token-confined.sh"

tree() {
  local d
  d="$(fake_dir)"
  mkdir -p "$d/identity" "$d/net/bindings" "$d/render"
  printf '%s\n' 'export const IDENTITY_STORAGE_KEY = "bc.identity.v1";' > "$d/identity/identity-storage.ts"
  printf '%s\n' 'const c = builder.withToken(t);' > "$d/net/connection.ts"
  printf '%s\n' '// never the token
export function recordIdentityForE2e() {}' > "$d/net/e2e-hooks.ts"
  printf '%s\n' 'withToken(x);' > "$d/net/bindings/index.ts"
  printf '%s' "$d"
}

d="$(tree)"
check "the clean layout passes" 0 bash "$CHECK" "$d"

d="$(tree)"; printf '%s\n' 'localStorage.getItem("bc.identity.v1");' > "$d/render/x.ts"
check "the storage key outside identity-storage.ts fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s\n' 'b.withToken(t);' > "$d/render/x.ts"
check "withToken outside net/ fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s\n' 'console.log(token);' >> "$d/identity/identity-storage.ts"
check "a console call in the token module fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s\n' 'window.__bc.token = t;' >> "$d/net/e2e-hooks.ts"
check "e2e-hooks exposing the token fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s\n' 'const u = `wss://h/?token=${t}`;' > "$d/net/url.ts"
check "a token query parameter fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s
' 'const c = DbConnection.builder();' > "$d/net/other.ts"
check "DbConnection.builder outside connection.ts and link.ts fails" 1 bash "$CHECK" "$d"

d="$(tree)"; printf '%s
' 'const c = DbConnection.builder();' > "$d/net/link.ts"
check "DbConnection.builder in link.ts passes" 0 bash "$CHECK" "$d"

d="$(fake_dir)"
check "a tree with no identity-storage.ts fails loudly" 1 bash "$CHECK" "$d"

check "the real client/src passes" 0 bash "$CHECK"

summary
exit $?
