#!/usr/bin/env bash
# Fast, dedicated coverage for scripts/ops/lib.sh's bc_snapshot_candidates
# (story 4.18) -- against a real, throwaway git repo built here, never the
# real repository's own history (deterministic, and never slower as this
# repo's own commit count grows). The BC_SNAPSHOT_CANDIDATES_DIR override
# this function also supports is exercised by
# scripts/ops/tests/test-export-world.sh instead -- this file proves the
# real git-backed path it stands in for, per lib.sh's own doc comment
# (Quentin's direction: the override must never be the only tested path).
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
. "$REPO_ROOT/scripts/ops/lib.sh"

labels_of() { # <out-dir>
  cat "$1/labels.txt"
}
label_for_index() { # <out-dir> <index>
  awk -F'\t' -v i="$2" '$1 == i { print $2 }' "$1/labels.txt"
}
export -f label_for_index

# fake_git_repo -- a throwaway repo with:
#   commit 1 (oldest): server/schema.snapshot.json = "v1", plus an
#     unrelated file.
#   commit 2: an unrelated-file-only commit -- must never appear as a
#     candidate (the `-- path` filter's own job).
#   commit 3 (HEAD, newest): server/schema.snapshot.json = "v2".
# The working tree's own copy is left equal to HEAD's (v2) -- tests that
# want a divergent worktree overwrite it themselves, after this returns.
fake_git_repo() {
  local d
  d="$(fake_dir)/repo"
  mkdir -p "$d/server"
  git -C "$d" init -q
  git -C "$d" config user.email "test@example.com"
  git -C "$d" config user.name "test"
  git -C "$d" config core.autocrlf false
  printf 'v1\n' > "$d/server/schema.snapshot.json"
  printf 'unrelated\n' > "$d/README.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m "v1"

  printf 'unrelated 2\n' > "$d/README.md"
  git -C "$d" add -A
  git -C "$d" commit -q -m "unrelated, does not touch the snapshot"

  printf 'v2\n' > "$d/server/schema.snapshot.json"
  git -C "$d" add -A
  git -C "$d" commit -q -m "v2"

  printf '%s' "$d"
}

echo "green: candidate order is newest first, and an unrelated commit is skipped"
REPO="$(fake_git_repo)"
SHA_V2="$(git -C "$REPO" log --first-parent --format=%H -1 HEAD -- server/schema.snapshot.json)"
SHA_V1="$(git -C "$REPO" log --first-parent --format=%H HEAD -- server/schema.snapshot.json | tail -n1)"
OUT="$(fake_dir)/out"
bc_snapshot_candidates "$OUT" "$REPO" "$REPO/server/schema.snapshot.json" >/dev/null
check "exactly 3 candidates (worktree, v2's own commit, v1's own commit -- never the unrelated one)" 0 \
  bash -c "[ \"\$(wc -l < '$OUT/labels.txt' | tr -d ' ')\" -eq 3 ]"
check "candidate 0 is labelled 'worktree'" 0 bash -c "[ \"\$(label_for_index '$OUT' 0)\" = 'worktree' ]"
LABEL1="$(label_for_index "$OUT" 1)"
check_contains "candidate 1 is v2's own commit (the newest that touched the file)" "$SHA_V2" "$LABEL1"
LABEL2="$(label_for_index "$OUT" 2)"
check_contains "candidate 2 is v1's own commit (the oldest)" "$SHA_V1" "$LABEL2"
check "candidate 1's content is v2's" 0 bash -c "[ \"\$(cat '$OUT/1')\" = 'v2' ]"
check "candidate 2's content is v1's" 0 bash -c "[ \"\$(cat '$OUT/2')\" = 'v1' ]"

echo
echo "green: candidate 0 is the worktree's own current content, even when it differs from HEAD's"
REPO2="$(fake_git_repo)"
printf 'v3-uncommitted\n' > "$REPO2/server/schema.snapshot.json"
OUT2="$(fake_dir)/out"
bc_snapshot_candidates "$OUT2" "$REPO2" "$REPO2/server/schema.snapshot.json" >/dev/null
check "candidate 0's content is the worktree's uncommitted edit, not HEAD's" 0 bash -c "[ \"\$(cat '$OUT2/0')\" = 'v3-uncommitted' ]"

echo
echo "red-ish: a non-git checkout yields only the worktree candidate, never an error"
PLAIN="$(fake_dir)/plain"
mkdir -p "$PLAIN/server"
printf 'plain\n' > "$PLAIN/server/schema.snapshot.json"
OUT3="$(fake_dir)/out"
bc_snapshot_candidates "$OUT3" "$PLAIN" "$PLAIN/server/schema.snapshot.json" >/dev/null
CODE=$?
check "a non-git checkout does not fail" 0 bash -c "exit $CODE"
check "exactly 1 candidate (worktree only)" 0 bash -c "[ \"\$(wc -l < '$OUT3/labels.txt' | tr -d ' ')\" -eq 1 ]"
check "that one candidate is labelled 'worktree'" 0 bash -c "[ \"\$(label_for_index '$OUT3' 0)\" = 'worktree' ]"

echo
echo "green: BC_SNAPSHOT_CANDIDATES_DIR overrides the git walk entirely (documented, test-only)"
OVERRIDE_DIR="$(fake_dir)/override"
mkdir -p "$OVERRIDE_DIR"
printf 'override-0\n' > "$OVERRIDE_DIR/0"
printf 'override-1\n' > "$OVERRIDE_DIR/1"
printf '0\tworktree\n1\tdeadbeef\n' > "$OVERRIDE_DIR/labels.txt"
OUT4="$(fake_dir)/out"
BC_SNAPSHOT_CANDIDATES_DIR="$OVERRIDE_DIR" bc_snapshot_candidates "$OUT4" "$REPO" "$REPO/server/schema.snapshot.json" >/dev/null
check "the override's own labels are used verbatim, never the real repo's" 0 bash -c "[ \"\$(label_for_index '$OUT4' 1)\" = 'deadbeef' ]"
check "the override's own file content is used verbatim" 0 bash -c "[ \"\$(cat '$OUT4/1')\" = 'override-1' ]"

summary
