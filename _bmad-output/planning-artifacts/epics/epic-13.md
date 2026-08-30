[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 13: Careers

A player can spend their evenings qualifying for a post, wait for it to open, take it, and make decisions in it that outlast them.

**This closes the A3 gap**, which the GDD accepted as a known deferral: at launch, players could observe institutional chains but not staff one, so P2's most distinctive half shipped unplayable. The architecture found this **far cheaper to close than the GDD assumed** - a decider is not a different kind of agent, only a citizen whose work-time option set is matters instead of procedure steps. Epic 10 already built the inbox, the scoring, the four actions and the chain templates. Putting a player in that slot is an addition, not a rebuild.

**The central choice of the game lives here.** Roughly 15 real minutes of daily own time are contested between becoming someone the city needs and having a life. That contest recurs every day rather than being made once in a menu.

**The sensor migrates.** Early game the player reads the city by walking through it. Late game they read it through the paperwork that crosses their desk. This is the answer to how the game avoids going quiet between early lateral pursuit and late institutional position: the thing that shows you the city changes hands rather than switching off.

**Accepted trade, stated plainly.** Dependency is carried by decisions, not by presence, so **nobody is literally waiting on you**. This fully protects P3 and P2, and it deliberately weakens the felt fantasy of being missed. The alternative - a degraded AI backfill - was considered and rejected because it would make players and AI mechanically distinguishable.

### Story 13.1: Qualification

**Leads:** quentin, derek, tim

As a player,
I want to spend my evenings becoming qualified for something,
So that advancement costs me the only thing that is scarce.

**Acceptance Criteria:**

**Given** qualification is a licence, certificate or course for a role
**When** the player pursues one
**Then** it is taken out of their own time, in in-city minutes

**Given** advancement is bought with time rather than with skill points
**When** the player studies
**Then** the minutes come from the same block their pursuits compete for

**Given** qualification costs minutes and never money alone
**When** a wealthy player attempts to shortcut it
**Then** they cannot, because a rich player cannot buy a career
**And** any fee attached is incidental rather than sufficient

**Given** evening classes happen at a place at a time
**When** the player attends
**Then** they travel there, it occupies a fixed in-city hour, and missing it means missing it

**Given** qualification is always available to work on
**When** the player has no vacancy to apply for
**Then** there is still something to progress
**And** this is one of the three mitigations against the two-gate wall

### Story 13.2: Vacancy

**Leads:** quentin, derek, tim

As a player,
I want the post I want to be occupied by somebody,
So that getting it means somebody left rather than a slot unlocking.

**Acceptance Criteria:**

**Given** a vacancy is an actual open post in an actual institution
**When** a post is vacant
**Then** it is vacant because its holder left, retired, moved or died

**Given** the city has roughly 344 workplaces and roughly 69 professions
**When** vacancies are counted
**Then** they arise at a rate consistent with real citizen churn rather than being generated for the player

**Given** an unfilled post is a matter in its owner's inbox
**When** it stays open
**Then** the employer responds through the mechanisms built in Story 5.16, including raising the offer

**Given** the player may be qualified and still blocked on timing
**When** this happens
**Then** it is the designed two-gate structure rather than a defect
**And** the night shift and lateral pursuits fill the interval

**Given** city growth opens new posts as the active player population rises
**When** more players arrive
**Then** vacancy pressure eases exactly when player pressure increases
**And** the mechanism arrives in Epic 14

### Story 13.3: Application and Hiring

**Leads:** quentin, derek, tim

As a player,
I want to apply and be chosen by somebody,
So that getting the job is a decision another person made.

**Acceptance Criteria:**

**Given** a vacancy requires an application
**When** the player applies
**Then** the application is a matter in the hiring decider's inbox

**Given** the decider scores it like any other matter
**When** they act
**Then** they use the scoring from Story 10.6, including the who-raised-it term reading their own citizen memory

**Given** knowing the hiring manager helps
**When** the player has a habit with them
**Then** their application scores higher
**And** the only route to that is genuinely knowing them

**Given** an application can be denied or left in the tray
**When** either happens
**Then** it is content rather than a failure, and the player may apply elsewhere or again on material change

**Given** citizens apply for the same posts
**When** a vacancy opens
**Then** the player competes with them, and the same scoring decides

### Story 13.4: Career Carriers

**Leads:** quentin, derek, tim, artie

As a player,
I want my qualifications to hang on my wall,
So that who I have become is furniture rather than a number.

**Acceptance Criteria:**

**Given** progression carriers are diegetic
**When** the player qualifies
**Then** the certificate is on their wall and the licence is in their wallet, as objects

**Given** holding a post has its own carriers
**When** the player is hired
**Then** their name is on a roster and they are issued a set of keys

**Given** the keys are the ones others wait on
**When** the player holds a post with access
**Then** the keys open what the post opens, physically

**Given** no career progress display exists
**When** the player wants to know where they stand
**Then** they look at their wall, their wallet, their keyring and the roster
**And** no level, rank, title bar or progression indicator exists anywhere

**Given** the outfit layer is role-driven
**When** the player takes a post
**Then** their appearance reflects it, and others can read their occupation by looking

### Story 13.5: Job Access Tiers

**Leads:** quentin, derek, tim

As the solo developer,
I want the job count to be a dial,
So that the project's primary scope valve is usable rather than theoretical.

**Acceptance Criteria:**

**Given** job access tiers are the project's primary scope valve
**When** they are implemented
**Then** which roles are player-holdable is configuration rather than code

**Given** adding a player-holdable role should be an addition rather than a rebuild
**When** a new role is opened to players
**Then** it requires a profession definition and a tier assignment, and nothing else

**Given** every role already has an AI holder
**When** a role is not player-holdable
**Then** it still runs, held by its citizen
**And** opening it later changes nothing about how it works

**Given** the valve should be used deliberately
**When** scope pressure arises
**Then** the tier configuration is the named place to relieve it

### Story 13.6: The First Player-Holdable Decision Link

**Leads:** quentin, derek, tim

As a player,
I want to be the person who approves or denies the thing,
So that I occupy the machine rather than only observing it.

**Acceptance Criteria:**

**Given** a decider is a citizen whose work-time option set is matters
**When** a player takes a decider post
**Then** their shift presents the open matters in their jurisdiction, scored, and they act on them

**Given** the driver slot is the same slot
**When** a player holds a decider post
**Then** approve, deny, defer and escalate behave identically to when a citizen held it
**And** no mechanical seam exists between the two

**Given** the first candidate is the council permits clerk or a development-chain role
**When** the first link is opened
**Then** it is one of those, chosen for being a genuine link in a chain the player has already watched from the receiving end

**Given** the player's decisions have consequences that land on citizens who never saw the paperwork
**When** the player denies a request
**Then** the condition persists, complaints keep arriving, and somebody's street stays bad

**Given** the player may leave the post
**When** they do
**Then** a citizen takes it and works it exactly as well
**And** nothing degrades because a player stopped holding it

**Given** the discretionary middle must be discretionary within the procedure's state space
**When** a player acts as a decider
**Then** every action available corresponds to a state the system can represent

### Story 13.7: Positional Consequence

**Leads:** quentin, derek, tim

As a player,
I want the decisions I made to outlast my presence,
So that I am load-bearing through consequence rather than through attendance.

**Acceptance Criteria:**

**Given** dependency is carried by decisions rather than by presence
**When** the player logs off after approving a budget
**Then** the approval persists and the chain it started continues

**Given** the player's absence changes nothing about how the post is worked
**When** they are away
**Then** an AI holds it exactly as well, because P2 forbids any mechanical seam

**Given** what persists is the choices made while present
**When** the player returns
**Then** the budget they approved, the route they scheduled, the application they expedited or left in the tray have all had their effects

**Given** nobody is literally waiting on the player
**When** this trade is assessed
**Then** it is recorded as deliberate: the alternative of a degraded AI backfill was rejected because it would break P2
**And** if players report the fantasy of being needed feels hollow, the finding returns to design rather than being patched by degrading the backfill

**Given** decisions are recorded with their author
**When** a decision's history is inspected
**Then** the player who made it is named, permanently

### Story 13.8: The Sensor Migrates

**Leads:** quentin, derek, tim

As a player,
I want my desk to show me the city once my commute stops doing it,
So that the game does not go quiet as I optimise my travel.

**Acceptance Criteria:**

**Given** early game the player reads the city by walking through it
**When** their commute nears its floor
**Then** they see less of the street than they did

**Given** late game the player reads the city through the paperwork that crosses their desk
**When** they hold an institutional post
**Then** the matters in their inbox tell them about places they have not walked

**Given** the sensor changes hands rather than switching off
**When** the transition happens
**Then** there is no interval in which the player has neither sensor

**Given** matters carry their origin
**When** the player reads one
**Then** they can tell which street, which business and which citizen it came from

**Given** twelve complaints about one street are the aggregate
**When** the player scores their inbox
**Then** volume tells them where the city hurts, without a statistic being computed

### Story 13.9: The Wall Risk

**Leads:** quentin, derek

As a player,
I want there always to be something to work on,
So that two gates never read as a locked door.

**Acceptance Criteria:**

**Given** two gates mean a qualified player can be blocked on timing
**When** no vacancy is open
**Then** qualification for the next role is available, so there is never nothing to do

**Given** the night shift is always available and always pays
**When** the player is waiting
**Then** that route exists and works

**Given** lateral pursuits fill the interval
**When** the player is between posts
**Then** cooking, collecting and the club are all available

**Given** the wall risk is real
**When** playtesting occurs
**Then** time spent qualified-but-blocked is measured
**And** if it reads as a wall despite the three mitigations, the finding reopens the gating structure

### Story 13.10: The Central Choice

**Leads:** quentin, derek

As the solo developer,
I want to know whether the daily contest is a real one,
So that the design's central tension is verified rather than assumed.

**Acceptance Criteria:**

**Given** roughly 15 real minutes of own time per day are contested between qualification and a life
**When** the player chooses
**Then** both are genuinely attractive and both cost the same minutes

**Given** the minute-spend split is one of the five gameplay metrics
**When** own time is spent
**Then** the instrumentation from Story 4.14 emits how it divided between qualification and lateral pursuit
**And** this completes the metric begun in Story 12.9

**Given** a heavy skew either way means one side is underpriced
**When** the split is read
**Then** a skew is treated as a balance finding rather than as a player preference

**Given** the contest recurs every day rather than being made once in a menu
**When** the player plays across an in-city month
**Then** they face the choice repeatedly and may answer differently on different days

**Given** a census clerk as a producer role for statistics was deferred with v1 set to no, to be revisited here
**When** this epic is planned
**Then** the decision is revisited and recorded either way
**And** if taken, it becomes a player-holdable post where stale information is a staffed bottleneck

**Given** public office and private ownership are one mechanic under two labels and belong to a later tier
**When** they are proposed
**Then** they are deferred, and the tier mechanism from Story 13.5 is the place they would arrive

---
