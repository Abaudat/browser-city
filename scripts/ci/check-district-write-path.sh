#!/usr/bin/env bash
# A district is generated once and read back as stored (FR108, FR109): the
# `district` record has one writer, and so do the macro routing graph's
# `route_node`, `route_edge` and `route_provision` rows (FR129, FR130),
# which are written with it.
# Under server/src/:
#
#   - `generation::` (the generator) is named only in tables/district.rs.
#   - each accessor -- `district`, `route_node`, `route_edge`, `route_provision` -- is called
#     only in tables/district.rs (`district`: `create_district` only;
#     the graph rows: `create_district`'s own writer `write_graph` and the
#     test-only `debug_write_graph_then_fail`, which calls it), in
#     tables/restore.rs (inside `begin_restore` and the accessor's own
#     `restore_*` reducer only) and never in tables/metrics.rs (which
#     imports them to sample row counts). The files that own them never
#     delete or update.
#   - any other file naming an accessor (a call, a path, a glob or a
#     `use` reaching the module's accessor) fails.
#
# Comment lines are skipped. Usage: check-district-write-path.sh [src-dir]
set -euo pipefail
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="${1:-"$REPO_ROOT/server/src"}"
[ -d "$SRC_DIR" ] || { echo "check-district-write-path: $SRC_DIR not found" >&2; exit 1; }

DECL="$SRC_DIR/tables/district.rs"
[ -f "$DECL" ] || { echo "check-district-write-path: FAIL -- $DECL not found (the scan matched nothing)" >&2; exit 1; }

code() { grep -v '^[[:space:]]*//' "$1" | tr -d '\r'; }
flat() { code "$1" | tr '\n' ' '; }

# <accessor>:<declaring module>:<fns of district.rs that may name it>:<fns of restore.rs>
ACCESSORS=(
  "district:district:create_district:begin_restore restore_district"
  "route_node:routing:create_district write_graph debug_write_graph_then_fail:begin_restore restore_route_node"
  "route_edge:routing:create_district write_graph debug_write_graph_then_fail:begin_restore restore_route_edge"
  "route_provision:routing:create_district write_graph debug_write_graph_then_fail:begin_restore restore_route_provision"
)
GEN='(^|[^_[:alnum:]])generation([^_[:alnum:]]|$)'

# calls_outside <file> <accessor> <fn>... -- the enclosing fn of every
# `.<accessor>()` call that is not one of the named functions.
calls_outside() {
  local f="$1" acc="$2"; shift 2
  local allowed=" $* "
  code "$f" | awk -v allowed="$allowed" -v acc="$acc" '
    /(^|[^_A-Za-z0-9])fn[ \t]+[A-Za-z_0-9]+/ {
      cur = $0; sub(/^.*(^|[^_A-Za-z0-9])fn[ \t]+/, "", cur); sub(/[^A-Za-z_0-9].*$/, "", cur)
    }
    {
      if (match($0, "[.][ 	]*" acc "[ 	]*[(][)]")) {
        name = (cur == "") ? "<unknown>" : cur
        if (index(allowed, " " name " ") == 0) print name
      }
    }'
}

BAD=""
note() { BAD="$BAD$1"$'\n'; }

while IFS= read -r f; do
  rel="${f#"$SRC_DIR"/}"
  names_generator=0
  if flat "$f" | grep -Eq "$GEN"; then names_generator=1; fi
  case "$rel" in
    tables/district.rs)
      for spec in "${ACCESSORS[@]}"; do
        IFS=: read -r acc _mod district_fns _restore_fns <<<"$spec"
        # shellcheck disable=SC2086
        OUT="$(calls_outside "$f" "$acc" $district_fns)"
        [ -z "$OUT" ] || note "$rel: names the $acc accessor outside $district_fns (in: $(echo "$OUT" | tr '\n' ' '))"
      done
      if flat "$f" | grep -Eq '\.[[:space:]]*(delete|update)[[:space:]]*\('; then
        note "$rel: updates or deletes (the record and the graph are insert-only)"
      fi
      continue ;;
    tables/restore.rs)
      for spec in "${ACCESSORS[@]}"; do
        IFS=: read -r acc _mod _district_fns restore_fns <<<"$spec"
        # shellcheck disable=SC2086
        OUT="$(calls_outside "$f" "$acc" $restore_fns)"
        [ -z "$OUT" ] || note "$rel: names the $acc accessor outside $restore_fns (in: $(echo "$OUT" | tr '\n' ' '))"
        if flat "$f" | grep -Eq "::[[:space:]]*$acc[[:space:]]*\("; then note "$rel: calls the $acc accessor by path"; fi
      done
      if [ "$names_generator" -eq 1 ]; then note "$rel: names the generator"; fi
      continue ;;
    tables/routing.rs)
      # The declaring module also holds the provision query's read-only
      # view (story 3.10): it names the accessors to read by index, never
      # to write.
      if flat "$f" | grep -Eq '\.[[:space:]]*(insert|delete|update)[[:space:]]*\('; then
        note "$rel: writes a row (it declares the tables and reads them by index; district.rs and restore.rs write)"
      fi
      if [ "$names_generator" -eq 1 ]; then note "$rel: names the generator"; fi
      continue ;;
    tables/metrics.rs)
      for spec in "${ACCESSORS[@]}"; do
        IFS=: read -r acc _rest <<<"$spec"
        if flat "$f" | grep -Eq "\.[[:space:]]*$acc[[:space:]]*\(\)|::[[:space:]]*$acc[[:space:]]*\("; then
          note "$rel: calls the $acc accessor (it only samples row counts)"
        fi
      done
      if [ "$names_generator" -eq 1 ]; then note "$rel: names the generator"; fi
      continue ;;
  esac
  if [ "$names_generator" -eq 1 ]; then note "$rel: names the generator (only tables/district.rs may)"; fi
  for spec in "${ACCESSORS[@]}"; do
    IFS=: read -r acc mod _rest <<<"$spec"
    calls="\.[[:space:]]*$acc[[:space:]]*\(\)|::[[:space:]]*$acc[[:space:]]*\(|$mod[[:space:]]*::[[:space:]]*($acc([^_[:alnum:]]|\$)|\*)"
    # A `use` that leaves a bare accessor after the `<mod>::` segments are
    # taken out: `use super::routing::{RouteNode, route_node};` reaches it.
    reaches=0
    if flat "$f" | grep -oE 'use [^;]*;' \
      | sed -E "s/$mod[[:space:]]*::/ /g" \
      | grep -Eq "(^|[^_[:alnum:]])$acc([^_[:alnum:]]|\$)"; then reaches=1; fi
    if flat "$f" | grep -Eq "$calls" || [ "$reaches" -eq 1 ]; then
      note "$rel: names the $acc accessor"
    fi
  done
done < <(find "$SRC_DIR" -name '*.rs' -not -path '*/generated/*' | sort)

if [ -n "$BAD" ]; then
  echo "check-district-write-path: FAIL -- a district and its routing graph are generated once and read back, never regenerated or rewritten (FR108, FR109, FR129):" >&2
  printf '%s' "$BAD" >&2
  exit 1
fi
echo "check-district-write-path: only create_district inserts the record and the graph, only restore restores them (FR108, FR109, FR129)" >&2
