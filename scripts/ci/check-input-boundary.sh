#!/usr/bin/env bash
# FR148/AC3 (Quentin's direction, story 1.9): nothing under
# `client/src/input/**` may import a procedure, an interaction module, a
# reducer binding or the demo scene. The input layer emits intents whose
# meaning is somebody else's business, and the way that stays true is that
# it cannot *reach* the code that would decide a meaning.
#
# `client/biome.json`'s own `src/input/**` override bans those imports
# too, and is the fast feedback a developer gets. This is the second,
# independent check, for the two things a lint rule cannot promise: that
# the override still exists at all (a deleted block fails nothing), and
# that a module named for a procedure or an interaction is refused by
# name even if it lands somewhere the override's path patterns do not
# cover. A comment is not an automated test; this is.
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# An optional first argument overrides the scanned directory --
# `scripts/ci/tests/test-check-input-boundary.sh`'s own use, so it can
# plant each banned import in a throwaway temp file rather than the real
# `client/src/input/`. CI itself always calls this with no argument.
SRC_DIR="${1:-"$REPO_ROOT/client/src/input"}"

[ -d "$SRC_DIR" ] || { echo "check-input-boundary: $SRC_DIR not found" >&2; exit 1; }

# Matches the module specifier of a static `import ... from "…"`, a
# side-effect `import "…"`, a type-only import, or a dynamic `import("…")`
# whose path names any of: `net/` (bindings and connection included),
# `test-street/`, a `procedure`/`procedures` module, an `interaction`/
# `interactions` module, or `pixi.js`. Deliberately matches the *path*,
# not an identifier, so a local variable called `interaction` is never a
# false positive.
PATTERN='(from|import)[[:space:]]*\(?[[:space:]]*["'"'"'][^"'"'"']*((^|/)(net|test-street|procedure|procedures|interaction|interactions)(/|["'"'"'])|pixi\.js)'

MATCHES="$(grep -rnE "$PATTERN" "$SRC_DIR" --include='*.ts' 2>/dev/null || true)"

if [ -n "$MATCHES" ]; then
  echo "check-input-boundary: FAIL -- client/src/input/ must not import a procedure, an interaction module, net/ or test-street/ (FR148: the input layer never encodes what an intent means):" >&2
  echo "$MATCHES" >&2
  exit 1
fi

# The Biome override is the other half of this guard, and a deleted
# override would otherwise fail nothing at all.
BIOME_CONFIG="$REPO_ROOT/client/biome.json"
if [ -f "$BIOME_CONFIG" ] && ! grep -q '"src/input/\*\*"' "$BIOME_CONFIG"; then
  echo "check-input-boundary: FAIL -- client/biome.json has no src/input/** override left (the import ban on the input layer was removed)" >&2
  exit 1
fi

echo "check-input-boundary: client/src/input/ imports no procedure, interaction, net/ or test-street/ module (FR148)" >&2
exit 0
