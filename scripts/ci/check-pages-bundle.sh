#!/usr/bin/env bash
# The deploy story's PR-time catch for a build that would ship a blank
# page or a client that quietly dials the wrong server. This repo is
# `Abaudat/browser-city`, so GitHub Pages serves the built client from
# `/browser-city/`, not the domain root -- a default build emits
# `<script src="/assets/...">`, which resolves to the domain root and
# 404s. `ci.yml`'s `client-build` job runs this against a second,
# production-style build (`--base=/browser-city/`, dummy `wss://` `VITE_`
# values) so a misconfigured base or a missing production URI turns a PR
# red, never a master deploy.
#
# Quentin's cycle-1 direction (PR #288): the original version only
# grepped for a literal `"/assets/`, which missed the one real bug this
# story actually found -- `main.ts`'s `fetchDefs("/defs/defs.json")`, a
# root-absolute reference to a `public/` asset that is not under
# `/assets/` at all, and whose only static guard was `check-no-shared-
# code.sh`-style pattern matching that never ran (the e2e layer caught it
# instead, the wrong layer for a mechanical build-shape bug). Generalised:
# every top-level entry actually present under `<dist>`, except
# `index.html` itself, is checked -- a root-absolute reference to any of
# them, in any of the four ways one gets baked into a bundle (a
# double-quoted, single-quoted or backtick-template string, or an
# unquoted CSS `url(...)`), fails the build.
#
# Two independent things:
#   1. no root-absolute reference to a real top-level dist entry anywhere
#      in the built JS/CSS/HTML.
#   2. the real production URI actually reached the build (a positive
#      assertion -- "no localhost fallback" alone would still pass a
#      build that baked in some *other* wrong value), and the
#      `ws://127.0.0.1` local-dev fallback (client/src/net/config.ts)
#      never ships regardless.
#
# Usage: check-pages-bundle.sh <dist-dir> <base-path> <expected-uri>
#   <dist-dir>      the built output to check (e.g. client/dist-pages)
#   <base-path>     the Pages base the build actually used (e.g.
#                    /browser-city/) -- only used in this script's own
#                    messages, never re-derived from the dist output
#   <expected-uri>  the VITE_SPACETIME_URI value the build was made with
#                    (or any other string expected to appear verbatim in
#                    the built JS) -- the positive half of the URI check
set -euo pipefail

DIST_DIR="${1:-}"
BASE_PATH="${2:-}"
EXPECTED_URI="${3:-}"

[ -n "$DIST_DIR" ] || { echo "check-pages-bundle: missing <dist-dir> argument" >&2; exit 1; }
[ -n "$BASE_PATH" ] || { echo "check-pages-bundle: missing <base-path> argument" >&2; exit 1; }
[ -n "$EXPECTED_URI" ] || { echo "check-pages-bundle: missing <expected-uri> argument" >&2; exit 1; }
[ -d "$DIST_DIR" ] || { echo "check-pages-bundle: $DIST_DIR not found" >&2; exit 1; }
[ -f "$DIST_DIR/index.html" ] || { echo "check-pages-bundle: $DIST_DIR/index.html not found" >&2; exit 1; }

FAILED=0

# --- every top-level entry under <dist>, except index.html itself: none
# of its own paths may be referenced root-absolute (without the base) ---
NAMES=()
for entry in "$DIST_DIR"/*; do
  name="$(basename "$entry")"
  [ "$name" = "index.html" ] && continue
  NAMES+=("$name")
done
[ "${#NAMES[@]}" -gt 0 ] || { echo "check-pages-bundle: $DIST_DIR has nothing under it besides index.html to check" >&2; exit 1; }

for name in "${NAMES[@]}"; do
  entry="$DIST_DIR/$name"
  # A directory (assets/, defs/, ...) is banned with a trailing slash so
  # `"/browser-city/assets/` (correctly based) never false-positives; a
  # top-level file has no such separator to anchor on.
  suffix=""
  [ -d "$entry" ] && suffix="/"
  MATCHES="$(grep -rnE "[\"'\`]/${name}${suffix}|url\\(/${name}${suffix}" "$DIST_DIR" --include='*.js' --include='*.css' --include='*.html' 2>/dev/null || true)"
  if [ -n "$MATCHES" ]; then
    echo "check-pages-bundle: FAIL -- a root-absolute reference to '/${name}${suffix}' was found (the build's base ('$BASE_PATH') was not applied to it):" >&2
    echo "$MATCHES" >&2
    FAILED=1
  fi
done

# --- the production URI actually reached the build (positive) --------------
if ! grep -rqF "$EXPECTED_URI" "$DIST_DIR" --include='*.js' 2>/dev/null; then
  echo "check-pages-bundle: FAIL -- expected production URI '$EXPECTED_URI' was not found anywhere in the built JS -- VITE_SPACETIME_URI did not reach the build" >&2
  FAILED=1
fi

# --- the local-dev fallback URI never ships (negative, regardless) ---------
LOCALHOST_MATCHES="$(grep -rlF 'ws://127.0.0.1' "$DIST_DIR" --include='*.js' 2>/dev/null || true)"
if [ -n "$LOCALHOST_MATCHES" ]; then
  echo "check-pages-bundle: FAIL -- client/src/net/config.ts's local-dev fallback (ws://127.0.0.1) shipped in the production bundle:" >&2
  echo "$LOCALHOST_MATCHES" >&2
  FAILED=1
fi

# --- story 1.11: the story 1.1 ping indicator never ships (negative) -------
# `render/bootstrap.ts` (deleted this story) mounted a fixed-position
# `#bc-ping-indicator` div -- a fourth persistent DOM surface with no
# requirement behind it, exactly the abstract counter NFR22/FR151 ban. It
# must never reach a production bundle, whatever a later branch does.
PING_INDICATOR_MATCHES="$(grep -rlF 'bc-ping-indicator' "$DIST_DIR" --include='*.js' --include='*.html' 2>/dev/null || true)"
if [ -n "$PING_INDICATOR_MATCHES" ]; then
  echo "check-pages-bundle: FAIL -- the story 1.1 ping indicator (#bc-ping-indicator, NFR22/FR151 forbid it) shipped in the production bundle:" >&2
  echo "$PING_INDICATOR_MATCHES" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "check-pages-bundle: base path ('$BASE_PATH') and production URI ('$EXPECTED_URI') both check out" >&2
exit 0
