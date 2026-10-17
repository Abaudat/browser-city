#!/usr/bin/env bash
# Story 3.16: every reducer the `time-control` flavour adds, derived from the
# source rather than a hand-kept list: a `#[spacetimedb::reducer]` fn under a
# `#[cfg(feature = "time-control")]` attribute, and every reducer of a module
# declared under one (`#[cfg(...)] pub mod x;` -> `x.rs`). One name a line,
# sorted. Fails when it finds none, so a guard built on it is never vacuous.
# Usage: list-time-control-reducers.sh [src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "list-time-control-reducers: $SRC_DIR not found" >&2; exit 1; }

CFG='#[cfg(feature = "time-control")]'

# Reducer fns in a file, all of them (`gated=all`) or only those under the
# cfg attribute (`gated=item`). Attribute lines between the cfg and the fn
# keep the cfg pending; any other code line drops it.
reducers_in() {
  tr -d '\r' <"$1" | awk -v mode="$2" -v cfg="$CFG" '
    /^[[:space:]]*\/\// { next }
    index($0, cfg) { pending = 1; next }
    /^[[:space:]]*#\[spacetimedb::reducer/ { reducer = 1; next }
    /^[[:space:]]*#\[/ { next }
    /^[[:space:]]*(pub[[:space:]]+)?fn[[:space:]]+[A-Za-z_0-9]+/ {
      if (reducer && (mode == "all" || pending)) {
        name = $0; sub(/^.*fn[[:space:]]+/, "", name); sub(/[^A-Za-z_0-9].*$/, "", name); print name
      }
      pending = 0; reducer = 0; next
    }
    /[^[:space:]]/ { pending = 0; reducer = 0 }
  '
}

# Modules declared under the cfg: `x` -> the file defining it.
gated_modules() {
  find "$SRC_DIR" -name '*.rs' -print0 | while IFS= read -r -d '' f; do
    tr -d '\r' <"$f" | awk -v cfg="$CFG" '
      index($0, cfg) { pending = 1; next }
      pending && /^[[:space:]]*(pub[[:space:]]+)?mod[[:space:]]+[A-Za-z_0-9]+[[:space:]]*;/ {
        name = $0; sub(/^.*mod[[:space:]]+/, "", name); sub(/[^A-Za-z_0-9].*$/, "", name); print name
      }
      /[^[:space:]]/ { pending = 0 }
    ' | while read -r m; do
      dir="$(dirname "$f")"
      for cand in "$dir/$m.rs" "$dir/$m/mod.rs"; do [ -f "$cand" ] && echo "$cand"; done
    done
  done
}

OUT="$(
  {
    while IFS= read -r -d '' f; do reducers_in "$f" item; done < <(find "$SRC_DIR" -name '*.rs' -print0)
    while IFS= read -r f; do reducers_in "$f" all; done < <(gated_modules)
  } | sort -u
)"
[ -n "$OUT" ] || { echo "list-time-control-reducers: no time-control reducer found under $SRC_DIR" >&2; exit 1; }
printf '%s\n' "$OUT"
