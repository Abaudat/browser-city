[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 10: Institutions and the Reference Slice

The plastic-bottle loop runs end to end, and the player reads it on their commute.

**This is the vertical slice** that exercises institutions, emergence, jobs and physical consequence on a single street - the GDD's named mitigation against the project's headline scope risk.

**It builds the decision layer, not the plumbing.** The chain engine came from Story 6.5. What is new here is **matters**: a decider is not a different kind of agent, only a citizen whose work-time option set is matters instead of procedure steps, scored by the same utility evaluator built in Story 5.10. A decider's shift is entirely own-time.

**Nothing arrives by detection.** All four inbound fluxes have a person and a physical object. A threshold has no author; a driver noticing does. **Volume is the signal** - twelve complaints about one street *are* the aggregate, and no statistic is required.

**The watch item.** If residents habituate to a bad street, complaints dry up, severity decays, and the problem becomes permanent with nothing pursuing it - starving the signal rather than drifting, but violating the equilibrium law all the same.

### Story 10.1: Matters

**Leads:** quentin, derek, tim

As a developer,
I want an item of institutional business to be a first-class thing,
So that every municipal service in the city runs on one mechanism.

**Acceptance Criteria:**

**Given** a matter is scoped to a jurisdiction and to a subject
**When** one is created
**Then** its jurisdiction is a profession, and its subject is a place, a business, a department or the city

**Given** matters carry severity and age
**When** a matter sits unresolved
**Then** its age rises, and age is a scoring term, so nothing starves indefinitely

**Given** the matter table is bounded by complaint rate multiplied by expiry window rather than by cumulative history
**When** the bound is declared
**Then** it is game-mechanical, with expiry as the mechanism

**Given** matter kinds are an extensible set
**When** a new municipal service is added later
**Then** it is a row insert rather than a migration

### Story 10.2: Citizen-Filed Complaints

**Leads:** quentin, derek, tim

As a player,
I want somebody to walk past a full bin and decide to report it,
So that the city's problems are noticed by people rather than detected by code.

**Acceptance Criteria:**

**Given** a citizen passes a degraded thing on their route
**When** they observe it
**Then** they weigh the minutes filing would cost against how much it bothers them, using the evaluator from Story 5.10

**Given** filing has a physical carrier
**When** a citizen files
**Then** it is a complaint form, a phone call or a visit to the ward office, costing them in-city minutes

**Given** volume is the signal
**When** twelve citizens complain about one street
**Then** twelve matters exist and their volume is the aggregate
**And** no statistic is computed

**Given** complaint filing probability has a floor
**When** residents habituate to a persistently bad street
**Then** filing decays but never reaches zero
**And** the floor is a balance parameter, tunable on a running world

**Given** newcomers have not habituated
**When** in-migration brings new residents to a degraded area
**Then** they file at the undecayed rate, regenerating the signal

### Story 10.3: Worker Escalation

**Leads:** quentin, derek, tim

As a player,
I want the driver who tips at the landfill to be the one who notices it is nearly full,
So that the decision layer is fed by people doing their jobs.

**Acceptance Criteria:**

**Given** a routine job's procedure step detects an out-of-range condition
**When** the step runs
**Then** it branches to emit a report, and the citizen performing it is the report's author

**Given** the canonical case
**When** a driver tips at the landfill and the tip step reads refuse stock near capacity
**Then** the driver emits a report

**Given** this flux replaces a statistic crossing a threshold
**When** any monitoring of a quantity is proposed
**Then** it is rejected unless a worker performing a step is the one who notices
**And** the review gate carries this check

**Given** the escalation has a physical carrier
**When** the report is made
**Then** it is a note at the depot or a word at handover

**Given** being somewhere is how you find things out
**When** a routine job has no decisions of its own
**Then** it still feeds the decision layer, because its holder goes places

### Story 10.4: Inter-Institutional Requests and the Calendar

**Leads:** quentin, derek, tim

As a player,
I want a manager's request to land on somebody else's desk,
So that institutions depend on each other rather than acting alone.

**Acceptance Criteria:**

**Given** a chain needs a decision at a link
**When** it reaches that link
**Then** a matter appears in the responsible jurisdiction's inbox, carried by the paperwork itself

**Given** the canonical case
**When** a sanitation manager requests headcount
**Then** the request lands in the finance officer's inbox

**Given** scheduled obligations arrive on a calendar
**When** a budget review, renewal date or inspection date approaches
**Then** a matter appears with deadline semantics
**And** its severity climbs steeply toward the date

**Given** the calendar flux is what drains deferred matters
**When** budget season arrives
**Then** the accumulated deferrals are the demand signal it addresses

### Story 10.5: Decider Jobs

**Leads:** quentin, derek, tim

As a player,
I want a manager's day to be choosing which of eleven things is today's problem,
So that institutional work is judgement rather than a procedure.

**Acceptance Criteria:**

**Given** a decider is a citizen whose work-time option set is matters instead of procedure steps
**When** a decider works a shift
**Then** they score open matters in their jurisdiction and act on one

**Given** a decider's shift is entirely own-time
**When** their decisions are made
**Then** they use the same utility evaluator that scores a citizen's evening
**And** no decider-specific decision machinery exists

**Given** freedom scales inversely with supervision, so the least supervised post should be the most interesting
**When** decider posts are designed
**Then** they follow that rule rather than contradicting it

**Given** deciders answer questions by reading the world
**When** a decider diagnoses a problem
**Then** they count open matters in a ward, read an account balance, count unfilled postings, read a facility's stock against capacity, or count occupied against vacant dwellings
**And** no statistics table is required for any of these

**Given** a statistics table would be a materialised view rather than a data source
**When** one is proposed
**Then** it is justified by a measured performance problem or it is not built

### Story 10.6: Scoring a Matter

**Leads:** quentin, derek, tim

As a player,
I want the officer who knows me to take my complaint more seriously,
So that favouritism exists without anybody building a favour system.

**Acceptance Criteria:**

**Given** matter scoring weighs severity, age, cost against available budget, jurisdiction fit, disposition and who raised it
**When** a decider scores their inbox
**Then** all six terms contribute, and their weights are balance parameters in a table

**Given** the who-raised-it term reads the decider's own citizen memory
**When** a complaint comes from somebody the officer knows
**Then** it scores higher
**And** institutional favouritism emerges with no system built for it

**Given** there is nothing to farm
**When** a player attempts to exploit this
**Then** the only route is genuinely knowing the officer, through the habit mechanism from Story 5.12

**Given** age rises so nothing starves
**When** a low-severity matter sits long enough
**Then** it eventually outscores newer higher-severity ones

**Given** scoring is pure
**When** it is tested
**Then** it runs in CI with no database, and a property test asserts no matter starves indefinitely

### Story 10.7: Approve, Deny, Defer, Escalate

**Leads:** quentin, derek, tim

As a player,
I want a budget request to be genuinely deniable,
So that institutional friction is the story rather than an obstacle to it.

**Acceptance Criteria:**

**Given** all four actions are first-class
**When** a decider acts on a matter
**Then** approve, deny, defer and escalate are each available and each has real consequences

**Given** a denied budget request is institutional friction working as designed
**When** a request is denied
**Then** the chain stalls, and the consequence lands on citizens who never saw the paperwork

**Given** deferral is not a black hole
**When** a matter is deferred
**Then** it becomes part of the demand signal the calendar's budget review drains
**And** deferring is a real choice rather than a way to make a problem disappear

**Given** escalation moves a matter to a different jurisdiction
**When** a decider escalates
**Then** it appears in that jurisdiction's inbox rather than vanishing

### Story 10.8: Decision Records and Material Change

**Leads:** quentin, derek, tim

As a developer,
I want a denial to be remembered by its severity rather than by a timer,
So that repeat requests are governed by the world changing rather than by a cooldown.

**Acceptance Criteria:**

**Given** a decision record carries the action, a reason code and the severity at the time of the decision
**When** a decision is made
**Then** all three are stored

**Given** re-raising the same request for the same scope scores near zero
**When** a manager considers re-raising
**Then** it scores near zero unless current severity exceeds the severity at denial by a margin
**And** the margin is a balance parameter

**Given** this is material change rather than a timer
**When** the world does not worsen
**Then** the request is not re-raised, however much time passes

**Given** the record is structurally identical to citizen memory
**When** the world moves past it
**Then** it self-obsoletes in the same way

**Given** reason codes are an extensible set
**When** a new one is needed
**Then** it is a row insert

### Story 10.9: Responses to Denial

**Leads:** quentin, derek, tim

As a player,
I want an institution under budget pressure to visibly degrade into stopgaps,
So that austerity is something I can see rather than something I am told.

**Acceptance Criteria:**

**Given** four trait-weighted responses to denial exist
**When** a manager is denied
**Then** they wait, escalate, substitute a cheaper mechanism, or reroute permanently, according to their traits

**Given** waiting is gated on caution
**When** a cautious manager is denied
**Then** they accept and re-raise only on material worsening

**Given** escalation is gated on ambition
**When** an ambitious manager is denied
**Then** they re-raise with a different jurisdiction, over their head

**Given** substitution is gated on diagnostic breadth
**When** headcount is denied for lack of budget
**Then** the manager requests overtime instead
**And** the diagnostic offered several options at different costs, so denying the expensive one made the cheap one relatively more attractive

**Given** rerouting follows from a reason code of wrong jurisdiction
**When** that code is returned
**Then** the manager now knows this jurisdiction was never right, and future matters of that kind go elsewhere

**Given** stopgaps emerge from a cost comparison rather than being authored
**When** budget pressure is sustained
**Then** the institution visibly shifts to overtime instead of hiring, and patching instead of resurfacing

### Story 10.10: Burial

**Leads:** quentin, derek, tim

As a player,
I want some problems to simply stay unsolved,
So that the city is honest about what institutions do not fix.

**Acceptance Criteria:**

**Given** a condition fixed by another route buries its matters
**When** a different chain, a business tidying up, or a citizen binning the bottle resolves it
**Then** complaints stop, severity decays, and the matters expire

**Given** severity may plateau below the denial mark
**When** a street stays bad and nobody re-raises
**Then** the problem persists indefinitely
**And** this is the story rather than a defect

**Given** matters expire after a stated number of in-city weeks if unresolved and unrefreshed
**When** expiry runs
**Then** the matter is removed, satisfying the table's declared bound

**Given** the request and the evidence are different objects
**When** a request is denied
**Then** the denial closes the chain and does nothing to the complaints
**And** complaints keep arriving because the condition persists and people keep walking past it

**Given** the world regenerates the signal
**When** a manager needs to raise the issue again
**Then** they do not need to, because fresh complaints arrive on their own
**And** no cooldown timer exists anywhere in this mechanism

### Story 10.11: Institutional Chain Templates

**Leads:** quentin, derek, tim

As a player,
I want a decision in one building to become work in another,
So that the machine is visibly made of linked jobs.

**Acceptance Criteria:**

**Given** the chain engine exists from Story 6.5
**When** institutional chains are added
**Then** they are templates in `defs/` and the engine is not modified

**Given** the canonical chain runs investigation, approval, budget, procurement, logistics and labour
**When** a chain of this shape runs
**Then** each link is an occupation with its own work loop

**Given** each link is holdable by an AI citizen or a player with no mechanical seam
**When** v1 ships
**Then** chains run AI-staffed end to end, and players experience them from the receiving end
**And** the seam does not exist, so Epic 13 can put a player on a link without a rebuild

**Given** chains survive restarts, deploys and multi-day latency
**When** the module is republished mid-chain
**Then** the chain resumes correctly

**Given** friction is the narrative
**When** chains are observed over an in-city month
**Then** some stall, some are denied and some are expedited

### Story 10.12: The Sanitation Round

**Leads:** quentin, derek, tim, artie

As a player,
I want to drive the bin lorry,
So that I am the labour end of the loop rather than only its audience.

**Acceptance Criteria:**

**Given** the sanitation round is route order, lift, empty, log and depot return
**When** the player works the shift
**Then** each is a procedure on objects, following the four-beat template

**Given** the job requires a vehicle and a route
**When** it is built
**Then** it is the first job needing both, and the vehicle uses the grid from Story 6.14

**Given** the job fails badly as missed bins, spillage and wrong route order
**When** the player performs badly
**Then** those consequences are physical and visible on the street
**And** nothing scores them

**Given** the tip step reads landfill capacity
**When** the landfill approaches capacity
**Then** the step branches to emit a worker escalation, per Story 10.3

### Story 10.13: Bins and Litter

**Leads:** quentin, derek, tim, artie

As a player,
I want a bin that fills and litter that lies where it fell,
So that the city's state is carried by objects.

**Acceptance Criteria:**

**Given** bins carry state
**When** a bin fills
**Then** its state is visible on the bin itself

**Given** litter is a physical entity
**When** a bottle is dropped
**Then** it exists as an object at a place, with an author

**Given** litter accretes when sanitation fails
**When** the sanitation chain is under-resourced
**Then** litter accumulates through citizens dropping things, never by fiat

**Given** the litter table needs both bounds
**When** they are declared
**Then** the game-mechanical bound is the sanitation chain, and the engineering ceiling is a hard per-chunk cap so a failed chain cannot fill the database

**Given** litter is produced per consumption event
**When** the rate is set
**Then** it is a balance parameter tunable on a running world

### Story 10.14: Broken Windows

**Leads:** quentin, derek, tim, artie

As a player,
I want one dropped bottle to make the next one more likely,
So that a street's decline is something I can watch happen.

**Acceptance Criteria:**

**Given** litter licenses litter
**When** litter is present at a place
**Then** the probability of a citizen dropping something there rises

**Given** the loop is reversible
**When** the sanitation chain clears the street, or any citizen bins a bottle
**Then** the licensing effect falls with it

**Given** Story 8.11 already built the civic verb
**When** a player bins a bottle here
**Then** it works with no change to that story's code
**And** one person, one bottle, one street is a genuine reversal

**Given** the street degrades as litter accumulates
**When** degradation crosses a visible threshold
**Then** the change is legible from the street itself

**Given** the equilibrium law requires something actively pursuing the equilibrium
**When** litter accumulates
**Then** the sanitation chain is actively working to clear it
**And** a state where nothing pursues it is a defect

### Story 10.15: Response Time Is a Budget Line

**Leads:** quentin, derek, tim

As a player,
I want the ambulance to be slow because of a decision I never saw,
So that the city's indifference is legible rather than merely asserted.

**Acceptance Criteria:**

**Given** response time depends on a decision made in a building the player has never entered
**When** an emergency occurs
**Then** the response time follows from the responsible service's staffing and equipment, which follow from budget decisions

**Given** the causal chain must be inspectable
**When** the player asks why the response was slow
**Then** the answer traces back through staffing to a specific denied or approved matter
**And** the matter inspector can show it

**Given** the player is on the receiving end in v1
**When** they experience a slow response
**Then** they can read the cause in the world without being told it

### Story 10.16: Welfare and Shelters

**Leads:** quentin, derek, tim, artie

As a player,
I want the bottom of the city to be a place with its own life,
So that falling is arriving somewhere rather than losing.

**Acceptance Criteria:**

**Given** welfare offices and shelters are simulated institutions
**When** they exist in the district
**Then** they are staffed, have procedures, and run like any other institution

**Given** destitution is a place with its own routines and community
**When** a player reaches it
**Then** there is a life there rather than a failure screen

**Given** the mechanism that rescues a failing player is a career path for a thriving one
**When** these institutions are built
**Then** their roles are ordinary occupations, holdable by a player from Epic 13

**Given** Ruin By Process from Story 7.9 routes here
**When** the process runs its course
**Then** the player ends up inside these institutions rather than outside the game

### Story 10.17: The Matter and Chain Inspector

**Leads:** quentin, tim

As a developer,
I want to see an institution's inbox and the state of its chains,
So that a stalled city is diagnosable.

**Acceptance Criteria:**

**Given** the inspector registers with Epic 1's overlay framework
**When** it is opened on an institution
**Then** it shows the open matters in that jurisdiction with their scores and score components

**Given** chains span in-city days
**When** the inspector is opened on a chain
**Then** it shows the current step, the occupation responsible, and how long it has been there

**Given** a stalled chain is content rather than an error
**When** one is stalled
**Then** the inspector shows why without flagging it as a fault

**Given** the causality inspector from Story 5.17 answers why a citizen is somewhere
**When** that citizen is a decider acting on a matter
**Then** the two inspectors join up, so the matter is visible as the reason

### Story 10.18: The Plastic-Bottle Loop

**Leads:** quentin, derek, tim

As a player,
I want to watch a budget shortfall become a dirty street I walk down,
So that the whole thesis of the game is visible in one commute.

**Acceptance Criteria:**

**Given** the reference chain runs end to end
**When** it is exercised
**Then** a sanitation budget shortfall leaves a bin unemptied, which licenses a dropped bottle, which degrades the street, which triggers complaints, which opens a budget chain

**Given** every link has an author
**When** the loop is traced
**Then** each step names the citizen who performed it, with no step occurring by detection

**Given** the loop can be denied
**When** a finance officer denies the sanitation manager's headcount request
**Then** the trash stays
**And** the reason is a conversation in a building the complainant has never entered

**Given** the player reads it on the commute
**When** they walk to work over successive in-city days
**Then** they can observe the street's decline and, later, its recovery or its persistence
**And** at no point is any of it reported to them

**Given** unprompted noticing is the metric that matters most and is hardest to instrument
**When** the loop runs with a player present
**Then** the instrumentation defined in Story 4.14 captures what it can
**And** an honest judgement is recorded on whether a player noticed without being asked

**Given** this is the vertical slice that mitigates the project's headline scope risk
**When** the epic closes
**Then** a written assessment records whether the slice demonstrates the thesis

---
