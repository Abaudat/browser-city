#!/usr/bin/env bash
# The deploy story's PR-time catch for a build that would ship a blank
# page or a client that quietly dials localhost. This repo is
# `Abaudat/browser-city`, so GitHub Pages serves the built client from
# `/browser-city/`, not the domain root -- a default build emits
# `<script src="/assets/...">`, which resolves to the domain root and
# 404s. `ci.yml`'s `client-build` job runs this against a second,
# production-style build (`BC_BASE_PATH=/browser-city/`, dummy `wss://`
# `VITE_` values) so a misconfigured base or a missing production URI
# turns a PR red, never a master deploy.
#
# Two independent things, both mechanical rather than trusted:
#   1. no absolute /assets/... reference anywhere in the built output --
#      neither index.html's own src/href (the base-path bug this guard
#      exists for) nor a "/assets/ string baked into the emitted JS/CSS.
#      The latter matters because a `new URL(..., import.meta.url)` asset
#      import (ModernTileset's character-part sheets, story 1.10) resolves
#      to an absolute path at *build* time and is never rewritten by
#      whatever fixes index.html's own <script>/<link> tags -- checking
#      index.html alone would miss exactly this case.
#   2. no ws://127.0.0.1 anywhere in the bundle -- client/src/net/config.ts's
#      own local-dev fallback. If VITE_SPACETIME_URI never reached the
#      build, the shipped client would quietly dial localhost instead of
#      Maincloud: a blank game that still looks like a green pipeline.
#
# Usage: check-pages-bundle.sh <dist-dir> <base-path>
#   <dist-dir>   the built output to check (e.g. client/dist-pages)
#   <base-path>  the Pages base the build actually used (e.g. /browser-city/) --
#                only used in this script's own messages, never re-derived
#                from the dist output itself
set -euo pipefail

DIST_DIR="${1:-}"
BASE_PATH="${2:-}"

[ -n "$DIST_DIR" ] || { echo "check-pages-bundle: missing <dist-dir> argument" >&2; exit 1; }
[ -n "$BASE_PATH" ] || { echo "check-pages-bundle: missing <base-path> argument" >&2; exit 1; }
[ -d "$DIST_DIR" ] || { echo "check-pages-bundle: $DIST_DIR not found" >&2; exit 1; }
[ -f "$DIST_DIR/index.html" ] || { echo "check-pages-bundle: $DIST_DIR/index.html not found" >&2; exit 1; }

FAILED=0

# --- index.html never references an absolute /assets/... path --------------
INDEX_MATCHES="$(grep -nE '(src|href)="/assets/' "$DIST_DIR/index.html" || true)"
if [ -n "$INDEX_MATCHES" ]; then
  echo "check-pages-bundle: FAIL -- $DIST_DIR/index.html references an absolute /assets/... path -- the build's base was not '$BASE_PATH':" >&2
  echo "$INDEX_MATCHES" >&2
  FAILED=1
fi

# --- no "/assets/ string anywhere in the emitted JS/CSS ---------------------
JS_MATCHES="$(grep -rlE '"/assets/' "$DIST_DIR" --include='*.js' --include='*.css' 2>/dev/null || true)"
if [ -n "$JS_MATCHES" ]; then
  echo "check-pages-bundle: FAIL -- an absolute /assets/... string was found baked into the built JS/CSS -- the build's base was not '$BASE_PATH':" >&2
  echo "$JS_MATCHES" >&2
  FAILED=1
fi

# --- the local-dev fallback URI never ships ---------------------------------
LOCALHOST_MATCHES="$(grep -rlF 'ws://127.0.0.1' "$DIST_DIR" --include='*.js' 2>/dev/null || true)"
if [ -n "$LOCALHOST_MATCHES" ]; then
  echo "check-pages-bundle: FAIL -- client/src/net/config.ts's local-dev fallback (ws://127.0.0.1) shipped in the production bundle -- VITE_SPACETIME_URI did not reach the build:" >&2
  echo "$LOCALHOST_MATCHES" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-pages-bundle: base path ('$BASE_PATH') and production URI both check out" >&2
exit 0
