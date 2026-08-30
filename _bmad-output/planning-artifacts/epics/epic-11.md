[← Epics index](index.md)

Story status is **not** recorded here. It lives in `_bmad-output/implementation-artifacts/sprint-status.yaml`, which is generated from these files.

---

## Epic 11: Transit and the Full Roster

Five playable jobs, real transit with routes and timetables, and a city that sounds like somewhere with its own business.

**This epic marks the MVP boundary.** After it, the district has its full content breadth: five playable jobs, real transit, 100+ interiors, institutions running.

**It completes FR14's roster.** The till came in Epic 7, the guard in Epic 8, the sanitation round in Epic 10. The night bus driver and the cafe barista land here - the second vehicle-and-route job, and the deepest procedure in the game.

**The barista is A1's canonical case.** Grind, dose, tamp, pull, steam, serve is the sequence the interaction model was prototyped against in Story 8.3. If the model holds anywhere, it holds here; if it does not, this is where that shows.

**Audio is a legibility channel, not decoration.** A tram heard but never seen is evidence the city is running, and it extends the player's sensor past the screen edge for almost nothing.

### Story 11.1: Routes and Stops

**Leads:** quentin, tim

As a player,
I want tram and bus routes that actually go places,
So that the city has a circulatory system rather than a set of walkable distances.

**Acceptance Criteria:**

**Given** transit legs are edges on the macro graph emitted in Epic 3
**When** routes are defined
**Then** they run over those edges with costs denominated in minutes

**Given** stops are nodes on the graph
**When** a stop is placed
**Then** it is a transit node, and citizens routing through it consume the leg's duration

**Given** the district is 512 by 512 cells
**When** routes are laid out
**Then** they connect the residential edges to the commercial core, so the commute they serve is the one people actually make

**Given** citizens use transit as well as players
**When** a citizen's route includes a transit leg
**Then** they board, ride and alight, and their derived position follows the vehicle

### Story 11.2: Timetables

**Leads:** quentin, derek, tim

As a player,
I want the tram to be late because something happened,
So that the timetable is a promise the city can fail to keep.

**Acceptance Criteria:**

**Given** services run to a timetable
**When** a service is scheduled
**Then** it departs and arrives at stated in-city times

**Given** a timetable can be missed
**When** a vehicle is delayed, or a driver post is unfilled
**Then** the service runs late or does not run
**And** this is content rather than an error

**Given** service level follows from resourcing
**When** a budget decision changes the number of vehicles or drivers
**Then** the timetable changes with it, traceable through the matter that caused it

**Given** waiting costs minutes
**When** a player arrives at a stop between services
**Then** they wait in real time, and the wait is part of the commute's cost

### Story 11.3: Riding Transit

**Leads:** quentin, derek, tim, artie

As a player,
I want to get on the tram and watch the city go past,
So that a faster commute changes what I read rather than whether I read.

**Acceptance Criteria:**

**Given** the player boards a service
**When** they ride it
**Then** they travel with the vehicle and the world moves past them

**Given** faster transport changes what is read rather than whether
**When** the player switches from walking to transit
**Then** the route passes different streets than the walk did

**Given** the destination is known before arrival
**When** the player is in transit
**Then** the destination region is prefetched during the journey, per Story 5.7

**Given** fares are paid per trip in this epic
**When** the player boards
**Then** they pay, in cash or by card, using the mechanisms from Epic 6
**And** the transit pass that changes this arrives in Epic 12

**Given** the subway is a floor beneath the street
**When** the player descends
**Then** the street floor is culled and the subway is revealed, per Story 1.7

### Story 11.4: The Night Bus Driver

**Leads:** quentin, derek, tim, artie

As a player,
I want to drive the last bus of the night,
So that the emptiest hours of the city have somebody in them.

**Acceptance Criteria:**

**Given** the job is route, stops, timing, doors and fares
**When** the player works the shift
**Then** each is a procedure on objects, following the four-beat template

**Given** the job fails badly as running early, missed stops and harsh braking
**When** the player performs badly
**Then** those consequences are real: passengers left at stops, a service ahead of its timetable
**And** nothing scores them

**Given** running early is a genuine failure rather than efficiency
**When** the player arrives at a stop before its scheduled time
**Then** waiting is the correct action, and leaving early strands the people who arrived on time

**Given** passengers are citizens with reasons to travel
**When** they board
**Then** each has a destination and a reason, answerable by the causality inspector

**Given** this job is available as a borrowed night shift
**When** a player takes it through Story 9.7
**Then** it works identically, because the driver slot is the same slot

### Story 11.5: The Cafe Barista

**Leads:** quentin, derek, tim, artie

As a player,
I want to pull a shot properly,
So that the deepest procedure in the game is worth doing well.

**Acceptance Criteria:**

**Given** the job is grind, dose, tamp, pull, steam and serve
**When** the player makes a drink
**Then** each step is performed on an object in sequence, using the interaction model resolved in Story 8.3

**Given** this is the canonical case that model was prototyped against
**When** the job is played
**Then** it is assessed explicitly against whether procedure feels like handling
**And** a negative read here reopens Story 8.3 rather than being absorbed

**Given** the job fails badly as a bad shot, burnt milk and a wrong order
**When** the player performs badly
**Then** the drink is worse, the customer has it anyway, and nothing is scored

**Given** props carry state
**When** the hopper empties or the machine needs attention
**Then** it is visible on the object, and a reorder is emitted below threshold

**Given** recipes convert inputs plus labour minutes into outputs
**When** a drink is made
**Then** it consumes beans and milk from the cafe's own stock, per Epic 6

**Given** recognisability depends on meeting the same person repeatedly
**When** a player is a regular at a cafe
**Then** the same barista serves them
**And** when the player works the counter, their own regulars emerge the same way

### Story 11.6: Hospitals and Injury

**Leads:** quentin, derek, tim

As a player,
I want being hurt to cost me days and savings,
So that there is a real consequence that is not death.

**Acceptance Criteria:**

**Given** there is no death
**When** the player is injured
**Then** they lose days and savings, and recover

**Given** hospitals are institutions with chains
**When** the player is treated
**Then** paramedic, triage, nurse, surgeon, admin and billing are occupations in a chain, staffed like any other

**Given** being hurt puts the player inside the machine from the other side
**When** they are treated
**Then** they experience the institution as its subject rather than its operator

**Given** response time is a budget line
**When** an ambulance is called
**Then** its arrival time follows from the service's resourcing, per Story 10.15

**Given** treatment costs money
**When** billing runs
**Then** the cost settles against the player's balance, and falling short routes into Ruin By Process rather than into a failure

### Story 11.7: Ambient Beds

**Leads:** quentin, tim, artie

As a player,
I want the city to sound different in different places,
So that I can hear where I am.

**Acceptance Criteria:**

**Given** audio uses Web Audio directly or a very thin wrapper
**When** the client is built
**Then** no full audio library is added, because the bundle weight is not available against the boot budget

**Given** ambient beds crossfade by environment, neighbourhood character and time of day
**When** the player moves between neighbourhoods or the hour changes
**Then** the bed crossfades rather than cutting

**Given** neighbourhood character comes from the four generator parameters
**When** the bed is selected
**Then** it follows density, building age, affluence and land-use mix

**Given** audio assets are sourced rather than composed
**When** they are packaged
**Then** they are content-hashed, service-worker cached and loaded by neighbourhood, like atlases
**And** they version under the same `defs_version`

### Story 11.8: Stepping Indoors

**Leads:** quentin, tim, artie

As a player,
I want the street to go quiet when I close the door behind me,
So that inside and outside are different places.

**Acceptance Criteria:**

**Given** the interior and exterior transition is a low-pass filter
**When** the player steps indoors
**Then** the exterior bed is filtered rather than swapped
**And** this is the GDD's room tone that changes when you step indoors

**Given** the transition follows the same enclosure state the renderer uses
**When** the player crosses a threshold
**Then** audio and rendering change together, reading the same derived state

**Given** there is no separate audio simulation
**When** audio state is determined
**Then** it is derived from the same world state the renderer reads

### Story 11.9: Positional Sound and Diegetic Music

**Leads:** quentin, derek, tim, artie

As a player,
I want music to come from a radio somebody switched on,
So that everything I hear is something in the world.

**Acceptance Criteria:**

**Given** there is no composed score and no music system
**When** music plays
**Then** it comes from a positional emitter such as a radio or a busker

**Given** a radio is an object
**When** it is playing
**Then** the sound attenuates with distance and stops if the object stops

**Given** positional one-shots come from world events near the player
**When** an event occurs
**Then** the sound plays at its position

**Given** no non-diegetic audio exists
**When** any music cue, sting or feedback sound is proposed
**Then** it is rejected, on the same grounds as a HUD element

### Story 11.10: Earshot

**Leads:** quentin, derek, tim

As a player,
I want to hear a tram I cannot see,
So that the city is evidently running beyond the edge of my screen.

**Acceptance Criteria:**

**Given** earshot is deliberately larger than the viewport
**When** a tram passes just off screen
**Then** the player hears it

**Given** this extends the player's sensor past the screen edge for almost nothing
**When** the radius is set
**Then** it is a deliberate design parameter rather than a side effect of attenuation

**Given** audio is a legibility channel
**When** the city is busy beyond the screen
**Then** it sounds busy
**And** when it is quiet, it sounds quiet

**Given** sound sources beyond the body zone have no instantiated bodies
**When** they are heard
**Then** the sound derives from the same ledger state that would have produced a body, so nothing is heard without a cause

### Story 11.11: The MVP District

**Leads:** quentin, derek, tim, artie

As a player,
I want a district with five jobs, real transit and institutions running,
So that there is a whole small city to be in.

**Acceptance Criteria:**

**Given** the five-job roster is complete
**When** the player looks for work
**Then** convenience shop till, security guard, sanitation round, night bus driver and cafe barista are all available and all playable

**Given** four of the five need a single interior and no vehicle
**When** the roster is reviewed
**Then** the build cost matches that, with only the sanitation round and the night bus requiring vehicles and routes

**Given** the district holds 100+ enterable interiors
**When** the player explores
**Then** they are furnished, occupied and in use rather than merely enterable

**Given** institutions are present and staffed
**When** the player visits
**Then** shops, cafes, the depot, the council, a hospital, a welfare office and shelters are all running with citizens in their posts

**Given** job access tiers are the project's primary scope valve
**When** the roster is set
**Then** the tier mechanism exists so that the job count remains a dial rather than a commitment

**Given** this is the MVP boundary
**When** the epic closes
**Then** a written assessment records whether the district reads as a place to live in rather than a demo of systems

---
