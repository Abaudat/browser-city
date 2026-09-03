[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 1: Foundations and Gating Spikes

A player can walk an avatar down a hand-laid test street in a browser tab, and the three measurements that could overturn architectural decisions have been taken before anything depends on them.

**Sequencing note.** Stories 1.3, 1.4 and 1.14 are spikes. They are placed where their answers are still free to change a decision: 1.3 and 1.4 before any world state exists, 1.14 once there is enough content to measure honestly. A spike that reports a failure is a successful story — the deliverable is the measurement, not a passing number.

### Story 1.1: Project Scaffold and First Round Trip

**Leads:** quentin, tim

As a developer,
I want the server module and browser client standing up together with a verified round trip,
So that every later story has a place to put code and a way to know it ran.

**Acceptance Criteria:**

**Given** a clean checkout with the Rust toolchain, the `wasm32-unknown-unknown` target, the SpacetimeDB CLI and Node.js installed
**When** the scaffold commands are run (`spacetime init --lang rust --project-path ./server browsercity`, `npm create vite@latest client -- --template vanilla-ts`, `npm install pixi.js spacetimedb`, `spacetime generate --lang typescript --out-dir client/src/net/bindings`)
**Then** both targets build without error
**And** the directory structure matches the architecture's prescribed layout

**Given** the module is published locally
**When** a reducer writes a row and the browser client is subscribed to that table
**Then** the row appears in the client within one second of the write
**And** the client receives it through the SDK's `onInsert` callback

**Given** the developer edits a Rust source file
**When** `spacetime dev` is running
**Then** the module rebuilds and republishes without a manual step

**Given** the Windows install path for the SpacetimeDB CLI is not the documented Unix shell installer
**When** the prerequisites are set up on this machine
**Then** the working Windows install method is recorded in the repository README
**And** the recorded method is verified by a clean install on a second path

### Story 1.2: Permanent Schema Decisions

**Leads:** quentin, tim

As a developer,
I want every primary key, unique constraint and scheduled table the design will ever need declared in the first commit,
So that a world which can never be reset is never blocked by a migration the platform forbids.

> **This story deliberately departs from just-in-time data creation. Do not "correct" it.**
> The normal rule is that each story creates the data structures it needs, and creating them all upfront is an anti-pattern. That rule is suspended here because the platform makes these particular declarations irreversible: in SpacetimeDB a primary key and a unique constraint are permanent (NFR33), and **a normal table can never become a scheduled one** (NFR34). Deferring them to the story that first needs them would not make them flexible — it would make them unfixable *and wrong*. The architecture states it directly: *"Fix the permanent decisions first."* Everything else in the schema remains additive and just-in-time; only these three categories are settled here.

**Acceptance Criteria:**

**Given** automigration forbids adding primary keys, adding unique constraints, and changing a table's scheduling status
**When** the initial schema is written
**Then** every table any architectural decision names carries its final primary key
**And** every table that might ever need scheduling is declared as a scheduled table, even where it is not yet used

**Given** the `character <-> identity` mapping table is required from day one by D5
**When** the initial schema is written
**Then** that table exists with a one-character-to-N-identities shape, before any character row can be created

**Given** a developer appends a new field to an existing table
**When** the module is published against a live world
**Then** the publish succeeds because the column carried a default
**And** a publish that appends a column without a default fails loudly rather than silently

**Given** any extensible set is needed (matter kinds, provisions, reason codes, node kinds)
**When** it is declared
**Then** it is a `u32` code with a companion data table, never a Rust enum

### Story 1.3: Spike - Scheduled-Reducer Timing Fidelity

**Leads:** quentin, tim

As a developer,
I want measured evidence that scheduled reducers fire when they say they will,
So that the far-agent model is not built on a platform behaviour patched twice in the last month.

**Acceptance Criteria:**

**Given** SpacetimeDB v2.8.3, in which scheduled-function drift was fixed in both v2.7.1 and v2.8.3
**When** a scheduled table is loaded with rows due across intervals from 100 ms to 10 minutes
**Then** each row's actual fire time is recorded against its scheduled time
**And** the drift distribution is reported with median, p95 and maximum

**Given** the module is republished while scheduled rows are pending
**When** the republish completes
**Then** the report states whether pending rows survived, fired late, or were lost

**Given** measured drift would be visible to a player as a citizen arriving at the wrong time
**When** the spike concludes
**Then** the finding is recorded against risk R10 and decision D7
**And** if drift exceeds what the design can absorb, the Alarm Clock decision is reopened rather than worked around

### Story 1.4: Spike - Backup, Export and a Tested Restore

**Leads:** quentin, tim

As a developer,
I want a backup path I have personally restored from,
So that a world which cannot be regenerated never rests on an assumption.

**Acceptance Criteria:**

**Given** Maincloud advertises backups but no user-facing backup, restore or export command was found in the CLI
**When** the platform's backup semantics are investigated directly
**Then** frequency, retention, and whether the developer can trigger and restore without vendor support are recorded as findings

**Given** the vendor's backup semantics may prove insufficient or opaque
**When** this story completes
**Then** a logical export exists that dumps every table via `spacetime sql` on a schedule
**And** the export runs unattended and reports its own failure

**Given** an export file and an empty database
**When** the restore procedure is run
**Then** the restored world matches the exported one row for row
**And** the procedure is documented as a runnable sequence, not as prose

**Given** an untested backup is not a backup
**When** this story is marked complete
**Then** at least one full restore has actually been performed and verified

### Story 1.5: The World Data Model

**Leads:** quentin, tim

As a developer,
I want one tilemap addressed by floor and layer,
So that bridges, manholes, upper storeys and interiors are one mechanism rather than four special cases.

**Acceptance Criteria:**

**Given** the world is addressed as `(x, y, floor, layer)`
**When** two cells occupy the same `(x, y)` on different floors
**Then** both exist simultaneously without conflict
**And** an entity on floor 0 tests collision only against floor 0

**Given** a player standing on a road with a bridge overhead
**When** they walk beneath the bridge deck
**Then** they pass under it, because the deck is not in their floor's collision set

**Given** a transition cell (stairs, ramp, ladder, station steps, manhole)
**When** the player enters it
**Then** their floor index changes to the transition's target floor
**And** their collision set changes with it in the same frame

**Given** interiors live in the same tilemap at their building's footprint
**When** a player walks through a doorway
**Then** no space transition, portal or load occurs - the door is an ordinary walkable cell

**Given** every cell carries a building/room ownership id
**When** the player is inside a building
**Then** that building's id is queryable for the player's current position

### Story 1.6: Layer-Aware Depth Sorting

**Leads:** quentin, tim, artie

As a player,
I want to be drawn in front of what I am in front of and behind what I am behind,
So that the city reads as a place with depth rather than a flat collage.

**Acceptance Criteria:**

**Given** the renderer runs three flat passes (Ground, Ground decals, Ground objects) then one y-sorted pool
**When** a frame is drawn
**Then** pool members are ordered by `(y, layer_rank, x, object_id)` ascending
**And** no object is ever sliced or split across passes

**Given** `layer_rank` is assigned in tens (Furniture 0, Objects 10, Walls 20, Wall decals 30, Characters 40)
**When** two objects share an anchor cell
**Then** rank alone resolves them - a glass draws over a table, a poster over a wall

**Given** a multi-cell prop such as a long counter
**When** the player stands at one end of it
**Then** they render in front of the near end and behind the far end
**And** this works because the prop decomposed into per-cell drawables each carrying its own anchor

**Given** content on a floor above or below the player's
**When** it is drawn
**Then** it is offset vertically in proportion to its floor
**And** the offset is derived from the tileset's storey height and validated against the LimeZu wall sprites

**Given** a sprite wider than its footprint (a canopy, an awning)
**When** it overlaps a sprite whose footprint cannot occlude it
**Then** the order is stable across frames, because footprint geometry determines no answer and any stable order is correct

### Story 1.7: Enclosure Visibility

**Leads:** quentin, tim, artie

As a player,
I want to see inside the building I am standing in,
So that interiors are places in the city rather than rooms behind a loading screen.

**Acceptance Criteria:**

**Given** the player enters a building
**When** its near-side walls would occlude them
**Then** those walls are retracted
**And** retraction is keyed on the building/room ownership id, not on proximity

**Given** a wall tile is a window
**When** it is rendered from outside
**Then** it draws semi-transparently and the furniture behind it is visible through the glass
**And** no masking or aperture system is involved

**Given** the subway is floor -1
**When** the player is above ground
**Then** the subway is culled entirely
**And** on entering it, the street floor above is culled instead

**Given** culling is per-enclosure
**When** the player stands in one shop of a terrace
**Then** only that shop's enclosure is opened, not the whole terrace

### Story 1.8: Player Movement and Sub-Tile Collision

**Leads:** quentin, tim

As a player,
I want to walk continuously and be stopped by things that are solid,
So that the street is a physical space rather than a grid of legal squares.

**Acceptance Criteria:**

**Given** movement is fully client-authoritative with no server validation in v1
**When** the player holds a direction key
**Then** the avatar moves continuously and immediately, with no round trip

**Given** walking speed is 2.2 cells/second (35 world px/second)
**When** the player crosses one viewport width of 40 cells
**Then** it takes approximately 18 real seconds
**And** the speed is a named constant, not a literal scattered through movement code

**Given** collision rows expand into a derived grid on insert, delete and update
**When** the player moves against a solid object
**Then** the collision test is an `O(1)` lookup against that structure
**And** no row query happens in the movement path

**Given** collision uses swept AABB resolution against base-anchored rectangles
**When** the player walks into a corner at an angle
**Then** they slide along the surface rather than catching on it

**Given** a lamppost occupies a fraction of its cell
**When** the player walks past it
**Then** they pass through the rest of the cell, because collision is sub-tile rather than tile-granular

**Given** an object has no collider defined
**When** the player walks onto it
**Then** they walk over it, because absence of a collider is walkability

### Story 1.9: Intents and Keybindings

**Leads:** quentin, tim, artie

As a player,
I want clicking a thing in the world to mean something,
So that interaction is with objects rather than with menus.

**Acceptance Criteria:**

**Given** input produces intents rather than actions
**When** the player clicks a world object
**Then** the click resolves to an object instance via the derived grid
**And** reachability is checked against that definition's `interact_at`
**And** an intent is emitted whose meaning is left entirely to whatever consumes it

**Given** the object is out of reach
**When** the player clicks it
**Then** no intent is emitted and the click is visibly ignored

**Given** the procedure interaction model is deliberately unresolved until Epic 8
**When** this story is complete
**Then** nothing in the input layer encodes what any intent means
**And** Epic 8 can iterate on procedure feel without touching this code

**Given** keybindings are stored in `localStorage`
**When** the player rebinds a key and reloads the page
**Then** the new binding survives
**And** a browser with cleared storage falls back to defaults without error

### Story 1.10: Character Appearance

**Leads:** quentin, tim, artie

As a player,
I want the same person to look the same every time I see them,
So that recognising a face is possible at all.

**Acceptance Criteria:**

**Given** the character generator ships 511 parts across Bodies, Eyes, Hairstyles, Outfits and Accessories
**When** a character's appearance is stored
**Then** it is five small integers, not an asset reference

**Given** appearance is deterministic from citizen id
**When** the same citizen is rendered on two different clients, or on the same client a week later
**Then** the appearance is identical

**Given** the five part spritesheets are asserted to share an identical frame layout
**When** one `(animation, direction, frame)` index is applied
**Then** it selects the corresponding cell from all five sheets
**And** this invariant is verified once by test rather than assumed

**Given** appearance tuples must be coherent rather than random
**When** the generator produces one
**Then** kids' parts pair only with kids' bodies
**And** the outfit layer can be driven by occupation, so a janitor is visibly a janitor

**Given** a composite is rendered
**When** the same appearance appears many times on screen
**Then** the runtime caches the composite into a texture so each character costs one draw call rather than six

### Story 1.11: The DOM Shell

**Leads:** quentin, tim, artie

As a player,
I want the game's only interface furniture to be a settings menu and an honest connection notice,
So that nothing ever accumulates into a HUD.

**Acceptance Criteria:**

**Given** all UI is DOM and nothing persistent, global or abstract is drawn into the canvas
**When** the client is built
**Then** there is no in-canvas UI layer at all, so there is nowhere to put a counter

**Given** the DOM surface is exactly the boot name prompt, an options menu and connection-state notices
**When** the options menu is opened
**Then** it offers audio, display and controls, and nothing else

**Given** the connection drops
**When** the client notices
**Then** a connection-state notice appears in DOM
**And** the world keeps rendering its last known state rather than blanking

**Given** the no-HUD design law
**When** any informational element belonging to the fiction is needed
**Then** it is rendered in the world as an object, not in DOM

### Story 1.12: Debug Overlays

**Leads:** quentin, tim

As a developer,
I want to see what the collision system and the sort order actually believe,
So that the failures which fail silently become visible.

**Acceptance Criteria:**

**Given** debug tooling is compiled in behind a flag not exposed in production
**When** the flag is off
**Then** no overlay can be activated by any input

**Given** the overlay framework exists
**When** the collision overlay is enabled
**Then** every collider rectangle is drawn over the world at its true position
**And** a prop with no collider is visibly distinguishable from one with a zero-size collider

**Given** the sort-order overlay is enabled
**When** objects overlap
**Then** each drawable's computed sort key is legible on screen

**Given** overlays must never be mistaken for the game
**When** any overlay is drawn
**Then** it is rendered in a deliberately non-diegetic style

**Given** later epics introduce navmesh, chunk boundary and citizen route overlays
**When** they do
**Then** they register with this framework rather than building their own

### Story 1.13: The Hand-Laid Test Street

**Leads:** quentin, tim

As a player,
I want a street I can actually walk down,
So that every foundation built in this epic is proven by use rather than by unit test.

**Acceptance Criteria:**

**Given** no generator exists yet
**When** the test street is assembled
**Then** it is hand-laid from a minimal hardcoded object set, understood to be replaced wholesale by Epic 3

**Given** the test street must exercise each foundational case
**When** it is walked
**Then** it includes a bridge or underpass (two floors at one `(x, y)`), a transition cell, a building interior with retractable walls, a window, a multi-cell prop, and a prop the player can pass partly through

**Given** a person opens the page
**When** they press a movement key
**Then** they control a character on that street
**And** collision, depth sorting, wall retraction and appearance behave correctly together rather than only in isolation

### Story 1.14: Spike - Boot Budget Measured

**Leads:** quentin, tim

As a developer,
I want the one-second boot claim tested against a real payload,
So that the hardest constraint in the project stops being arithmetic.

**Acceptance Criteria:**

**Given** D6's boot design is explicitly recorded as arithmetic rather than evidence
**When** the test street and client are loaded cold on a mid-range laptop over a typical domestic connection
**Then** time to first paint, time to interactive prompt, and time to player-controllable are each measured and recorded

**Given** the boot budget is a standing constraint rather than a system built later
**When** the measurement is taken
**Then** the breakdown attributes time to bundle, atlas, subscription decode and connection handshake separately
**And** the dominant term is named

**Given** D4 records a known risk that ~28k row decodes for one screen is a real slice of the boot budget
**When** subscription decode cost is measured
**Then** the result either clears the revisit trigger or opens D4's chunking migration

**Given** the measurement may show the target is missed
**When** it does
**Then** the finding is recorded against A4 and R5 and the affected decisions are reopened
**And** the story is complete regardless, because the deliverable is the measurement

---

### Story 1.15: Interactable Affordance

**Leads:** quentin, derek, tim, artie

As a player,
I want to be able to tell what I can act on,
So that a dense street is a place I can use rather than a picture I have to guess at.

**Acceptance Criteria:**

**Given** the city is 16x16 pixel art at 3x zoom, deliberately dense with props
**When** dozens of drawn objects share a screen and a handful are interactable
**Then** an affordance exists, justified by that specific breakage rather than adopted as a default

**Given** the pointer is over an object that declares an interaction
**And** the player is within that definition's `interact_at`
**When** the object is hovered
**Then** a transient highlight is drawn on that object's own drawables
**And** the browser cursor changes

**Given** an object is reachable but not hovered
**When** the player looks at the street
**Then** it carries no treatment at all, because the world is not pre-lit

**Given** an object is hovered but out of reach
**When** the pointer rests on it
**Then** the cursor changes but the in-world highlight is withheld
**And** this is how reachability is learned rather than told

**Given** D17 permits transient object-bound canvas drawing and forbids the persistent, global or abstract
**When** the highlight is implemented
**Then** it exists only while hovered, is never state the world holds, and adds no floating icon, label, tooltip or prompt

**Given** the treatment must survive a busy street at rush hour without becoming noise
**When** strength is chosen
**Then** it is a dial rather than a fixed value, exposed in the options menu's display section
**And** the value is settled by playing rather than by specification

**Given** A1 asks whether procedure feels like handling or like clicking
**When** the Epic 8 prototype runs
**Then** this affordance is already in the build, so the prototype cannot mistake discovery friction for procedure friction

---
