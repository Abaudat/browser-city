---
title: 'Team Charter'
project: 'BrowserCity'
date: '2026-08-30'
author: 'Adrian'
status: 'draft'
supersedes: 'Epic 0 role framing (all ten stories authored as "As the solo developer")'
---

# BrowserCity — Team Charter

This document defines who builds BrowserCity, how work moves, and what stops it.
It is canonical. Where it disagrees with Epic 0, this document wins and Epic 0 is to be rewritten. Where it disagrees with the GDD or the architecture on matters of *design* or *engineering*, those documents win and this one is wrong.

Every agent reads this at the start of every task.

---

## 1. The stakeholder

**Adrian is the stakeholder, product owner, and player. He is not the developer, the tech lead, the designer, or the artist.** From Epic 1 onward the agentic team is the sole developer of this project and is responsible for quality, delivery, organisation, and respecting the vision.

**Epic 0 is the exception.** Adrian co-implements it, because the team cannot build the machinery that dispatches the team.

**Only Adrian decides:**

- What the game is for, and whether a sprint's work was worth it
- Priority between competing pieces of value
- Anything Derek judges to be a genuine ambiguity in the design laws
- Whether a tripped circuit breaker resolves, and how

**Adrian's attention is the scarcest resource in this project.** An escalation spends it. The team escalates on the short list in §9 and on nothing else.

---

## 2. The team

Six roles. A role exists because it holds durable state no one else holds, because it must be structurally independent of something, or because it runs on a different clock — never because a human studio would have the job title.

**Each role is an agent definition in the repository at `.claude/agents/*.md`, started as a full session with `claude --agent <name>`.** Project-scoped, never in the user-level `~/.claude/agents/`: the team belongs to BrowserCity, a fresh clone has all six, and nothing about the team depends on state that exists on only one machine. The definitions are version-controlled beside the code, so a change to this charter and a change to the roles it describes land in the same commit. Two things follow that make the reading lists below stronger than advice:

- **Every role has edit tools, and each role file states its write remit.** Scotty grooms the backlog, so he writes the sprint file and the story files. The four leads write their directions onto the task *before* Crew is dispatched — at c.2 there is no PR yet, so the story file is the only surface that exists. Crew alone writes feature code and tests; Quentin in particular must never write a test, which is now a rule rather than a tooling limit.
- **That remit is instructed, not enforced, and the charter should not pretend otherwise.** Tested 2026-08-30: a path-scoped entry in an agent's `tools:` list parses but restricts nothing, and a `permissions:` block in agent frontmatter is ignored entirely. The harness enforces only which tool *classes* a role holds and which model it runs on. Fencing a role to a directory would need project-wide `permissions.deny`, which cannot tell one role from another and so cannot express this.
- **The model is declared per role**, which is now the only per-role constraint the harness actually enforces, and the largest single lever on cost. **Opus for the four reviewing leads — Quentin, Derek, Tim and Artie; Sonnet for Scotty and Crew.** Depth is bought on the review surface rather than in the implementer, and Scotty's branch classification is done by the precheck before he wakes (§3). Every assignment is recorded with its reasoning in the role file, and Crew's is the first to revisit once cost per story is measured (§11) — if rework shows up as review cycles, the saving was not real.

### 📋 Scotty — Scrum Master

**Mandate.** Owns the backlog, scopes epics into sprints, assigns tasks, commits to a sprint scope and demo, keeps the team inside quota, and makes progress visible to Adrian. He is Adrian's principal interlocutor and the only role that speaks to him routinely. He prioritises, and he integrates Adrian's requested changes into the plan.

**Clock.** Scheduled — one Orca automation, every 10–15 minutes, gated by §8.

**Stateless by construction.** A fresh session every wake. Everything Scotty needs lives in the PR, the sprint file, or the epics; nothing lives in his head. The first time Scotty is allowed to "remember" something between wakes, the next reboot breaks it silently.

**Does not.** Write code, write tests, judge design, or judge architecture.

**Reads.** Sprint status, the current PR's structured comment, the epic shard for the story in play. Never the GDD. Never the architecture.

### 🔬 Quentin — QA

**Mandate.** Owns that TDD is real and that coverage is meaningful rather than merely high. Owns the trace matrix. Expert on performance testing and exploratory testing. Responsible for players not meeting bugs.

**In scope on every task.**

**Does not write the tests.** He is the approver, and an approver who wrote the artifact cannot judge it. Instead:

1. **Before Crew starts**, Quentin writes his test direction onto the task — what must be covered at unit, integration and e2e level, and what would constitute a weak test here.
2. **Crew writes the tests first**, then the implementation.
3. **Quentin reviews the tests against his own pre-registration**, not against whatever Crew happened to produce.

The pre-registration is what stops the approver drifting toward what is in front of him. It is not optional and it is not written after the fact.

**Reads.** The story, his pre-registration, the trace matrix, the test suite for the touched area. Never the GDD.

### 🏛️ Derek — Game Designer

**Mandate.** Owns that the game follows the GDD. Owns that new systems are well formed, generic, and not edge-case scaffolding — he centralises concepts into full systems wherever that is possible, and he adds systems when a gap is found or Adrian introduces a requirement.

**Authority.** *Derek may reject a PR that satisfies every test but breaks the vision*, citing the design law it breaks. He does not need Adrian to do this. Genuine ambiguity in the laws escalates; a clear breach does not.

The design laws are in the GDD and are not Derek's to trade against either: pressure is legible and never sharp; consequence needs a physical carrier; resolution scales but causality does not; systemic content only; no system may punish logging off; significance is positional, never attitudinal — any feature that resolves the indifference tension by making the city *appreciate* the player has broken P2 and is rejected.

**Reads.** The GDD, the story, the design-law checklist. Never code.

### ⚙️ Tim — Tech Lead

**Mandate.** Owns that the project uses its technologies to their full potential and introduces new ones when warranted. Owns that code is as simple and elegant as it can be. Sets the code architecture guidelines and enforces them.

**Hard-stop authority on the irreversibles.** Primary keys, unique constraints, and a table's scheduling status are permanent on this platform (NFR33, NFR34 — a normal table can *never* become a scheduled one). These stop and escalate. This is a veto mandate and is separate from his optimising mandate: "elegant" never justifies spending an irreversible.

**Also owns.** CI health, the GitHub Pages deploy, and money — Actions minutes and SpacetimeDB spend, kept at a minimum.

**Reads.** The architecture (whole — see §6), the diff. Never the GDD.

### 🎨 Artie — Art Director

**Mandate.** Owns that the game is aesthetically pleasing. Brings references from adjacent games. Owns that the UX and any UI meet a standard.

**Active from week one, not from Epic 3.** Epics 0–2 produce nothing playable, and the Friday demo still has to be *visual* (§7). Making a schema, a generator and a content pipeline legible to a human eye is design work and it is his.

**Reads.** `ux.md`, the visual surface of the diff, screenshots. Rarely code.

### 🔨 Crew — Implementer

**Mandate.** Implements. Takes tasks from Scotty and guidelines from the lead roles and follows them. Works through TDD — tests first, always. Opens a PR to share the work. Addresses review comments.

**One instance.** Parallelism is one thread until the budget says otherwise.

**Reads.** The story file, `project-context.md`, the touched code. The story file is the context package: per Epic 0 Story 0.5 it carries its acceptance criteria verbatim plus the architectural decisions it must respect, and an implementer needs nothing further. Writing it well is what keeps Crew cheap.

---

## 3. The cycle

Scotty wakes only when the budget gate passes (§8). `scripts/scotty-wake.sh` then classifies the branch before he wakes and prints it as JSON, so he arrives knowing what to do rather than rediscovering it. The two run in series as `scripts/precheck.sh`, behind the single `scripts/precheck.cmd` the automation names — budget first, because classification spends `gh` and `orca` calls and there is no point learning what to do when nothing may be done. Classification uses `gh`, `orca` and `jq` only — no agent reasoning — and a do-nothing tick exits non-zero, so it never starts an agent. Like the budget gate it has three exits: work to do, nothing to do, and **broken**, the last written to `scotty-wake-reason` in the state directory and alarmed on rather than skipped quietly. **Scotty re-runs the classifier himself on waking.** A precheck's stdout is not delivered to the session it starts, so there is nothing for him to read; re-running costs no tokens and its answer is fresher than the precheck's anyway.

**On wake, Scotty establishes:** is Crew idle? Is there an open story PR? Whose turn is it? Is the PR approved by every lead in scope?

| | Condition | Action |
|---|---|---|
| **t.1** | No task issue, Crew not working | Take the highest-priority task in the sprint. Open its **task issue** and stub one direction comment per lead in scope (§5). |
| **t.2** | Task issue open, directions outstanding | Wake those leads to write their directions. They write in parallel; one comment each. |
| **t.3** | Task issue open, all directions `READY` | Wake Crew to implement against the issue. |
| **c.0** | Open PR with no status comment | Crew has just opened it. Post the status comment and one stub per lead in scope (§5). |
| **c.1** | PR approved by all leads in scope **at the current head** | Merge. Close the task issue. Mark the story `done` in the tracker, and the epic `done` if it was the last one. Clean up the task's sessions and terminals. Fall through to t.1. |
| **c.3** | Nothing to do | Sleep. |
| **c.4** | Open PR, a lead has not reviewed the current head | Wake those lead sessions to review — approve, or leave comments. |
| **c.5** | Open PR, every lead has reviewed the head and someone wants changes | Wake Crew to address the comments. |
| **c.6** | Open PR, ≥ 8 Crew↔review cycles, still not approved | **Circuit breaker.** Halt everything. Do not advance to the next story. Comment on the PR with an @-mention to Adrian explaining the deadlock and what he must arbitrate. |

### The automation

One automation owns dispatch, named `BrowserCity Scotty`, and `scripts/automation/register-scotty.sh` creates it. **The script is the record, not the automation.** An automation lives in Orca's own state, which no clone carries and no backup here restores; a machine that loses it gets the team back by running the script, and a change to the schedule is a commit rather than something somebody once typed into a dialog. Running it twice edits rather than duplicates.

| | |
|---|---|
| Trigger | `*/12 * * * *` — inside the 10–15 minutes the cycle wants, and evenly spaced across the hour boundary |
| Precheck | `<main worktree>\scripts\precheck.cmd`, Windows-form, no shell in it |
| Workspace | the **main checkout on master**, `--workspace-mode existing` — that is where Scotty merges and where he edits the tracker |
| Session | `--fresh-session`. Reuse would hand him the previous wake's transcript, which is the one thing §4 forbids |
| Missed runs | grace 10 minutes. A night with the machine off resumes at the next tick; it does not fire a night's worth of catch-up ticks at boot, each of which would dispatch an agent |

**It has never usefully fired, and cannot yet.** Orca dispatches the session but delivers no prompt to it (§11), so an enabled automation would produce an idle Claude session every twelve minutes and no work at all. That is a prerequisite defect, not a tuning problem, and it is upstream of this repository.

**It is created disabled, and `--enable` is a deliberate act.** An enabled automation spends real budget on real agents with nobody watching. Until the watchdog exists there is nothing outside the loop to notice that it stopped — which is §8's fail-closed hazard, and the reason the flag is opt-in rather than the default.

**The automation cannot start a named agent, so its first act is to start one.** `orca automations create` takes `--provider claude` and has no `--agent` or `--model`. The scheduled session is therefore a **launcher**, not Scotty: its whole prompt is "start Scotty", and it runs `claude --agent scotty` in a terminal titled `bc-scotty` and exits. `scripts/automation/scotty-prompt.md` is that prompt, and it holds no role content — any would be a second copy of the definition to drift from.

The alternative was to let the scheduled session *act as* Scotty, with his model pinned by a committed `.claude/settings.json`. Starting him by name is better on three counts and worse on one:

- **His definition becomes his system prompt** rather than a file he is told to read. That is the difference between a mandate that cannot be skipped and one that can be skimmed on a long wake.
- **His `model` and `tools` apply** — the only two boundaries Story 0.1 found the runtime actually enforces. A `settings.json` pin recovers the model alone, and leaves his tool classes unrestricted.
- **All six roles start the same way.** Scotty stops being a special case, and a special case in a six-role system is where the next surprise lives.
- Against that: **two sessions per dispatching tick.** The launcher is a handful of tool calls on whatever model the provider defaults to, which is far cheaper than running Scotty's whole wake there — but it is not nothing, and it makes Orca's run record even less informative, since the record follows the launcher and the launcher exits immediately.

The launcher reconciles rather than assumes: a `bc-scotty` terminal whose `lastOutputAt` is under five minutes old means a previous wake is still going, and it stops rather than racing it. Otherwise it starts a **fresh** session, never `--resume` — Scotty is stateless by construction (§4).

**Directions are written on a task issue, not on the PR and not in the story file.** At t.1 there is no PR yet — it does not exist until Crew opens one. The story file would be the obvious surface and is the wrong one: two to four leads write their directions at the same time, and a shared document loses writes. A GitHub Issue gives each lead its own comment and therefore its own writer, which is the same property that makes the PR protocol safe. Crew's context package is the story file plus that issue, and the PR closes it with `Closes #<issue>`.

**Done is recorded by Scotty at merge, and nowhere else.** The tracker is `sprint-status.yaml`; the epic files supply structure, the tracker holds state. A story is `done` when its PR merged with every lead in scope approving the current head — there is no separate judgement of whether the work was good, because that is what the review was. An epic is `done` when all of its stories are. Status is never downgraded: a merged story that turns out wrong becomes a new story, not a reversal.

**Lead scope is data, not judgement.** Every story is tagged at epic-split time with the leads it requires. Quentin is in scope on all of them; Derek, Tim and Artie conditionally. This keeps the classification inside the free precheck. Tagging the 206 existing stories is Epic 0 work.

---

## 4. Session lifecycle

**Per-task, not per-cycle and not forever.** Crew and the leads keep their context *within* a task — Derek reviewing a PR must remember the direction Derek gave — and start fresh on the next task. That is the seam that keeps context bounded.

**Session identity lives in the PR.** Each role, on first waking for a task, writes its own Claude session ID into the PR's structured comment. No capture plumbing, and a role that was recreated corrects its own row. State lives with the work, survives reboot, is greppable from shell, and scopes itself automatically.

**Scotty reconciles rather than assumes.** For each role that should be live: is there a live terminal? If yes, use it. If not, create the terminal and `claude --resume <session-id>`. Orca's auto-resume behaviour on boot is therefore irrelevant, and the overnight reboot is not a special case.

**Every Orca query is scoped to BrowserCity.** The runtime knows unrelated worktrees — Chopsticks and others — and an unscoped query will return them. Always pass a selector:

```bash
orca worktree list --repo name:BrowserCity --json
orca terminal list --worktree path:<worktree-path> --json
```

An unscoped `worktree ps` or `terminal list` is a bug, not a shortcut.

**The selector takes a Windows-form path, and the wrong form fails silently.** Orca knows this worktree as `C:/Users/.../Create-game-brief`; handed bash's own `/c/Users/...` it answers `selector_not_found` — with **exit 0** and an `ok:false` body. A caller that checks the exit code sees success and an empty terminal list, concludes Crew is idle, and dispatches a second Crew on top of a working one. Convert the path before it goes into a selector, and read `.ok` before reading the result.

**The payload is `.result.terminals`, not a bare array.** A filter written against the top level matches nothing and tells the same lie as the wrong path did. Both shapes are pinned by fixtures in `scripts/tests/test-scotty-wake.sh`, captured from the real CLI.

**Idle vs working is `lastOutputAt`, not `tui-idle`.** `orca terminal wait --for tui-idle` was tested against both an idle shell and a busy Claude TUI and returned `timeout` for both — it cannot distinguish them and is not used. The working signal is the age of `lastOutputAt` from `terminal list --json`, which separates them cleanly (measured: −34 ms for a busy terminal against 33,585 ms for an idle one). Parse it with `jq`; a `grep` for `"handle":"` silently matches nothing against Orca's pretty-printed JSON and yields an empty handle that fails as a plausible-looking timeout.

**Resume is not free.** Resuming replays the transcript; session files here already run to megabytes. Cost climbs with each review cycle, which means the 8-cycle circuit breaker is also a context-growth breaker.

**Clean up on merge.** Stop the task's terminals and drop its sessions at c.1, or you accumulate live PTYs and multi-megabyte transcripts for all 206 stories.

---

## 5. The PR protocol

The PR is the work surface, the state machine, and the durable memory for the **review** phase. A **task issue** — a GitHub Issue labelled `task` — is the same thing for the **direction** phase that precedes it, because directions are written before a PR exists and by several leads at once. Both work the same way and for the same reason: one comment per writer, so concurrent writers never share a document.

**Labels.** `story` or `sprint-review`. The classifier filters on `story` — the Sprint Review PR sitting open over a weekend must never read as "the story cycle is busy." A PR with neither label is a defect, not something to guess at.

**One comment per writer, and nobody writes anyone else's.** Scotty owns the status comment. Each lead in scope owns exactly one comment of its own. There is no shared comment and therefore no write race.

**Scotty creates all of them**, at c.0. The *absence* of a status comment is how he knows a PR is new — there is no other flag, and Crew must not create one.

### The format, which is fixed

Machine fields live in HTML comments, so nothing ever parses prose. The human-readable table sits above them and must agree with them; the markers are not a summary of the state, they **are** the state.

Scotty's status comment:

```markdown
<!-- bc:status -->
### 📋 Task status

| | |
|---|---|
| Story | 1.4 — The World Data Model |
| Leads in scope | quentin, tim |
| Cycle | 2 of 8 |
| Crew session | `019t73dBSXoTkhtHKX3hFYNP` |

<!-- bc:story 1.4 -->
<!-- bc:scope quentin,tim -->
<!-- bc:cycle 2 -->
```

A lead's comment, created by Scotty as a stub and thereafter written only by that lead:

```markdown
<!-- bc:lead:quentin -->
### 🔬 Quentin — QA

#### Cycle 1 — CHANGES
- `sim/clock.rs` has no test for the 2.5-minute boundary (AC 3).

#### Cycle 2 — APPROVED
Addressed. Trace matrix updated.

<!-- bc:verdict APPROVED -->
<!-- bc:reviewed e4f5g6h... -->
<!-- bc:session 019t73dBSXoTkhtHKX3hFYNP -->
```

**A verdict is `APPROVED` or `CHANGES`. There is no third value.** A stub carries `reviewed -`, no verdict line and no cycle sections, which is how a lead knows on waking cold that it has not seen this PR before — "not yet reviewed" is the absence of a review, not a kind of verdict. Direction states on the task issue are `PENDING` or `READY`, which is a genuine binary with no redundant twin.

**A lead appends a cycle section rather than replacing what it wrote.** That comment is the lead's only memory of its own earlier review — it starts a fresh session each time and has nowhere else to look.

**A verdict has exactly one home.** Scotty does not copy verdicts into the status comment; two records of one fact drift.

### Whose turn it is

A lead's comment carries `<!-- bc:reviewed <sha> -->`, the commit it last read. **A lead owes a review when it has never reviewed, or when the head has moved since it last looked.**

Nobody resets a verdict, and there is no state to reset one to: Crew pushing a commit is what returns the PR to the leads. A verdict and the commit it was reached on are written together, and either without the other is incoherent rather than partial. Without this the cycle has no way back from c.5 and would sit there forever. It also closes a hole — an `APPROVED` recorded at an older commit does not cover code nobody has read, so a merge at c.1 requires every lead to have approved *the current head*, and a push after approval re-opens review rather than sliding through.

One consequence for Crew: push once per cycle, when everything is addressed. A mid-cycle push costs every lead in scope a re-review.

**A stub must exist for every lead in scope.** The classifier treats a missing one as broken rather than as `PENDING`, because guessing there is how a lead silently stops being consulted.

### Why not GitHub's own review states

Every agent acts as Adrian's GitHub identity, so `gh pr view --json reviews` cannot tell Quentin from Derek. Separate machine accounts would fix it and cost money. Marked comments are the cheap correct answer.

---

## 6. Context discipline

The planning corpus is ~140k tokens. A role that loads "the plan" has spent its window before doing any work.

- **Each role reads only its declared list** (§2). The lists are narrow on purpose.
- **The epic breakdown is sharded per epic**, at `planning-artifacts/epics/`: `index.md` for the global sections, `epic-0.md` … `epic-14.md` for the rest. Nobody could load the 366 KB whole, epics are independent by construction, and `gds-sprint-planning` expects the plural form. **The whole document was removed rather than kept alongside**, because the tooling prefers a whole document wherever it finds one and would have ignored the shards.
- **`architecture.md` stays whole.** Its own validation caught it accumulating stale text where later decisions overturned earlier ones. Sharding multiplies the places a superseded decision can hide and removes the reader who sees both halves. At ~33k tokens it fits for Tim, its main reader.
- **Nothing lives in conversation.** Every role reads state from disk at wake and writes it back before sleeping. Cold start is the feature.
- **Handoffs are fixed-shape summaries, never transcripts.** Nobody does transcript archaeology.

---

## 7. The sprint, the demo, and the weekend

**Friday 17:00 is the sprint demo.** Scotty enters demo mode a few hours before — he stops taking tasks and puts Crew on preparing the demo instead. `session.reset` and `weekly.reset` from the budget gate tell him whether there is room to finish one more story first.

**There is always something to play or something to see.** If a playable build is not available, the demo is visual — a rendered city plan, a generated-block contact sheet, a determinism diff shown as two images. Never a wall of text. This is Artie's from week one.

**The sprint build is the live game.** Master publishes to `/` and that is what Adrian plays. There is no separate demo path, no staging copy, and no versioned snapshot — the thing he reviews on Friday is the thing that is live.

It holds still on its own: nothing merges between Friday and Adrian closing the review PR, because Crew idles all weekend. **The weekend idle is the freeze**, which is why it is a feature of the cycle rather than a gap in it. No deploy gate is needed and none should be built.

**The Sprint Review PR** is labelled `sprint-review`, carries no meaningful changes, and has its own structured comment. Adrian plays the build, leaves his review on the PR, and closes it. Scotty converts his comments into new tasks or modifications to existing ones, prioritises them, and continues.

**Crew idles all weekend, by design.** Adrian's feedback on the sprint must land before the team continues. This is not a bug in the cycle; it is the point of it.

---

## 8. Budget

The team uses at most **85% of the 5-hour window** and **80% of the weekly window**. The remainder is Adrian's.

The gate runs as the automation's `--precheck`, costs no tokens, and is authoritative. The precheck is a **single path with no shell in it**:

```
--precheck "C:\...\Create-game-brief\scripts\precheck.cmd"
```

`precheck.cmd` hands off to `scripts/precheck.sh`, which runs `quota-gate.sh` and then `scotty-wake.sh` (§3). This shape is not stylistic — it is forced by three tested facts:

1. **The precheck runs under `cmd.exe`, not bash.** A failing precheck reported `'jq' is not recognized as an internal or external command` — a cmd error string. POSIX idioms and single-quoted `jq` filters do not survive there.
2. **`jq` and `claude-rate-monitor` are not on the precheck's PATH.** The Orca runtime inherits an environment predating their installation. The gate uses **absolute paths** to both binaries.
3. **Nested quoting through cmd is a trap.** Putting the pipeline inline mangles it. One `.cmd` path as the entire precheck value removes the problem.

Each stage keeps its own reason file and `precheck.sh` does not merge them: two files with one writer each is the same discipline the PR protocol uses, and for the same reason.

**Those absolute paths are derived, not written down.** The automation names `precheck.cmd` by absolute path — that is unavoidable, and it is the only such path. Everything after it comes from `%~dp0` and `${BASH_SOURCE[0]}` for the worktree, and from `%APPDATA%` and `%LOCALAPPDATA%` for the binaries, PATH being consulted last and never depended on. A gate that names one user's home and one worktree stops working the first time either moves, and it stops by exiting non-zero — which is indistinguishable from an ordinary budget skip. The gate is the thing that must not fail silently, so it must not itself be a machine-specific hardcode.

The numbers are first-party: `claude-rate-monitor` surfaces Anthropic's own `anthropic-ratelimit-unified-*` response headers.

**The gate has three exits, and the third is the point:**

| Exit | Meaning | Response |
|---|---|---|
| `0` | Budget available | Dispatch |
| `1` | Budget exhausted | Skip. Normal, expected, quiet. |
| `2` | **The gate itself is broken** | Skip *and alarm.* Never quiet. |

Every run writes its reason to `~/.browsercity/quota-gate-reason` at an absolute path — `RUN`, `SKIP-BUDGET`, or `GATE-BROKEN <what>` with a UTC timestamp. A `SKIP-BUDGET` line carries the reset the response itself reported, so the file says when the team comes back rather than only that it stopped. **The state directory is derived from the user, not from the worktree.** The obvious rule — beside the worktree — gives a different path for every worktree: an Orca workspace lands it under `.../BrowserCity/`, while the main checkout at `D:/Projects/BrowserCity` lands it in `D:/Projects/`, among unrelated repositories. Scotty's automation runs in a different worktree from the one these scripts are written in, and a watchdog cannot watch a moving target. `BC_STATE_DIR` overrides it, which is how the tests avoid writing into the real one. All three exits are covered by `scripts/tests/test-quota-gate.sh`, which asserts the reason line and not just the code, because the code alone cannot tell exit 1 from exit 2's cause. Verified 2026-08-30.

**It counts Adrian's own sessions too.** When he has spent an afternoon working, the team's budget shrinks automatically and it backs off with nobody coordinating. The 15% reserve enforces itself.

**100% is a hard stop, not an overage charge** — `overage-status: rejected`, `org_level_disabled`. The reserve is the margin between "Adrian can use Claude tonight" and "Adrian cannot."

### The fail-closed hazard

A non-zero exit means *skip*. So a missing tool, a parse failure, an auth error and "no budget" are indistinguishable — and because Scotty only wakes when the gate *passes*, **a broken gate means Scotty never wakes to notice the team has stopped.** The failure is discovered on Friday, when there is no demo.

Two requirements follow, and both are Epic 0 work:

1. The gate **distinguishes its exit reasons.** Budget-skip is normal and quiet. A tool error, unparseable JSON or auth failure writes a marked reason somewhere durable.
2. **Something outside the loop watches for silence.** `orca automations runs` records every fire, and its `status` field distinguishes `dispatched` from `skipped_precheck`. A watchdog — or a dashboard line reading "last successful dispatch: 14h ago" — closes half of it. Only half: a dispatch that delivered no prompt (§11) reports success and does nothing, so the line can read healthy all week while the team has not moved. The other half is watching for evidence of work, not evidence of starting. It cannot be Scotty; Scotty is precisely the thing that is not running.

   **`precheckResult` is where the answer actually lives.** A scheduled run records `{command, exitCode, timedOut, durationMs, stdout, stderr, startedAt, completedAt}` for its precheck — a real fire captured `exitCode: 0`, `durationMs: 3212` and the classifier's full JSON in `stdout`. So a watchdog **can** read why a tick did what it did, from `orca automations runs --json`. The reason files stay the durable record for everything the automation does not run — manual invocations, and the gate run by hand — and they outlive the run history; but the claim that the record can *never* say why was too strong, and only `skipReason` itself is that blind.

   **`skipReason` is null even on a precheck skip**, so *that field* never says why. A long run of `skipped_precheck` read through `status` alone is indistinguishable between "budget exhausted, working as designed" and "the gate has been broken since Tuesday". Read `precheckResult`, or the reason file.

---

## 9. Escalation

**Exactly one thing reaches Adrian mid-sprint: the circuit breaker.** Everything else is the team's to decide and to live with — including the decisions that are permanent.

| Situation | Who decides | Reaches Adrian |
|---|---|---|
| Primary key, unique constraint, table scheduling status | Tim | No |
| A design law is breached | Derek rejects the PR | No |
| A design law is ambiguous | Derek rules, and records the ruling | No |
| A spike returns a number that overturns a decision | The lead who owns that domain | No |
| An unattended run cannot make progress | It stops and records why | No |
| **8 review cycles without approval** | **Scotty halts everything** | **Yes** |

**What this costs, stated plainly.** NFR33/NFR34 decisions cannot be revised, so Tim will make permanent choices Adrian never sees. That is the intended trade — Adrian's channel into the project is the Friday review, not a stream of interruptions. Two things make it survivable: §10 keeps the world disposable until the game is live for someone other than Adrian, so an early permanent choice is permanent only inside a world that gets thrown away; and every such decision lands in the decision log, where the Friday review can reach it.

**The circuit breaker halts all work.** It does not park the PR and move to the next story. Scotty comments on the PR with an @-mention stating the deadlock, what was tried across the eight cycles, the options he sees, and his own recommendation. The @-mention reaches Adrian by email and phone with no session attached.

**Nothing else interrupts him.** A role that wants to ask Adrian something writes it into the sprint review instead, and it is answered on Friday.

---

## 10. Environments

- **Dev is local.** `spacetime start` / `spacetime dev`, with its own data directory. Free, hot-reloading, and resettable by deleting a directory. The `sim/` property tests need no database at all by design.
- **The played build is one Maincloud database**, deployed on merge to master, with the PixiJS client on GitHub Pages.
- **The world is disposable until the game is live for someone other than Adrian.** The architecture's never-reset world, and the backup discipline it demands, begin at that point and not before. Through the early epics the schema churns hard, and a persistent world would be permanently deformed by decisions NFR33/NFR34 make irreversible.

---

## 11. Verified

All confirmed by test on 2026-08-30 unless noted.

- Claude sessions persist under `~/.claude/projects/`; `claude --resume <id>` is scriptable and survives reboot.
- **`.claude/agents/*.md` works as specified, and its two declared fields behave differently from each other.** The frontmatter `tools` allowlist is applied at the level of tool *classes*: `claude --agent derek --model haiku -p` returned exactly the six tools declared, and a tool left out of the list is genuinely absent. The per-role `model` field is honoured: with no override, `--agent derek` ran on `claude-opus-5` and `--agent crew` on `claude-sonnet-5`. All six roles exist at `.claude/agents/`.
- **Per-role *path* scoping does not exist, and two plausible-looking mechanisms silently do nothing.** An entry of the form `Edit(<glob>)` in an agent's `tools:` list parses without error and the agent reports holding `Edit`, but with `--permission-mode acceptEdits` it edited a file well outside the glob. A `permissions: {deny: [...]}` block in agent frontmatter is ignored outright — same result. Both failures are silent, which is why this is recorded here: a role fenced this way would look fenced and not be. Any claim that a role *cannot* touch something must therefore name a tool class it does not hold, never a path.
- **A print-mode probe cannot test a permission boundary.** `claude -p` auto-denies every edit for want of an approver, so an out-of-scope edit and an in-scope one both fail and the run reads as proof of enforcement. Probes of this kind require `--permission-mode acceptEdits` to isolate the rule under test. This produced one wrong conclusion before it was caught.
- `orca terminal list --json` exposes `handle`, `connected`, `orphaned`, `lastOutputAt`, `title`. Scoping works via `--worktree <selector>` and `orca worktree list --repo name:BrowserCity`. **The payload sits under `.result.terminals` and the selector wants a Windows-form path**: `--worktree path:C:/Users/.../Create-game-brief` returns the terminals, while the same path as `/c/Users/...` returns `selector_not_found` with `ok:false` and **exit 0**. Both wrong readings produce an empty list rather than an error, so both look like "Crew is idle."
- **`${p//\\//}` substitutes nothing in this bash**, so a Windows-to-POSIX conversion written that way silently returns the path unchanged and every derived candidate is skipped — the resolver then falls through to PATH, which is the one thing the precheck environment does not have. `${p//'\'//}`, with the backslash quoted, works. Found by a resolver that reported success while finding nothing it had been pointed at.
- **Unquoted candidate expansion splits `C:/Program Files/...` into three words.** A resolver that globs must set `IFS=` to keep pathname expansion without field splitting, or it silently fails to find tools that are sitting where it looked.
- **`lastOutputAt` separates busy from idle; `tui-idle` does not.** Measured −34 ms against 33,585 ms. `terminal wait --for tui-idle` returned `timeout` for *both* an idle shell and a busy Claude TUI, so it is not used.
- `orca automations` supports `--precheck`, `--workspace-mode`, `--base-branch`, `--missed-run-grace-minutes`, `--timezone`, `--reuse-session`, and cron/RRULE triggers. **It has no `--agent` and no `--model`**, so a scheduled session cannot be started as one of the six roles and does not inherit that role's model or tool classes. The scheduled session is therefore a launcher whose only act is to run `claude --agent scotty` (§3), which is the sole way to apply a role definition. `orca orchestration worker-start` has both flags; automations do not. The precheck is stored with a `timeoutSeconds` of 60 by default — ours runs in about three — and `--timezone` defaults to the machine's, recorded as `Europe/Zurich`, which a fixed `*/12` interval never consults.
- **`BrowserCity Scotty` is registered and disabled**, id `1b946558`, every 12 minutes against the main checkout with `precheck.cmd` gating it. Registering it twice edits rather than duplicates. It has never fired: enabling it is Story 0.4's precondition, not this story's.
- **Scheduled fires do run the precheck, and a non-zero exit blocks dispatch.** Confirmed: a scheduled run with a failing precheck recorded `status: "skipped_precheck"` and spawned no agent.
- **`orca automations run <id>` bypasses the precheck.** A manual run is ungated and dispatches the agent immediately — confirmed by it spawning a Claude session with `skipReason: null` and no precheck side effects. Only *scheduled* fires are gated. Never use a manual run to test a gate, and never assume a manual run respects the budget.
- **`skipReason` is `null` even on a precheck skip.** The run record's `status` is the only field that distinguishes `dispatched` from `skipped_precheck`. `precheckResult` carries the precheck's exit code, duration, stdout and stderr, so a watchdog reads that; it never keys on `skipReason` — **and `status` alone is not enough either**: `dispatched` is written when Orca starts a session, not when it does anything, so a session that received no prompt records exactly what one that merged a PR records. The watchdog keys on evidence the team moved.
- A precheck's relative-path side effects did not land in the workspace directory. **Prechecks must use absolute paths** for anything they write.
- **The budget gate is proven end to end through a real scheduled precheck.** `PRECHECK-PROBE-4` recorded `status: "dispatched"` and the precheck itself wrote `RUN session=0.39 weekly=0.3` to the reason file — so the gate resolved both absolute-path binaries, reached the API, and returned 0 from inside Orca's own precheck shell. The failing and broken paths were verified separately (exit 1, and exit 2 with `GATE-BROKEN`). The entry point has since moved to `precheck.cmd`, which chains the classifier behind the gate, and both binaries are now found by derivation rather than by hardcoded path; that combination is re-proven when the automation of Story 0.3 is scheduled.
- `jq` 1.8.2 and `claude-rate-monitor` are installed globally and resolve on PATH **in a normal shell**, but **not** in the Orca precheck shell, whose environment predates their installation. This is why §8 uses absolute paths and does not rely on PATH.
- **Orca starts automation sessions with permissions bypassed.** The run output opens with Claude Code's `WARNING: Claude Code running in Bypass Permissions mode` confirmation, and the session then runs with `bypass permissions on`. Every agent this automation starts has no approval gate on any command it runs. That is a property of the harness rather than a choice made here, and it is the operating assumption the team design lives under: Crew's commands, and each lead's, execute unreviewed.
- **That confirmation dialog is what ate the prompt.** It is a startup interstitial — exactly the class of [#10666](https://github.com/stablyai/orca/issues/10666) and [#13805](https://github.com/stablyai/orca/issues/13805), where injected keystrokes go to the modal instead of the composer. Turning Remote Control off made delivery work; the plausible mechanism is that Remote Control's startup work (`/rc connecting…`, and the 400 when it fails) widens the window in which the modal is still up. **Whether that fix is durable is unknown.** There is no Remote Control key in `~/.claude/settings.json`, and the in-session hint reads *"To keep a session in this terminal only, run `/remote-control`"* — which sounds per-session. If it is, every fresh automation session re-enables it and the hazard returns.
- **The chained precheck is proven under a real scheduled fire.** Run 3 recorded `precheckResult.exitCode: 0` after 3,212 ms with the classifier's `t.1` JSON in `stdout` — so `precheck.cmd` resolved every derived binary and ran both stages in series inside Orca's own scheduled precheck shell, well inside the stored 60-second timeout.
- **No scheduled run has dispatched successfully yet.** That same run 3 went `dispatch_failed` despite its passing precheck, and every `completed` run is `trigger: manual` — which skips the precheck. Schedule fires → precheck gates → Scotty starts has never happened end to end.
- **A *manual* Orca automation run dispatches a Claude session and delivers no prompt to it.** Confirmed twice, once by Adrian independently. **Scheduled delivery is untested** — it needs an enabled automation, and every observation so far is of `automations run`. The two paths may differ, and the claim is scoped accordingly. The run record reads `status: dispatched`, `skipReason: null`, `error: null`; a live Claude session exists in the worktree; and the session, asked to describe its own context, reports a system prompt and **nothing else** — no automation prompt, no precheck output, no token the precheck had printed. It sits at an empty input forever. The session also shows `Remote Control disconnected — Session creation failed (server 400)`, which is the prime suspect: that channel is the plausible route for injecting a prompt into an interactive TUI, and it is failing. Remote Control works normally in sessions started by hand in another worktree on the same machine, so this is not an account-wide outage.

  **It is a known upstream family, not something this repository can fix.** Orca's issue tracker carries the same signature repeatedly — a delivery that reports success and injects nothing, or injects without submitting:

  - [#2439](https://github.com/stablyai/orca/issues/2439) (closed) is the closest: *"Automation run opens empty/disconnected terminal tab"*, `status: dispatched`, `outputSnapshot: null`, *"no agent banner, no prompt injected"* — for manual **and** scheduled runs.
  - [#13488](https://github.com/stablyai/orca/issues/13488) (closed) reproduces with Claude Code: the prompt is written into the PTY before the TUI can accept a submit, lands in the composer and is never sent, while the call returns `ok: true`. Ours is a step worse — the composer was empty and the session's own context held nothing — but the mechanism is the same race.
  - [#13439](https://github.com/stablyai/orca/issues/13439), [#10666](https://github.com/stablyai/orca/issues/10666) and [#13805](https://github.com/stablyai/orca/issues/13805) (all open) are the swallowing variants: text pasted while the agent is still loading, consumed by a trust prompt, or eaten by an update-available modal.

  **There is a known workaround if the prompt lands but is not submitted:** one empty keystroke starts it — `orca terminal send --terminal <handle> --text "" --enter`. It does not help if nothing was typed at all, and nothing inside the automation can perform it: the precheck runs before dispatch, and the stalled session is the only thing after it. If it comes to that, the watchdog of Story 0.4 is the only component positioned to notice a session holding an unsubmitted prompt and nudge it.

  **The docs do not describe the delivery mechanism at all.** `onorca.dev/docs/cli/automations` documents every flag and says nothing about how `--prompt` reaches the agent, what it requires, or how to diagnose it not arriving.

  **This blocks Story 0.3.** The automation is registered, correctly configured and correctly gated, and a scheduled fire would still produce an idle agent that never learned what to do. Until prompt delivery works, enabling it buys nothing.

  **It also changes what Story 0.4 must watch for.** The watchdog was specified against the *absence* of dispatch. This failure is the presence of one: every record green, a live session, and no work. "Last successful dispatch: 20 minutes ago" would have looked healthy all week. The watchdog therefore has to key on evidence that the team moved — a commit, a comment, a merged PR — and never on the run record alone, which cannot tell a working tick from this.
- **Not verified: whether a precheck's stdout reaches the session it starts.** It cannot be tested without a scheduled fire, and a manual `automations run` skips the precheck entirely, so there is no way to find out while the automation is disabled. Scotty is built for the pessimistic answer — he re-runs the classifier himself, which costs nothing and is fresher — so the answer does not change what he does. Confirm it on the first real fire.
- SpacetimeDB: local instance via `spacetime start` / `spacetime dev`; Maincloud is multi-database.

---

## 12. Settled

These were open questions during design. They are closed, and are recorded here so they are not silently reopened.

- **Orca auto-resume on boot is not depended upon.** Whether Orca relaunches sessions after a reboot does not matter, because Scotty reconciles state on every wake (§4) rather than assuming. The question is closed by design, not by test.
- **`claude --from-pr` is not used.** Session identity lives in the PR's structured comment (§4). One mechanism, already specified.
- **The decision log:** each lead records decisions in its own domain, and **Scotty audits weekly for contradiction** — he is the only role that reads across all four. Contradictions surface at the Friday review. This closes Epic 0 Story 0.10, which is otherwise made *worse* by four leads deciding asynchronously.
- **Repository layout:** one repository holding the SpacetimeDB module, the PixiJS client, and the agent harness. **Tim owns the layout within it.** Tooling that is not repo-specific is installed globally and never adds a manifest to the repo — `jq` and `claude-rate-monitor` are the precedent.
- **Epic 0 is rewritten in place, not superseded.** `gds-sprint-planning` builds `sprint-status.yaml` by parsing the epic files; a superseded Epic 0 would leave phantom stories in the tracker forever.
- **Cost per story is a measurement, not an unknown.** It is Epic 0's first deliverable. Every cadence number in this document — the 10–15 minute tick, single-threaded Crew, the sprint scope — is provisional until it lands. If it comes back far from expectation, the epic sequence is revisited before Derek and Tim spend a year enforcing it.
