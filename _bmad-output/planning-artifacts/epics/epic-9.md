[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 9: Reciprocal Occupancy

A player can leave and come back safely, and the night is populated because somebody is always awake in it.

**One system, not two.** D20 closed the validation gap that had the understudy and the night shift looking like separate mechanisms. A citizen body has exactly one driver, and the driver is swappable. This makes P2's "no mechanical seam between a player-held and an AI-held role" **structural rather than aspirational**: the seam cannot exist, because there is one slot with three possible occupants.

**A deliberate departure from the GDD, carried from the architecture.** The GDD makes *"the pile of post on the doormat"* the diegetic carrier for missed time and for financial state. The architecture rejected it as **an inbox in diegetic costume, and inconsistent with a competent understudy**, and rejected "records rendered as sentences" as a HUD in disguise. What replaces it: **the trace on return is the changed world.** Payslips and receipts still accrue as additive physical objects; they are simply not the mechanism by which the player reads their situation.

**Time scale, which makes absence severe.** At 24 in-city days per real day, a weekend offline is about 7 in-city weeks and a fortnight offline is about an in-city year.

### Story 9.1: Body Drivers

**Leads:** quentin, derek, tim

As a developer,
I want one occupancy slot with three possible occupants,
So that the seam P2 forbids cannot be written.

**Acceptance Criteria:**

**Given** a citizen body has exactly one driver
**When** the driver is inspected
**Then** it is the citizen's own L2, an understudy, or a player

**Given** the driver is swappable
**When** a player connects, disconnects, or takes a borrowed shift
**Then** the slot's occupant changes and nothing else does

**Given** an unheld institutional post is simply L2 continuing
**When** no player holds a role
**Then** its driver is the citizen's own L2, and no distinct backfill mechanism exists

**Given** the driver determines how a step is performed but never what the state is
**When** the same procedure is advanced by different drivers
**Then** the resulting state is identical

**Given** P2 forbids any mechanical seam
**When** the two paths are compared in code
**Then** they share the procedure machine from Story 8.1 rather than paralleling it

### Story 9.2: The Understudy's Mandate

**Leads:** quentin, derek, tim

As a player,
I want somebody sensible holding my life while I am gone,
So that leaving is safe rather than a decision.

**Acceptance Criteria:**

**Given** the understudy's mandate is conservative and fixed
**When** the player is disconnected
**Then** it goes to work, pays rent, eats, sleeps and banks the surplus

**Given** it never bets the paycheck, never quits the job and never takes a risk with the character's position
**When** an opportunity to do any of those arises
**Then** it declines

**Given** the mandate is not configurable
**When** any interface to adjust it is proposed
**Then** it is rejected, because a configurable understudy becomes an optimisation surface and turns absence into a strategy

**Given** the understudy earns the same wage the player would
**When** it works a shift
**Then** the pay is identical, never more and never less

**Given** it is the same machine with richer inputs and a conservative posture as a parameter
**When** it is built
**Then** it is not a second code path

### Story 9.3: Additive Only

**Leads:** quentin, derek, tim

As a player,
I want to come back to everything I left,
So that logging off costs me nothing I earned with my own time.

**Acceptance Criteria:**

**Given** the understudy adds and never subtracts, replaces, consumes, degrades or rearranges
**When** the player returns from any absence
**Then** nothing they owned is gone, changed, worn or moved

**Given** necessities are a cost line rather than inventory consumption
**When** the understudy eats for a week
**Then** it pays the weekly food cost and does not consume the player's things

**Given** wear during absence would be a P3 violation, penalising logging off in the currency of the player's own discretionary time
**When** any degradation-during-absence is proposed
**Then** it is rejected on that basis

**Given** at 24 in-city days per real day a weekend offline is about 7 in-city weeks
**When** the arithmetic of any accrual is considered
**Then** it is checked against that multiplier before being accepted

**Given** the property must hold for any absence duration
**When** the property test runs
**Then** it asserts the returning inventory is a superset of the departing one and no owned item's state has degraded
**And** it runs across randomised absence durations up to an in-city year

### Story 9.4: Reconciliation as a Record

**Leads:** quentin, derek, tim

As a developer,
I want an absent character reconciled as a ledger entry rather than simulated tick by tick,
So that absence costs nothing to run.

**Acceptance Criteria:**

**Given** the ledger is separate from the body
**When** a player is absent
**Then** their character advances as a record, and no body is instantiated on their behalf

**Given** the record settles on return
**When** the player reconnects
**Then** their financial and positional state is consistent with the elapsed time, resolved in one settlement

**Given** kinematic continuity means the player returns where cause and elapsed time put them
**When** they reconnect mid-shift or mid-commute
**Then** they are at the position that follows from what the understudy was doing

**Given** the same ledger-body separation applies to citizens
**When** the mechanism is built
**Then** it is the mechanism from Story 5.5 rather than a parallel one for players

### Story 9.5: The Trace Is the World

**Leads:** quentin, derek, tim

As a player,
I want to notice that things happened while I was gone by looking at the city,
So that returning is arriving somewhere rather than reading a report.

**Acceptance Criteria:**

**Given** the trace on return is the world rather than the player's possessions
**When** the player returns after a long absence
**Then** the street has changed, scaffolding has gone up, a chain has advanced

**Given** the pile of unread post is rejected as an inbox in diegetic costume
**When** the player returns
**Then** no inbox, queue or list of things that happened is presented

**Given** records rendered as sentences are rejected as a HUD in disguise
**When** the player learns what happened
**Then** they learn it from carriers rather than from sentences
**And** no narrated summary of the absence exists anywhere

**Given** this change is causal and Truth-Test clean rather than authored for the returning player
**When** the world's changes are inspected
**Then** each would have happened identically had the player never left or never returned

**Given** the GDD specifies the pile of post and the architecture overrode it
**When** this story is implemented
**Then** the override is recorded in the decision log from Story 0.10, so the contradiction is visible rather than silently resolved

### Story 9.6: Payslips and Receipts

**Leads:** quentin, derek, tim, artie

As a player,
I want the paperwork of my absence to be objects in my flat,
So that money has a physical form without becoming a readout.

**Acceptance Criteria:**

**Given** payslips, receipts and council letters survive as additive physical objects
**When** the understudy is paid or pays rent
**Then** the corresponding document appears in the player's flat as a world object

**Given** these documents are not the mechanism for reading financial state
**When** the player wants to know how they stand
**Then** the documents are evidence they may choose to read, not a summary presented to them

**Given** no HUD, balance or counter exists
**When** the player reads a payslip
**Then** they read a document in the world, examined as an object

**Given** documents accrete over a world that never resets
**When** they accumulate
**Then** the player can bin them, and a hard cap exists behind that as an engineering ceiling
**And** the table declares both bounds

### Story 9.7: The Night Shift

**Leads:** quentin, derek, tim

As a player,
I want to work somebody else's night when I am not ready to stop,
So that there is always a way to earn and the night is populated.

**Acceptance Criteria:**

**Given** staying up past the character's bedtime offers a few available night posts
**When** the player chooses to stay up
**Then** a small set of posts is offered and they pick one

**Given** the framing is non-diegetic and deliberately so
**When** the choice is presented
**Then** there is no shift board and no agency office
**And** the rationale is recorded: transforming into another character already breaks immersion, so diegetic ceremony would buy nothing

**Given** the shift is sized by how tired the character is
**When** the tiredness cap is applied
**Then** it bounds the shift's duration

**Given** the borrowed shift is always available and always pays
**When** the player has no money and no other route
**Then** this route exists and works
**And** it is the mechanism that makes the floor inhabitable

**Given** night posts are differentiated only by pay, duration and the tiredness cap
**When** they are offered
**Then** no social or progression reason to prefer one exists
**And** this is accepted: the night shift is a utility system, not a second life

### Story 9.8: The Borrowed Body Is Anonymous

**Leads:** quentin, derek, tim

As a player,
I want borrowed shifts to leave no trace on me,
So that the night shift stays a safety net rather than becoming a second career.

**Acceptance Criteria:**

**Given** borrowed shifts do not accumulate
**When** a player drives the same night bus fifty times
**Then** they do not become known as the night bus driver, to anyone

**Given** consequence lands on the NPC rather than the player
**When** the player performs badly in a borrowed body
**Then** the consequence attaches to that citizen

**Given** the borrowing licence is untested as an anti-griefing measure
**When** it ships
**Then** the risk is recorded as observable only with real players, and revisited post-launch

**Given** nothing carries forward
**When** the shift ends
**Then** the player returns to their own character with no gain other than the pay

### Story 9.9: AI Backfill

**Leads:** quentin, derek, tim

As a player,
I want every post in the city covered,
So that nothing deadlocks because somebody went to bed.

**Acceptance Criteria:**

**Given** AI backfill is simply that citizen's L2 continuing
**When** a role is unheld
**Then** it is worked by its citizen, with no separate backfill system

**Given** institutional decay from churn is prevented outright rather than damped
**When** players come and go
**Then** no service degrades because the server was quiet

**Given** decay always has an author
**When** a service does degrade
**Then** somebody chose it

**Given** the design may never assume a player is present for a chain to advance
**When** any chain is examined
**Then** it advances without player presence

### Story 9.10: Handover Mid-Procedure

**Leads:** quentin, derek, tim

As a player,
I want to be able to disconnect halfway through anything,
So that session boundaries are never world boundaries.

**Acceptance Criteria:**

**Given** the procedure state machine is the shared substrate
**When** the driver changes mid-procedure
**Then** the same procedure continues from its current state

**Given** L2 state is never suspended while a player drives
**When** the player performs a step
**Then** the citizen's L2 state advances by their action rather than pausing

**Given** handover snaps to the current step boundary
**When** a player drives a bus halfway between stops and disconnects
**Then** the handover resolves to the step boundary and resumes, because the route step already knows which stops remain
**And** this is chosen over resumable sub-step state as simpler and indistinguishable in practice

**Given** taking over cancels the citizen's pending scheduled transition and handing back re-creates it
**When** either happens
**Then** the scheduling change is transactional with the state change, so neither can be lost

**Given** handover works in both directions
**When** a player takes over a borrowed body mid-shift and later hands it back
**Then** both transitions behave identically

### Story 9.11: Discretionary Within the State Space

**Leads:** quentin, derek, tim

As a developer,
I want the player unable to take the bus into a field,
So that every borrowed shift is recoverable.

**Acceptance Criteria:**

**Given** the discretionary middle must be discretionary within the procedure's state space
**When** the player acts during a shift
**Then** every action they can take corresponds to a state the procedure can represent

**Given** a player doing what L2 cannot represent would create an unrecoverable state
**When** such an action is proposed
**Then** it is rejected, because L2 would have no state for a bus in a field

**Given** a player may perform a procedure well or badly but never outside it
**When** the boundary is tested
**Then** performing badly remains fully available
**And** the constraint restricts the state space, not the quality of performance

**Given** the seam P2 forbids would otherwise return as a bug
**When** any procedure is added
**Then** its state space is checked to cover everything a player can do within it

### Story 9.12: Nothing Punishes Logging Off

**Leads:** quentin, derek

As a player,
I want to close the tab without weighing it,
So that the game is a place I visit rather than a commitment I maintain.

**Acceptance Criteria:**

**Given** no system may punish logging off
**When** the systems are audited
**Then** none imposes a cost, decay, forfeit or missed opportunity attributable solely to absence

**Given** absence is technically the money-optimal play, because the understudy banks while a present player spends
**When** this is considered
**Then** it is accepted, because money is the least-valued axis and has no display
**And** the tension is recorded, to be re-examined if players report feeling punished for playing

**Given** everything that actually matters requires presence
**When** the axes are compared
**Then** lateral pursuits, institutional position and the people who know you all advance only when the player is there

**Given** the review gate carries this rule
**When** any feature would make absence costly
**Then** it is rejected

### Story 9.13: Social Continuity Across Long Absence

**Leads:** quentin, derek, tim

As a player,
I want the people I knew to still be there after a fortnight away,
So that recognisability survives the thing that most threatens it.

**Acceptance Criteria:**

**Given** a fortnight offline is roughly an in-city year
**When** a player returns after one
**Then** the citizens they had habits with are mostly still in place

**Given** recognisability and the geographic social graph both assume the player keeps meeting the same people
**When** labour churn is modelled
**Then** established citizens are sticky rather than churning uniformly
**And** this is recorded as more accurate than uniform churn, not as a concession

**Given** money and rent scale fine across long absence and the understudy holds the role
**When** the exposed surface is identified
**Then** it is the social graph specifically, and the mitigation is scoped to that

**Given** this was escalated from the architecture to design and left open
**When** this story is implemented
**Then** the decision taken is recorded in the decision log
**And** if stickiness proves insufficient, the finding returns to design rather than being patched here

### Story 9.14: Come Back After a Week

**Leads:** quentin, derek, tim, artie

As a player,
I want to return after a real week and find my life intact and slightly richer,
So that absence reads as safe rather than as abandonment.

**Acceptance Criteria:**

**Given** a player logs off for a real week, roughly 168 in-city days
**When** they return
**Then** their character has worked, paid rent, eaten and banked the surplus

**Given** money is the one axis that advances during absence
**When** they return
**Then** they have more in the bank than they left, and nothing else has advanced

**Given** the return must read as arriving somewhere
**When** they reconnect
**Then** they are where cause and elapsed time put them, the world has visibly moved, and no summary is presented

**Given** return rate after absence is one of the five gameplay metrics
**When** a player returns
**Then** the instrumentation from Story 4.14 emits it

**Given** the metric tests whether absence reads as safe or as abandonment
**When** the result is read
**Then** an honest judgement is recorded on which of the two it felt like

---
