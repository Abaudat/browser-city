#!/usr/bin/env bash
# The one place the deployed build's own commit stamp
# (`<meta name="bc-build" content="<sha>">`, injected into
# `dist/index.html`) is defined -- written by `scripts/ci/stamp-build.sh`,
# read by `scripts/ci/decide-client-deploy.sh` and `.github/workflows/
# deploy.yml`'s own `smoke` job wait loop. Quentin's direction (PR #288
# cycle 2): the format was written in one place and parsed in two,
# independently -- a format change should break a test, not a deploy.
# Sourced, never executed directly.

# bc_build_stamp_line <sha> -- the exact line stamp-build.sh injects.
bc_build_stamp_line() {
  printf '  <meta name="bc-build" content="%s" />' "$1"
}

# bc_build_stamp_extract -- reads HTML on stdin, prints the stamped SHA
# on stdout, or nothing if there is none.
bc_build_stamp_extract() {
  grep -oE 'name="bc-build" content="[0-9a-f]+"' | sed -E 's/.*content="([0-9a-f]+)"/\1/' | head -n1
}
