[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 4: The Living Wire

Two people stand in the same city in under a second, and the city keeps its own time whether or not anybody is connected.

**This epic carries A4, the hardest technical constraint in the project.** The one-second boot is what enforces the design thesis - a place you drop into rather than a session you commit to - and D6's design for it is explicitly arithmetic rather than evidence. Story 1.14 measured a test street; this epic must hold the target against a real city, real identity and a real subscription.

**It also closes open gap G4**, the in-city clock's authority, which the architecture left undecided.

**Note on scope.** The `actor_location` table built here is shared by players and citizens. Only the player kind is populated in this epic; Epic 5 populates the other without altering the table, which matters because the schema is permanent.

### Story 4.1: The In-City Clock

**Leads:** quentin, derek, tim

As a player,
I want the city to have its own time that runs whether or not I am watching,
So that logging in is arriving somewhere rather than starting something.

**Acceptance Criteria:**

**Given** one in-city day is 60 real minutes and one in-city hour is 2.5 real minutes
**When** the clock is read
**Then** the conversion holds exactly, and the constant lives in one place with a generated client mirror

**Given** the clock is detached from real-world time
**When** a player logs in at the same real hour every day for a week
**Then** they arrive at a different in-city hour each time, rotating through the full day across the week

**Given** open gap G4 asks how time is computed, who reads it, and whether clients derive it
**When** this story completes
**Then** the decision is taken and recorded: the server holds the authoritative epoch, and clients derive current in-city time from it arithmetically rather than being told
**And** no per-tick time broadcast exists

**Given** a client's wall clock is wrong or drifts
**When** it derives in-city time
**Then** it reconciles against the server's epoch on connect and periodically thereafter
**And** a skewed client is corrected rather than trusted

**Given** the clock advances continuously with zero clients connected
**When** the server runs unattended overnight
**Then** in-city time has advanced by exactly the elapsed real time converted at the fixed rate

### Story 4.2: The Authoritative Loop

**Leads:** quentin, tim

As a player,
I want the city to keep running when I close the tab,
So that causality is real rather than a fiction maintained while I watch.

**Acceptance Criteria:**

**Given** the city always ticks and spinning down when empty was considered and rejected
**When** no client is connected
**Then** scheduled reducers continue to fire and the world continues to advance

**Given** the server performs no per-frame work
**When** the loop is profiled with clients connected
**Then** no reducer runs at frame rate
**And** player movement consumes no server tick budget

**Given** reducers are transactional
**When** a reducer returns an error
**Then** the transaction aborts cleanly and no partial state is written
**And** the reducer did not panic

**Given** the world cannot be regenerated
**When** any reducer encounters an inconsistent state
**Then** aborting is chosen over writing through

**Given** Story 1.3 measured scheduled-reducer timing fidelity
**When** the loop depends on that timing
**Then** it operates within the drift the spike actually measured, not within the drift the design assumed

### Story 4.3: Chunks and Interest Management

**Leads:** quentin, tim

As a player,
I want to receive the part of the city I am in rather than all of it,
So that a district of a quarter of a million cells fits down a domestic connection.

**Acceptance Criteria:**

**Given** subscription queries are the interest-management mechanism
**When** a client connects
**Then** it subscribes to a bounded region around its character rather than to whole tables

**Given** `actor_location` is keyed on chunk and shared by players and citizens
**When** it is created
**Then** it carries actor id, actor kind, chunk and floor
**And** the citizen kind is unpopulated in this epic but requires no schema change to populate later

**Given** a derived value cannot be subscribed to
**When** the chunk column is justified
**Then** the justification is recorded: it exists solely so that a chunk filter is expressible as a subscription
**And** a comment states that no x or y is to be added to this table for consistency

**Given** the player moves across a chunk boundary
**When** the crossing happens
**Then** the subscription updates and the new region arrives before the player reaches its edge

**Given** the body zone extends past the viewport with hysteresis on despawn
**When** the player walks toward a boundary
**Then** content is present before it is visible, and leaves lazily rather than at the edge

**Given** high-frequency player writes must not wake citizen subscribers
**When** tables are organised
**Then** they are split by access frequency rather than by the entity they describe

### Story 4.4: Player Position

**Leads:** quentin, tim

As a player,
I want other people to see me move smoothly,
So that we are plainly in the same place at the same time.

**Acceptance Criteria:**

**Given** a player's position exists only in a human's head and can be computed by nobody else
**When** it is handled
**Then** it is transmitted, unlike a citizen's position which is derived

**Given** position is one row per player overwritten in place
**When** the player moves
**Then** no event table and no separate durable channel is used
**And** the same row serves as the hot rendering channel and as the durable state that reconnection and handover read

**Given** the update rate starts at 10 Hz
**When** another client renders that player
**Then** it interpolates between updates and the motion reads as smooth

**Given** ten concurrent players at 20 Hz would generate more transactions than twenty thousand citizens living
**When** the rate is chosen
**Then** it is a tunable dial, and the reasoning that player movement scales with concurrency while L2 scales with population is recorded beside it

### Story 4.5: Identity

**Leads:** quentin, tim

As a player,
I want to be the same person when I come back tomorrow,
So that months of a life are not one cleared cache away from gone.

**Acceptance Criteria:**

**Given** identity is anonymous-first and issued during the WebSocket handshake
**When** a new player connects
**Then** the identity token is delivered, stored in `localStorage`, and re-presented on the next connect
**And** the common path costs zero extra round trips

**Given** the character-to-identity mapping table was created in Story 1.2 with a one-to-N shape
**When** a character is created
**Then** it is linked to the issuing identity through that table rather than by holding an identity column

**Given** an OIDC identity derived from issuer and subject produces a second, different identity
**When** a player later links an account
**Then** the new identity is added to the existing character's set and the character is unchanged
**And** signing in with either identity reaches the same character

**Given** clearing browser data orphans an unlinked character permanently, in a game with no wipes
**When** the player reaches a natural moment
**Then** they are prompted to link
**And** the prompt is framed diegetically - registering with the council, being issued papers - rather than as an account-security dialog

**Given** the player declines to link
**When** they continue playing
**Then** nothing is withheld and the prompt does not repeat aggressively

### Story 4.6: First Boot

**Leads:** quentin, derek, tim, artie

As a new player,
I want to be standing in the city about a second after I decide to be,
So that arriving costs nothing.

**Acceptance Criteria:**

**Given** the name prompt is inline DOM in the HTML shell
**When** the page is opened for the first time
**Then** the prompt is interactive at first paint, around 50-150 ms, with zero game assets loaded

**Given** the full payload streams while the player types
**When** they submit their name
**Then** the remaining critical path is short because loading overlapped with typing

**Given** the player is controllable within one second of submitting
**When** the timer is measured from submit to controllable
**Then** it is under one second on a mid-range laptop over a typical domestic connection

**Given** a first-ever spawn in the player's flat interior costs roughly 420 rows against a street screen's roughly 28,000
**When** the first spawn happens
**Then** it is the flat, and the street streams behind the door
**And** this is understood as the loop's own opening beat rather than as a loading trick

**Given** rendered content is on the critical path rather than cover for it
**When** the player arrives
**Then** there is no arrival sequence, no splash and no character creation ceremony

### Story 4.7: Returning

**Leads:** quentin, derek, tim, artie

As a returning player,
I want to arrive where my life actually is,
So that closing the tab was not a decision.

**Acceptance Criteria:**

**Given** the identity token is in `localStorage`
**When** a returning player opens the page
**Then** no prompt is shown and navigation to controllable completes in under one second

**Given** the return path is dominated by the initial tilemap subscription
**When** boot is optimised
**Then** the primary lever applied is subscription scope, not asset size
**And** if profiling shows decode dominating, D4's chunking migration is opened rather than worked around

**Given** the spawn is wherever cause and elapsed time put the character
**When** the player returns
**Then** they are at that position, not at a save point and not at a default

**Given** atlases and the bundle are immutable and content-hashed
**When** a returning player loads
**Then** the service worker serves them from cache without a network round trip

### Story 4.8: Reconnection Without a Seam

**Leads:** quentin, derek, tim

As a player,
I want a dropped connection to be an interruption to me and not to the city,
So that nothing needs resuming because nothing was suspended.

**Acceptance Criteria:**

**Given** nothing is suspended when a client disconnects
**When** the client reconnects
**Then** there is no resume step, because the world never paused

**Given** the character continues to exist while the player is away
**When** they reconnect after any interval
**Then** their position is consistent with cause and elapsed time, every time

**Given** the SDK handles visibility, focus, online and pageshow events with dead-socket rebuild and exponential backoff
**When** a laptop lid is closed and reopened
**Then** the client reconnects without user action
**And** a connection-state notice appeared while it was down

**Given** the world moved while the client was disconnected
**When** the subscription is re-established
**Then** the client's local store is brought current without a full reload

### Story 4.9: Two Players in One City

**Leads:** quentin, tim

As a player,
I want to see somebody else walking down the same street,
So that the city is shared rather than merely persistent.

**Acceptance Criteria:**

**Given** two browsers connect to the same district
**When** both players stand in the same chunk
**Then** each sees the other move, with interpolated motion

**Given** they walk apart
**When** one leaves the other's subscription region
**Then** they despawn lazily with hysteresis rather than blinking out at a boundary

**Given** authoritative simulation means a second connected player is close to incrementally free
**When** the second client connects
**Then** no matchmaking, lobby or session mechanism is involved
**And** server cost does not step up materially

**Given** client-authoritative movement permits teleporting and wall-clipping
**When** this is observed
**Then** it is accepted and unmitigated in v1, as recorded, with no plausibility checking added speculatively

### Story 4.10: Time Control

**Leads:** quentin, tim

As a developer,
I want to move the clock,
So that debugging a weekly rent cycle does not cost seven real hours.

**Acceptance Criteria:**

**Given** one in-city day is 60 real minutes and rent falls weekly, so a rent cycle at normal speed costs about seven real hours
**When** time control is available
**Then** the clock can be multiplied and jumped forward

**Given** the architecture names this the highest-value tool in the project
**When** it is built
**Then** it is built early rather than deferred, and it works for anything time-dependent rather than only for rent

**Given** jumping the clock must not corrupt state
**When** the clock jumps
**Then** everything scheduled across the skipped interval resolves correctly rather than being silently dropped
**And** a jump that would drop scheduled work fails rather than proceeding

**Given** debug tooling is gated behind a flag not exposed in production
**When** the flag is off
**Then** the clock cannot be altered by any input

### Story 4.11: Live Migration Policy

**Leads:** quentin, tim

As a developer,
I want changing the schema on a running world to be routine,
So that a multi-year build is not a sequence of emergencies.

**Acceptance Criteria:**

**Given** the world never resets, so every schema change is a live migration
**When** a change is needed
**Then** the standard workflow is incremental and lazy: a new table with the desired schema, the module reading new-first with fallback to old, backfill on access, and the old table eventually emptied rather than dropped

**Given** automigration forbids removing tables, retyping, renaming and reordering
**When** a change would require one of those
**Then** it is achieved by the new-table-plus-read-through path instead

**Given** backing up before every migration is non-negotiable
**When** a migration is run
**Then** the export from Story 1.4 has been taken and verified first
**And** a migration attempted without one is refused by the procedure

**Given** non-updated clients cannot see new tables
**When** the schema moves
**Then** the `defs_version` handshake detects the mismatch at connect and the client refreshes

### Story 4.12: Table Bounds and the Metrics Sampler

**Leads:** quentin, tim

As a developer,
I want every accreting table to declare how it is bounded,
So that a world running for years does not fill up by accident.

**Acceptance Criteria:**

**Given** every table declares a bound that is either game-mechanical or an engineering ceiling
**When** a table exists without one
**Then** it is treated as a bug and caught in the review gate from Story 0.3

**Given** the declaration is a monitoring input rather than documentation
**When** a bound is declared
**Then** it is machine-readable, carrying bound kind, expected magnitude and alert threshold

**Given** a scheduled reducer samples per-table row counts and bytes on a slow cadence
**When** it runs hourly
**Then** the samples land in a metrics table
**And** the sampler's own table declares its bound like any other

**Given** the storage budget is a hard wall around 40 GB with a review trigger at 10 GB and a launch estimate near 200 MB
**When** sampling runs
**Then** total storage is tracked against both figures

### Story 4.13: The Watcher

**Leads:** quentin, tim

As a developer,
I want to be told when something is drifting,
So that a declared bound is not merely a comment.

**Acceptance Criteria:**

**Given** reducers are sandboxed and transactional, so outbound notification is not their job
**When** alerting is built
**Then** it lives in an external process subscribing to the metrics table

**Given** a declared threshold is exceeded, or total storage crosses the review trigger
**When** the watcher notices
**Then** it alerts, naming the table and the figure

**Given** the watcher may itself die
**When** it does
**Then** the city keeps ticking and only alerting is lost
**And** this risk profile is explicitly different from an in-line dependency, which is why an external process is acceptable here after the Ghost Crew was rejected

**Given** one pipeline serves several purposes
**When** the watcher is built
**Then** it covers table growth, cost per reducer class, the gameplay metrics and the outstanding benchmarks, rather than one system per concern

**Given** cost per reducer class must be instrumented from day one
**When** reducers run
**Then** their cost is attributed by class, so scaling decisions rest on measurement rather than on published conversions

### Story 4.14: The Gameplay Metric Definitions

**Leads:** quentin, derek, tim

As the solo developer,
I want the five metrics defined precisely enough to implement,
So that the questions the design rests on are answerable rather than merely asked.

**Acceptance Criteria:**

**Given** the GDD states five gameplay metrics as questions rather than as measurements
**When** this story completes
**Then** each has a precise definition, an emission point and a unit: voluntary time in the discretionary middle, perceived aliveness at one connected player, return rate after absence, minute-spend split between qualification and lateral pursuit, and unprompted noticing

**Given** each metric is emitted by the epic that creates the behaviour it measures
**When** the definitions are written
**Then** each names the epic that will emit it
**And** the registration mechanism exists here so that later epics add a metric without adding a pipeline

**Given** unprompted noticing is named as the metric that matters most and is hardest to instrument
**When** its definition is written
**Then** it states honestly how it will be captured and what that proxy cannot see
**And** if it is only answerable by asking players, that is recorded as the method rather than left as an aspiration

**Given** metrics measurable in this epic exist now
**When** the pipeline is stood up
**Then** boot time, concurrent players and reconnection continuity are emitted immediately, proving the path end to end

**Given** adjectives are not metrics
**When** any metric is defined
**Then** it resolves to a number or a proportion

### Story 4.15: Spike - Position Write Rate Against Smoothness

**Leads:** quentin, tim

As a developer,
I want to know the lowest position update rate that still looks right,
So that the term which scales with concurrency is set by measurement.

**Acceptance Criteria:**

**Given** the rate starts at 10 Hz and is absorbed by interpolation on receiving clients
**When** rates from 5 to 20 Hz are compared
**Then** perceived smoothness is assessed at each and the lowest acceptable rate is recorded

**Given** player movement scales with concurrency far more steeply per capita than L2 scales with population
**When** the spike concludes
**Then** the transaction cost of the chosen rate is reported at the launch concurrency target

**Given** the finding may argue for a rate other than 10 Hz
**When** it does
**Then** the dial is changed and the reasoning recorded against D9b

---

### Story 4.16: The Page and the Session

**Leads:** quentin, tim, artie

As a player,
I want the browser to behave the way a browser should,
So that the city is a page I can leave and come back to rather than an application I have to manage.

**Acceptance Criteria:**

**Given** the name prompt is interactive at first paint while the payload streams behind it
**When** the page is loading
**Then** the prompt is the page
**And** there is no loading screen, no spinner and no progress bar, because the boot design removed the thing they would report on

**Given** the city is a place rather than an app
**When** the tab is rendered
**Then** the page title and favicon name the city, so a player finds it among their other tabs

**Given** a character body has exactly one driver
**When** the same character is opened in a second tab
**Then** the most recent tab holds the character
**And** the earlier tab is told in plain language that the character is being driven elsewhere and is not controllable
**And** it does not close itself, error, or fight for control

**Given** nothing is ever suspended
**When** the player refreshes the browser
**Then** it behaves as a reconnection rather than a restart, with no re-prompt and no lost state

**Given** the player leaves using the back button
**When** they go
**Then** the city keeps running and no warning dialog is shown, because that is the design's central promise rather than an accident

**Given** the procedure state machine is server-authoritative
**When** the connection drops mid-procedure
**Then** a connection-state notice appears
**And** the machine snaps to its current step boundary, so the shift is not lost
**And** the player resumes at that step on reconnection

---
