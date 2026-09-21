#!/usr/bin/env bash
# Keeps docs/trace-matrix.md honest against both the actual test suite and
# the invariant registry (server/sim/tests/invariants.rs), in every
# direction that can rot silently:
#   - a `covered` row whose named test does not exist is a claim nobody can
#     verify
#   - a `deferred` row whose named test DOES exist means the matrix was
#     never flipped when the coverage landed
#   - an INV_* constant with no matrix row, or a matrix row with no INV_*
#     constant, means the registry and the matrix have drifted apart
#   - an inv_* test with no row at all is coverage the matrix does not know
#     about, in *either* suite: `server/sim/tests/invariants.rs`'s `#[test]`
#     functions, or an `it`/`test` name in `client/tests/unit/**` prefixed
#     `inv_` (story 1.6 on) -- a client-side invariant has no `INV_` Rust
#     constant counterpart, so it is exempt from that symmetry check alone.
#   - a Guard-section `covered` row citing a path that does not exist, or a
#     test/fn/case name that is not actually declared anywhere under the
#     paths that row itself names, is a claim nobody can verify either
#     (story 3.17)
# Also bans `#[ignore]` outright -- a skipped test is an unautomated test.
#
# Every membership test below reads its own haystack via a here-string
# (`grep ... <<< "$VAR"`), never `printf '%s\n' "$VAR" | grep ...`: under
# `set -o pipefail`, a `grep -q` that quits the instant it finds a match
# can SIGPIPE the still-writing `printf` on its left, and pipefail then
# reports *that* broken-pipe exit code for the whole pipeline rather than
# grep's own true answer -- a real, workspace-size-dependent race (story
# 3.2 cycle 2's own CI run: every `covered` row started failing "no such
# test exists" the moment the invariant list grew past whatever
# buffering threshold triggers it), not a fixed threshold to raise. A
# here-string has no concurrent writer process to race.
#
# `--client-only` (Tim's direction, story 1.6 cycle 2): runs only the
# directions that need no cargo invocation at all -- the client inv_*
# symmetry and the Guard-section path/name checks -- so `client-check` can
# run this at effectively zero cost instead of the full run paying for a
# release `cargo test --workspace` (clippy, wasm build, `cargo llvm-cov`,
# two local SpacetimeDB instances) just to protect two greps over
# committed text. It skips: listing the Rust test suite, verifying a
# `covered` row's Test column when that test is not a client `inv_*` name
# (it may be a Rust test this mode cannot see), and the `INV_`
# constant<->matrix symmetry (a Rust-only concern). The Guard-section
# lookup below reads only committed source text (`fn`/quoted-title/`.sh`
# case/whole-word declarations, `git ls-files`), needs no cargo
# invocation and is never gated behind CLIENT_ONLY -- both modes run it,
# so it is not nested in either branch below (AC3).
#
# Usage: check-trace-matrix.sh [--client-only] [root_dir]
#   [--client-only] see above; may appear before or is simply the first
#                   arg -- the remaining arg (if any) is the root.
#   [root_dir]      defaults to the real repository root -- overridden by
#                   scripts/ci/tests/test-check-trace-matrix.sh's own fake
#                   trees, so that suite never needs cargo. A fake tree
#                   must itself be a git work tree (the fixture builder
#                   runs `git init`/`git add`) -- name/path resolution
#                   below reads `git ls-files`, the real production code
#                   path, never a `find` fallback.
set -euo pipefail

# trim <string> -- leading/trailing whitespace into REPLY, pure bash
# parameter expansion, no subprocess and no subshell (never `$(...)`):
# hundreds of rows and thousands of tokens run through this and the
# Guard-cell field split further down, so keeping both to bash builtins
# (never a `sed`/`awk`/`tr`/`xargs` round trip per row) is what keeps the
# whole lookup in low single digits of seconds over the real matrix
# (Tim's budget).
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  REPLY="$s"
}

CLIENT_ONLY=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--client-only" ]; then
    CLIENT_ONLY=1
  else
    ARGS+=("$a")
  fi
done

REPO_ROOT="${ARGS[0]:-"$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"}"
REPO_ROOT="$(cd -- "$REPO_ROOT" && pwd)"
MATRIX="$REPO_ROOT/docs/trace-matrix.md"
INVARIANTS_FILE="$REPO_ROOT/server/sim/tests/invariants.rs"
CLIENT_UNIT_DIR="$REPO_ROOT/client/tests/unit"

[ -f "$MATRIX" ] || { echo "check-trace-matrix: $MATRIX not found" >&2; exit 1; }
[ -f "$INVARIANTS_FILE" ] || { echo "check-trace-matrix: $INVARIANTS_FILE not found" >&2; exit 1; }
[ -d "$CLIENT_UNIT_DIR" ] || { echo "check-trace-matrix: $CLIENT_UNIT_DIR not found" >&2; exit 1; }

# --- collect every test name the workspace actually runs --------------------
# browser_city, sched_timing_spike and boot_budget_spike are excluded: all
# three embed SpacetimeDB's reducer/table macros, which reference host FFI
# symbols the wasm runtime supplies, so none can be linked natively (see
# server/Cargo.toml, server/spikes/sched_timing/Cargo.toml and
# server/spikes/boot_budget/Cargo.toml). --release reuses the artifacts
# the CI test job already built in release rather than compiling the
# workspace a second time in debug just to print test names. Skipped
# entirely under --client-only.
if [ "$CLIENT_ONLY" -eq 1 ]; then
  TEST_NAMES=""
else
  LIST_OUTPUT="$(cd "$REPO_ROOT/server" && cargo test --workspace --exclude browser_city --exclude sched_timing_spike --exclude boot_budget_spike --release -- --list 2>&1)" || {
    echo "check-trace-matrix: 'cargo test -- --list' failed:" >&2
    echo "$LIST_OUTPUT" >&2
    exit 1
  }
  TEST_NAMES="$(printf '%s\n' "$LIST_OUTPUT" | grep -E ': (test|benchmark)$' | sed -E 's/: (test|benchmark)$//')"
fi

# --- collect every inv_* test name declared in client/tests/unit/** ---------
# Matches `it("inv_foo", ...)` / `test("inv_foo", ...)`, single or double
# quoted -- the exact idiom `client/tests/unit/render/*.test.ts` uses.
# `TEST_NAMES` (above) is Rust-only, kept separate rather than merged: a
# client name has no module-path prefix to strip, and this list alone is
# what the constant-symmetry check below exempts from needing an `INV_`
# Rust constant.
CLIENT_INV_NAMES="$(
  { find "$CLIENT_UNIT_DIR" -name '*.test.ts' -print0 |
    xargs -0 -r grep -ohE '(it|test)\(\s*["'"'"'](inv_[A-Za-z0-9_]+)["'"'"']' |
    grep -oE 'inv_[A-Za-z0-9_]+' |
    sort -u; } || true
)"

# --- ban #[ignore] -----------------------------------------------------------
# Driven off tracked files, not a recursive grep from server/ -- that would
# walk target/, which the test job's own release build populates, and a
# dependency that ships an ignored test in build-script-generated source
# would turn this into a false red nobody in this repo can fix.
IGNORED="$(cd "$REPO_ROOT" && git ls-files '*.rs' -z | xargs -0 -r grep -l '#\[ignore' || true)"
if [ -n "$IGNORED" ]; then
  echo "check-trace-matrix: FAIL -- #[ignore] found (a skipped test is an unautomated test):" >&2
  printf '%s\n' "$IGNORED" >&2
  exit 1
fi

# --- parse the matrix's data rows --------------------------------------------
# | id | description | status | test | story |
MATRIX_ROWS="$(grep -E '^\| `' "$MATRIX" || true)"
MATRIX_IDS="$(printf '%s\n' "$MATRIX_ROWS" | awk -F'|' '{print $2}' | tr -d '`' | xargs -n1 2>/dev/null || true)"
# COVERED_MATRIX_ID_SET (populated below, from `covered` rows only) is the
# Guard-section lookup's own inv_* resolver: an id whose own row is
# `deferred`/`planned` is a claim no test yet exists for, by definition,
# so a Guard cell citing it must still resolve through a real path, never
# take this shortcut (Quentin's direction) -- an associative-array
# membership test, not a `grep -qxF ... <<<` subprocess per inv_*
# candidate (Tim's low-single-digit-seconds budget).
declare -A COVERED_MATRIX_ID_SET

# --- parse the invariant registry's INV_* constants --------------------------
# `|| true`: an `invariants.rs` declaring zero INV_ constants (every self
# test's own minimal fixture) makes `grep` the pipeline's own failing
# stage under `pipefail` even though every stage after it succeeds --
# zero constants is a legal, empty answer, not a script-ending error.
CONSTANT_IDS="$(grep -oE 'pub const INV_[A-Z0-9_]+' "$INVARIANTS_FILE" | sed -E 's/pub const //' | tr 'A-Z' 'a-z' | sort -u || true)"

# Set forms of TEST_NAMES/CLIENT_INV_NAMES, checked hundreds of times
# below and again by the Guard-section lookup further down -- an
# associative-array membership test, not a `grep -qxF ... <<<` subprocess
# per row (same low-single-digit-seconds budget as the Guard lookup).
declare -A TEST_NAME_SET CLIENT_INV_NAME_SET
while IFS= read -r n; do
  [ -n "$n" ] || continue
  TEST_NAME_SET["$n"]=1
done <<< "$TEST_NAMES"
while IFS= read -r n; do
  [ -n "$n" ] || continue
  CLIENT_INV_NAME_SET["$n"]=1
done <<< "$CLIENT_INV_NAMES"

FAILED=0

# every covered row's Test column must name a real test; every deferred
# row's id must NOT already have a test (or it should have been flipped)
while IFS='|' read -r _ id _ status test _; do
  id="${id//\`/}"; trim "$id"; id="$REPLY"
  trim "$status"; status="$REPLY"
  test="${test//\`/}"; trim "$test"; test="$REPLY"
  [ -n "$id" ] || continue
  case "$status" in
    covered)
      COVERED_MATRIX_ID_SET["$id"]=1
      if [ -z "$test" ]; then
        echo "check-trace-matrix: FAIL -- '$id' is 'covered' but names no test" >&2
        FAILED=1
      elif [ "$CLIENT_ONLY" -eq 1 ]; then
        # Cannot see the Rust suite in this mode, and a Rust invariant
        # test name looks exactly like a client one (both are `inv_*`) --
        # so this mode only ever confirms a client test exists, never
        # that a row wrongly claims one that does not. The full run
        # (`test` job) is what catches that.
        :
      elif [ -z "${TEST_NAME_SET[$test]+x}" ] && [ -z "${CLIENT_INV_NAME_SET[$test]+x}" ]; then
        echo "check-trace-matrix: FAIL -- '$id' claims coverage via '$test', but no such test exists" >&2
        FAILED=1
      fi
      ;;
    deferred)
      if [ "$CLIENT_ONLY" -eq 1 ]; then
        if [ -n "${CLIENT_INV_NAME_SET[$id]+x}" ]; then
          echo "check-trace-matrix: FAIL -- '$id' is 'deferred' but a client test named '$id' now exists -- flip its row to 'covered'" >&2
          FAILED=1
        fi
      elif [ -n "${TEST_NAME_SET[$id]+x}" ] || [ -n "${CLIENT_INV_NAME_SET[$id]+x}" ]; then
        echo "check-trace-matrix: FAIL -- '$id' is 'deferred' but a test named '$id' now exists -- flip its row to 'covered'" >&2
        FAILED=1
      fi
      ;;
  esac
done <<< "$MATRIX_ROWS"

# every inv_* test must have a matrix row (Rust side) -- skipped under
# --client-only, which never lists the Rust suite.
if [ "$CLIENT_ONLY" -eq 0 ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$name" in
      *inv_*) short="${name##*::}" ;;
      *) continue ;;
    esac
    if ! grep -qxF "$short" <<< "$MATRIX_IDS"; then
      echo "check-trace-matrix: FAIL -- test '$name' has no row in docs/trace-matrix.md" >&2
      FAILED=1
    fi
  done <<< "$TEST_NAMES"
fi

# every inv_* test must have a matrix row (client side) -- same direction,
# same message, so a client-only invariant can never silently stop being
# tracked either.
while IFS= read -r name; do
  [ -n "$name" ] || continue
  if ! grep -qxF "$name" <<< "$MATRIX_IDS"; then
    echo "check-trace-matrix: FAIL -- client test '$name' has no row in docs/trace-matrix.md" >&2
    FAILED=1
  fi
done <<< "$CLIENT_INV_NAMES"

# every INV_* constant must have a matrix row, and every matrix row an INV_*
# constant -- the registry and the matrix are two hands on the same list.
# A matrix row covered by a client inv_* test is exempt from needing a
# Rust INV_ constant: it is a client-only invariant, not a sim one. A
# Rust-only concern, so skipped under --client-only.
if [ "$CLIENT_ONLY" -eq 0 ]; then
  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    if ! grep -qxF "$cid" <<< "$MATRIX_IDS"; then
      echo "check-trace-matrix: FAIL -- invariants.rs declares '$cid' but docs/trace-matrix.md has no row for it" >&2
      FAILED=1
    fi
  done <<< "$CONSTANT_IDS"

  while IFS= read -r mid; do
    [ -n "$mid" ] || continue
    if grep -qxF "$mid" <<< "$CLIENT_INV_NAMES"; then
      continue
    fi
    if ! grep -qxF "$mid" <<< "$CONSTANT_IDS"; then
      echo "check-trace-matrix: FAIL -- docs/trace-matrix.md has a row for '$mid' but invariants.rs declares no such INV_ constant" >&2
      FAILED=1
    fi
  done <<< "$MATRIX_IDS"
fi

# --- Guard-section tables: every `covered`/`partial` row's Guard column
# names guards that are real, checked mechanically rather than by eye -- a
# guard renamed or deleted without updating the row is a lie the matrix
# would otherwise keep telling. Not part of the `inv_*`/`INV_*` id symmetry
# above (these are guard requirements that span the client/server
# boundary, the CI graph itself, or a permanent schema decision, not a
# `sim` invariant).
#
# Guard tables are discovered by their header row, never a hardcoded
# section-title list (the list this replaces let a whole table -- "The
# hand-laid test street" -- go unchecked for going unregistered): any line
# reading exactly "| Requirement | Status | Guard |" opens a guard table,
# whose rows run until the next "## " heading or the file's end -- a blank
# or otherwise non-`|` line inside a table (between its header and the
# next heading) is skipped, never mistaken for the table's own end, or a
# row two lines after it would silently vanish (Tim's direction). A row is
# the remainder of the line after its third "|" (minus the closing one),
# never a fixed-field split -- a Guard cell that itself contains a literal
# "|" is real data, not a fourth column.
GUARD_HEADER='| Requirement | Status | Guard |'

# Every table header in the matrix -- a "|"-line immediately followed by
# its own "| --- |"-shaped separator line (alignment colons, `:---`/
# `:---:`/`---:`, admitted too: legal GitHub markdown that renders
# identically to plain dashes, so a mistyped header sitting over one must
# still be recognised as a header, not silently invisible) -- must be
# exactly one of the three header shapes this file actually uses. A
# closed set, not "the first cell says Requirement": that open-ended
# check cannot tell
# "Requirment" (a typo, invisible to it and to every row below it) from a
# table this file has never had, and a `grep -Fxc` of the very literal
# string the discovery pass already looked for can never disagree with
# it -- a tautological floor, replaced rather than kept for show (Tim's
# and Quentin's direction). Read with `mapfile`, not `awk ... getline`:
# `getline` inside a `/^\|/` rule consumes the *next* input line for every
# data row too, not only real headers, so a header sitting right after a
# data row (no blank line between them) is silently skipped -- the same
# false-negative shape as the bug this whole check exists to close.
KNOWN_TABLE_HEADERS=(
  '| Invariant id | Description | Status | Test | Story |'
  '| Metric | Status | Blocked on |'
  "$GUARD_HEADER"
)
mapfile -t MATRIX_LINES < "$MATRIX"
for ((mi = 0; mi < ${#MATRIX_LINES[@]} - 1; mi++)); do
  mline="${MATRIX_LINES[$mi]%$'\r'}"
  case "$mline" in
    '|'*) ;;
    *) continue ;;
  esac
  mnext="${MATRIX_LINES[$((mi + 1))]%$'\r'}"
  if [[ "$mnext" =~ ^\|([[:space:]]*:?-+:?[[:space:]]*\|)+[[:space:]]*$ ]]; then
    known=0
    for k in "${KNOWN_TABLE_HEADERS[@]}"; do
      if [ "$mline" = "$k" ]; then
        known=1
        break
      fi
    done
    if [ "$known" -eq 0 ]; then
      echo "check-trace-matrix: FAIL -- '$mline' is a table header (followed by its own separator row) but is not one of this matrix's known header shapes" >&2
      FAILED=1
    fi
    [ "$mline" = "$GUARD_HEADER" ] && GUARD_TABLE_COUNT=$((${GUARD_TABLE_COUNT:-0} + 1))
  fi
done
if [ "${GUARD_TABLE_COUNT:-0}" -eq 0 ]; then
  echo "check-trace-matrix: FAIL -- no '$GUARD_HEADER' guard table found in $MATRIX" >&2
  FAILED=1
fi

# A blank/prose line inside a table is skipped (`intable { next }`) --
# never closes it early -- so the only floor left against a table that
# discovery opens but never actually reads a row from (a stray extra
# blank line right after the header/separator, an all-comment table) is
# counting rows per table directly: zero is red, naming the section.
GUARD_ROWS_RAW="$(awk -v hdr="$GUARD_HEADER" '
  function close_table() {
    if (intable && rowcount == 0) {
      print "\x02ZEROROWS\x1f" section
    }
    intable = 0
  }
  /^## / { close_table(); section = substr($0, 4); next }
  $0 == hdr { close_table(); intable = 1; sawsep = 0; rowcount = 0; next }
  intable && !sawsep { sawsep = 1; next }
  intable && /^\|/ {
    if ($0 ~ /^\|[ \t]*:?-+:?[ \t]*\|/) { next }
    rowcount++
    print section "\x1f" $0
    next
  }
  intable { next }
  END { close_table() }
' "$MATRIX")"

GUARD_ROWS=""
while IFS= read -r grrow; do
  case "$grrow" in
    $'\x02ZEROROWS\x1f'*)
      zsection="${grrow#*$'\x1f'}"
      echo "check-trace-matrix: FAIL -- '## $zsection' is a guard table with zero rows" >&2
      FAILED=1
      ;;
    *)
      GUARD_ROWS+="$grrow"$'\n'
      ;;
  esac
done <<< "$GUARD_ROWS_RAW"

# A backticked, `/`-free token that looks like a Rust/TypeScript/shell
# identifier -- the only shape this story's lookup ever tries to resolve.
# camelCase, `Type::path`, kebab-case and anything else with an uppercase
# letter, `:`, `-`, `.` or `(` is deliberately out of scope (Tim's
# direction): the matrix cites plenty of those and none of them are a
# name a source file declares in one of the forms below. Also out of
# scope, on purpose: a name that survives only inside a `/* */` block
# comment, a string literal, or a trailing comment sharing a line with
# real code (`fn real_one() {} // fn gone() {}`) still reads as
# declared -- only a comment-*only* line is blanked. `//`/`#`-only line
# stripping covers the realistic "a deleted case, its name left in a
# leftover comment on its own line" failure mode this story is actually
# about; a Rust lexer in bash is not in this story's budget (Tim's
# direction).
#
# The optional trailing `*` (a prefix candidate) is checked separately
# from "carries at least one underscore" below, never folded into one
# regex: the real matrix's own prefix candidates
# (`from_balance_rejects_*`) put the `*` directly after the trailing
# underscore, with no further word character between them, a shape
# `(_[a-z0-9]+)+\*?` cannot match at all.
CANDIDATE_RE='^[a-z][a-z0-9_]*\*?$'
# is_candidate <token> -- CANDIDATE_RE plus "carries at least one
# underscore before its optional star" (snake_case, never a bare word).
is_candidate() {
  [[ "$1" =~ $CANDIDATE_RE ]] || return 1
  local stem="${1%\*}"
  [[ "$stem" == *_* ]]
}

# A backticked, spaced token is a *title* candidate shape only when it
# reads as an English test title -- lowercase words, digits, spaces and
# the punctuation a real title actually carries (apostrophe, comma,
# period, hyphen). A code snippet quoted for illustration
# (`textures.set("counter", ...)`, `MountStreetSceneOptions.defs:
# VerifiedDefs`) has a space too but carries parens, quotes, a colon or
# an uppercase letter -- none of which a title ever does -- so it is
# never mistaken for one, title-file-in-cell or not.
TITLE_RE="^[a-z0-9 ,.'-]+\$"

# Every lookup below is memoised, one subprocess (at most) per distinct
# repo-relative path or file, never one per candidate token: a cell citing
# the same file for five candidates reads that file once. `git ls-files`
# (never `find`/`grep -r`, so a fake test tree is made a real git work
# tree by its own fixture builder) is the only external process a
# directory needs -- a bare file path never even needs `-e` re-verified
# here, since pass 1 below already confirmed it exists, so it is used
# as its own one-file list directly. Content is read with `$(< file)`, a
# bash builtin with no `cat` subprocess, and matched with bash's own
# `[[ =~ ]]`/`[[ == * ]]`, not `grep`: hundreds of tokens against a
# handful of cached, already-loaded strings is what keeps the whole
# lookup in low single digits of seconds over the real matrix (Tim's
# budget) rather than one process per token the way a naive `grep -r`
# per candidate would.
# Markdown is never a guard: excluded from every resolver below (`.md`
# files still have their own existence checked in pass 1, same as any
# other path) -- otherwise a cell citing `docs/` or `docs/trace-matrix.md`
# itself "resolves" every name it cites, because the whole-word tier
# finds the name sitting right there in the very row that cites it
# (Quentin's direction).
is_markdown() { case "$1" in *.md) return 0 ;; *) return 1 ;; esac; }

declare -A DIR_LIST_CACHE FILE_CONTENT_CACHE STRIPPED_CACHE

# files_under <repo-relative path> -- sets REPLY, one file per line (or
# the path itself, for a bare file). No subshell (never called through a
# `< <(...)` process substitution, which throws its own assignments to
# DIR_LIST_CACHE away on return) -- every caller feeds a loop from REPLY
# via a here-string instead, so the memo is real: a directory cited by
# several candidates runs `git ls-files` once, not once per candidate.
files_under() {
  local p="$1"
  if [ -d "$REPO_ROOT/$p" ]; then
    if [ -z "${DIR_LIST_CACHE[$p]+x}" ]; then
      DIR_LIST_CACHE[$p]="$(cd "$REPO_ROOT" && git ls-files -- "$p" 2>/dev/null)"
    fi
    REPLY="${DIR_LIST_CACHE[$p]}"
  else
    REPLY="$p"
  fi
}

# file_content <file> -- sets REPLY to the whole file, read once.
file_content() {
  local f="$1"
  if [ -z "${FILE_CONTENT_CACHE[$f]+x}" ]; then
    FILE_CONTENT_CACHE[$f]="$(< "$REPO_ROOT/$f")"
  fi
  REPLY="${FILE_CONTENT_CACHE[$f]}"
}

# stripped_content <file> <comment-prefix> -- sets REPLY to <file> with
# every comment-only line (leading whitespace then exactly
# <comment-prefix>) blanked, read/stripped once per (file, prefix): a
# deleted fn/case/title whose name survives in a leftover comment must
# still read as gone, for `.rs`/`.ts` (`//`) and the whole-word tier's
# own `.sh`/`.toml`/`.yml` files (`#`) alike -- one shared helper keyed
# by prefix rather than a separate one per extension (Quentin's
# direction).
stripped_content() {
  local f="$1" prefix="$2" line out=""
  local key="$f"$'\x1f'"$prefix"
  if [ -z "${STRIPPED_CACHE[$key]+x}" ]; then
    file_content "$f"
    while IFS= read -r line; do
      [[ "$line" =~ ^[[:space:]]*${prefix} ]] && continue
      out+="$line"$'\n'
    done <<< "$REPLY"
    STRIPPED_CACHE[$key]="$out"
  fi
  REPLY="${STRIPPED_CACHE[$key]}"
}

rs_fn_exists() { # <file> <exact-name>
  stripped_content "$1" '//'
  [[ "$REPLY" =~ fn[[:space:]]+$2[[:space:]]*[\(\<] ]]
}
rs_fn_prefix_exists() { # <file> <prefix>
  stripped_content "$1" '//'
  [[ "$REPLY" =~ fn[[:space:]]+$2[A-Za-z0-9_]*[[:space:]]*[\(\<] ]]
}

# A client test/case title as a complete quoted string, single, double or
# backtick quoted -- a `.ts` `it(...)`/`test(...)` name, or a `.sh`
# `check`/`check_contains` case label (same idiom, so one resolver, not
# two: story 3.17's own `## CI guards` row cites its self-tests' own case
# titles in exactly this shape). Every needle is built and matched as a
# quoted `[[ == *"$needle"* ]]` bash pattern, never a constructed regex or
# an interpolated `grep` argument: a real title routinely carries an
# apostrophe or a comma (`...collider rasterises relative to its
# south-west anchor, not its top-left`), which an unescaped regex would
# either fail to build or match wrongly (the xargs-apostrophe crash this
# file's own header already warns about, same class of bug, different
# tool) -- a quoted bash pattern segment is matched literally regardless.
# <comment-prefix> is `//` for `.ts`, `#` for `.sh` -- the caller (by
# extension) decides, never a guess: a `.sh` comment surviving a deleted
# `check "case name" ...` line uses `#`, and a `//`-only strip would
# leave it standing.
quoted_title_exists() { # <file> <exact-title> <comment-prefix>
  stripped_content "$1" "$3"
  local n1="'$2'" n2="\"$2\"" n3="\`$2\`"
  [[ "$REPLY" == *"$n1"* || "$REPLY" == *"$n2"* || "$REPLY" == *"$n3"* ]]
}
quoted_title_prefix_exists() { # <file> <prefix> <comment-prefix>
  stripped_content "$1" "$3"
  local n1="'$2" n2="\"$2" n3="\`$2"
  [[ "$REPLY" == *"$n1"* || "$REPLY" == *"$n2"* || "$REPLY" == *"$n3"* ]]
}

# Every other tracked extension (.toml/.yml/.json/.txt, etc; `.sh` is
# handled by quoted_title_exists above, not this tier): a whole-word
# match -- what covers a `key = "rule_id"` row in a `defs/rules/*.toml`
# file. Candidates only ever carry `[a-z0-9_]` (CANDIDATE_RE), always
# regex-safe, so this can build a real word-boundary regex without
# escaping anything -- on both ends for an exact name, and anchored only
# on its own left/start edge for a prefix (`real_rule_*` must not resolve
# against a `# xreal_rule_...` comment purely because "real_rule_" is a
# substring of it somewhere in the middle).
word_exists() { # <file> <exact-word>
  stripped_content "$1" '#'
  [[ "$REPLY" =~ (^|[^A-Za-z0-9_])$2([^A-Za-z0-9_]|$) ]]
}
word_prefix_exists() { # <file> <prefix>
  stripped_content "$1" '#'
  [[ "$REPLY" =~ (^|[^A-Za-z0-9_])$2 ]]
}

# resolve_exact/_prefix -- <name> <cell-path>... : true if some file under
# some path in the cell declares it, by the form its own extension calls
# for.
resolve_exact() {
  local name="$1" p f
  shift
  for p in "$@"; do
    files_under "$p"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      is_markdown "$f" && continue
      case "$f" in
        *.rs) rs_fn_exists "$f" "$name" && return 0 ;;
        *.ts) quoted_title_exists "$f" "$name" '//' && return 0 ;;
        *.sh) quoted_title_exists "$f" "$name" '#' && return 0 ;;
        *) word_exists "$f" "$name" && return 0 ;;
      esac
    done <<< "$REPLY"
  done
  return 1
}
resolve_prefix() {
  local prefix="$1" p f
  shift
  for p in "$@"; do
    files_under "$p"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      is_markdown "$f" && continue
      case "$f" in
        *.rs) rs_fn_prefix_exists "$f" "$prefix" && return 0 ;;
        *.ts) quoted_title_prefix_exists "$f" "$prefix" '//' && return 0 ;;
        *.sh) quoted_title_prefix_exists "$f" "$prefix" '#' && return 0 ;;
        *) word_prefix_exists "$f" "$prefix" && return 0 ;;
      esac
    done <<< "$REPLY"
  done
  return 1
}
resolve_title() { # <title> <cell-path>...
  local title="$1" p f
  shift
  for p in "$@"; do
    files_under "$p"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      is_markdown "$f" && continue
      case "$f" in
        *.ts) quoted_title_exists "$f" "$title" '//' && return 0 ;;
        *.sh) quoted_title_exists "$f" "$title" '#' && return 0 ;;
      esac
    done <<< "$REPLY"
  done
  return 1
}

# A cell qualifies for title candidates only if it names at least one
# client test/case file -- keeps a spaced-but-unrelated token (`cargo run
# --bin defs-build`, `const _: () = assert!(...)`) out of the lookup
# entirely rather than trying and failing to resolve it.
cell_has_test_path() {
  local p
  for p in "$@"; do
    case "$p" in
      *.test.ts | *.spec.ts) return 0 ;;
      scripts/*/tests/*.sh) return 0 ;;
    esac
  done
  return 1
}

check_guard_row() { # <section> <requirement> <status> <guard>
  local section="$1" requirement="$2" status="$3" guard="$4"

  case "$status" in
    covered | partial) ;;
    deferred | planned) return 0 ;;
    *)
      echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) has status '$status', which is none of covered/partial/deferred/planned" >&2
      FAILED=1
      return 0
      ;;
  esac

  # Every backtick-delimited span in the Guard cell, pure bash (no
  # `grep -oE`/`sed`/process-substitution subshell per row).
  local -a tokens=()
  local tok_rest="$guard" tok_after tok_t
  while [[ "$tok_rest" == *'`'*'`'* ]]; do
    tok_after="${tok_rest#*\`}"
    tok_t="${tok_after%%\`*}"
    [ -n "$tok_t" ] && tokens+=("$tok_t")
    tok_rest="${tok_after#*\`}"
  done

  if [ "${#tokens[@]}" -eq 0 ]; then
    echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) is '$status' but its Guard column names no backtick-quoted guard" >&2
    FAILED=1
    return 0
  fi

  # --- pass 1: every backticked path must exist; a `path::symbol` token
  # checks the path's existence and turns `symbol` into a name candidate
  # scoped to that one file only. A token carrying a `*`, a `{` or a
  # space is never a path (Tim's direction) even when it contains a `/`
  # -- a biome.json glob override (`render/**`), a brace-expanded set of
  # fixture files, or a command line with a flag appended
  # (`check-trace-matrix.sh --client-only`) is real prose, not a
  # filesystem path this check can resolve. A token starting with `/`
  # (`/browser-city/`, the Pages base path) is a URL, not a repo-relative
  # path either, for the same reason (Quentin's direction).
  local -a cell_paths=() scoped_names=() scoped_files=()
  local tok path sym seen_path=0
  for tok in "${tokens[@]}"; do
    case "$tok" in
      *'*'* | *'{'* | *' '* | '/'*) continue ;;
      */*) ;;
      *) continue ;;
    esac
    seen_path=1
    path="$tok"
    sym=""
    case "$tok" in
      *::*)
        path="${tok%%::*}"
        sym="${tok#*::}"
        ;;
    esac
    if [ ! -e "$REPO_ROOT/$path" ]; then
      echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) cites path '$path', but it does not exist" >&2
      FAILED=1
      continue
    fi
    cell_paths+=("$path")
    if [ -n "$sym" ]; then
      scoped_names+=("$sym")
      scoped_files+=("$path")
    fi
  done

  if [ "$seen_path" -eq 0 ]; then
    echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) is '$status' but its Guard column names no backtick-quoted path" >&2
    FAILED=1
    return 0
  fi

  local has_test_path=0
  if [ "${#cell_paths[@]}" -gt 0 ] && cell_has_test_path "${cell_paths[@]}"; then
    has_test_path=1
  fi

  # --- pass 2: a `path::symbol`'s own symbol, scoped to that one file.
  local i
  for i in "${!scoped_names[@]}"; do
    if ! resolve_exact "${scoped_names[$i]}" "${scoped_files[$i]}"; then
      echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) cites '${scoped_names[$i]}', but no fn by that name exists in ${scoped_files[$i]}" >&2
      FAILED=1
    fi
  done

  # --- pass 3: every non-path backticked token -- name/prefix candidates
  # resolve against the cell's own existing paths (never repo-wide); a
  # spaced token resolves as a client title only when the cell itself
  # names a test file; anything else (camelCase, `Type::path`, a bare
  # word with no underscore, an untitled spaced phrase) is out of scope
  # and silently ignored.
  for tok in "${tokens[@]}"; do
    case "$tok" in
      */*) continue ;;
    esac
    if [[ "$tok" == *" "* ]]; then
      if [ "$has_test_path" -eq 1 ] && [[ "$tok" =~ $TITLE_RE ]]; then
        if ! resolve_title "$tok" "${cell_paths[@]}"; then
          echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) cites '$tok', but no test/case title by that name exists under: ${cell_paths[*]}" >&2
          FAILED=1
        fi
      fi
      continue
    fi
    if is_candidate "$tok"; then
      if [[ "$tok" == *'*' ]]; then
        local prefix="${tok%\*}"
        if ! resolve_prefix "$prefix" "${cell_paths[@]}"; then
          echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) cites '$tok', but no fn/test/case by that prefix exists under: ${cell_paths[*]}" >&2
          FAILED=1
        fi
      else
        if [[ "$tok" == inv_* ]] && [ -n "${COVERED_MATRIX_ID_SET[$tok]+x}" ]; then
          continue
        fi
        if ! resolve_exact "$tok" "${cell_paths[@]}"; then
          echo "check-trace-matrix: FAIL -- '${requirement:0:80}' (## $section) cites '$tok', but no fn/test/case by that name exists under: ${cell_paths[*]}" >&2
          FAILED=1
        fi
      fi
    fi
  done
}

while IFS= read -r row; do
  [ -n "$row" ] || continue
  section="${row%%$'\x1f'*}"
  line="${row#*$'\x1f'}"
  # The Guard cell is the remainder of the line after its third "|",
  # minus the closing one -- never a fixed IFS='|' split, which drops
  # everything after a Guard cell's own literal "|" (Tim's direction).
  # Three bash parameter-expansion cuts, never awk/sed: a data row's own
  # first "|" is stripped, the next slice up to "|" is the requirement,
  # the next is the status, and everything left (minus the row's own
  # closing "|") is the guard, extra pipes inside it included verbatim.
  body="${line#|}"
  requirement="${body%%|*}"
  rest="${body#*|}"
  status="${rest%%|*}"
  guard="${rest#*|}"
  guard="${guard%|}"
  trim "$requirement"; requirement="$REPLY"
  trim "$status"; status="$REPLY"
  [ -n "$requirement" ] || continue
  check_guard_row "$section" "$requirement" "$status" "$guard"
done <<< "$GUARD_ROWS"

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

if [ "$CLIENT_ONLY" -eq 1 ]; then
  echo "check-trace-matrix: --client-only -- client inv_* symmetry, Guard-section paths and Guard-cell name lookup agree" >&2
else
  echo "check-trace-matrix: matrix, registry, test suite and Guard-cell name lookup all agree" >&2
fi
exit 0
