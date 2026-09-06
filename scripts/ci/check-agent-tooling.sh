#!/usr/bin/env bash
# Keeps the agent tooling declared in `.mcp.json` / `.claude/settings.json`
# honest against its record in docs/architecture.md's agent-tooling table, in
# every direction that can rot silently, plus a few hard safety rules. Pure
# static check over the working tree: no network, no `npx`, no `spacetime`
# binary invocation, no MCP handshake.
#
# Usage: check-agent-tooling.sh [root_dir]
# root_dir defaults to the repo root; a caller (the unit tests) can point it
# at a fixture directory instead so this never has to read the live tree to
# be exercised.
set -euo pipefail

DEFAULT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${1:-$DEFAULT_ROOT}"
MCP="$ROOT/.mcp.json"
SETTINGS="$ROOT/.claude/settings.json"
ARCH="$ROOT/docs/architecture.md"
SPACETIME_JSON="$ROOT/spacetime.json"

FAILED=0
fail() { echo "check-agent-tooling: FAIL -- $1" >&2; FAILED=1; }
# jq -r, with any stray \r stripped -- some jq builds emit CRLF on Windows
# when stdout isn't a tty, which would otherwise corrupt line-oriented reads.
jqr() { jq -r "$@" | tr -d '\r'; }

[ -f "$MCP" ] || { fail "$MCP not found -- declare the MCP servers there"; exit 1; }
[ -f "$ARCH" ] || { fail "$ARCH not found"; exit 1; }

# --- JSON must parse ---------------------------------------------------------
MCP_OK=1
if ! MCP_ERR="$(jq empty "$MCP" 2>&1)"; then
  fail "$MCP does not parse as JSON: $MCP_ERR"
  MCP_OK=0
fi

SETTINGS_OK=1
if [ -f "$SETTINGS" ] && ! SETTINGS_ERR="$(jq empty "$SETTINGS" 2>&1)"; then
  fail "$SETTINGS does not parse as JSON: $SETTINGS_ERR"
  SETTINGS_OK=0
fi

# --- collect the config's declared tool ids ----------------------------------
# Every id is either an .mcp.json `mcpServers` key, or a `<plugin>@<marketplace>`
# key from .claude/settings.json's `enabledPlugins` that is actually enabled
# (true) -- a plugin present but disabled is not "configured".
MCP_SERVER_IDS=""
if [ "$MCP_OK" -eq 1 ]; then
  MCP_SERVER_IDS="$(jqr '.mcpServers // {} | keys[]' "$MCP")"
fi
PLUGIN_IDS=""
if [ -f "$SETTINGS" ] && [ "$SETTINGS_OK" -eq 1 ]; then
  PLUGIN_IDS="$(jqr '.enabledPlugins // {} | to_entries[] | select(.value == true) | .key' "$SETTINGS")"
fi
CONFIG_IDS="$(printf '%s\n%s\n' "$MCP_SERVER_IDS" "$PLUGIN_IDS" | sed '/^$/d' | sort -u)"

# --- collect the doc's declared rows ------------------------------------------
# The agent-tooling table's rows are identified the same way
# docs/trace-matrix.md's are: a leading `| \`id\` ` cell -- position-independent,
# so this does not care which table in the file it lives in.
DOC_ROWS="$(grep -E '^\| `' "$ARCH" || true)"
DOC_IDS="$(printf '%s\n' "$DOC_ROWS" | awk -F'|' '{print $2}' | tr -d '`' | xargs -n1 2>/dev/null | sort -u || true)"

if [ -z "$DOC_ROWS" ]; then
  fail "$ARCH has no agent-tooling rows (expected rows shaped '| \`id\` | ... |') -- add the agent-tooling table to the Toolchain section"
fi

# --- symmetry: config <-> doc, both directions -------------------------------
while IFS= read -r id; do
  [ -n "$id" ] || continue
  if ! printf '%s\n' "$DOC_IDS" | grep -qxF "$id"; then
    fail "'$id' is declared in config but has no row in docs/architecture.md -- add one to the agent-tooling table"
  fi
done <<< "$CONFIG_IDS"

while IFS= read -r id; do
  [ -n "$id" ] || continue
  if ! printf '%s\n' "$CONFIG_IDS" | grep -qxF "$id"; then
    fail "docs/architecture.md has a row for '$id' but no config (.mcp.json / .claude/settings.json) declares it"
  fi
done <<< "$DOC_IDS"

# --- every doc row carries an exact pinned version ----------------------------
# | Tool | Provided as | Pinned version | Notes |
while IFS='|' read -r _ id _provided version _rest; do
  id="$(printf '%s' "$id" | tr -d '`' | xargs)"
  version="$(printf '%s' "$version" | xargs)"
  [ -n "$id" ] || continue
  if [ -z "$version" ]; then
    fail "'$id' has an empty Pinned version cell in docs/architecture.md"
  elif [ "$version" = "*" ]; then
    fail "'$id' pins version '*' -- a floating wildcard is not a pin"
  elif printf '%s' "$version" | grep -qiw "latest"; then
    fail "'$id' pins version 'latest' -- record the exact version instead"
  fi
done <<< "$DOC_ROWS"

# --- config-level pin and safety checks ---------------------------------------
if [ "$MCP_OK" -eq 1 ]; then
  # any npx-launched server must pin an exact package version, never a bare
  # or unpinned invocation
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    cmd="$(jqr --arg n "$name" '.mcpServers[$n].command // ""' "$MCP")"
    [ "$cmd" = "npx" ] || continue
    if ! jq -e --arg n "$name" '.mcpServers[$n].args // [] | any(test("@[0-9]"))' "$MCP" >/dev/null; then
      fail "mcpServers.$name runs via npx with no @version-pinned package -- pin an exact version"
    fi
  done <<< "$MCP_SERVER_IDS"

  # headers/env values that carry a secret must be an ${ENV_VAR} reference,
  # never an inline literal
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    server="${line%%|*}"; rest="${line#*|}"
    key="${rest%%=*}"; value="${rest#*=}"
    if ! [[ "$value" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*\}$ ]]; then
      fail "mcpServers.$server's '$key' is not an \${ENV_VAR} reference -- no inline credential belongs in a tracked file"
    fi
  done <<< "$(jqr '.mcpServers // {} | to_entries[] | .key as $s | ((.value.headers // {}) + (.value.env // {})) | to_entries[] | "\($s)|\(.key)=\(.value)"' "$MCP")"

  # never Maincloud, never a hard-coded production database
  if jq -e 'tostring | test("maincloud"; "i")' "$MCP" >/dev/null 2>&1; then
    fail "$MCP names a Maincloud host -- agent tooling targets the local server only"
  fi
  if [ -f "$SPACETIME_JSON" ]; then
    PROD_DB="$(jqr '.database // empty' "$SPACETIME_JSON" 2>/dev/null || true)"
    if [ -n "$PROD_DB" ] && jq -e --arg db "$PROD_DB" 'tostring | test($db)' "$MCP" >/dev/null 2>&1; then
      fail "$MCP hard-codes the database name '$PROD_DB' -- read it from the local spacetime config instead"
    fi
  fi
fi

if [ "$SETTINGS_OK" -eq 1 ] && [ -f "$SETTINGS" ]; then
  if jq -e 'tostring | test("maincloud"; "i")' "$SETTINGS" >/dev/null 2>&1; then
    fail "$SETTINGS names a Maincloud host -- agent tooling targets the local server only"
  fi
  # every marketplace source behind an enabled plugin must pin an exact sha,
  # not just a floating branch/tag ref
  while IFS= read -r mp; do
    [ -n "$mp" ] || continue
    sha="$(jqr --arg m "$mp" '.extraKnownMarketplaces[$m].source.sha // empty' "$SETTINGS")"
    if [ -z "$sha" ]; then
      fail "marketplace '$mp' has no pinned commit sha -- a branch/tag ref alone can move under it"
    fi
  done <<< "$(jqr '.enabledPlugins // {} | keys[] | split("@")[1]' "$SETTINGS" | sort -u)"
fi

# --- grep guard: no community SpacetimeDB MCP server anywhere ---------------
# Driven off tracked files, not a recursive grep, for the same reason
# check-trace-matrix.sh scopes its #[ignore] scan that way.
BANNED_PATTERNS=(
  'spacetimedb-mcp-server'
  'spacetimemcp'
  'game-mcp-spacetime'
  'fail2fail-studios/spacetimedb-mcp'
)
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  for pattern in "${BANNED_PATTERNS[@]}"; do
    HIT="$(git -C "$ROOT" ls-files -z | (cd "$ROOT" && xargs -0 -r grep -liF "$pattern") 2>/dev/null || true)"
    if [ -n "$HIT" ]; then
      fail "community SpacetimeDB MCP package name '$pattern' found in tracked files (first-party only):"
      printf '%s\n' "$HIT" >&2
    fi
  done
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-agent-tooling: config and docs/architecture.md agree" >&2
exit 0
