# scripts/ — the scripted orchestrator

This is `agentic-team/high-level-agentic-flow.mmd` made executable. State
lives entirely in GitHub (a Project v2 board, issues, PRs, comments) — these
scripts read it, decide the single next move, and act. There is no other
state store.

## Architecture — three levels

```
scripts/
  lib/            LEVEL 1 — primitives, no intelligence, sourced
    paths.sh        tool resolution, path form conversion, bc_state_dir
    config.sh        constants (repo, project, roles, thresholds) + bc_init + the clock
    gh-cli.sh         issues, PRs, comments, labels, sub-issues (one `gh` call each)
    project.sh        GitHub Project v2: items, Status/Priority/Sprint fields
    orca.sh            worktrees, terminals (one `orca` call each)
    claude.sh           session argv builders + the judgement one-shot
    markers.sh           the `<!-- bc:name value -->` comment vocabulary
    fake.sh               BC_FAKE test double: replays JSON, logs writes

  bc-issue.sh     LEVEL 2 — issues: next/current/transition/scope/demo-*
  bc-comment.sh    LEVEL 2 — the structured-comment reads and writes
  bc-pr.sh          LEVEL 2 — PRs: open/merge/for-issue/head
  bc-sprint.sh       LEVEL 2 — sprints: current/next/over/close/start
  bc-session.sh       LEVEL 2 — Orca/Claude session lifecycle

  prompts/        dispatch-*.md (sent into a running role session) and
                  judge-*.md (system prompts for the one-shot judgement calls)

  orchestrator.sh LEVEL 3 — the wake: one entry point, one decision, one action

  setup-github.sh  idempotent one-time GitHub setup (labels, scope check)
  spike/            the Phase-0 Orca/Claude session spike, kept as documentation
  tests/             fixture-driven tests, run with bash
```

Level 1 is sourced by level 2 (and, for `config.sh`/`paths.sh` only, by
level 3) and never calls another script — every function is exactly one
`gh`/`orca`/`claude` call, or pure text/JSON logic.

Level 2 scripts source level 1 directly. Each is `bc-x.sh <command> [args]`:
prints JSON or a bare value on stdout, follows the exit contract below. Two
of the five — `bc-comment.sh` and `bc-pr.sh` — are also invoked by the role
sessions themselves (leads writing their analysis/review, Crew opening a PR
and marking it addressed), which is what keeps one writer per comment.

Level 3 is `orchestrator.sh` alone. It **never sources** `gh-cli.sh`,
`project.sh`, `orca.sh`, or `claude.sh`, and never calls `gh`/`orca`/`claude`
directly — it only sources `lib/config.sh` (for constants, `bc_init`, and
`bc_state_dir`/`posix2win`) and invokes the five `bc-*.sh` scripts as
subprocesses. This is the whole point of the split: the level-2 scripts
decide *facts* (what's active, who has commented, whether the head moved),
and the orchestrator decides nothing except which branch of the flowchart
those facts select, then does the one thing at the end of it.

## Running a tick

```
bash scripts/orchestrator.sh
```

No arguments. Each run is one wake: it reads state, picks exactly one branch
of `agentic-team/high-level-agentic-flow.mmd`, takes the one action that
branch calls for (or nothing, if the gate says no), and exits. It does not
loop and does not remember anything between runs — run it again to advance
further, e.g. from cron, a scheduled task, or a human.

A crash mid-tick is safe to retick: state is transitioned *before* the side
effects it announces (starting-dev-cycle claims a sub-issue before spawning
anything), and every "the gate says no" branch re-derives what's missing
rather than trusting what a previous tick claimed to have done. Two spots
repair a half-finished previous tick explicitly: at "To analyze", the scoped
leads' analysis stubs are re-created (only the missing ones) before the pending
check, and a scoped lead with no stub counts as pending; at "Leads review",
a PR with no status comment gets its review stubs created before anything
else is checked. Session ids need no repair at all: every role's uuid is
derived from role + issue number (`bc-session uuid <role> <issue>`, an md5
shaped as a uuid), so any tick can recompute whom to resume, no comment has
to carry a uuid, and Crew — which never writes on the issue — gets no stub.

## The exit contract

Every tick ends by writing **one line** — `<node> <verb> <details>`, using
the node names from `agentic-team/high-level-agentic-flow.mmd` verbatim — to
both stdout and `$BC_WAKE_REASON`, then exits with:

| Code | Meaning | Examples |
|---|---|---|
| `0` | acted | `leads-analysed nudged tim,derek on #12`, `merging-pr merged PR #15 for #12` |
| `1` | slept — nothing to do | `demo-active sleep demo #40 awaiting feedback`, `starting-dev-cycle sleep backlog empty` |
| `2` | broken | a level-2 script failed somewhere it shouldn't have |

Everything else — diagnostics, warnings, subprocess stderr — goes to
stderr; stdout carries only that one reason line.

## Env overrides

| Variable | Effect | Default |
|---|---|---|
| `BC_FAKE=<dir>` | Every level-1 primitive read/write is replayed from/logged to `<dir>` instead of touching `gh`/`orca`/`claude`. Propagates to every subprocess the orchestrator spawns. This is what the whole test suite runs under. | unset (real calls) |
| `BC_NOW=<epoch or ISO timestamp>` | Pins "now" for every sprint/demo-hour/clock decision (`bc-sprint over`, `demo-current`, etc). | unset (real clock) |
| `BC_WAKE_REASON=<file>` | Where the one-line reason gets written. | `$(bc_state_dir)/wake-reason.txt` — see `lib/paths.sh`; falls back to `${TMPDIR:-$TEMP}/bc-wake-reason.txt` if that can't be resolved. |
| `BC_ENV_FILE=<file>` | A file of `BC_*=value` lines sourced by every bc-* process — including the ones the role sessions run in their own Orca terminals, which inherit nothing from the orchestrator's environment. The e2e run uses it to point `BC_BASE_BRANCH` at a throwaway base. | `~/.browsercity/env.sh` (absent = defaults) |
| `BC_READY_TIMEOUT_S=<s>` | How long `bc-session spawn`/`start` wait for the new terminal to show Claude's idle prompt (✳ title + `agentIdentity: claude`) before giving up with a warning. | 90 |
| `BC_CLOSE_RETRIES=<n>` | How many rounds `orca terminal close` gets per pane, two seconds apart, each round trying a plain close and then `--tab`. | 3 |
| `BC_STOP_TIMEOUT_S=<s>` | How long `bc-session stop-all` keeps closing and re-listing before it reports panes still open as exit 2. Orca refuses to close some busy panes with `terminal_handle_stale` (reliably the oldest Claude pane in a worktree) for up to a minute, then accepts the same call, so stop-all trusts the listing, not the close's answer. | 120 |
| `BC_SESSION_MODE=main` | `bc-session.sh worktree` returns `$BC_MAIN_CHECKOUT` instead of creating/looking up an Orca worktree-per-issue — the spike's documented fallback if Orca worktrees are ever unavailable. | unset (worktree-per-issue) |

(`lib/config.sh` also exposes plain constant overrides — `BC_REPO`,
`BC_PROJECT_NUMBER`, `BC_LEADS`, `BC_CYCLE_LIMIT`, `BC_IDLE_MS`, `BC_TZ`,
`BC_DEMO_HOUR`, label names, etc — see that file for the full list.)

## Running the tests

```
bash scripts/tests/run-all.sh
```

Runs every `scripts/tests/test-*.sh` and aggregates pass/fail (exit 0 only
if every file passed). Each file is fixture-driven through `BC_FAKE`:
`test-markers.sh` and `test-lib.sh` cover level 1 in isolation;
`test-bc-*.sh` cover each level-2 script's commands against canned
`project_items.json` / `gh_issue_comments.*.json` / etc fixtures;
`test-orchestrator.sh` runs `orchestrator.sh` itself as a subprocess, one
scenario per flowchart edge, asserting the exit code, the exact reason
line, and the decisive `calls.log` lines (or their absence). To run one
file directly: `bash scripts/tests/test-orchestrator.sh` (it prints its own
pass/fail summary and exits accordingly).

Note: `test-orchestrator.sh` alone takes a couple of minutes — each of its
~35 scenarios shells out through the real level-2 scripts and their `gh`
path resolution — so give it a generous timeout if scripting around it.

### The live end-to-end run

```
bash scripts/tests/e2e.sh
```

Not part of `run-all.sh`: it drives the real board, repo and Orca. It pushes
a throwaway `e2e-base` branch from the current HEAD (the task worktree
branches from HEAD too, so the PR diff is only Crew's work) and points
`BC_BASE_BRANCH` at it through
`BC_ENV_FILE`, creates a throwaway parent + sub-issue (`lead:tim`, Sprint =
current, Backlog, Standard), ticks `orchestrator.sh` every 60 s until the
sub-issue is Done (or 60 min), once closes every role terminal at
`To analyze` to check the next tick resumes each session without
duplicating it, and then — from an EXIT trap, so Ctrl-C or a timeout also
gets there — stops the sessions, removes the worktree, closes any open PR,
**deletes** both issues (which drops them from the board), deletes the
branches and restores the env file. Three real Claude sessions do real work,
so budget 15–45 minutes and some quota. The one thing it cannot remove is
the merged PR record itself.
