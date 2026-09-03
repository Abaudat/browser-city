[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 3: The Generated City

A player can walk a whole generated 512x512 district, enter buildings, and find neighbourhoods that read as different from one another.

**The largest and riskiest epic in the project.** Nothing is hand-placed, so there is no fallback if the rules produce a bad street (A5). Determinism must survive an arbitrary future patch history (R3, R8), because E13's growth breaks the same-seed-same-city promise otherwise.

**Scale target, from the settled baseline:** 512x512 cells, ~894 buildings, ~344 workplaces, dwellings for ~5,000 citizens, 100+ enterable interiors.

**Division of labour, per D21.** The GDD owns what neighbourhoods should *feel* like. The architecture owns the *shape* of the rule system. This epic owns the rule **content** — hundreds of placement constraints, adjacency tables and density curves — as its own artifact, authored incrementally.

### Story 3.1: The Generation Design Document

**Leads:** quentin, derek, tim, artie

As a developer,
I want the rule content to live in a document I extend rather than in my head,
So that hundreds of constraints accumulate coherently instead of as accreted special cases.

**Acceptance Criteria:**

**Given** the architecture explicitly assigns rule content to an E3-owned artifact rather than to itself
**When** this epic begins
**Then** a generation design document exists and is the named home for placement constraints, adjacency tables, density curves and neighbourhood parameter ranges

**Given** the document is authored incrementally alongside the passes
**When** a pass is implemented
**Then** the rules it consumes are recorded in the document before or with the code, never after

**Given** rules are data in `defs/` rather than code
**When** the document specifies a rule
**Then** it names the constraint kind (placement, distribution, coherence, adjacency, requirement) it is expressed as

### Story 3.2: Land Use and the Street Network

**Leads:** quentin, tim, artie

As a player,
I want a district with streets that go somewhere,
So that the city has a shape before it has any buildings in it.

**Acceptance Criteria:**

**Given** generation is multi-pass, coarse to fine
**When** the first pass runs
**Then** it assigns land use across the 512x512 area - residential, commercial, industrial, institutional - and nothing finer

**Given** the second pass consumes the first
**When** the street network is generated
**Then** streets connect all land-use regions and no region is stranded
**And** the network reads as a city's streets rather than as a maze or a perfect grid

**Given** the city is generated as square blocks, which is what makes the Manhattan estimator appropriate later
**When** the network is produced
**Then** block structure is genuinely rectilinear enough for that assumption to hold

**Given** the periphery must read as character rather than as budget
**When** land use is assigned near the district edge
**Then** sparseness there is an intentional output of the rules, not an absence of them

### Story 3.3: Plots and Building Envelopes

**Leads:** quentin, tim, artie

As a player,
I want buildings that sit on the street properly,
So that a block reads as a block rather than as scattered boxes.

**Acceptance Criteria:**

**Given** the third pass subdivides land into plots
**When** plots are cut
**Then** each fronts a street and none is landlocked

**Given** building footprints are sized by interior usability rather than street frontage alone
**When** an envelope is placed on a plot
**Then** it is large enough to hold its eventual interior - a shop must fit its counter, its stock and a moving player
**And** an envelope too small for its intended type is rejected rather than shrunk into unusability

**Given** the tileset's own premade interiors run from 14x6 (a condominium flat) to 19x15 (a gym)
**When** envelope sizes are chosen
**Then** they fall in a range consistent with those, averaging around 12x11 cells

**Given** the settled scale baseline expects roughly 894 buildings at 512x512
**When** the district is generated
**Then** the building count lands within a stated tolerance of that figure
**And** a wild deviation fails generation rather than producing a district nobody checked

### Story 3.4: Building Types and Institution Placement

**Leads:** quentin, derek, tim

As a player,
I want the depot, the council building and the corner shop to be where such things go,
So that the city's institutions feel sited rather than sprinkled.

**Acceptance Criteria:**

**Given** building type is assigned from the grammar against neighbourhood parameters
**When** a type is chosen for an envelope
**Then** it satisfies coherence rules - no skyscraper among villas

**Given** institutions are generated types under placement constraints rather than hand-placed landmarks
**When** the district is generated
**Then** it contains a depot, a council building, a hospital, a welfare office, shelters, shops and cafes
**And** each satisfies its own placement and distribution constraints

**Given** municipal services are distributed at roughly one per N dwellings, evenly spread
**When** placement runs
**Then** no quadrant of the district is left without the services its dwelling count requires

**Given** the scale baseline expects roughly 344 workplaces
**When** the district is generated
**Then** workplace count lands within tolerance
**And** the professions those workplaces support number around 69, consistent with the labour-market depth the design needs

### Story 3.5: Interior Layout

**Leads:** quentin, tim, artie

As a player,
I want to open a door and find a room that makes sense,
So that a hundred interiors are a hundred places rather than a hundred boxes.

**Acceptance Criteria:**

**Given** interiors live in the same tilemap at their building's footprint
**When** an interior is generated
**Then** it occupies the building's own cells and no separate space is created

**Given** the room grammar and its requirement constraints
**When** an interior is laid out
**Then** every dwelling has a door, every room has a light, and every business has stock space
**And** a layout violating any requirement is regenerated or rejected, never emitted

**Given** the MVP target is 100+ enterable interiors
**When** the district is generated
**Then** at least 100 buildings are enterable and furnished
**And** the enterable set spans dwellings, shops, cafes and institutional back rooms rather than being all of one kind

**Given** cells carry a building/room ownership id
**When** interiors are emitted
**Then** every interior cell carries the id its enclosure culling and wall retraction depend on

### Story 3.6: Prop Placement

**Leads:** quentin, tim, artie

As a player,
I want rooms and streets with things in them,
So that the city has texture rather than only geometry.

**Acceptance Criteria:**

**Given** the final pass places props against the definitions from Epic 2
**When** props are placed
**Then** each is one row at its anchor cell and its extent comes from `object_def`

**Given** the generator composites footprints into a per-district collision map once per seed
**When** placement completes
**Then** the collision map is cached
**And** nothing infers collision at spawn time or at runtime

**Given** a placed prop must not block what it should not block
**When** the district is generated
**Then** the doorway-gap invariant from Epic 2 holds everywhere
**And** the reachability invariant reports no walkable region enclosed without a door

### Story 3.7: Neighbourhood Character

**Leads:** quentin, derek, tim, artie

As a player,
I want to know I have walked into a different neighbourhood without being told,
So that the district has places in it rather than being uniformly itself.

**Acceptance Criteria:**

**Given** nothing is hand-placed, so character must come from generator parameters
**When** neighbourhoods are parameterised
**Then** density, building age, affluence and land-use mix are the four dials
**And** no fifth mechanism is introduced to make a neighbourhood feel different

**Given** a player walks from one neighbourhood into another
**When** they cross the boundary
**Then** the change is legible from the buildings, their state, the shop types and the crowding, without any label

**Given** these same parameters must later make the gentrification loop legible
**When** they are implemented
**Then** physical state, desirability and land use are readable quantities rather than opaque generator internals

**Given** local density is the constraint that makes a street read as busy
**When** density is parameterised
**Then** a commercial core supports the citizen density a busy screen requires, and a residential edge supports far less

### Story 3.8: The Walkability Grid

**Leads:** quentin, tim

As a developer,
I want a tile-level truth about where a body can stand,
So that routing and collision are both derived from one place.

**Acceptance Criteria:**

**Given** the walkability grid is per floor and derived from object footprints
**When** the district is generated
**Then** one grid exists per floor and is materialised as a generation output

**Given** the grid is server-side and used to build and repair the macro graph
**When** it is produced
**Then** the client receives derived walkability for its own collision and steering, not the grid's authoring form

**Given** a structural change occurs later (a welded door, a road closure)
**When** it happens
**Then** the grid is patched rather than regenerated

### Story 3.9: The Macro Routing Graph

**Leads:** quentin, tim

As a developer,
I want a graph whose edges are priced in minutes,
So that the commute tax, agent routing and the transport ladder are one system rather than three.

**Acceptance Criteria:**

**Given** the macro graph is emitted as a generation output into SpacetimeDB tables
**When** the 512x512 district is generated
**Then** the graph is of the order of a few thousand nodes and roughly ten thousand edges

**Given** nodes are transit points, sources and portals
**When** the graph is built
**Then** each carries floor and position, and source nodes carry a business id

**Given** edge cost is denominated in minutes, the game's only currency
**When** an edge is created
**Then** its cost is in minutes and no second distance unit exists anywhere in the graph

**Given** interiors would balloon the graph for no routing benefit
**When** a building is added
**Then** it collapses to an entrance node, plus an internal node only if it is large

**Given** portal edges are the only edges crossing floors
**When** the graph is validated
**Then** every edge whose endpoints differ in floor is a portal, and this is asserted rather than assumed

**Given** the graph lives in tables rather than module globals
**When** a reducer aborts after modifying it
**Then** the graph rolls back with the transaction
**And** it survives restart and republish without rebuilding

### Story 3.10: Provisions

**Leads:** quentin, derek, tim

As a developer,
I want the routing graph to also answer "what is near me that provides food",
So that one index serves both movement and choice.

**Acceptance Criteria:**

**Given** source nodes advertise provisions
**When** a provision query runs
**Then** it is a spatial lookup over the same structure routing uses

**Given** a venue may provide several things - a cafe is both Food and Social
**When** provisions are stored
**Then** they are rows in a separate table rather than a column
**And** one venue can satisfy two different needs

**Given** provisions carry a quality value
**When** a source is created
**Then** quality is set from the building type and neighbourhood affluence

**Given** source nodes join to business identity
**When** a provision is queried
**Then** the business id is available on the result, so "do I know this place" is a lookup on a key already in hand

### Story 3.11: The Distance Estimator

**Leads:** quentin, tim

As a developer,
I want a cheap origin-independent distance in minutes,
So that scoring many candidate destinations never runs a pathfind.

**Acceptance Criteria:**

**Given** distance is Manhattan, computed fresh, converted to minutes
**When** an estimate is requested
**Then** it is `manhattan_cells x minutes_per_cell(transport_mode) + floor_change_penalty`
**And** no cached distance is stored anywhere

**Given** the city is generated as square blocks
**When** Manhattan is compared against Euclidean over real generated geometry
**Then** Manhattan is the closer estimate, confirming the choice rather than assuming it

**Given** the estimator is denominated in minutes and parameterised by transport mode
**When** a faster mode is supplied
**Then** the estimate falls proportionally, so the transport ladder acts on scoring without a special case

**Given** the estimator lives in pure code with no table access
**When** it is tested
**Then** thousands of cases run in CI with no database

**Given** Manhattan ignores rivers, rail cuttings and closed parks
**When** the estimate is optimistic in such a place
**Then** this is accepted as a person misjudging a route, and a per-region correction factor remains available but unused

### Story 3.12: Pathfinding

**Leads:** quentin, tim

As a developer,
I want one A* run after a destination is chosen rather than during the choice,
So that pathfinding cost scales with decisions taken rather than with options considered.

**Acceptance Criteria:**

**Given** scoring is arithmetic over candidates and pathfinding happens once, afterwards
**When** a destination is selected
**Then** exactly one A* runs, over the macro graph, for that destination only

**Given** A* returns a route
**When** the route is stored
**Then** it carries the information needed to derive a position at any time within it

**Given** the client never sees the macro graph
**When** subscriptions are scoped
**Then** no macro graph table is client-visible
**And** the client's only routing input is a chosen route delivered in an agent's state

**Given** A* must be deterministic
**When** two runs are made over the same graph with the same endpoints
**Then** they return the identical path, because collections are ordered and no unordered iteration influences the result

### Story 3.13: Determinism and Rule-Set Versioning

**Leads:** quentin, tim

As a developer,
I want the same seed to produce the same city forever,
So that the world can be extended in two years without contradicting itself.

**Acceptance Criteria:**

**Given** determinism breaks from floating-point drift across toolchains, unordered map iteration and RNG changes under dependency bumps
**When** the generator is written
**Then** it uses integer or fixed-point arithmetic, ordered collections and a pinned RNG throughout
**And** any introduction of a float into the generation path fails review

**Given** the city records the rule-set version it was generated under
**When** rules change afterwards
**Then** the existing city is not regenerated
**And** the recorded version remains readable for the life of the world

**Given** the city is generated once and persisted rather than re-rolled
**When** the server restarts
**Then** the world is loaded, not regenerated

**Given** new neighbourhoods later run under the current rules
**When** the district is extended in future
**Then** visible difference between old and new areas is expected and welcome, not a defect

### Story 3.14: The Determinism Harness

**Leads:** quentin, tim

As a developer,
I want a test that regenerates from seed and diffs the result,
So that a determinism regression is caught by CI rather than by a player.

**Acceptance Criteria:**

**Given** the harness regenerates a district from a fixed seed and rule-set version
**When** it compares against a stored reference
**Then** any difference is reported with the first divergent cell or node named

**Given** determinism must survive dependency bumps
**When** a dependency changes
**Then** the harness runs and fails loudly if generation output moved

**Given** the harness serves R3
**When** it is built
**Then** it covers geometry, the collision map and the nav graph, not geometry alone

**Given** debug tooling registers with Epic 1's framework
**When** the harness is invoked interactively
**Then** it reports through that framework rather than through its own surface

### Story 3.15: The Nav Graph Patch Format

**Leads:** quentin, tim

As a developer,
I want the patch log's shape decided before anything writes to it,
So that a permanent schema decision is not made by accident under time pressure.

**Acceptance Criteria:**

**Given** primary keys and scheduling status cannot be changed after the first commit
**When** the patch log is defined
**Then** its schema is final in this story, even though patches are not applied until later epics

**Given** the city must be reproducible from seed plus patch history
**When** a patch is recorded
**Then** it carries enough to replay the structural change deterministically

**Given** determinism wants a replayable history and state growth wants the log compacted, and these pull opposite ways
**When** this story completes
**Then** a decision is taken and recorded - periodic re-baselining (snapshot the graph, truncate the log) is the expected shape, but the decision is made deliberately rather than by default
**And** the table declares its bound, as every accreting table must

**Given** patches are applied by later epics rather than this one
**When** this story completes
**Then** the format and the log exist and are empty
**And** nothing in this epic writes a patch

### Story 3.16: Walk the District

**Leads:** quentin, derek, tim, artie

As a player,
I want to walk out of my door and across a whole generated city,
So that everything this epic produced is proven by being lived in rather than by passing a test.

**Acceptance Criteria:**

**Given** a 512x512 district generated from a seed
**When** a player walks from one edge toward the core
**Then** the traverse takes roughly 233 real seconds on foot, consistent with the settled walking speed

**Given** the district is walked end to end
**When** the player enters buildings along the way
**Then** at least 100 are enterable, furnished, and correctly wall-retracted on entry

**Given** neighbourhood parameters differ across the district
**When** the player crosses between neighbourhoods
**Then** the difference is legible without being labelled

**Given** the hand-laid test street from Epic 1 was explicitly disposable
**When** this story completes
**Then** it is deleted rather than kept alongside the generated world

**Given** this is the epic where A5 either holds or does not
**When** the district is walked
**Then** an honest judgement is recorded on whether the rules produce streets worth walking
**And** if they do not, that finding reopens the rule content rather than being absorbed as acceptable

---
