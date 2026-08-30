[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 7: The Day Loop - the Burger Test, first read

A player can live one day: wake in a flat they can barely afford, walk to work, hold down a shift, get paid, and have rent take its bite.

**This is the project's first falsification point.** Everything after it assumes that mundane work is intrinsically satisfying without SS13's round timer and antagonists. A pre-foundation spike was considered and declined, so this is the earliest honest read available.

**Signal-quality caveat, carried from the GDD.** The shop till is the more engaging first job but the **softer** test - it may satisfy because of customers and feedback, in ways that do not generalise to an unsupervised post. The hard case is deliberately held one epic back rather than dropped. A positive read here is necessary but not sufficient.

**The till built here is pre-template.** Epic 8 generalises the four-beat shift structure across jobs; this epic builds one job that works, so that the loop can be played end to end and judged.

**All economic figures in this epic are seed values, not live parameters.** They are read once at world generation and tuning them on a running world has no effect. This must be visibly marked, because someone will eventually try to change starting rent on a live city and be confused.

### Story 7.1: The Starting Flat

**Leads:** quentin, derek, tim, artie

As a new player,
I want to wake up somewhere that is mine and barely affordable,
So that the opening fantasy is true from the first second.

**Acceptance Criteria:**

**Given** first-ever spawn is the player's flat interior
**When** a new player arrives
**Then** they are standing in a flat on the edge of the district

**Given** rent on the starting edge flat is 250 per week against a gross of 560
**When** the flat is assigned
**Then** it consumes 45 per cent of gross income
**And** the figure is a seed value, marked as such

**Given** the flat is generated rather than authored
**When** it is assigned
**Then** it comes from the district's dwelling stock under the generator's own rules

**Given** the player has possessions
**When** they look around the flat
**Then** what they own is visible in the world rather than listed anywhere

### Story 7.2: The Commute

**Leads:** quentin, derek, tim

As a player,
I want getting to work to cost me real minutes,
So that the distance between where I live and where I work is a thing I feel.

**Acceptance Criteria:**

**Given** the starting commute is 60 in-city minutes each way on foot
**When** the player walks from the edge flat to their workplace
**Then** the journey takes roughly 151 real seconds over roughly 333 cells at the settled walking speed

**Given** the day's budget allocates 2 in-city hours to commuting
**When** both legs are walked
**Then** they consume that budget and leave 6 in-city hours of own time

**Given** the commute has a floor of roughly 20 in-city minutes per leg
**When** any future transport improvement is applied
**Then** the commute never reaches zero
**And** the floor is enforced rather than emergent

**Given** the route is computed over the same macro graph the citizens route on
**When** the player's commute is derived
**Then** it uses edge costs denominated in minutes, so a transport change later acts on it directly

### Story 7.3: The Commute Is the Sensor

**Leads:** quentin, derek, tim

As a player,
I want to read the city's state on my way to work,
So that the hundredth run of the loop has content the first did not.

**Acceptance Criteria:**

**Given** emergence reaches the player on the way to and from work
**When** the city's state has changed
**Then** the change is visible on the route rather than reported anywhere

**Given** there is no feed, no notification and no summary
**When** something happens in the city
**Then** the player learns it by walking past it or not at all

**Given** the commute passes through the citizen population built in Epic 5
**When** the player walks at rush hour
**Then** the street reads as busy, and at three in the morning it reads as quiet

**Given** faster transport later changes what is read rather than whether
**When** the route changes
**Then** it passes different streets rather than fewer

### Story 7.4: The Convenience Shop Till

**Leads:** quentin, derek, tim, artie

As a player,
I want a job that consists of serving actual people,
So that there is something to hold down rather than a progress bar to watch.

**Acceptance Criteria:**

**Given** the shift is 8 in-city hours, or 20 real minutes
**When** the player works it
**Then** it occupies that block of the day

**Given** the job is serve, scan, bag, take payment, make change and restock
**When** a customer arrives
**Then** the player performs those steps on objects rather than selecting them from a menu

**Given** customers are citizens from Epic 5 who came because they wanted something
**When** they enter the shop
**Then** each has a genuine reason to be there, answerable by the causality inspector
**And** no customer is spawned because a player is present

**Given** physical cash is stock and the till holds denominations
**When** a customer pays with a large note and the till is short
**Then** the procedure branches, and refusing or finding another way are both available
**And** nothing is logged as an error

**Given** stock depletes as it is sold
**When** the shelves run low
**Then** restocking is a step the player performs, and a reorder is emitted when stock falls below threshold

**Given** no job has a score
**When** the shift ends
**Then** nothing rates the player's performance
**And** a shift done well and a shift done adequately differ in the world, not in a number

**Given** the job is one interior with no vehicle and no route
**When** it is built
**Then** it needs no transport or routing work beyond what already exists

### Story 7.5: Wages

**Leads:** quentin, derek, tim

As a player,
I want money to arrive as the minutes I spent,
So that pay is stored time rather than a score.

**Acceptance Criteria:**

**Given** the entry wage is 10 per in-city hour
**When** an 8-hour shift completes
**Then** the player is paid 80, and across seven days 560 gross

**Given** wages settle against a bank balance
**When** payment occurs
**Then** it moves bank money rather than physical cash

**Given** there is no HUD and no balance display
**When** the player is paid
**Then** they learn it from a payslip or the world, never from a counter

**Given** the wage is an offered wage on a job posting set by an employer
**When** it is read
**Then** it comes from that posting rather than from a city-wide constant

### Story 7.6: The Rent Metronome

**Leads:** quentin, derek, tim

As a player,
I want rent to take its bite whether or not I earned,
So that the pressure the whole time economy answers to is real.

**Acceptance Criteria:**

**Given** rent falls due every 7 in-city days, roughly every 7 real hours
**When** the due date arrives
**Then** rent is taken whether or not the player worked that week

**Given** rent is 250 per week against 560 gross
**When** it is taken
**Then** 45 per cent of gross has gone before anything else

**Given** the landlord is a person setting their own rent rather than a system applying a rate
**When** rent is charged
**Then** it traces to a tenancy with a named counterparty

**Given** debugging a weekly cycle at normal speed would cost seven real hours
**When** rent is tested
**Then** the time control from Story 4.10 is used, and jumping the clock resolves the rent correctly

### Story 7.7: Necessities

**Leads:** quentin, derek, tim

As a player,
I want eating to cost me something,
So that the surplus is what is genuinely left over.

**Acceptance Criteria:**

**Given** food and necessities cost roughly 90 per week
**When** the week's costs settle
**Then** the weekly surplus is approximately 220 against 560 gross

**Given** the surplus sets the first savings goal
**When** the player considers a bike at 450
**Then** it is roughly two weeks of surplus away

**Given** necessities are consumed by the player eating rather than deducted as a fee
**When** the player buys food
**Then** stock moves and cash or balance moves with it

### Story 7.8: Sleep

**Leads:** quentin, derek, tim

As a player,
I want the day to end,
So that the loop closes and tomorrow is a different day.

**Acceptance Criteria:**

**Given** sleep occupies 8 in-city hours, or 20 real minutes
**When** the player's character sleeps
**Then** the day advances and the loop begins again

**Given** the sleep branch offers logging off or staying up
**When** the player reaches bedtime in this epic
**Then** logging off is available and behaves safely
**And** the borrowed night shift is built in Epic 9 rather than here

**Given** the clock is detached from real time
**When** the player returns the next real day
**Then** they arrive at a different in-city hour

### Story 7.9: Ruin By Process

**Leads:** quentin, derek, tim

As a player,
I want falling behind to be a process rather than a failure,
So that pressure is legible and never sharp.

**Acceptance Criteria:**

**Given** missing rent does not trigger eviction
**When** the player misses a payment
**Then** a notice is issued, and the chain runs notice, escalation, judgment, enforcement

**Given** the chain runs on the engine built in Story 6.5
**When** it advances
**Then** it uses that engine rather than new machinery

**Given** each link is a job somebody holds
**When** a link advances
**Then** a named citizen performed it
**And** at v1 those links are AI-staffed, with player-holdable links deferred to Epic 13

**Given** consequences are slow, visible and interruptible
**When** the chain is running
**Then** the player can see where in the process they are, through documents in the world rather than through a status readout

**Given** the chain has in-city days of latency between links
**When** the player does nothing
**Then** it advances at its own pace rather than immediately

### Story 7.10: Every Link Is a Moment to Intervene

**Leads:** quentin, derek, tim

As a player,
I want each step of falling behind to be something I can act on,
So that the process is survivable by doing something rather than by waiting.

**Acceptance Criteria:**

**Given** each link is a moment at which the player can intervene, negotiate, pay or appeal
**When** the player reaches a link
**Then** all four are available where they make sense, and each changes what happens next

**Given** intervening involves a person holding a post
**When** the player negotiates or appeals
**Then** they do so with a citizen in a role, at a place, costing minutes

**Given** the borrowed night shift is always available and always pays
**When** the player needs money urgently
**Then** a route up exists, from Epic 9 onward

**Given** pressure must be legible and never sharp
**When** the player is in the process
**Then** at no point does an irreversible step occur without prior visible warning

### Story 7.11: Nothing Is Irreversible

**Leads:** quentin, derek

As a player,
I want to know that nothing here can destroy me,
So that the game is cozy in consequence while being harsh in arithmetic.

**Acceptance Criteria:**

**Given** there is no win condition, no loss condition and no death
**When** the player's situation is at its worst
**Then** no terminal state exists and no state prevents recovery

**Given** nothing is scored
**When** the player performs badly for a sustained period
**Then** no rating, rank or record of failure accumulates

**Given** destitution is a place with routines rather than a game-over
**When** the player reaches the bottom
**Then** they are somewhere with its own life, and the institutions that catch them are built in Epic 10

**Given** the maths is genuinely tight
**When** the arithmetic is checked
**Then** rent really is 45 per cent of gross and minutes really are scarce
**And** the harshness is in the arithmetic while the consequence stays survivable

### Story 7.12: Time Is the Only Scarcity

**Leads:** quentin, derek

As a developer,
I want to verify that nothing competes with minutes,
So that the pillar the whole economy rests on is checked rather than assumed.

**Acceptance Criteria:**

**Given** money is stored time and nothing else
**When** the economy is audited
**Then** every cost is expressible in minutes before it is expressible in currency

**Given** no system may introduce a resource that competes with time as the scarce thing
**When** any new resource is proposed
**Then** it either reduces to minutes or it is rejected
**And** the review gate carries this check

**Given** convenience purchases must be expressible as minutes-per-day returned
**When** one is defined
**Then** its return is stated in those terms

**Given** the day budget is 24 in-city hours across sleep, work, commute and own time
**When** the player's day is measured
**Then** it sums correctly and own time is the only genuinely discretionary block

### Story 7.13: The Burger Test, First Read

**Leads:** quentin, derek, tim, artie

As the solo developer,
I want an honest answer to whether this is fun,
So that six epics of assumption are tested rather than extended.

**Acceptance Criteria:**

**Given** the loop runs wake, commute, shift, paid, spend, rent, sleep
**When** a person plays it
**Then** they can complete a full day unaided and then choose to run it again

**Given** the metric is voluntary time in the shift rather than a survey
**When** the player works
**Then** the instrumentation defined in Story 4.14 emits it
**And** skipping or idling through the shift is measurable

**Given** the till is the softer test and may satisfy for reasons that do not generalise
**When** the read is recorded
**Then** it states explicitly what it does and does not tell us about an unsupervised post

**Given** everything after this epic assumes the answer is yes
**When** the answer is not clearly yes
**Then** the finding is recorded against A8 and Epic 8 is treated as the deciding test rather than as a continuation
**And** if both reads are negative, the design's foundation is reopened rather than the epics continuing

**Given** honest judgement is the deliverable
**When** the epic closes
**Then** a written read exists, not a passing test

---

### Story 7.14: The Opening Minutes

**Leads:** quentin, derek, tim, artie

As a new player,
I want my first session to make sense without being explained,
So that I learn the city by living in it rather than by being taught about it.

**Acceptance Criteria:**

**Given** first-ever spawn is the player's own flat interior
**When** the session begins
**Then** it is the loop's opening beat, and it is also the cheapest screen to boot at roughly 420 rows against a street's 28,000

**Given** the street streams behind the door
**When** the player looks for something to do
**Then** going outside is the first available thing and needs no prompting

**Given** the commute is 60 in-city minutes on foot
**When** the player walks it
**Then** the game has taught its central arithmetic by charging it, before anything explains it

**Given** the till shift at this epic is worked without the four-beat procedure machine, which arrives in Epic 8
**When** the player takes their first shift
**Then** the opening sequence is complete without it
**And** handover as the teaching moment arrives with that machine rather than being owed by this story

**Given** rent takes its bite whether or not the player understood any of this
**When** the first week closes
**Then** the metronome has started, which is the design's honest opening statement

**Given** the design ships no authored content
**When** these beats are implemented
**Then** each is a system already scheduled elsewhere, ordered for a new player
**And** nothing here is a script, a cutscene, a quest or a tutorial mode

---
