[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 8: Procedure and Props - the Burger Test, the hard case

Work that can be performed well or badly, with nothing scoring you - and an empty post that has to hold a player anyway.

**The second and harder falsification point.** Epic 7 tested a customer-facing job, which may satisfy for reasons that do not generalise. This epic tests the unsupervised one. **If a shift with nothing demanding attention is not satisfying, P4 has failed and the design's foundation is wrong.**

**This epic resolves A1** - the multi-step procedure interaction model - by prototyping. It is the most important unresolved control question in the design and is explicitly not resolvable on paper. P4 lives or dies on whether procedure feels like *handling* or like *clicking*.

**Freedom scales inversely with supervision**, so the emptiest post is designed as the most interesting one rather than the most neglected. The night guard's building is where this is settled.

**Watch alongside Epic 6's packing dials.** Grid inventory tedium and procedure feel will be experienced together, and the judgement about whether interaction has become tedious must be made across both rather than about either alone.

### Story 8.1: The Procedure Machine

**Leads:** quentin, derek, tim

As a developer,
I want procedures to be declared step sequences over object state,
So that every job in the city runs on one mechanism.

**Acceptance Criteria:**

**Given** a procedure is a state machine over steps
**When** a procedure is defined
**Then** it is data in `defs/` rather than code, and its steps name the objects they act on

**Given** routine jobs are a fixed sequence of steps over local state
**When** a decision arises within one
**Then** it is expressible as a procedure branch, such as no beans meaning order, or no change meaning refuse the note

**Given** the machine advances by intents from the input layer built in Story 1.9
**When** an intent arrives
**Then** the procedure decides what it means
**And** nothing in the input layer encodes procedure semantics

**Given** the same procedure must later be advanced by a player or by a citizen's scheduled transition
**When** the machine is built
**Then** the driver determines how a step is performed, never what the state is
**And** Epic 9 can swap drivers without altering this machine

**Given** procedure state is authoritative
**When** a step completes
**Then** the state change is recorded server-side with the performing citizen named

### Story 8.2: Props Carry State

**Leads:** quentin, derek, tim, artie

As a player,
I want to see that the stamp is dry by looking at the stamp,
So that the simulation is legible at the scale of my own hands.

**Acceptance Criteria:**

**Given** props carry state and that state is visible on the object
**When** a prop's state changes
**Then** the change is visible in the world
**And** it appears in no UI readout anywhere

**Given** the canonical cases
**When** they are built
**Then** the stamp runs dry, the till runs short of change, the bin lorry fills and the coffee grinder's hopper empties

**Given** a state-driven animated object exists
**When** its state changes
**Then** the animation follows, client-side and non-authoritative, seeded from the object id so all clients agree

**Given** an empty till or an empty hopper is content
**When** either occurs
**Then** it is not logged as an error, and a person in the world could observe it and shrug

**Given** prop state is server-authoritative
**When** two players observe the same prop
**Then** they see the same state

### Story 8.3: The Interaction Model

**Leads:** quentin, derek, tim, artie

As a player,
I want performing a procedure to feel like handling things,
So that the discretionary middle has something worth inhabiting.

**Acceptance Criteria:**

**Given** A1 is explicitly unresolved and is resolved here by prototyping
**When** this story runs
**Then** more than one interaction model is built and played, not one designed and accepted

**Given** procedure steps are performed on objects in sequence rather than selected from a menu
**When** the player performs grind, dose, tamp and pull
**Then** each is an action on a world object
**And** no step list, wheel or command menu appears

**Given** the question is whether procedure feels like handling or like clicking
**When** the prototypes are compared
**Then** the judgement is recorded in those terms, by playing rather than by reasoning

**Given** gamey affordances exist only where the experience genuinely breaks without them
**When** an abstraction is introduced
**Then** it is justified by a specific breakage rather than adopted as a default

**Given** the input layer is deliberately ignorant of procedure meaning
**When** the model is iterated
**Then** no change to the input layer is required
**And** if one is required, that is itself a finding about Story 1.9's boundary

**Given** this is the most important unresolved control question in the design
**When** no prototype feels like handling
**Then** the finding is escalated rather than the least-bad option being adopted

### Story 8.4: The Four-Beat Template

**Leads:** quentin, derek, tim

As a player,
I want a shift to have a shape,
So that arriving and leaving are events rather than state changes.

**Acceptance Criteria:**

**Given** every playable job runs the same four beats
**When** a shift is worked
**Then** it runs ritual open of roughly 30 in-city minutes, rhythmic duties of roughly 3 hours, a discretionary middle of roughly 4 hours, and a ritual close of roughly 30 minutes

**Given** the total shift is 8 in-city hours or 20 real minutes
**When** the beats are summed
**Then** they account for that block

**Given** the ritual open is arrive, change in, equip and take handover
**When** the player starts a shift
**Then** they relieve somebody, and that somebody is a citizen who was working before they arrived

**Given** the ritual close is a final round, handover, change out, return equipment and goodbye
**When** the shift ends
**Then** the player hands over to whoever is next
**And** handover is where information legitimately passes between people, per the carrier law

**Given** the template is reused across the city rather than authored per job
**When** a new job is defined
**Then** it supplies its own duties and inherits the four beats

### Story 8.5: The Discretionary Middle

**Leads:** quentin, derek, tim

As a player,
I want four in-city hours where nobody is watching,
So that there is somewhere in the day that is genuinely mine.

**Acceptance Criteria:**

**Given** the discretionary middle is roughly 4 in-city hours, or 10 real minutes
**When** the player reaches it
**Then** nothing requires their attention and no task is outstanding

**Given** the middle is where the game actually lives
**When** the player is in it
**Then** the available actions include the job's optional work, the verb vocabulary, and doing nothing

**Given** a shift where nobody is watching only means something if there is a thing you are supposed to be doing and could choose not to
**When** the middle begins
**Then** such a thing exists and is genuinely optional

**Given** voluntary time in the middle is the metric that tests P4
**When** the player is in it
**Then** the instrumentation defined in Story 4.14 emits how that time was spent
**And** skipping, idling and engaging are distinguishable

**Given** the middle is different every day because the player chooses what it is
**When** it is played repeatedly
**Then** nothing scripts or varies it on the player's behalf

### Story 8.6: Doing It Badly

**Leads:** quentin, derek, tim

As a player,
I want to be able to do my job badly,
So that doing it well is a choice I made.

**Acceptance Criteria:**

**Given** an action is worth simulating when it can be performed badly
**When** a procedure is built
**Then** it has at least one way to be performed badly, or it is abstracted instead

**Given** the canonical failures
**When** they occur
**Then** missed bins, spillage, wrong route order, short-changing, queues, a bad shot, burnt milk, a wrong order, running early, missed stops, harsh braking, skipped rounds and unlogged doors are each possible

**Given** failure changes the world rather than a score
**When** the player performs badly
**Then** the consequence is physical and visible
**And** nobody tells them they did badly

**Given** a badly performed procedure is not an error
**When** it happens
**Then** nothing is logged as a failure and no correction is offered

### Story 8.7: Nothing Scores You

**Leads:** quentin, derek

As a player,
I want cleaning the lobby to be worth doing even though nothing notices,
So that the good move and the efficient move can differ.

**Acceptance Criteria:**

**Given** no job has a score
**When** a shift ends
**Then** no rating, rank, percentage, streak or record exists anywhere

**Given** self-imposed standards are never required, tracked or rewarded
**When** the player cleans the lobby
**Then** the lobby is cleaner afterwards, and that is the entire consequence

**Given** the good move and the efficient move differ deliberately
**When** the player takes the courteous option
**Then** it costs them minutes and returns nothing measurable

**Given** the most satisfying actions are the socially optional ones
**When** the verb set is reviewed
**Then** the courtesy, the pause and the tidy-up are available and unrewarded

**Given** an agent may be tempted to add feedback where none is designed
**When** any progress indicator, completion state or acknowledgement is proposed
**Then** the review gate rejects it

### Story 8.8: The Security Guard

**Leads:** quentin, derek, tim

As a player,
I want a shift in an empty building with nobody watching,
So that the design's hardest claim is put to the test.

**Acceptance Criteria:**

**Given** the guard's job is rounds, door checks and log entries
**When** the player works the shift
**Then** each is a procedure performed on objects in the building

**Given** the post is one interior with no customers and no supervision
**When** the shift runs
**Then** nothing arrives to demand attention

**Given** freedom scales inversely with supervision, so the emptiest post is designed as the most interesting one
**When** the building is built
**Then** it is designed for a person with time rather than left sparse
**And** it rewards exploring, noticing and pottering without recording any of it

**Given** the job fails badly as skipped rounds and unlogged doors
**When** the player skips
**Then** the log shows what was and was not done, as a physical document rather than a score

**Given** this is where P4 is proven or disproven
**When** the shift is played
**Then** the judgement is taken seriously rather than absorbed

### Story 8.9: Toys Inside Jobs

**Leads:** quentin, derek, tim, artie

As a player,
I want solitaire on the guard's computer,
So that the empty post has something in it that is mine.

**Acceptance Criteria:**

**Given** toys exist inside jobs
**When** the player finds the guard's computer
**Then** solitaire is playable on it, in the world, as an object

**Given** a toy is not a reward and not a distraction from the job
**When** the player plays it
**Then** nothing tracks it, and the shift continues around them

**Given** the discretionary middle needs things to fill it that are not work
**When** toys are placed
**Then** they are found rather than offered

**Given** the canvas may draw transient object-bound views
**When** solitaire is displayed
**Then** it is drawn as such, bound to the computer, and closes when the player walks away

### Story 8.10: Presence Verbs

**Leads:** quentin, derek, tim

As a player,
I want sitting on a bench to be a thing I can do,
So that being somewhere is content rather than the gap between content.

**Acceptance Criteria:**

**Given** presence verbs are actions whose entire payload is being somewhere
**When** the player uses one
**Then** sit, order, wait and watch are available on the objects that afford them

**Given** idleness is designed content
**When** a bench exists
**Then** it can be sat on, and that is a feature

**Given** presence verbs cost minutes
**When** the player sits
**Then** time passes and that is the point

**Given** nothing rewards presence
**When** the player sits for a long time
**Then** nothing accrues and nothing acknowledges it

### Story 8.11: Civic Verbs

**Leads:** quentin, derek, tim

As a player,
I want to pick up somebody else's bottle,
So that I have a hand in the city's state rather than only reading it.

**Acceptance Criteria:**

**Given** civic verbs operate on single world objects
**When** the player encounters the affordance
**Then** bin the bottle, hold the door and give up the seat are available

**Given** binning a bottle removes it from the street
**When** the player does it
**Then** the object is gone and the street is that much less degraded

**Given** the litter loop itself is built in Epic 10
**When** that epic lands
**Then** this verb is already the player-side reversal of it, requiring no change here
**And** litter becomes reversible both by the sanitation chain and by any citizen who picks the bottle up

**Given** the commons is an interactive surface at the scale of a single object
**When** the player acts on it
**Then** the effect is one object, one street, and reversible

**Given** nothing rewards civic action
**When** the player bins the bottle
**Then** no acknowledgement of any kind occurs

### Story 8.12: Conversation as Loitering

**Leads:** quentin, derek, tim, artie

As a player,
I want talking to somebody to cost me minutes,
So that time spent with a person is the thing that was actually spent.

**Acceptance Criteria:**

**Given** conversation is done instead of transacting
**When** the player talks to a citizen
**Then** it is an alternative to the transaction rather than a wrapper around it

**Given** conversation is chosen sentence by sentence and costs minutes
**When** the player continues
**Then** each continuation costs in-city minutes from their own budget

**Given** there is no dialogue tree and no branching script
**When** the player converses
**Then** no branching structure exists, no outcome is unlocked and no information is dispensed
**And** what the conversation buys is that the time was spent

**Given** citizens remember individual people
**When** the player converses repeatedly with the same citizen
**Then** habit strength grows through the mechanism already built in Story 5.12
**And** no separate relationship system exists

**Given** this is P1 applied to social interaction
**When** the cost is assessed
**Then** it is denominated in the only currency the game has

### Story 8.13: Dignity Work

**Leads:** quentin, derek, tim

As a player,
I want my job to be made of small courtesies to specific people,
So that the work is not resource throughput with sprites on it.

**Acceptance Criteria:**

**Given** dignity work is the ramp, the ticket and the correct change
**When** a job is designed
**Then** it contains actions that are courtesies to a specific person rather than operations on a quantity

**Given** the person is specific
**When** the player performs the courtesy
**Then** it is for a citizen with an identity, an appearance and a reason to be there

**Given** these actions are what stop the playable jobs reading as chores
**When** a job is reviewed
**Then** it is assessed against this and reworked if it reads as throughput

**Given** nothing rewards the courtesy
**When** it is performed
**Then** it costs minutes and returns nothing measurable

### Story 8.14: Two Pairs of Hands

**Leads:** quentin, derek, tim

As a developer,
I want procedures able to require two people,
So that co-op emerges from simulation fidelity rather than from designed multiplayer content.

**Acceptance Criteria:**

**Given** some procedures may physically require two people
**When** the procedure machine is built
**Then** a step can declare that it needs two performers

**Given** the principle ships but the content does not
**When** v1 is scoped
**Then** at most a token case exists, and specific two-handed tasks are deferred

**Given** co-op must emerge from fidelity rather than from designed content
**When** a two-person step is encountered
**Then** it is because the thing genuinely needs two people, not because multiplayer content was wanted

**Given** the design laws permit only this kind of multiplayer content
**When** a two-person task is proposed
**Then** it is accepted only if the physical justification holds

### Story 8.15: The Hard Burger Test

**Leads:** quentin, derek, tim, artie

As the solo developer,
I want to know whether an empty post holds a player,
So that the design's foundation is tested rather than assumed for another six epics.

**Acceptance Criteria:**

**Given** the guard's shift has nothing demanding attention
**When** a person works it
**Then** their voluntary time in the discretionary middle is measured

**Given** the failure condition is players skipping or idling through the middle
**When** the measurement is taken
**Then** it distinguishes engaged time from idle time from skipped time
**And** the distinction is defined before the shift is played rather than after

**Given** P4 has failed if the middle does not hold a player
**When** the result is negative
**Then** the finding is recorded against A8 and the design's foundation is reopened
**And** epics 9 onward do not proceed on the assumption that it passed

**Given** Epic 7's read was on the softer case
**When** both reads are available
**Then** they are assessed together, and the harder one carries more weight

**Given** procedure feel and packing tedium are experienced together
**When** the judgement is made
**Then** it covers both, and the grid-size and packing-frequency dials from Epic 6 are tuned or the design is reconsidered

**Given** honest judgement is the deliverable
**When** the epic closes
**Then** a written read exists that states plainly whether this is worth doing when nobody is watching

---

### Story 8.16: Handover Teaches the Procedure

**Leads:** quentin, derek, tim

As a new player,
I want the person I am relieving to show me the job,
So that I can be bad at the work for real reasons rather than because nobody told me what it was.

**Acceptance Criteria:**

**Given** the design has no tutorial, no HUD, no objective markers and no quest log
**And** the core activity is a multi-step procedure with real failure modes
**When** a player performs a procedure they have not performed before
**Then** handover teaches it

**Given** ritual open is arrive, change in, equip and take handover
**When** the teaching happens
**Then** it is the outgoing worker walking the steps in the world on the actual props
**And** it is not a text panel, a tooltip sequence, a step list or a pinned checklist

**Given** knowledge travels through physical carriers
**When** the procedure is learned
**Then** it came from a person at handover, satisfying the carrier law rather than bending it

**Given** conversation costs minutes
**When** the player asks a colleague to go through it again
**Then** repetition is available and is priced like any other conversation

**Given** props carry their own state
**When** the player returns for a later shift
**Then** there is no reminder, no checklist and no re-teaching, because the props are the standing reminder

**Given** the Burger Test asks whether mundane work is intrinsically satisfying
**When** a player cannot work out how to do the work
**Then** that would fail the test for reasons unrelated to the hypothesis
**And** this story exists so Epic 7 and Epic 8 do not return a false negative on the assumption the whole design rests on

---
