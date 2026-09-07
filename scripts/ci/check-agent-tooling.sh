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
CARGO_TOML="$ROOT/server/Cargo.toml"

MARKER_START='<!-- bc:agent-tooling:start -->'
MARKER_END='<!-- bc:agent-tooling:end -->'
UNPINNABLE='hosted, unpinnable'
# Marketplace `ref`s that name a moving default branch rather than a pin --
# a plugin resting on one of these floats, and the doc must say so rather
# than dress it up as a version.
DEFAULT_BRANCH_NAMES=(main master)

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

# --- collect the doc's declared rows, strictly between the markers ----------
# Scoped to an explicit pair of markers, the same convention the `bc:`
# vocabulary already uses elsewhere -- so an unrelated table gaining a
# backticked first column (Stack, Naming, ...) can never be mistaken for an
# agent-tooling row, and a row moved outside the markers by accident is
# loudly missing rather than silently ignored.
DOC_ROWS=""
if ! grep -qF "$MARKER_START" "$ARCH" || ! grep -qF "$MARKER_END" "$ARCH"; then
  fail "$ARCH is missing the '$MARKER_START' / '$MARKER_END' markers around the agent-tooling table"
else
  DOC_ROWS="$(awk -v s="$MARKER_START" -v e="$MARKER_END" '
    $0 == s { inside = 1; next }
    $0 == e { inside = 0; next }
    inside && /^\|/ { print }
  ' "$ARCH")"
  # drop the header and separator rows, keep only backtick-id data rows
  DOC_ROWS="$(printf '%s\n' "$DOC_ROWS" | grep -E '^\| `' || true)"
  if [ -z "$DOC_ROWS" ]; then
    fail "$ARCH has no rows between the agent-tooling markers"
  fi
fi
# whole first cell, trimmed -- never word-split, a multi-word id would
# otherwise turn into several phantom ids
DOC_IDS="$(printf '%s\n' "$DOC_ROWS" | awk -F'|' '{print $2}' | tr -d '`' | sed 's/^ *//; s/ *$//' | sort -u)"
DOC_IDS="$(printf '%s\n' "$DOC_IDS" | sed '/^$/d')"

# --- symmetry: config <-> doc, both directions -------------------------------
while IFS= read -r id; do
  [ -n "$id" ] || continue
  if ! printf '%s\n' "$DOC_IDS" | grep -qxF "$id"; then
    fail "'$id' is declared in config but has no row in docs/architecture.md's agent-tooling table"
  fi
done <<< "$CONFIG_IDS"

while IFS= read -r id; do
  [ -n "$id" ] || continue
  if ! printf '%s\n' "$CONFIG_IDS" | grep -qxF "$id"; then
    fail "docs/architecture.md's agent-tooling table has a row for '$id' but no config (.mcp.json / .claude/settings.json) declares it"
  fi
done <<< "$DOC_IDS"

# doc_version_cell <id> -- the trimmed Pinned version cell for a row id.
doc_version_cell() {
  printf '%s\n' "$DOC_ROWS" | awk -F'|' -v want="$1" '
    { id = $2; gsub(/`/, "", id); gsub(/^ +| +$/, "", id);
      if (id == want) { v = $4; gsub(/^ +| +$/, "", v); print v; exit } }
  '
}
# doc_row <id> -- the whole row, for a Notes-column ("floating") search.
doc_row() {
  printf '%s\n' "$DOC_ROWS" | awk -F'|' -v want="$1" '
    { id = $2; gsub(/`/, "", id); gsub(/^ +| +$/, "", id);
      if (id == want) { print; exit } }
  '
}

# --- every doc row carries a real pin, cross-checked against its source -----
while IFS= read -r id; do
  [ -n "$id" ] || continue
  version="$(doc_version_cell "$id")"
  if [ -z "$version" ]; then
    fail "'$id' has an empty Pinned version cell in docs/architecture.md"
    continue
  fi
  case "$id" in
    context7)
      if [ "$version" != "$UNPINNABLE" ]; then
        fail "'$id' has no version to pin (a hosted endpoint) -- its cell must read exactly '$UNPINNABLE', not a free-text excuse"
      fi
      ;;
    spacetimedb)
      if [ -f "$CARGO_TOML" ]; then
        CRATE_PIN="$(grep -oE 'spacetimedb = \{ version = "[^"]+"' "$CARGO_TOML" | sed -E 's/.*"([^"]+)"/\1/' || true)"
        if [ -z "$CRATE_PIN" ]; then
          fail "could not find the spacetimedb crate's version pin in $CARGO_TOML to cross-check '$id' against"
        elif [ "$version" != "$CRATE_PIN" ]; then
          fail "'$id' pins '$version' in docs/architecture.md but server/Cargo.toml pins the spacetimedb crate at '$CRATE_PIN' -- the CLI number rides the crate pin, they must match"
        fi
      fi
      ;;
    *@*)
      # a <plugin>@<marketplace> id: the doc's Pinned version cell must
      # literally contain the marketplace's actual `ref` -- this is what
      # catches drift, in either direction, between config and doc.
      if [ "$SETTINGS_OK" -eq 1 ] && [ -f "$SETTINGS" ]; then
        mp="${id#*@}"
        ref="$(jqr --arg m "$mp" '.extraKnownMarketplaces[$m].source.ref // empty' "$SETTINGS")"
        if [ -z "$ref" ]; then
          fail "marketplace '$mp' (behind '$id') has no pinned ref -- a marketplace source with nothing to check out at all"
        elif ! printf '%s' "$version" | grep -qF "$ref"; then
          fail "'$id' records '$version' in docs/architecture.md but '.claude/settings.json' pins marketplace '$mp' at ref '$ref' -- they have drifted apart"
        fi
        for branch in "${DEFAULT_BRANCH_NAMES[@]}"; do
          if [ "$ref" = "$branch" ]; then
            ROW="$(doc_row "$id")"
            if ! printf '%s' "$ROW" | grep -qi "floating"; then
              fail "marketplace '$mp' (behind '$id') is pinned to '$ref', a default branch, but its row does not say 'floating' -- record it honestly instead of dressing it up as a version"
            fi
          fi
        done
      fi
      ;;
  esac
done <<< "$DOC_IDS"

# --- config-level safety checks -----------------------------------------------
if [ "$MCP_OK" -eq 1 ]; then
  # headers/env values that carry a secret must be an ${ENV_VAR} reference
  # (optionally with a ${VAR:-default} fallback), never an inline literal
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    server="${line%%|*}"; rest="${line#*|}"
    key="${rest%%=*}"; value="${rest#*=}"
    if ! [[ "$value" =~ ^\$\{[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}$ ]]; then
      fail "mcpServers.$server's '$key' is not an \${ENV_VAR} reference -- no inline credential belongs in a tracked file"
    fi
  done <<< "$(jqr '.mcpServers // {} | to_entries[] | .key as $s | ((.value.headers // {}) + (.value.env // {})) | to_entries[] | "\($s)|\(.key)=\(.value)"' "$MCP")"

  # allowlist, not a denylist -- a community MCP server does not get to
  # exist by having a name the checker has not heard of yet
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    cmd="$(jqr --arg n "$name" '.mcpServers[$n].command // empty' "$MCP")"
    type="$(jqr --arg n "$name" '.mcpServers[$n].type // empty' "$MCP")"
    url="$(jqr --arg n "$name" '.mcpServers[$n].url // empty' "$MCP")"
    if [ "$cmd" = "spacetime" ]; then
      # the one first-party command this repo trusts to run at all, and only
      # when it never resolves anywhere but the local server
      ARGS_JOINED="$(jqr --arg n "$name" '.mcpServers[$n].args // [] | join(" ")' "$MCP")"
      case "$ARGS_JOINED" in
        *mcp*)
          if ! printf '%s' "$ARGS_JOINED" | grep -qE -- '--server[ =]local'; then
            fail "mcpServers.$name runs 'spacetime mcp' without an explicit '--server local' -- the CLI's own default is not local"
          fi
          ;;
      esac
    elif [ "$type" = "http" ] && [ "$url" = "https://mcp.context7.com/mcp" ]; then
      : # the one first-party hosted endpoint this repo trusts
    else
      fail "mcpServers.$name (command '$cmd', url '$url') is not on the first-party allowlist -- declare it there or drop it"
    fi
  done <<< "$MCP_SERVER_IDS"

  if [ -f "$SPACETIME_JSON" ]; then
    PROD_DB="$(jqr '.database // empty' "$SPACETIME_JSON" 2>/dev/null || true)"
    if [ -n "$PROD_DB" ] && jq -e --arg db "$PROD_DB" 'tostring | test($db)' "$MCP" >/dev/null 2>&1; then
      fail "$MCP hard-codes the database name '$PROD_DB' -- read it from the local spacetime config instead"
    fi
  fi
fi

if [ "$SETTINGS_OK" -eq 1 ] && [ -f "$SETTINGS" ]; then
  # allowlist of top-level keys, confirmed against Claude Code's settings
  # reference -- an invented or misspelled key (like a prior cycle's
  # `disabledMcpServers`, which does not exist) must fail loudly rather than
  # sit there silently doing nothing while the doc claims it works
  ALLOWED_SETTINGS_KEYS=(extraKnownMarketplaces enabledPlugins deniedMcpServers enabledMcpjsonServers)
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    allowed=0
    for k in "${ALLOWED_SETTINGS_KEYS[@]}"; do
      if [ "$key" = "$k" ]; then allowed=1; fi
    done
    if [ "$allowed" -ne 1 ]; then
      fail "$SETTINGS has an unrecognized top-level key '$key' -- confirm it against Claude Code's settings reference before adding it"
    fi
  done <<< "$(jqr 'keys[]' "$SETTINGS")"

  # allowlist of first-party marketplace repos, replacing a community-package
  # denylist that could only ever ban names it already knew about
  FIRST_PARTY_REPOS=(
    'clockworklabs/SpacetimeDB'
    'pixijs/pixijs-skills'
  )
  while IFS= read -r mp; do
    [ -n "$mp" ] || continue
    repo="$(jqr --arg m "$mp" '.extraKnownMarketplaces[$m].source.repo // empty' "$SETTINGS")"
    allowed=0
    for fp in "${FIRST_PARTY_REPOS[@]}"; do
      if [ "$repo" = "$fp" ]; then allowed=1; fi
    done
    if [ "$allowed" -ne 1 ]; then
      fail "marketplace '$mp' sources from '$repo', which is not on the first-party allowlist"
    fi
  done <<< "$(jqr '.enabledPlugins // {} | keys[] | split("@")[1]' "$SETTINGS" | sort -u)"

  # plugins known to bundle their own flagless MCP server must have it
  # blocked exactly -- a documentation claim about closing a Maincloud path
  # is worthless without a machine behind it
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    bundled_cmd=""
    case "$id" in
      spacetimedb@spacetimedb-plugins) bundled_cmd="spacetime mcp" ;;
    esac
    [ -n "$bundled_cmd" ] || continue
    DENIED_COMMANDS="$(jqr '.deniedMcpServers // [] | .[] | select(.serverCommand) | .serverCommand | join(" ")' "$SETTINGS")"
    if ! printf '%s\n' "$DENIED_COMMANDS" | grep -qxF "$bundled_cmd"; then
      fail "'$id' bundles its own '$bundled_cmd' with no --server flag; deniedMcpServers needs an exact serverCommand entry for it, or re-enabling it opens an unscoped SpacetimeDB connection"
    fi
  done <<< "$PLUGIN_IDS"

  # a project .mcp.json server is not loaded until it is approved for that
  # project, and an unattended agent session cannot answer that prompt --
  # enabledMcpjsonServers must name exactly the servers .mcp.json declares,
  # both directions, so a server added there without being approved fails
  # the build instead of silently never loading
  if [ "$MCP_OK" -eq 1 ]; then
    APPROVED_SERVERS="$(jqr '.enabledMcpjsonServers // [] | .[]' "$SETTINGS" | sort -u)"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if ! printf '%s\n' "$APPROVED_SERVERS" | grep -qxF "$name"; then
        fail "mcpServers.$name is declared in .mcp.json but not approved in .claude/settings.json's enabledMcpjsonServers -- an unattended agent session can't click through the approval prompt"
      fi
    done <<< "$MCP_SERVER_IDS"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if ! printf '%s\n' "$MCP_SERVER_IDS" | grep -qxF "$name"; then
        fail "enabledMcpjsonServers approves '$name', which is not a server .mcp.json declares"
      fi
    done <<< "$APPROVED_SERVERS"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-agent-tooling: config and docs/architecture.md agree" >&2
exit 0
