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
  mkdir -p "$d/docs" "$d/.claude"
  cat > "$d/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "spacetimedb": {"command": "spacetime", "args": ["mcp", "--server", "local"]},
    "context7": {"type": "http", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"}}
  }
}
JSON
  cat > "$d/.claude/settings.json" <<'JSON'
{
  "extraKnownMarketplaces": {
    "spacetimedb-plugins": {"source": {"source": "github", "repo": "clockworklabs/SpacetimeDB", "ref": "v2.9.0", "sha": "9e0d92412ff2248f401a8ad12d535f2b5ac30912"}},
    "pixijs-skills": {"source": {"source": "github", "repo": "pixijs/pixijs-skills", "ref": "main", "sha": "6aae70d76cf410432dd144029c07a1ad4bb12793"}}
  },
  "enabledPlugins": {
    "spacetimedb@spacetimedb-plugins": true,
    "pixijs-skills@pixijs-skills": true
  }
}
JSON
  cat > "$d/docs/architecture.md" <<'MD'
## Toolchain

| Tool | Provided as | Pinned version | Notes |
| --- | --- | --- | --- |
| `spacetimedb` | `spacetime mcp` CLI subcommand, `.mcp.json` | CLI 2.9.0 | `--server local` only, never Maincloud |
| `context7` | hosted HTTP MCP, `.mcp.json` | hosted endpoint, no local version | needs `${CONTEXT7_API_KEY}` |
| `spacetimedb@spacetimedb-plugins` | Claude plugin marketplace, `.claude/settings.json` | tag v2.9.0 | ships CLI/module/client skills |
| `pixijs-skills@pixijs-skills` | Claude plugin marketplace, `.claude/settings.json` | commit 6aae70d | PixiJS v8 rendering skills |
MD
  (cd "$d" && git init -q && git add -A) >/dev/null 2>&1
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

echo "green: config and docs/architecture.md agree"
GOOD="$(fresh_fixture)"
check "a matching config and doc passes" 0 run_check "$GOOD"

echo
echo "red: tool declared in config has no row in the doc"
D1="$(fresh_fixture)"
TMP="$(fake_dir)"
jq '.mcpServers.foo = {"command": "foo", "args": []}' "$D1/.mcp.json" > "$TMP/mcp.json" && mv "$TMP/mcp.json" "$D1/.mcp.json"
(cd "$D1" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D1" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'foo' is declared in config but has no row in docs/architecture.md\"" _ "$OUT"

echo
echo "red: doc has a row with no config declaring it"
D2="$(fresh_fixture)"
printf '| `ghost-tool` | nothing | 1.0.0 | ghost |\n' >> "$D2/docs/architecture.md"
(cd "$D2" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D2" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"docs/architecture.md has a row for 'ghost-tool' but no config\"" _ "$OUT"

echo
echo "red: a floating version"
D3="$(fresh_fixture)"
sed -i 's/CLI 2.9.0/latest/' "$D3/docs/architecture.md"
(cd "$D3" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D3" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"'spacetimedb' pins version 'latest'\"" _ "$OUT"

echo
echo "red: a community SpacetimeDB MCP package name in a tracked file"
D4="$(fresh_fixture)"
echo "see also spacetimedb-mcp-server on GitHub" >> "$D4/README.md"
(cd "$D4" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D4" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"community SpacetimeDB MCP package name 'spacetimedb-mcp-server' found\"" _ "$OUT"

echo
echo "red: malformed JSON"
D5="$(fresh_fixture)"
echo '{not json' > "$D5/.mcp.json"
(cd "$D5" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D5" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF '.mcp.json does not parse as JSON'" _ "$OUT"

echo
echo "red: an npx-launched server with no @version-pinned package"
D6="$(fresh_fixture)"
TMP2="$(fake_dir)"
jq '.mcpServers.npxtool = {"command": "npx", "args": ["-y", "some-pkg"]}' "$D6/.mcp.json" > "$TMP2/mcp.json" && mv "$TMP2/mcp.json" "$D6/.mcp.json"
printf '| `npxtool` | npx, .mcp.json | some-pkg@1.0.0 | test |\n' >> "$D6/docs/architecture.md"
(cd "$D6" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D6" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'mcpServers.npxtool runs via npx with no @version-pinned package'" _ "$OUT"

echo
echo "red: an inline credential instead of an \${ENV_VAR} reference"
D7="$(fresh_fixture)"
TMP3="$(fake_dir)"
jq '.mcpServers.context7.headers.CONTEXT7_API_KEY = "sk-live-abcdef123456"' "$D7/.mcp.json" > "$TMP3/mcp.json" && mv "$TMP3/mcp.json" "$D7/.mcp.json"
(cd "$D7" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D7" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"mcpServers.context7's 'CONTEXT7_API_KEY' is not an \\\${ENV_VAR} reference\"" _ "$OUT"

echo
echo "red: a Maincloud host in .mcp.json"
D8="$(fresh_fixture)"
TMP4="$(fake_dir)"
jq '.mcpServers.spacetimedb.args = ["mcp", "--server", "maincloud"]' "$D8/.mcp.json" > "$TMP4/mcp.json" && mv "$TMP4/mcp.json" "$D8/.mcp.json"
(cd "$D8" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D8" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF 'names a Maincloud host'" _ "$OUT"

echo
echo "red: an enabled plugin's marketplace with no pinned sha"
D9="$(fresh_fixture)"
TMP5="$(fake_dir)"
jq 'del(.extraKnownMarketplaces."pixijs-skills".source.sha)' "$D9/.claude/settings.json" > "$TMP5/settings.json" && mv "$TMP5/settings.json" "$D9/.claude/settings.json"
(cd "$D9" && git add -A) >/dev/null 2>&1
OUT="$(run_check "$D9" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the exact offending message" 0 bash -c \
  "printf '%s' \"\$1\" | grep -qF \"marketplace 'pixijs-skills' has no pinned commit sha\"" _ "$OUT"

echo
echo "red: .mcp.json missing entirely"
D10="$(fake_dir)"
rm -rf "$D10"
mkdir -p "$D10/docs"
: > "$D10/docs/architecture.md"
OUT="$(run_check "$D10" 2>&1)"; CODE=$?
check "exits non-zero" 1 bash -c "exit $CODE"
check "names the missing file" 0 bash -c "printf '%s' \"\$1\" | grep -qF '.mcp.json not found'" _ "$OUT"

summary
