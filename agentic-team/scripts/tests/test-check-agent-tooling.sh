#!/usr/bin/env bash
# Fixture-driven coverage for scripts/ci/check-agent-tooling.sh. Never reads
# the live repo tree -- every fixture is a scratch dir built here, so this
# suite keeps testing the checker's logic even after the real .mcp.json or
# docs/architecture.md changes shape.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
CHECK="$TEST_DIR/../../../scripts/ci/check-agent-tooling.sh"

# write_good_fixture <dir> -- a config and doc that agree, checked in.
write_good_fixture() {
  local d="$1"
  mkdir -p "$d/docs" "$d/.claude" "$d/server"
  cat > "$d/server/Cargo.toml" <<'TOML'
[dependencies]
spacetimedb = { version = "2.9.*" }
TOML
  cat > "$d/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "spacetimedb": {"command": "spacetime", "args": ["mcp", "--server", "local"]},
    "context7": {"type": "http", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY": "${CONTEXT7_API_KEY:-}"}}
  }
}
JSON
  cat > "$d/.claude/settings.json" <<'JSON'
{
  "extraKnownMarketplaces": {
    "spacetimedb-plugins": {"source": {"source": "github", "repo": "clockworklabs/SpacetimeDB", "ref": "v2.9.0"}},
    "pixijs-skills": {"source": {"source": "github", "repo": "pixijs/pixijs-skills", "ref": "main"}}
  },
  "enabledPlugins": {
    "spacetimedb@spacetimedb-plugins": true,
    "pixijs-skills@pixijs-skills": true
  },
  "enabledMcpjsonServers": ["spacetimedb", "context7"],
  "deniedMcpServers": [
    {"serverCommand": ["spacetime", "mcp"]}
  ]
}
JSON
  cat > "$d/docs/architecture.md" <<'MD'
## Toolchain

<!-- bc:agent-tooling:start -->
| Tool | Provided as | Pinned version | Notes |
| --- | --- | --- | --- |
| `spacetimedb` | `spacetime mcp` CLI subcommand, `.mcp.json` | 2.9.* | `--server local` explicit |
| `context7` | hosted HTTP MCP, `.mcp.json` | hosted, unpinnable | needs `${CONTEXT7_API_KEY}` |
| `spacetimedb@spacetimedb-plugins` | Claude plugin marketplace, `.claude/settings.json` | v2.9.0 | its bundled `spacetime mcp` is blocked by `deniedMcpServers` |
| `pixijs-skills@pixijs-skills` | Claude plugin marketplace, `.claude/settings.json` | floating on `main` | PixiJS v8 rendering skills |
<!-- bc:agent-tooling:end -->
MD
}

# fresh_fixture -- a good fixture in its own scratch dir, ready to mutate.
fresh_fixture() {
  local d
  d="$(fake_dir)"
  rm -rf "$d"
  write_good_fixture "$d"
  printf '%s' "$d"
}

run_check() { bash "$CHECK" "$1"; }

# insert_before_end_marker <dir> <line> -- appends a row to the doc's
# agent-tooling table, inside the markers.
insert_before_end_marker() {
  local d="$1" line="$2" tmp
  tmp="$(fake_dir)/architecture.md"
  awk -v line="$line" '
    /<!-- bc:agent-tooling:end -->/ { print line }
    { print }
  ' "$d/docs/architecture.md" > "$tmp"
  mv "$tmp" "$d/docs/architecture.md"
}

echo "green: config and docs/architecture.md agree"
GOOD="$(fresh_fixture)"
check "a matching config and doc passes" 0 run_check "$GOOD"

echo
echo "green: a backticked row outside the markers is not mistaken for agent tooling"
D0="$(fresh_fixture)"
{ echo; echo '| `bounds` | the table-bounds registry crate |'; } >> "$D0/docs/architecture.md"
check "an unrelated backticked row elsewhere still passes" 0 run_check "$D0"

echo
echo "red: tool declared in config has no row in the doc"
D1="$(fresh_fixture)"
TMP="$(fake_dir)"
jq '.mcpServers.foo = {"command": "foo", "args": []}' "$D1/.mcp.json" > "$TMP/mcp.json" && mv "$TMP/mcp.json" "$D1/.mcp.json"
OUT="$(run_check "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'foo' is declared in config but has no row in docs/architecture.md's agent-tooling table\"" _ "$OUT"

echo
echo "red: doc has a row with no config declaring it"
D2="$(fresh_fixture)"
insert_before_end_marker "$D2" '| `ghost-tool` | nothing | 1.0.0 | ghost |'
OUT="$(run_check "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"docs/architecture.md's agent-tooling table has a row for 'ghost-tool' but no config\"" _ "$OUT"

echo
echo "red: context7's pin is prose instead of the exact unpinnable literal"
D3="$(fresh_fixture)"
sed -i 's/hosted, unpinnable/hosted endpoint, no version to pin/' "$D3/docs/architecture.md"
OUT="$(run_check "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'context7' has no version to pin\"" _ "$OUT"

echo
echo "red: spacetimedb's doc pin has drifted from server/Cargo.toml's crate pin"
D4="$(fresh_fixture)"
sed -i 's/| 2.9.\* |/| 2.10.0 |/' "$D4/docs/architecture.md"
OUT="$(run_check "$D4" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'spacetimedb' pins '2.10.0' in docs/architecture.md but server/Cargo.toml pins the spacetimedb crate at '2.9.*'\"" _ "$OUT"

echo
echo "red: malformed JSON"
D5="$(fresh_fixture)"
echo '{not json' > "$D5/.mcp.json"
OUT="$(run_check "$D5" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF '.mcp.json does not parse as JSON'" _ "$OUT"

echo
echo "red: an mcpServers entry not on the first-party allowlist"
D6="$(fresh_fixture)"
TMP2="$(fake_dir)"
jq '.mcpServers.npxtool = {"command": "npx", "args": ["-y", "some-pkg"]}' "$D6/.mcp.json" > "$TMP2/mcp.json" && mv "$TMP2/mcp.json" "$D6/.mcp.json"
insert_before_end_marker "$D6" '| `npxtool` | npx, .mcp.json | some-pkg@1.0.0 | test |'
OUT="$(run_check "$D6" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'mcpServers.npxtool (command '\\''npx'\\'', url '\\'''\\'') is not on the first-party allowlist'" _ "$OUT"

echo
echo "red: an inline credential instead of an \${ENV_VAR} reference"
D7="$(fresh_fixture)"
TMP3="$(fake_dir)"
jq '.mcpServers.context7.headers.CONTEXT7_API_KEY = "sk-live-abcdef123456"' "$D7/.mcp.json" > "$TMP3/mcp.json" && mv "$TMP3/mcp.json" "$D7/.mcp.json"
OUT="$(run_check "$D7" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"mcpServers.context7's 'CONTEXT7_API_KEY' is not an \\\${ENV_VAR} reference\"" _ "$OUT"

echo
echo "red: spacetime mcp without an explicit --server local"
D8="$(fresh_fixture)"
TMP4="$(fake_dir)"
jq '.mcpServers.spacetimedb.args = ["mcp"]' "$D8/.mcp.json" > "$TMP4/mcp.json" && mv "$TMP4/mcp.json" "$D8/.mcp.json"
OUT="$(run_check "$D8" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"runs 'spacetime mcp' without an explicit '--server local'\"" _ "$OUT"

echo
echo "red: an enabled plugin's marketplace with no pinned ref at all"
D9="$(fresh_fixture)"
TMP5="$(fake_dir)"
jq 'del(.extraKnownMarketplaces."pixijs-skills".source.ref)' "$D9/.claude/settings.json" > "$TMP5/settings.json" && mv "$TMP5/settings.json" "$D9/.claude/settings.json"
OUT="$(run_check "$D9" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"marketplace 'pixijs-skills' (behind 'pixijs-skills@pixijs-skills') has no pinned ref\"" _ "$OUT"

echo
echo "red: drift -- ref changed in config only, doc left stale"
D_DRIFT1="$(fresh_fixture)"
TMP6="$(fake_dir)"
jq '.extraKnownMarketplaces."pixijs-skills".source.ref = "develop"' "$D_DRIFT1/.claude/settings.json" > "$TMP6/settings.json" && mv "$TMP6/settings.json" "$D_DRIFT1/.claude/settings.json"
OUT="$(run_check "$D_DRIFT1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'.claude/settings.json' pins marketplace 'pixijs-skills' at ref 'develop' -- they have drifted apart\"" _ "$OUT"

echo
echo "red: drift -- doc changed only, config left stale"
D_DRIFT2="$(fresh_fixture)"
sed -i "s/floating on \`main\`/floating on \`develop\`/" "$D_DRIFT2/docs/architecture.md"
OUT="$(run_check "$D_DRIFT2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'they have drifted apart'" _ "$OUT"

echo
echo "green: ref and doc changed together, in lockstep"
D_LOCKSTEP="$(fresh_fixture)"
TMP7="$(fake_dir)"
jq '.extraKnownMarketplaces."spacetimedb-plugins".source.ref = "v2.9.1"' "$D_LOCKSTEP/.claude/settings.json" > "$TMP7/settings.json" && mv "$TMP7/settings.json" "$D_LOCKSTEP/.claude/settings.json"
sed -i 's/| v2.9.0 |/| v2.9.1 |/' "$D_LOCKSTEP/docs/architecture.md"
check "config and doc updated together still passes" 0 run_check "$D_LOCKSTEP"

echo
echo "red: a marketplace ref is a default branch but the doc does not say floating"
D_FLOAT="$(fresh_fixture)"
sed -i "s/floating on \`main\`/pinned to \`main\`/" "$D_FLOAT/docs/architecture.md"
OUT="$(run_check "$D_FLOAT" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"is pinned to 'main', a default branch, but its row does not say 'floating'\"" _ "$OUT"

echo
echo "red: a marketplace repo not on the first-party allowlist"
D10="$(fresh_fixture)"
TMP8="$(fake_dir)"
jq '.extraKnownMarketplaces."spacetimedb-plugins".source.repo = "some-org/some-fork"' "$D10/.claude/settings.json" > "$TMP8/settings.json" && mv "$TMP8/settings.json" "$D10/.claude/settings.json"
OUT="$(run_check "$D10" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"marketplace 'spacetimedb-plugins' sources from 'some-org/some-fork', which is not on the first-party allowlist\"" _ "$OUT"

echo
echo "red: the agent-tooling markers are missing"
D11="$(fresh_fixture)"
sed -i '/<!-- bc:agent-tooling:start -->/d; /<!-- bc:agent-tooling:end -->/d' "$D11/docs/architecture.md"
OUT="$(run_check "$D11" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'is missing the'" _ "$OUT"

echo
echo "red: the plugin's bundled MCP server has no deniedMcpServers entry at all"
D13="$(fresh_fixture)"
TMP9="$(fake_dir)"
jq 'del(.deniedMcpServers)' "$D13/.claude/settings.json" > "$TMP9/settings.json" && mv "$TMP9/settings.json" "$D13/.claude/settings.json"
OUT="$(run_check "$D13" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'spacetimedb@spacetimedb-plugins' bundles its own 'spacetime mcp' with no --server flag\"" _ "$OUT"

echo
echo "red: deniedMcpServers is present but does not list the bundled command"
D14="$(fresh_fixture)"
TMP10="$(fake_dir)"
jq '.deniedMcpServers = [{"serverName": "something-else"}]' "$D14/.claude/settings.json" > "$TMP10/settings.json" && mv "$TMP10/settings.json" "$D14/.claude/settings.json"
OUT="$(run_check "$D14" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'spacetimedb@spacetimedb-plugins' bundles its own 'spacetime mcp' with no --server flag\"" _ "$OUT"

echo
echo "red: an unrecognized top-level key in .claude/settings.json"
D15="$(fresh_fixture)"
TMP11="$(fake_dir)"
jq '.disabledMcpServers = ["mcp__plugin_spacetimedb_spacetimedb"]' "$D15/.claude/settings.json" > "$TMP11/settings.json" && mv "$TMP11/settings.json" "$D15/.claude/settings.json"
OUT="$(run_check "$D15" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"has an unrecognized top-level key 'disabledMcpServers'\"" _ "$OUT"

echo
echo "red: a .mcp.json server is not approved in enabledMcpjsonServers"
D16="$(fresh_fixture)"
TMP12="$(fake_dir)"
jq '.enabledMcpjsonServers = ["spacetimedb"]' "$D16/.claude/settings.json" > "$TMP12/settings.json" && mv "$TMP12/settings.json" "$D16/.claude/settings.json"
OUT="$(run_check "$D16" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"mcpServers.context7 is declared in .mcp.json but not approved in .claude/settings.json's enabledMcpjsonServers\"" _ "$OUT"

echo
echo "red: enabledMcpjsonServers approves a server .mcp.json does not declare"
D17="$(fresh_fixture)"
TMP13="$(fake_dir)"
jq '.enabledMcpjsonServers = ["spacetimedb", "context7", "ghost"]' "$D17/.claude/settings.json" > "$TMP13/settings.json" && mv "$TMP13/settings.json" "$D17/.claude/settings.json"
OUT="$(run_check "$D17" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"enabledMcpjsonServers approves 'ghost', which is not a server .mcp.json declares\"" _ "$OUT"

echo
echo "red: .mcp.json missing entirely"
D12="$(fake_dir)"
rm -rf "$D12"
mkdir -p "$D12/docs"
: > "$D12/docs/architecture.md"
OUT="$(run_check "$D12" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c "printf '%s' \"\$1\" | grep -qF '.mcp.json not found'" _ "$OUT"

summary
