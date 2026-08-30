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

Scotty wakes only when the budget gate passes (§8). `scripts/scotty-wake.sh` then classifies the branch before he wakes and prints it as JSON, so he arrives knowing what to do rather than rediscovering it. Classification uses `gh`, `orca` and `jq` only — no agent reasoning — and a do-nothing tick exits non-zero, so it never starts an agent. Like the budget gate it has three exits: work to do, nothing to do, and **broken**, the last written to `.scotty-wake-reason` and alarmed on rather than skipped quietly.

**On wake, Scotty establishes:** is Crew idle? Is there an open story PR? Whose turn is it? Is the PR approved by every lead in scope?

| | Condition | Action |
|---|---|---|
| **c.0** | Open PR with no status comment | Crew has just opened it. Post the status comment and one stub per lead in scope (§5). |
| **c.1** | PR approved by all leads in scope | Merge. Clean up the task's sessions and terminals. Fall through to c.2. |
| **c.2** | No open PR, Crew not working | Take the highest-priority task in the sprint. Wake the leads in scope to write their directions onto the story file. When they are done, wake Crew to work it. |
| **c.3** | No open PR, Crew already working | Nothing. Sleep. |
| **c.4** | Open PR, a lead's turn | Wake those lead sessions to review — approve, or leave comments. |
| **c.5** | Open PR, Crew's turn | Wake Crew to address the comments. |
| **c.6** | Open PR, ≥ 8 Crew↔review cycles, still not approved | **Circuit breaker.** Halt everything. Do not advance to the next story. Comment on the PR with an @-mention to Adrian explaining the deadlock and what he must arbitrate. |

**Directions are written onto the story file, not onto the PR.** At c.2 there is no PR yet — it does not exist until Crew opens one — so the story file is the only surface that exists, and it is the context package Crew reads. Each lead appends under `## Lead directions` in a section headed with its own name, and edits nobody else's.

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

**Idle vs working is `lastOutputAt`, not `tui-idle`.** `orca terminal wait --for tui-idle` was tested against both an idle shell and a busy Claude TUI and returned `timeout` for both — it cannot distinguish them and is not used. The working signal is the age of `lastOutputAt` from `terminal list --json`, which separates them cleanly (measured: −34 ms for a busy terminal against 33,585 ms for an idle one). Parse it with `jq`; a `grep` for `"handle":"` silently matches nothing against Orca's pretty-printed JSON and yields an empty handle that fails as a plausible-looking timeout.

**Resume is not free.** Resuming replays the transcript; session files here already run to megabytes. Cost climbs with each review cycle, which means the 8-cycle circuit breaker is also a context-growth breaker.

**Clean up on merge.** Stop the task's terminals and drop its sessions at c.1, or you accumulate live PTYs and multi-megabyte transcripts for all 206 stories.

---

## 5. The PR protocol

The PR is the work surface, the state machine, and the durable memory. GitHub Issues are deliberately left free as a separate feedback channel.

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
<!-- bc:session 019t73dBSXoTkhtHKX3hFYNP -->
```

Verdicts are exactly `PENDING`, `APPROVED` or `CHANGES`. A stub carries `PENDING` and no cycle sections, which is also how a lead knows, on waking cold, that it has not seen this PR before.

**A lead appends a cycle section rather than replacing what it wrote.** That comment is the lead's only memory of its own earlier review — it starts a fresh session each time and has nowhere else to look.

**A verdict has exactly one home.** Scotty does not copy verdicts into the status comment; two records of one fact drift.

**A stub must exist for every lead in scope.** The classifier treats a missing one as broken rather than as `PENDING`, because guessing there is how a lead silently stops being consulted.

### Why not GitHub's own review states

Every agent acts as Adrian's GitHub identity, so `gh pr view --json reviews` cannot tell Quentin from Derek. Separate machine accounts would fix it and cost money. Marked comments are the cheap correct answer.

---

## 6. Context discipline

The planning corpus is ~140k tokens. A role that loads "the plan" has spent its window before doing any work.

- **Each role reads only its declared list** (§2). The lists are narrow on purpose.
- **`epics.md` is sharded per epic.** At 334 KB / 6,808 lines nobody can load it, epics are independent by construction, and `gds-sprint-planning` parses `epic*.md` — plural. The sharded form is what the tooling expects.
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
--precheck "C:\...\Create-game-brief\scripts\quota-gate.cmd"
```

`quota-gate.cmd` hands off to `scripts/quota-gate.sh`. This shape is not stylistic — it is forced by three tested facts:

1. **The precheck runs under `cmd.exe`, not bash.** A failing precheck reported `'jq' is not recognized as an internal or external command` — a cmd error string. POSIX idioms and single-quoted `jq` filters do not survive there.
2. **`jq` and `claude-rate-monitor` are not on the precheck's PATH.** The Orca runtime inherits an environment predating their installation. The gate uses **absolute paths** to both binaries.
3. **Nested quoting through cmd is a trap.** Putting the pipeline inline mangles it. One `.cmd` path as the entire precheck value removes the problem.

The numbers are first-party: `claude-rate-monitor` surfaces Anthropic's own `anthropic-ratelimit-unified-*` response headers.

**The gate has three exits, and the third is the point:**

| Exit | Meaning | Response |
|---|---|---|
| `0` | Budget available | Dispatch |
| `1` | Budget exhausted | Skip. Normal, expected, quiet. |
| `2` | **The gate itself is broken** | Skip *and alarm.* Never quiet. |

Every run writes its reason to `BrowserCity/.quota-gate-reason` at an absolute path — `RUN`, `SKIP-BUDGET`, or `GATE-BROKEN <what>` with a UTC timestamp. All three paths verified 2026-08-30.

**It counts Adrian's own sessions too.** When he has spent an afternoon working, the team's budget shrinks automatically and it backs off with nobody coordinating. The 15% reserve enforces itself.

**100% is a hard stop, not an overage charge** — `overage-status: rejected`, `org_level_disabled`. The reserve is the margin between "Adrian can use Claude tonight" and "Adrian cannot."

### The fail-closed hazard

A non-zero exit means *skip*. So a missing tool, a parse failure, an auth error and "no budget" are indistinguishable — and because Scotty only wakes when the gate *passes*, **a broken gate means Scotty never wakes to notice the team has stopped.** The failure is discovered on Friday, when there is no demo.

Two requirements follow, and both are Epic 0 work:

1. The gate **distinguishes its exit reasons.** Budget-skip is normal and quiet. A tool error, unparseable JSON or auth failure writes a marked reason somewhere durable.
2. **Something outside the loop watches for silence.** `orca automations runs` records every fire, and its `status` field distinguishes `dispatched` from `skipped_precheck`. A watchdog — or a dashboard line reading "last successful dispatch: 14h ago" — closes the gap. It cannot be Scotty; Scotty is precisely the thing that is not running.

   **`skipReason` is null even on a precheck skip**, so the run record alone can never say *why* a skip happened. A long run of `skipped_precheck` is indistinguishable between "budget exhausted, working as designed" and "the gate has been broken since Tuesday" unless the gate writes its own reason to an absolute path. That is why requirement 1 exists, and it is not optional.

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
- `orca terminal list --json` exposes `handle`, `connected`, `orphaned`, `lastOutputAt`, `title`. Scoping works via `--worktree <selector>` and `orca worktree list --repo name:BrowserCity`.
- **`lastOutputAt` separates busy from idle; `tui-idle` does not.** Measured −34 ms against 33,585 ms. `terminal wait --for tui-idle` returned `timeout` for *both* an idle shell and a busy Claude TUI, so it is not used.
- `orca automations` supports `--precheck`, `--workspace-mode`, `--base-branch`, `--missed-run-grace-minutes`, `--timezone`, `--reuse-session`, and cron/RRULE triggers.
- **Scheduled fires do run the precheck, and a non-zero exit blocks dispatch.** Confirmed: a scheduled run with a failing precheck recorded `status: "skipped_precheck"` and spawned no agent.
- **`orca automations run <id>` bypasses the precheck.** A manual run is ungated and dispatches the agent immediately — confirmed by it spawning a Claude session with `skipReason: null` and no precheck side effects. Only *scheduled* fires are gated. Never use a manual run to test a gate, and never assume a manual run respects the budget.
- **`skipReason` is `null` even on a precheck skip.** The run record's `status` is the only field that distinguishes `dispatched` from `skipped_precheck`. Any watchdog keys on `status`, never on `skipReason`.
- A precheck's relative-path side effects did not land in the workspace directory. **Prechecks must use absolute paths** for anything they write.
- **The budget gate is proven end to end through a real scheduled precheck.** `PRECHECK-PROBE-4` recorded `status: "dispatched"` and the precheck itself wrote `RUN session=0.39 weekly=0.3` to the reason file — so `quota-gate.cmd` resolved both absolute-path binaries, reached the API, and returned 0 from inside Orca's own precheck shell. The failing and broken paths were verified separately (exit 1, and exit 2 with `GATE-BROKEN`).
- `jq` 1.8.2 and `claude-rate-monitor` are installed globally and resolve on PATH **in a normal shell**, but **not** in the Orca precheck shell, whose environment predates their installation. This is why §8 uses absolute paths and does not rely on PATH.
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
