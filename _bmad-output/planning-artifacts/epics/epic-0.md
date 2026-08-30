[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 0: The Development Team

The agentic team defined by the team charter exists, dispatches itself, gates itself on budget, reviews its own work against the architecture and the vision, and shows Adrian something every Friday — without him in the loop.

**This epic is co-implemented by Adrian and the team.** It is the only epic in this document for which that is true. From Epic 1 onward the team is the sole developer, and Adrian is the stakeholder, product owner and player. Epic 0 exists because the team cannot build the machinery that dispatches the team, and because the GDD names agentic development capacity as a hard dependency — *"this is not an optimisation; it is what makes the scope possible for one person"* — and nothing else in the epic list builds it.

**The team charter (`team-charter.md`) is the specification for this epic.** Where a story here is thin, the charter section it names is the detail. Where the two disagree, the charter wins and the story is wrong.

**FRs covered: none, deliberately.** Epic 0 builds no game. It serves NFR27 (uniform, data-driven, agent-extensible by construction), NFR28 and NFR29 (the `sim/` purity boundary and the property tests that depend on it), NFR37 (every table declares a bound, checkable in review), NFR44 (logging discipline), and above all NFR18 — *every state change has an author* — which the architecture names as **the rule most likely to be broken and the most damaging**, enforceable only by review.

**Sizing.** Most of these stories are small. The risk is not that they are hard; it is that skipping them is invisible until Epic 5, by which point a hundred stories have been written under conventions nobody wrote down — and that the failures are silent. Four mechanisms tested during charter authoring failed in ways that produced no error at all: a gate that could not find `jq`, an idle probe that could not tell idle from busy, a manual run that ignored the budget entirely, and a run record that could not say why it skipped. Every story below that ends in a gate or a check must state how its own breakage becomes visible.

### Story 0.1: The Six Roles

**Leads:** quentin, tim

As Adrian,
I want the six roles of the charter to exist as durable, addressable agent configurations,
So that "wake Derek" means something specific and repeatable rather than a prompt someone improvises.

**Acceptance Criteria:**

**Given** `claude --agent <name>` starts a full top-level session as a named agent
**When** the roles are built
**Then** there is one definition file per role — `scotty`, `quentin`, `derek`, `tim`, `artie`, `crew` — and Scotty starts any of them by name

**Given** these roles belong to this project and to no other
**When** the definitions are placed
**Then** they live in the repository at `.claude/agents/`, **never** in the user-level `~/.claude/agents/`
**And** they are version-controlled, so a charter change and a role change land in the same commit, and a fresh clone has the whole team
**And** nothing about the team depends on state that exists only on one machine

**Given** each definition carries its own mandate, reading list and authority
**When** a role file is written
**Then** it states the mandate, the declared reading list, and the veto authority if the role has one
**And** Derek's power to reject a PR and Tim's hard stop on the irreversibles are stated in the role itself, not only in the charter

**Given** every role writes something — Scotty grooms the backlog, and the four leads write their directions onto the task at c.2, when no PR yet exists to comment on
**When** tools are assigned
**Then** all six roles hold edit tools, and each role file states its own write remit and what it must never touch
**And** Crew alone writes feature code and tests, with Quentin's prohibition on writing tests stated as the rule the approver role rests on rather than as a tooling limit

**Given** a boundary that looks enforced but is not is worse than one that is plainly advisory
**When** the tool declaration is relied upon
**Then** only tool *classes* and the per-role model are treated as enforced, both verified against a resolved session
**And** path scoping is not claimed anywhere, a path-scoped `tools:` entry and a frontmatter `permissions:` block having both been tested and found to restrict nothing silently

**Given** the model is declared per role and is the largest single lever on cost
**When** models are assigned
**Then** each role's choice is deliberate — Opus for the four reviewing leads (Quentin, Derek, Tim, Artie), Sonnet for Scotty and Crew
**And** the reasoning is recorded in the charter rather than in the role file, a role definition carrying only what the agent needs in order to act
**And** the assignment is revisited once cost per story has been measured, Crew's first

**Given** the charter is the specification and it will move
**When** it changes materially
**Then** updating the affected role definitions is part of that change, not a later cleanup

### Story 0.2: The Budget Gate

**Leads:** quentin, tim

As Adrian,
I want the team to stop at 85% of the 5-hour window and 80% of the weekly window,
So that there is always enough left for me to use Claude myself.

**Acceptance Criteria:**

**Given** `claude-rate-monitor --json` surfaces Anthropic's `anthropic-ratelimit-unified-*` headers
**When** the gate runs as the automation's precheck
**Then** it dispatches only when `overallStatus` is `allowed`, session utilisation is below 0.85, and weekly utilisation is below 0.80

**Given** the precheck runs under `cmd.exe` with an environment predating the tool installs
**When** the gate is written
**Then** it uses absolute paths to every binary and never relies on PATH
**And** the precheck value is a single path with no shell in it, because nested quoting through cmd mangles a pipeline

**Given** the scripts currently hardcode one worktree and one machine
**When** this story is done
**Then** both paths are derived rather than hardcoded, and the gate works from any worktree

**Given** the gate counts Adrian's own sessions as well as the team's
**When** he has been working
**Then** the team's available budget shrinks automatically, with nobody coordinating

**Given** exhaustion is a hard stop rather than an overage charge
**When** the window is spent
**Then** the gate skips quietly and the team resumes at the reset time the response reports

### Story 0.3: Scotty's Scheduled Session

**Leads:** quentin, tim

As Adrian,
I want one scheduled automation that owns dispatch and runs without me,
So that the project moves when the machine is on and I have not typed anything.

**Acceptance Criteria:**

**Given** Orca automations fire on a cron and survive the session that created them
**When** Scotty is scheduled
**Then** he runs every 10–15 minutes, gated by the budget gate of Story 0.2
**And** the schedule survives a reboot, picking up on the machine's next waking hours

**Given** Scotty is stateless by construction
**When** he wakes
**Then** he reconstructs everything from the PR, the sprint file and the epics, holding nothing between wakes
**And** a wake that depends on remembered context is a defect, because the next reboot will break it silently

**Given** the Orca runtime knows worktrees unrelated to this project
**When** Scotty queries state
**Then** every query is scoped — `orca worktree list --repo name:BrowserCity`, `orca terminal list --worktree path:<path>` — and an unscoped query is a defect
**And** all Orca JSON is parsed with `jq`, never with `grep`, which matches nothing against pretty-printed output and yields an empty handle that fails as a plausible-looking timeout

**Given** a manual `orca automations run` bypasses the precheck entirely and dispatches ungated
**When** the team is operated
**Then** manual runs are never used to test a gate and never used to start real work

### Story 0.4: Making the Gate's Own Failure Visible

**Leads:** quentin, tim

As Adrian,
I want a broken gate to look different from a spent budget,
So that the team stopping for a week does not look identical to the team behaving correctly.

**Acceptance Criteria:**

**Given** a non-zero precheck exit means *skip*, and a missing tool exits non-zero exactly as an exhausted budget does
**When** the gate runs
**Then** it distinguishes three outcomes: dispatch, budget-skip, and **gate-broken**
**And** each writes a timestamped reason to a durable absolute path

**Given** the run record's `skipReason` is null even on a precheck skip, so `status` alone can never say *why*
**When** a watchdog is built
**Then** it reads the gate's own reason file rather than inferring from the run record

**Given** Scotty only wakes when the gate passes, so he can never notice that the gate is broken
**When** the watchdog is built
**Then** it runs outside Scotty's loop
**And** a prolonged absence of successful dispatch reaches Adrian rather than waiting to be discovered on Friday

**Given** silence is the failure mode being defended against
**When** the watchdog itself stops
**Then** that is visible too

### Story 0.5: The Dispatch Cycle

**Leads:** quentin, tim

As Scotty,
I want the c.1–c.6 cycle expressed so a shell script can classify it,
So that an idle tick costs nothing and I wake already knowing what to do.

**Acceptance Criteria:**

**Given** the cycle has two phases — a direction phase on a task issue and a review phase on the PR — and nine branches across them
**When** the cycle is built
**Then** the branch is determined by `gh` and `orca` queries plus `jq`, with no agent reasoning required, and printed as JSON for Scotty to read rather than re-derive
**And** the classification runs in the precheck, so a do-nothing tick never starts an agent

**Given** a classifier that guesses is worse than one that stops
**When** the state is ambiguous — two open story PRs, a lead in scope with no comment, an unreadable verdict, Crew's state unknown
**Then** it exits broken and says which, rather than picking a plausible branch
**And** that exit is distinguishable from "nothing to do", as the budget gate's is

**Given** the distinction between "Crew is working" and "Crew has died" is the one that silently stalls the team
**When** Crew's state is checked
**Then** it is the age of `lastOutputAt` from `orca terminal list --json` that decides it
**And** `orca terminal wait --for tui-idle` is not used, having returned `timeout` for both an idle shell and a busy Claude TUI

**Given** the sprint review PR stays open across a weekend by design
**When** the cycle asks whether a PR is open
**Then** it filters on the `story` label, so the review PR never reads as "the story cycle is busy"

**Given** a story PR is approved by every lead in scope
**When** Scotty merges it
**Then** he cleans up the task's terminals and sessions in the same step

### Story 0.6: The PR Protocol

**Leads:** quentin, tim

As Adrian,
I want the PR to be the state machine, the memory and the work surface at once,
So that nothing about a task lives somewhere a reboot can erase.

**Acceptance Criteria:**

**Given** every agent acts as Adrian's GitHub identity, so native review states cannot tell Quentin from Derek
**When** a lead reports
**Then** it writes its verdict into its own marked comment, as `<!-- bc:verdict APPROVED -->` or `<!-- bc:verdict CHANGES -->`, those being the only two verdicts a lead can record
**And** the findings stay readable above that marker for Crew, and the human-readable text and the marker must agree

**Given** a parser that reads prose breaks on the first well-meant rewording
**When** the format is fixed
**Then** every machine-read field is an HTML comment — `bc:status`, `bc:story`, `bc:scope`, `bc:cycle`, `bc:lead:<role>`, `bc:verdict`, `bc:session`
**And** the format is set in stone in the charter and reproduced verbatim in each agent definition, so no role improvises it

**Given** several roles may act in one tick
**When** comments are written
**Then** there is exactly one writer per comment — Scotty owns the status comment, each lead owns its own — so there is no write race
**And** no role ever edits another's, and a verdict has exactly one home rather than being copied into the status comment

**Given** a PR is new precisely when Scotty has not set it up
**When** Crew opens one
**Then** the absence of the status comment is the signal, there is no other flag, and Crew does not create one
**And** Scotty creates the status comment plus one stub per lead in scope, a missing stub being a defect rather than a `PENDING`

**Given** a lead wakes cold and its comment is its only memory of its own earlier review
**When** it reviews again
**Then** it appends a new cycle section rather than replacing what it wrote
**And** it can tell first review from re-review by whether its comment carries cycle sections at all

**Given** several leads write their directions at the same time, before any PR exists
**When** the direction phase is built
**Then** it runs on a task issue with one comment per lead, never on a shared document such as the story file
**And** Crew is dispatched only when every lead in scope has marked its direction `READY`

**Given** a verdict that had to be reset would need a writer, and the only candidates are forbidden from writing that comment
**When** turn-taking is decided
**Then** it is decided by the commit each lead recorded reviewing against the PR's current head, and no verdict is ever reset
**And** "has not reviewed yet" is the absence of a recorded commit rather than a third verdict, so no state exists for anyone to reset
**And** an `APPROVED` left at an earlier commit does not permit a merge, so a push after approval re-opens review rather than sliding through

**Given** a role's session may be gone after a reboot
**When** a role first wakes for a task
**Then** it writes its own session ID into its own comment, correcting the row if it was recreated

**Given** PRs are labelled `story` or `sprint-review`
**When** the label is missing
**Then** the cycle treats it as a defect rather than guessing

### Story 0.7: Session Lifecycle and Cleanup

**Leads:** quentin, tim

As Adrian,
I want a task's agents to keep their context for that task and lose it afterwards,
So that Derek remembers the direction he gave without carrying 206 stories of history.

**Acceptance Criteria:**

**Given** Claude sessions persist to disk and `claude --resume <id>` is scriptable
**When** Scotty finds a role that should be live but is not
**Then** he creates the terminal and resumes that role by session ID
**And** whether Orca restored anything on boot is irrelevant, because reconciliation does not assume

**Given** resuming replays the whole transcript, so cost climbs with each review cycle
**When** the cycle count is tracked
**Then** the 8-cycle circuit breaker is understood as bounding context growth as well as deadlock

**Given** a task ends at merge
**When** Scotty merges
**Then** the task's terminals are stopped and its sessions dropped
**And** the team does not accumulate live PTYs and multi-megabyte transcripts across 206 stories

### Story 0.8: Project Context for Agents

**Leads:** quentin, derek, tim

As Adrian,
I want the unobvious rules written where every agent will read them,
So that nobody is re-explaining the same five constraints in every story.

**Acceptance Criteria:**

**Given** `gds-generate-project-context` produces `project-context.md` from the planning artifacts
**When** it is run against the GDD, the architecture and this epics document
**Then** the output captures the rules an LLM will otherwise get wrong, not a summary of the design

**Given** the architecture names specific failure modes agents are prone to
**When** the context file is written
**Then** it states plainly: `sim/` never reads a table; no reducer detects a condition and acts without a citizen in between; codes not enums; columns append-only with defaults; no server-side event bus; L3 never writes the ledger; client-derived values seeded from stable ids

**Given** the distinguishing error-handling rule is easy to get backwards
**When** the context file is written
**Then** it states that an empty till, a denied budget, a closed cafe and a stalled chain are **content, not errors**
**And** it says why: without the rule, agents will wrap the institutional friction that *is* the story in error handling and log-spam it

**Given** agents read a repository-level instruction file by convention
**When** the context is generated
**Then** both it and the team charter are reachable from that file rather than only from `_bmad-output/`

**Given** the design and architecture will move
**When** either changes materially
**Then** regenerating the context is part of that change, not a later cleanup

### Story 0.9: The Consistency Rules as a Review Gate

**Leads:** quentin, tim

As Tim,
I want the architecture's consistency rules turned into a checklist run against a diff,
So that the rules enforced only by review are actually reviewed.

**Acceptance Criteria:**

**Given** the architecture lists seven consistency rules and names their enforcement
**When** the review gate is built
**Then** each rule appears as a check, and each states whether it is machine-verifiable or requires judgement
**And** the machine-verifiable ones run in CI rather than costing a review

**Given** "no detection-without-an-author" is named as the most likely and most damaging violation
**When** a diff adds a reducer
**Then** the gate asks explicitly whether that reducer both detects a condition and changes the world with no citizen in between
**And** a diff that does so is rejected however well it performs

**Given** `sim/` purity is the only boundary in the project that can be violated silently
**When** a diff touches `sim/`
**Then** the gate checks for table access, and the `sim/` tests continue to run with no database

**Given** every table must declare a bound
**When** a diff adds a table
**Then** the gate requires a declared bound of a stated kind, and rejects the diff without one

**Given** Crew runs the gate on its own work before any lead sees it
**When** Crew opens a PR
**Then** the gate's result is part of the opening comment

### Story 0.10: Sprint Tracking and Epic Sharding

**Leads:** quentin, tim

As Scotty,
I want story status derived from this document rather than maintained beside it, and the document small enough to read,
So that the plan and the tracker cannot drift apart and no role burns its window loading the backlog.

**Acceptance Criteria:**

**Given** this document is 334 KB and roughly 85k tokens, and epics are independent by construction
**When** it is sharded
**Then** each epic becomes its own `epic*.md`, which is the plural form `gds-sprint-planning` already expects
**And** the global sections — requirements inventory, coverage map, NFR placement map, sequence — remain together as an index

**Given** `architecture.md` is *not* sharded, deliberately
**When** anyone proposes sharding it
**Then** the charter's reasoning applies: its own validation caught it accumulating contradictions, and sharding removes the reader who sees both halves

**Given** the checklist requires no items in the tracker that do not exist in the epic files, and none missing
**When** the tracker is generated
**Then** both directions round-trip cleanly, including the `0.N` series

**Given** stories are added or renumbered as later epics are written
**When** the tracker is regenerated
**Then** existing statuses survive and only the structure updates
**And** no status is ever downgraded, `done` being terminal

**Given** a status nobody writes is a status that drifts
**When** a story PR merges at c.1
**Then** Scotty marks that story `done` in the same step, and marks its epic `done` if it was the epic's last story
**And** he is the only role that writes the tracker, having merged the thing it records

### Story 0.11: Lead Scope as Data

**Leads:** quentin, tim

As Scotty,
I want each story tagged with the leads it needs,
So that deciding who to wake is a lookup rather than a judgement, and stays inside the free precheck.

**Acceptance Criteria:**

**Given** Quentin is in scope on every task and Derek, Tim and Artie conditionally
**When** the stories are tagged
**Then** every story in this document carries its lead scope explicitly

**Given** there are 206 existing stories written before this convention
**When** the tagging is done
**Then** it is a deliberate pass over all of them, not a convention applied only to new ones

**Given** waking a lead costs a context load
**When** scope is assigned
**Then** a lead is in scope because the story touches its domain, not to be safe

### Story 0.12: TDD and the Trace Matrix

**Leads:** quentin, tim

As Quentin,
I want tests written before implementation and traceable to the criteria they satisfy,
So that "tested" is a fact about coverage rather than a claim about effort.

**Acceptance Criteria:**

**Given** an approver who wrote the artifact cannot judge it
**When** a task starts
**Then** Quentin writes his test direction onto the task first — what must be covered at unit, integration and e2e level, and what a weak test would look like here
**And** Crew writes the tests before the implementation
**And** Quentin reviews the tests against that pre-registration rather than against what Crew produced

**Given** the acceptance criteria in this document are Given/When/Then
**When** the trace matrix is built
**Then** each test cites the specific criterion it satisfies, so weak coverage is visible rather than merely counted
**And** the matrix runs FR → acceptance criterion → test → build

**Given** a criterion may be genuinely untestable
**When** that happens
**Then** it is explicitly waived with a recorded reason, and a story with silently unmet criteria does not pass review

### Story 0.13: The Escalation Path

**Leads:** quentin

As Adrian,
I want exactly one thing to interrupt me,
So that autonomy is real and my attention is spent on the one question that is actually mine.

**Acceptance Criteria:**

**Given** the charter routes everything except the circuit breaker to the team
**When** the escalation path is built
**Then** the only mid-sprint interruption is 8 review cycles without approval
**And** Tim decides the irreversibles, Derek rules on the design laws, and a spike that overturns a decision is handled by the lead who owns that domain

**Given** a role wants to ask Adrian something that is not the circuit breaker
**When** it would otherwise escalate
**Then** it writes the question into the sprint review instead, and it is answered on Friday

**Given** the circuit breaker halts all work rather than parking the PR and moving on
**When** it trips
**Then** Scotty comments on the PR with an @-mention stating the deadlock, what was tried across the eight cycles, the options he sees, and his own recommendation
**And** the @-mention reaches Adrian with no session attached

**Given** decisions Adrian never sees are permanent under NFR33 and NFR34
**When** one is taken
**Then** it lands in the decision log where the Friday review can reach it

### Story 0.14: Agent Tooling

**Leads:** quentin, tim

As the team,
I want first-party access to the platforms we build on,
So that nobody is guessing at a stack that releases weekly.

**Acceptance Criteria:**

**Given** SpacetimeDB ships an official MCP server as a CLI subcommand and an official Claude plugin
**When** tooling is configured
**Then** both are installed and reachable from the agent sessions that need them
**And** the community alternatives are not used, since the first-party option supersedes them

**Given** the platform released five versions in one month during architecture, touching primitives this design depends on
**When** an agent needs current documentation
**Then** Context7 is available for lookup rather than the agent relying on training data

**Given** the client is PixiJS v8
**When** rendering work is dispatched
**Then** the official PixiJS agent skills are available to it

**Given** tooling drifts
**When** a version changes materially
**Then** the recorded tooling setup is updated as part of that change

### Story 0.15: The Local Development Environment

**Leads:** quentin, tim

As the team,
I want to develop and test against a local database,
So that the world Adrian plays is never our scratch space and dev costs nothing.

**Acceptance Criteria:**

**Given** `spacetime start` runs a local instance with its own data directory and `spacetime dev` hot-reloads
**When** the environment is set up
**Then** all development and testing runs locally, and resetting is deleting a directory

**Given** `sim/` is pure by design
**When** its property tests run
**Then** they need no database at all

**Given** the played build is a single Maincloud database
**When** anything is deployed there
**Then** it is only on merge to master, and never as part of development

**Given** the schema churns hard through the early epics and NFR33/NFR34 decisions are permanent
**When** the demo database is managed
**Then** it is disposable until the game is live for someone other than Adrian, and the never-reset world begins only at that point

### Story 0.16: Continuous Integration and the Definition of Done

**Leads:** quentin, tim

As the team,
I want a single command that says whether the project is still sound,
So that "done" is a fact rather than an opinion.

**Acceptance Criteria:**

**Given** `sim/` is pure and property tests run with no database
**When** CI runs
**Then** the property suite executes thousands of simulated citizen-weeks and fails on any violated invariant

**Given** the invariants recorded across the architecture are testable
**When** CI runs
**Then** it covers at minimum: no matter starves indefinitely, inventory is a superset after any absence, no owned item degrades during absence, budget never goes negative, `collider` is contained within `footprint`, and two derivations from identical seeded inputs match

**Given** determinism must survive dependency bumps
**When** a dependency changes
**Then** the determinism harness runs and fails loudly if generation output moved

**Given** GitHub Actions minutes cost money and Tim owns keeping that minimal
**When** CI is configured
**Then** it runs what is needed to protect the invariants and no more

**Given** a story claims to be done
**When** the definition of done is applied
**Then** it requires: acceptance criteria demonstrated, tests written before implementation, trace matrix updated, CI green, the consistency gate passed, and any new table's bound declared

### Story 0.17: Deploy, the Demo, and the Weekend

**Leads:** quentin, tim, artie

As Adrian,
I want a playable or visible build every Friday at 17:00 that holds still until I have seen it,
So that I can review real progress as a player rather than reading a status report.

**Acceptance Criteria:**

**Given** the client is static and the backend is Maincloud
**When** master is merged
**Then** GitHub Pages publishes the client to `/`, and that is the live game Adrian plays
**And** there is no separate demo path, staging copy, or versioned snapshot

**Given** Scotty knows the window reset times from the budget gate
**When** Friday approaches
**Then** he enters demo mode a few hours before 17:00, stops taking stories, and puts Crew on preparing the demo

**Given** the early epics produce nothing playable
**When** there is no playable increment
**Then** the demo is visual — a rendered city plan, a generated-block contact sheet, a determinism diff as two images — and never a wall of text
**And** this is Artie's from week one

**Given** Adrian reviews on the sprint review PR and closes it when done
**When** the PR is open
**Then** Crew idles until it closes, so nothing merges over the build he is playing
**And** the weekend idle is the freeze, so no deploy gate is built

**Given** Adrian's comments are the team's input for the next sprint
**When** he closes the review PR
**Then** Scotty converts them into new tasks or modifications to existing ones and prioritises them

### Story 0.18: The Running Decision Log

**Leads:** quentin, derek, tim

As the team,
I want implementation-time decisions recorded where the next agent will find them,
So that a choice made once is not silently remade differently.

**Acceptance Criteria:**

**Given** the architecture carries revisit triggers, escape-hatch conditions and deferred decisions
**When** one of them fires during implementation
**Then** the decision taken is recorded with its date, its trigger and its reasoning

**Given** four leads now decide asynchronously, which makes drift worse rather than better
**When** the log is built
**Then** each lead records decisions in its own domain
**And** Scotty audits weekly for contradiction, being the only role that reads across all four

**Given** several architectural decisions are explicitly provisional pending measurement
**When** a spike returns a number
**Then** the affected decision is updated in place or superseded, and the supersession is visible
**And** an agent reading the architecture cannot act on a position that measurement has overturned

**Given** the architecture's own validation found it had accumulated stale text as later decisions overturned earlier ones, such that an agent reading one section would have implemented a system that no longer existed
**When** a decision changes
**Then** every place stating the old position is updated in the same change

### Story 0.19: Cost Per Story

**Leads:** quentin, tim

As Adrian,
I want to know what one story actually costs,
So that every cadence number in the charter stops being a guess.

**Acceptance Criteria:**

**Given** the charter's tick interval, single-threaded Crew and sprint scope are all provisional
**When** the first stories complete
**Then** token and dollar cost is recorded per role per story

**Given** `claude_code.cost.usage` and `claude_code.token.usage` are available via OpenTelemetry
**When** instrumentation is set up
**Then** it is used rather than reimplementing pricing, and raw token sums are not treated as cost — cache reads dominate the count while costing far less

**Given** the number decides the schedule
**When** it is known
**Then** the achievable stories-per-week is stated plainly, and if 206 stories implies a timeline far from expectation, the epic sequence is revisited before the team spends a year enforcing it


---
