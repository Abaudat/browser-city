#!/usr/bin/env bash
# Fast, dedicated coverage for scripts/ops/lib.sh's bc_snapshot_candidates
# (story 4.18) -- against a real, throwaway git repo built here, never the
# real repository's own history (deterministic, and never slower as this
# repo's own commit count grows). No test-only override exists (Tim's
# direction, cycle 1): every scenario below, including the shallow-clone
# one, goes through the real git-backed walk.
set -u
TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
. "$TEST_DIR/harness.sh"
REPO_ROOT="$(cd -- "$TEST_DIR/../../.." && pwd)"
. "$REPO_ROOT/scripts/ops/lib.sh"

label_for_index() { # <out-dir> <index>
  awk -F'\t' -v i="$2" '$1 == i { print $2 }' "$1/labels.txt"
}
export -f label_for_index
candidate_count() { # <out-dir>
  wc -l < "$1/labels.txt" | tr -d ' '
}
export -f candidate_count
shallow_flag() { # <out-dir>
  cat "$1/shallow"
}
export -f shallow_flag

# fake_git_repo -- a throwaway repo with:
#   commit 1 (oldest): server/schema.snapshot.json = "v1", plus an
#     unrelated file.
#   commit 2: an unrelated-file-only commit -- must never appear as a
#     candidate (the `-- path` filter's own job).
#   commit 3 (HEAD, newest): server/schema.snapshot.json = "v2".
# The working tree's own copy is left equal to HEAD's (v2), i.e. clean --
# tests that want a divergent (dirty) worktree overwrite it themselves,
# after this returns.
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

echo "green: a clean worktree yields no worktree candidate -- candidate 0 is v2's own commit"
REPO="$(fake_git_repo)"
SHA_V2="$(git -C "$REPO" log --first-parent --format=%H -1 HEAD -- server/schema.snapshot.json)"
SHA_V1="$(git -C "$REPO" log --first-parent --format=%H HEAD -- server/schema.snapshot.json | tail -n1)"
OUT="$(fake_dir)/out"
bc_snapshot_candidates "$OUT" "$REPO" "$REPO/server/schema.snapshot.json" >/dev/null
check "exactly 2 candidates (v2's own commit, v1's own commit -- never a 'worktree' slot when clean, never the unrelated commit)" 0 \
  bash -c "[ \"\$(candidate_count '$OUT')\" -eq 2 ]"
LABEL0="$(label_for_index "$OUT" 0)"
check_contains "candidate 0 is v2's own commit (the newest that touched the file), not 'worktree'" "$SHA_V2" "$LABEL0"
check "candidate 0 is not labelled 'worktree'" 0 bash -c "[ '$LABEL0' != 'worktree' ]"
LABEL1="$(label_for_index "$OUT" 1)"
check_contains "candidate 1 is v1's own commit (the oldest)" "$SHA_V1" "$LABEL1"
check "candidate 0's content is v2's" 0 bash -c "[ \"\$(cat '$OUT/0')\" = 'v2' ]"
check "candidate 1's content is v1's" 0 bash -c "[ \"\$(cat '$OUT/1')\" = 'v1' ]"
check "shallow flag is 'false' for a normal, full clone" 0 bash -c "[ \"\$(shallow_flag '$OUT')\" = 'false' ]"

echo
echo "green: a dirty worktree (differs from HEAD's own committed content) is candidate 0, labelled 'worktree'"
REPO2="$(fake_git_repo)"
printf 'v3-uncommitted\n' > "$REPO2/server/schema.snapshot.json"
OUT2="$(fake_dir)/out"
bc_snapshot_candidates "$OUT2" "$REPO2" "$REPO2/server/schema.snapshot.json" >/dev/null
check "exactly 3 candidates (the dirty worktree, v2's own commit, v1's own commit)" 0 \
  bash -c "[ \"\$(candidate_count '$OUT2')\" -eq 3 ]"
check "candidate 0 is labelled 'worktree'" 0 bash -c "[ \"\$(label_for_index '$OUT2' 0)\" = 'worktree' ]"
check "candidate 0's content is the worktree's uncommitted edit, not HEAD's" 0 bash -c "[ \"\$(cat '$OUT2/0')\" = 'v3-uncommitted' ]"
check "candidate 1 is v2's own commit" 0 bash -c "[ \"\$(cat '$OUT2/1')\" = 'v2' ]"
check "candidate 2 is v1's own commit" 0 bash -c "[ \"\$(cat '$OUT2/2')\" = 'v1' ]"

echo
echo "green: a worktree that only differs from HEAD by CRLF-vs-LF line endings still counts as clean (regression: a Windows core.autocrlf=true checkout normalises the working-tree copy to CRLF while the git blob itself stays LF, which a byte-for-byte compare misread as a real, uncommitted edit)"
REPO3="$(fake_git_repo)"
printf 'v2\r\n' > "$REPO3/server/schema.snapshot.json"
OUT5="$(fake_dir)/out"
bc_snapshot_candidates "$OUT5" "$REPO3" "$REPO3/server/schema.snapshot.json" >/dev/null
check "still exactly 2 candidates -- no spurious 'worktree' slot for a CRLF-only difference" 0 \
  bash -c "[ \"\$(candidate_count '$OUT5')\" -eq 2 ]"
check "candidate 0 is not labelled 'worktree'" 0 bash -c "[ \"\$(label_for_index '$OUT5' 0)\" != 'worktree' ]"

echo
echo "red-ish: a non-git checkout yields only the worktree candidate, never an error"
PLAIN="$(fake_dir)/plain"
mkdir -p "$PLAIN/server"
printf 'plain\n' > "$PLAIN/server/schema.snapshot.json"
OUT3="$(fake_dir)/out"
bc_snapshot_candidates "$OUT3" "$PLAIN" "$PLAIN/server/schema.snapshot.json" >/dev/null
CODE=$?
check "a non-git checkout does not fail" 0 bash -c "exit $CODE"
check "exactly 1 candidate (worktree only)" 0 bash -c "[ \"\$(candidate_count '$OUT3')\" -eq 1 ]"
check "that one candidate is labelled 'worktree'" 0 bash -c "[ \"\$(label_for_index '$OUT3' 0)\" = 'worktree' ]"
check "shallow flag is 'non-git'" 0 bash -c "[ \"\$(shallow_flag '$OUT3')\" = 'non-git' ]"

echo
echo "green: a real --depth 1 shallow clone is reported shallow, and only the boundary commit is visible"
# `git clone --depth 1 file://<path>`, never a bare local path: local-path
# clones silently ignore --depth ('--depth is ignored in local clones',
# confirmed empirically) and would produce a full clone that proves
# nothing here.
SHALLOW_CLONE="$(fake_dir)/shallow-clone"
git clone -q --depth 1 "file://$REPO" "$SHALLOW_CLONE" >/dev/null 2>&1 \
  || { echo "could not create the --depth 1 fixture clone" >&2; exit 1; }
OUT4="$(fake_dir)/out"
bc_snapshot_candidates "$OUT4" "$SHALLOW_CLONE" "$SHALLOW_CLONE/server/schema.snapshot.json" >/dev/null
check "shallow flag is 'true'" 0 bash -c "[ \"\$(shallow_flag '$OUT4')\" = 'true' ]"
check "exactly 1 candidate is visible (git treats the shallow boundary commit as touching every file, confirmed empirically -- the unrelated and v1 commits are invisible to this clone)" 0 \
  bash -c "[ \"\$(candidate_count '$OUT4')\" -eq 1 ]"
check_contains "the one visible candidate is the boundary commit (v2's own sha)" "$SHA_V2" "$(label_for_index "$OUT4" 0)"
check "its content is v2's" 0 bash -c "[ \"\$(cat '$OUT4/0')\" = 'v2' ]"

summary
