#!/usr/bin/env bash
# LEVEL 1 -- the one git call the supervisor makes. Everything else in this
# repository leaves git to the roles working inside their own worktrees;
# keepalive.sh is the exception, because it is the only process that starts
# the loop, and a loop started from a checkout that is a week behind runs a
# week-old orchestrator against today's board. Fake-aware via fake.sh like
# every other primitive.

_BC_GIT_LIB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "$_BC_GIT_LIB_DIR/config.sh"
# shellcheck source=fake.sh
. "$_BC_GIT_LIB_DIR/fake.sh"

# bc_git_pull <dir> -- fast-forward <dir> to its upstream. Exit 0 pulled,
# 1 could not (git missing, not a repository, no upstream, a diverged or
# dirty tree). Whatever git said goes to stderr; nothing goes to stdout.
#
# --ff-only is the whole safety story. The main checkout is a working tree a
# human also uses, and a supervisor that runs unattended every dozen minutes
# must never be the thing that writes a merge commit into it, or leaves it
# sitting in a conflicted MERGING state that the next run inherits. A pull
# that cannot fast-forward is a pull that does not happen, and the caller
# says so in its reason line rather than treating it as fatal: a loop
# running slightly old code still moves the team, and a checkout that needs
# a human is a thing to read in the log, not a reason to stop.
bc_git_pull() { # <dir>
  local dir="$1" git
  [ -n "$dir" ] || { echo "git: dir is required" >&2; return 1; }
  if [ -n "${BC_FAKE:-}" ]; then
    bc_fake_write git_pull "$dir" >/dev/null
    # The fake's exit fixture is the only way a test can express "the pull
    # failed"; bc_fake_write's own <fn>.exit would exit the whole script,
    # which is precisely what this function must never do to its caller.
    [ -f "$BC_FAKE/git_pull.rc" ] && return "$(cat "$BC_FAKE/git_pull.rc")"
    return 0
  fi
  git="$(resolve_git)" || { echo "git: git not found; set BC_GIT" >&2; return 1; }
  "$git" -C "$dir" pull --ff-only >&2 || return 1
  return 0
}
