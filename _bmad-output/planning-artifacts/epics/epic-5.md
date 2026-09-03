[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 5: Citizens

The city feels populated with one player connected. This epic answers the AI-density hypothesis, which the brief names as the project's real engineering risk - harder than multiplayer.

**Build order is L3 then L2 then a population**, which is the reverse of runtime dependency and is deliberate: one NPC walks convincingly, then it gets a day, then a city of them has a labour market. Story 5.4 is a falsification gate placed before anything depends on its answer.

**The rule that shapes everything here:** every citizen advances identically, at transitions only, via a scheduled table. **Nobody ticks.** Cost varies because bodies exist only where someone is looking, not because simulation runs at different fidelities. There is no variable-resolution subsystem to build.

**The failure this epic must not commit** is the one the architecture names as most likely and most damaging: a reducer that detects a condition and acts on it with no citizen in between. Every state change here has an author.

### Story 5.1: One NPC Walks

**Leads:** quentin, tim, artie

As a player,
I want to watch one person walk down a street and believe it,
So that everything built on top of this has a foundation worth building on.

**Acceptance Criteria:**

**Given** L3 runs client-side and drives steering, gait and micro pathing for instantiated bodies only
**When** an NPC is given a route and a departure and arrival time
**Then** it walks the route, arriving at the stated time, at a pace that reads as walking rather than as interpolation

**Given** micro pathing is tile-level within one street segment or room
**When** the NPC crosses a segment
**Then** it paths around static obstacles using the derived walkability the client already holds

**Given** L3 may never write to the ledger
**When** the NPC is simulated
**Then** no client-side micro state reaches the server
**And** on despawn, state snaps to the ledger rather than being merged into it

**Given** NPCs route rather than collide
**When** an NPC encounters a solid object
**Then** its path avoided the object rather than its body colliding with it
**And** no sub-tile collision is performed for any NPC, on either side

**Given** the player watches the NPC for a minute
**When** they follow it
**Then** it does not jitter, stall at corners, or arrive early and wait conspicuously

### Story 5.2: Avoidance and Flavour, Bounded to What Nobody Checks

**Leads:** quentin, derek, tim, artie

As a player,
I want people to step around each other and do small idle things,
So that a street reads as inhabited rather than as a set of moving markers.

**Acceptance Criteria:**

**Given** every client simulates L3 for the NPCs in its own bubble, with no ownership and no handoff
**When** two clients both observe the same region
**Then** both agree on gross position and current activity, because those derive from replicated L2 state

**Given** local avoidance is the one genuinely divergent element
**When** avoidance is implemented
**Then** it is scoped to a fixed tile region rather than to the viewer's bubble, so any two clients covering that region agree by construction

**Given** anything the client computes that must agree across clients is seeded from stable ids
**When** flavour behaviour is triggered
**Then** it is seeded from the NPC id and a tick bucket, never from local randomness
**And** a property test asserts two derivations from identical inputs match

**Given** the governing principle is that L2 defines what everyone must agree on and L3 defines what nobody checks
**When** a divergence is found
**Then** it is confirmed to be in the second category, or it is a defect

**Given** unseeded randomness silently voids the bargain that justified client-side simulation
**When** any randomness is introduced into L3
**Then** the review gate rejects it unless it is seeded from a stable id

### Story 5.3: Body Instantiation and Despawn

**Leads:** quentin, tim, artie

As a player,
I want people to walk into view rather than appear,
So that the seam between what is simulated and what is drawn is never visible.

**Acceptance Criteria:**

**Given** there is no simulation zone and only bodies have a zone
**When** a citizen is far from every player
**Then** it has no body and costs no client anything, while its L2 continues to advance normally

**Given** the body zone extends past the viewport with hysteresis on despawn
**When** the player walks toward a citizen's position
**Then** the citizen's body is instantiated before it is visible, and it walks into view
**And** leaving the area despawns it lazily rather than at the viewport edge

**Given** a citizen crossing a chunk boundary updates its chunk column
**When** it crosses
**Then** the update is a wake-up on a table that already exists, with no second presence table to maintain

**Given** each chunk crossing raises the L2 event rate
**When** chunk size is chosen
**Then** it is a named dial, and the trade is recorded: larger chunks mean fewer wake-ups but more citizens streamed than needed
**And** the resulting rate is fed to the benchmark in Story 5.18

**Given** appearance is five indices deterministic from citizen id
**When** a body is instantiated
**Then** it looks the same as the last time this or any client saw that citizen

### Story 5.4: Falsification Gate - The L3 Frame Budget

**Leads:** quentin, tim

As a developer,
I want to know whether client-side L3 actually fits in a frame,
So that the decision it rests on is overturned now rather than in Epic 11.

**Acceptance Criteria:**

**Given** client-side L3 was chosen on the explicit basis that ~200 agents cost well under 2 ms per frame, and that this was unverified
**When** ~200 NPCs are instantiated in one bubble
**Then** the per-frame cost of L3 is measured and reported

**Given** the principal risk was named as garbage-collection pressure rather than throughput
**When** the measurement runs
**Then** it reports allocation behaviour over a sustained session, not only average frame cost

**Given** the alternative was rejected because assigned ownership costs roughly 400 times more egress
**When** the budget is exceeded
**Then** the finding reopens D-L3 with that cost comparison in hand, rather than being absorbed by reducing agent counts
**And** no later epic proceeds on the assumption until the decision is settled

**Given** divergence may prove visible even within budget
**When** two clients observe the same busy region
**Then** any visible disagreement is recorded, and avoidance scoping is tightened if it is

### Story 5.5: Derived Positions

**Leads:** quentin, tim

As a developer,
I want a citizen's position to be a function of their state and the time,
So that transmitting it would be sending information the receiver already has.

**Acceptance Criteria:**

**Given** citizens carry no coordinates
**When** a citizen's state is stored
**Then** it is either at a node, or in transit along a route between a departure and an arrival time

**Given** position is derived rather than authored
**When** any client needs a far citizen's position at a given time
**Then** it computes it locally from state the client already holds
**And** no citizen position is transmitted

**Given** a citizen in transit
**When** its position is derived mid-route
**Then** it interpolates along the macro path, and every client computes the same answer

**Given** the distinction is authored versus derived rather than player versus NPC
**When** the schema is reviewed
**Then** player position lives in its own table because it exists nowhere else, and citizen position does not exist as a column at all

### Story 5.6: Region Queries

**Leads:** quentin, tim

As a developer,
I want to ask which citizens are in a place at a time,
So that populating a street is a lookup rather than a scan.

**Acceptance Criteria:**

**Given** populating a region is a query rather than a promotion
**When** a region is populated at a time
**Then** the query returns the citizens whose route segments or located activities intersect that region at that time

**Given** cost must scale with occupancy rather than with population
**When** the query runs
**Then** it is a range lookup over an index on macro edge and time interval, not a scan
**And** the cost is measured against a district-scale population to confirm it

**Given** everyone present must have a reason to be present
**When** a citizen is instantiated by this query
**Then** the causality inspector can state why it is there
**And** no body is ever created without such a reason

**Given** extras without ledger presence are prohibited as authored-by-proximity
**When** a street reads as too empty
**Then** the remedy considered is more citizens or higher local density, never unbacked bodies

### Story 5.7: Prefetch Along Intent

**Leads:** quentin, tim

As a player,
I want the place I am travelling to be ready when I arrive,
So that arriving somewhere is not a pause.

**Acceptance Criteria:**

**Given** subscriptions prefetch along intent rather than position
**When** the player boards transit with a known destination and arrival time
**Then** the destination region is subscribed during transit rather than on arrival

**Given** the subway is the canonical case
**When** the player travels underground
**Then** the destination street is warm before they climb the steps

**Given** prefetch lead distance is a simulation dial
**When** it is set
**Then** it is a balance parameter in a table rather than a compiled constant

### Story 5.8: The Alarm Clock

**Leads:** quentin, derek, tim

As a developer,
I want citizens advanced by the platform's own scheduler,
So that a citizen cannot silently stop living.

**Acceptance Criteria:**

**Given** scheduled tables fire one reducer invocation per due row and delete the row after firing
**When** a citizen reaches a transition
**Then** exactly one invocation advances it, and the next transition is scheduled within the same transaction that decided it

**Given** scheduling is transactional with the state change
**When** a transition's transaction aborts
**Then** neither the state change nor the schedule survives, and the citizen is not left unscheduled

**Given** the Alarm Clock was chosen over an interval sweep because it cannot desynchronise
**When** the mechanism is built
**Then** no citizen depends on a next-due column that could go stale
**And** the alternative remains reachable additively, since the scheduled table exists from day one

**Given** Story 1.3 measured actual scheduled-reducer drift
**When** transitions are scheduled
**Then** they operate within that measured drift
**And** if the drift makes arrival times visibly wrong, this is escalated rather than compensated for

**Given** load is spiky with city rhythms
**When** shift start times are assigned
**Then** they are staggered, which the city needs to look right anyway

### Story 5.9: The Calendar

**Leads:** quentin, derek, tim

As a player,
I want people to have somewhere they have to be,
So that rush hour happens because of obligations rather than because a scheduler said so.

**Acceptance Criteria:**

**Given** obligations are a calendar and are data rather than AI
**When** a citizen holds a job, a club fixture or a standing commitment
**Then** those occupy fixed blocks and are not scored against alternatives

**Given** a citizen's day mirrors the player's day budget exactly
**When** the calendar is populated
**Then** sleep and work form a skeleton and the remainder is discretionary
**And** the same structure serves citizen and player

**Given** an eight-hour shift is not a choice for the player
**When** a citizen's shift begins
**Then** it is not a choice for them either

### Story 5.10: Utility in the Gaps

**Leads:** quentin, derek, tim

As a player,
I want the cafe to have people in it because they chose to be there,
So that the city's aliveness survives the Truth Test.

**Acceptance Criteria:**

**Given** own-time is filled by utility scoring rather than by a coordinator
**When** a citizen reaches a discretionary decision point
**Then** it scores its options and acts, with no knowledge that anyone is watching

**Given** a coordinator starting citizens on leisure activities near a player would be authoring by proximity
**When** discretionary decisions are made
**Then** they are made in L2 with no access to player state whatsoever

**Given** the evaluator uses four or five bars plus habit
**When** bars are defined
**Then** they are money, rest, hunger, social and pursuit drive, and the count is kept small because every bar multiplies a tuning surface spanning dozens of professions

**Given** utility is a function of quality, distance in minutes and habit strength
**When** a citizen chooses where to eat
**Then** the local cafe tends to win on cost in minutes, and habit makes the choice stick
**And** no stored per-citizen taste exists, because dispersion comes from the function

**Given** a plan is a chain and chains reintroduce invalidation
**When** a decision is made
**Then** it has a one-step horizon, with no committed sequence and therefore no future to invalidate

**Given** a fallback action provides a utility floor
**When** every option scores at or near zero
**Then** the citizen goes home rather than stalling

**Given** scoring is pure and takes no table access
**When** it is tested
**Then** thousands of citizen-weeks run in CI with no database

### Story 5.11: Traits

**Leads:** quentin, derek, tim

As a player,
I want people to differ in how they behave rather than in what they are,
So that a favour, a stickler and a chancer emerge without being authored.

**Acceptance Criteria:**

**Given** every citizen has traits, not only deciders
**When** a citizen is created
**Then** it carries caution, ambition, diligence, sociability and frugality

**Given** traits are weights in the same evaluator that scores an evening and an inbox
**When** they are applied
**Then** no decider-specific decision machinery exists

**Given** diligence does double duty
**When** it is used
**Then** it drives both self-imposed standards - the lobby nobody asked you to clean - and a finance officer's thoroughness, from one number

### Story 5.12: Citizen Memory and Belief

**Leads:** quentin, derek, tim

As a player,
I want to watch people learn that the cafe is shut,
So that knowledge spreading is something I can see happen.

**Acceptance Criteria:**

**Given** a row exists only where a citizen's knowledge diverges from the public default
**When** a citizen knows nothing special about a place
**Then** no row exists and the public default is used

**Given** memory is keyed on the business rather than the location
**When** a business closes and a new tenant opens
**Then** the new tenant does not inherit stale knowledge

**Given** known state is written on surprise only
**When** a citizen walks to a cafe believing it open and finds it shut
**Then** they observe, a row is written, and they re-decide on the spot with that row in scope
**And** the failed option now scores zero for that citizen specifically

**Given** memory is self-cleaning
**When** reality returns to the default and the citizen observes it
**Then** the row is deleted, with no decay timer and no expiry sweep

**Given** knowledge needs a physical carrier and nothing is broadcast
**When** information should travel
**Then** it travels through a sign, a colleague at handover, or a council notice
**And** a property test asserts no memory row is written except by an observation or interaction at a defined location and time

**Given** the table is bounded by an LRU cap of roughly fifty places per citizen and a fan-out delete when a business dies
**When** either bound is reached
**Then** it applies without a background sweep
**And** forgetting is understood as design-correct, because it produces re-discovery

**Given** externally visible state is observed on passing rather than on entering
**When** a citizen walks past a shuttered shop
**Then** they learn it is shut without going in

**Given** knowledge diffusion is the design's hardest-to-instrument quality arriving as a side effect
**When** a shop closes unexpectedly
**Then** many citizens are seen arriving and turning away on the first day, and almost none by the tenth
**And** the whole curve is legible from a bench across the road

### Story 5.13: Routes as Belief

**Leads:** quentin, derek, tim

As a player,
I want somebody to walk into a closed road and turn around,
So that the city's friction is visible rather than administrative.

**Acceptance Criteria:**

**Given** a cached commute route is itself a belief
**When** a citizen mid-commute meets a newly blocked edge
**Then** they re-route on the spot and overwrite their cached route

**Given** a citizen computing a fresh route uses the patched graph
**When** they set off after the change
**Then** they never walk into the barrier at all

**Given** roadworks are publicly announced through barriers, diversion signs and council notices
**When** a fresh route legitimately knows about a closure
**Then** this is a different case from a burnt cafe, not an exception to the carrier law

**Given** there is no route invalidation machinery
**When** the graph is patched
**Then** no edge-to-routes index, fan-out invalidation or propagation exists anywhere
**And** citizen memory holds no distance and no nav entries

**Given** commute routes are cached on the citizen
**When** a job or a flat is assigned
**Then** the route is computed once and recomputed only on disturbance

### Story 5.14: A Citizen Has a Life

**Leads:** quentin, derek, tim

As a player,
I want the person behind the counter to have a home to go to,
So that the city is made of people rather than of posts.

**Acceptance Criteria:**

**Given** every citizen has a home, a job, a schedule and ends of their own
**When** the district is populated to roughly 5,000 citizens
**Then** each has a dwelling, most have an occupation, and all have a daily structure

**Given** citizens require stable preferences and habits rather than decoration
**When** a citizen chooses repeatedly
**Then** habit strength grows on repetition and makes their choices recognisable over time

**Given** recognisability depends on meeting the same person repeatedly
**When** a player uses the same cafe across several in-city days
**Then** the same barista is behind the counter, looking the same
**And** the geographic social graph emerges from schedules and routes rather than from a system built for it

**Given** occupation is visible through the outfit layer
**When** a player looks down a street
**Then** they can read its labour composition by sight

**Given** habit writes occur inside the transition transaction that was already firing
**When** habits update
**Then** they are extra row writes rather than extra commits

### Story 5.15: The Own-Time Catalogue

**Leads:** quentin, derek, tim

As a developer,
I want NPC own-time and player lateral pursuits to be one catalogue,
So that the cafe has people in it for the same reason the player goes there.

**Acceptance Criteria:**

**Given** NPC own-time and player pursuits are one system
**When** an activity is defined
**Then** it is available to both, with no separate NPC-only or player-only activity list

**Given** provisions on nav source nodes are what utility scoring queries
**When** a citizen wants food or company
**Then** it queries provisions over the routing graph rather than a bespoke index

**Given** Epic 12 will add three player pursuits
**When** it does
**Then** they enter this catalogue rather than beside it

### Story 5.16: The Labour Market

**Leads:** quentin, derek, tim

As a player,
I want unpopular jobs to pay better without anyone deciding they should,
So that the economy balances because people act rather than because it is balanced.

**Acceptance Criteria:**

**Given** there is no city-wide wage
**When** wages are represented
**Then** they are offered wages on job postings, set by individual employers
**And** no aggregate wage value exists anywhere in the schema

**Given** an unfilled post is a matter for its owner
**When** a post stays unfilled
**Then** the employer's response is to raise the offer, bounded by a revenue ceiling
**And** the rate of rise per in-city week of vacancy is a balance parameter in a table

**Given** self-balancing emerges from many employers each responding to local pressure
**When** a profession becomes unpopular
**Then** its wages rise across independent employers with no coordinating actor involved

**Given** citizens change jobs when their own utility crosses a threshold
**When** an employer raises an offer
**Then** nobody is told, and some citizens' job-change utility crosses at their next decision point
**And** no assignment or push occurs

**Given** the settled scale supports roughly 69 professions at five or more employers each
**When** professions are defined
**Then** that is the target rather than the GDD's district-scale figure of around 100
**And** each profession has enough employers for wage competition to be observable

### Story 5.17: The Causality Inspector

**Leads:** quentin, tim

As a developer,
I want to ask why a citizen is where they are,
So that the Truth Test is a tool rather than an aspiration.

**Acceptance Criteria:**

**Given** if you cannot answer why, something is wrong by definition
**When** the inspector is pointed at any citizen
**Then** it reports their L2 state, current route, current activity and last decision with its inputs

**Given** the inspector registers with Epic 1's overlay framework
**When** it is used
**Then** it is presented non-diegetically and gated behind the same production flag

**Given** every body must have a genuine reason to be present
**When** the inspector is pointed at any instantiated body
**Then** a reason is returned in every case
**And** a body with no answer is a defect, not a display gap

### Story 5.18: Benchmark - The Real L2 Event Rate

**Leads:** quentin, tim

As a developer,
I want the citizen event rate measured with discretionary time and chunk crossings included,
So that A2's cost model rests on a number rather than on a skeleton.

**Acceptance Criteria:**

**Given** the work-only skeleton figure was expected to rise by 50 to 80 per cent once discretionary time is included
**When** the rate is measured at the settled population of roughly 5,000 citizens
**Then** the actual transactions per second is reported, with discretionary decisions and chunk crossings both included

**Given** the launch budget assumes roughly 42 transactions per second and about 108 million calls per month
**When** the measurement is compared against it
**Then** the result either confirms the budget sits inside the hosting allowance or names the overage

**Given** cost per transaction was also outstanding
**When** this benchmark runs
**Then** it reports cost per reducer class through the pipeline built in Story 4.13

**Given** chunk size is the dial on crossing frequency
**When** the rate proves higher than budgeted
**Then** chunk size is tuned and the effect re-measured, rather than the population being quietly reduced

### Story 5.19: The Density Answer

**Leads:** quentin, derek, tim

As a player,
I want a street at rush hour to feel busy while I am the only person playing,
So that the city does not depend on an audience it does not have.

**Acceptance Criteria:**

**Given** aliveness is measured per screen rather than per database
**When** a single player stands on an arterial street at rush hour
**Then** roughly twenty people are visible, each with a reason to be there

**Given** density is local by design
**When** the same player walks to a residential street at three in the morning
**Then** it reads as quiet, and the quiet is legibly intentional rather than empty

**Given** the periphery must read as character rather than as budget
**When** the player reaches the district edge
**Then** sparseness there looks deliberate

**Given** the L3 budget was sized for roughly 200 agents in a body zone
**When** the busiest realistic scene is measured
**Then** the actual peak is reported against that headroom

**Given** this epic answers A9, which the addendum names as the real engineering risk
**When** the district is inhabited
**Then** an honest judgement is recorded on whether a solo player would describe this city as populated
**And** if they would not, the finding reopens density, population or local concentration rather than being absorbed as acceptable

---
