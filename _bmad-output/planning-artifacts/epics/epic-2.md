[← Epics index](index.md)

Story status is **not** recorded here. It lives on the GitHub Project board, which `scripts/orchestrator.sh` reads and writes; these files are the plan, not the tracker.

---

## Epic 2: The Content Pipeline

An agent can author world content and have its own work validated, without a human ever placing a tile.

**Why this is an epic and not plumbing.** The design ships no hand-authored content, so the generator's rules *are* the content pipeline (A5). Everything downstream inherits their quality and there is no fallback of hand-laying a good street. The specific danger is R9: wrong prop metadata fails **quietly** — a bin with no collision, a manhole you cannot descend — so the deliverable of this epic is not the authoring tool but the **failure detector**.

**Relationship to Epic 1.** Epic 1 loaded a hardcoded object set and raw part PNGs directly, to have something to render. This epic replaces that with `defs/` and packed atlases. Where a story here supersedes an Epic 1 shortcut, it says so.

### Story 2.1: The defs Source of Truth

**Leads:** quentin, tim

As a developer,
I want one directory that both build targets consume and neither writes,
So that the client and the module can never disagree about what a thing is.

**Acceptance Criteria:**

**Given** `defs/` holds data and not code, subdivided into `objects/`, `items/`, `recipes/`, `professions/`, `chains/` and `balance/`
**When** the build runs
**Then** `tools/defs-build/` emits a Rust include for the module and a static asset for the client from that one source
**And** neither generated output is edited by hand

**Given** the server and client share no code by design
**When** both consume the same definition
**Then** they do so through two independent parsers over one generated source
**And** this duplication is documented as deliberate rather than as an oversight

**Given** a single `defs_version` covers prop atlases, character-part atlases, `object_def` and the audio manifest
**When** any one of them changes
**Then** the version changes for all of them
**And** nothing versions independently

**Given** a definition file is malformed
**When** the build runs
**Then** the build fails with the offending file and line named
**And** no partial output is emitted

### Story 2.2: Object Definitions

**Leads:** quentin, tim

As a developer,
I want every placeable thing described by one record,
So that collision, depth sorting, walkability and inventory all read the same rectangle.

**Acceptance Criteria:**

**Given** an `object_def` carries id, name, layer, atlas page, sprite rect, footprint in cells, an optional collider in anchor-relative pixels, and an optional `interact_at`
**When** a definition is authored
**Then** the sprite rect is one whole-object rectangle, because the tileset ships whole objects as single PNGs and nothing needs compositing

**Given** absence of a collider is walkability
**When** a definition omits the collider
**Then** the object is walkable
**And** no separate `walkable` flag exists anywhere in the schema

**Given** a multi-cell prop is one row placed at its anchor cell (smallest x, largest y)
**When** it is placed in the world
**Then** the covered cells hold no rows of their own
**And** extent is read from the definition rather than stored per cell

**Given** several objects may share an anchor cell (a rug, a table, a glass)
**When** they are placed
**Then** all three exist at that cell and are separated by `layer_rank` at draw time

**Given** footprints are capped at approximately 8x8 cells
**When** a definition exceeds the cap
**Then** the build rejects it and directs the author to compose the structure from multiple objects
**And** the cap holds because the region-subscription margin depends on it being a constant

### Story 2.3: Footprint Proposal and Classification

**Leads:** quentin, tim

As an agent,
I want a first guess at every prop's footprint that I can then correct,
So that authoring 3,000 definitions is a review task rather than a measurement task.

**Acceptance Criteria:**

**Given** a sprite's silhouette is not its footprint in an oblique projection with front-facing bias
**When** a footprint is proposed automatically
**Then** it is derived from alpha coverage of the sprite's **lower band** only
**And** the proposal is explicitly a starting point, never authority

**Given** the tileset's dominant city prop is 16x32 px - one cell of floor, two cells of screen height
**When** proposals are generated across the prop set
**Then** sprite height does not inflate footprint depth
**And** a 112x64 vehicle correctly proposes a footprint several cells deep, because depth greater than one is common rather than exceptional

**Given** an agent classifies each proposal against a set of archetypes
**When** a prop matches an archetype
**Then** the archetype supplies the footprint and collider shape
**And** the agent's correction is recorded in `defs/`, not in the tool

**Given** the pipeline runs offline exactly once per prop
**When** the world is generated or an object is spawned
**Then** no footprint is inferred at runtime, ever

### Story 2.4: Footprint Invariants

**Leads:** quentin, tim

As a developer,
I want the pipeline to catch wrong metadata by rule rather than by my eyes,
So that a silent-failure surface becomes a loud one.

**Acceptance Criteria:**

**Given** every prop must have a nonzero footprint or appear on an explicit walkable allow-list (manhole, rug, doormat, floor decal)
**When** validation runs
**Then** a trash can with no collision is rejected by name
**And** a manhole absent from the allow-list is rejected by name

**Given** the invariant `collider` is contained within `footprint`
**When** a definition violates it
**Then** validation fails and reports both rectangles

**Given** collider rects must lie within sprite bounds
**When** a definition places a collider outside its sprite
**Then** validation fails

**Given** doorway cells must leave a passable gap of at least the character's collider width
**When** a doorway is formed too narrowly
**Then** validation fails before that arrangement can reach the world

**Given** a walkable region enclosed with no door is unreachable
**When** graph reachability is checked over a test block
**Then** any enclosed region is reported
**And** the same check will later run over generated districts without modification, because it takes a walkability grid rather than a hand-laid map

**Given** invariants are the failure detector rather than review
**When** any invariant fails
**Then** the build fails and no definition set is emitted

### Story 2.5: Contact-Sheet Review

**Leads:** quentin, tim, artie

As a developer,
I want to see every footprint drawn over its sprite on one page,
So that the errors no invariant can express are still catchable by looking.

**Acceptance Criteria:**

**Given** invariants catch structural errors but not judgement errors
**When** the contact sheet is generated
**Then** each sprite is rendered with its footprint and collider overlaid
**And** props are grouped by archetype so that an outlier is visible by comparison

**Given** a prop's footprint is plausible but wrong (a bench a player should walk behind, marked as walk-through)
**When** the sheet is reviewed
**Then** the reviewer can identify it and correct the definition in `defs/`

**Given** the sheet is regenerated on every definition change
**When** a prop's footprint is edited
**Then** the change is visible on the next sheet without a manual step

### Story 2.6: The Atlas Packer

**Leads:** quentin, tim, artie

As a player,
I want the game to load without waiting for thousands of individual images,
So that the one-second boot is possible at all.

**Acceptance Criteria:**

**Given** the tileset holds 23,519 PNGs across 135 MB
**When** the packer runs
**Then** only the used subset is packed, into 2048x2048 pages

**Given** the boot budget depends on a spawn screen referencing few pages
**When** pages are packed
**Then** they are grouped by neighbourhood and theme, following the tileset's own theme-sorter organisation
**And** a single spawn screen resolves against a small number of pages rather than the whole set

**Given** page filenames are content-hashed
**When** a page's contents are unchanged between builds
**Then** its filename is unchanged and the browser cache and service worker keep it
**And** versioning is free rather than a mechanism

**Given** rects and definitions must never drift apart
**When** the packer runs
**Then** it emits the atlas pages and the `object_def` rects together as one operation
**And** both are covered by the same `defs_version`

**Given** the GPU binds a limited number of textures simultaneously (commonly 16, sometimes fewer)
**When** pages are packed
**Then** the simultaneously-bound count for a typical scene stays around eight
**And** the packing rule that guarantees this is asserted at build time rather than hoped for

### Story 2.7: Character-Part Atlases

**Leads:** quentin, tim, artie

As a player,
I want a crowd of visibly different people to cost about as much as a crowd of identical ones,
So that a busy street is affordable.

**Acceptance Criteria:**

**Given** each of the five character parts is a complete spritesheet containing all animations
**When** the parts are packed
**Then** the invariant that all five share an identical frame layout is asserted by the build, not assumed
**And** a part sheet with a mismatched layout fails the build by name

**Given** Epic 1 loaded raw part PNGs directly to have something to render
**When** this story completes
**Then** the client loads packed character atlases instead
**And** the Epic 1 shortcut is removed rather than left alongside

**Given** the character atlases count toward the simultaneously-bound texture limit
**When** they are packed
**Then** five character layers plus tile and prop atlases stay within the budget established in Story 2.6

### Story 2.8: The defs_version Handshake

**Leads:** quentin, tim

As a player,
I want a stale browser tab to notice it is stale,
So that the game never renders a world it is quietly misreading.

**Acceptance Criteria:**

**Given** a cached client holding old definitions would fail silently on an unknown `def_id`
**When** the client connects
**Then** the module publishes its `defs_version` and the client compares it against its own

**Given** the versions differ
**When** the comparison is made
**Then** the client refreshes its definitions and atlases before rendering anything
**And** it never draws a frame using a definition set it knows to be stale

**Given** `defs_version` also carries the schema and protocol version
**When** the module's schema has moved ahead of the client's bindings
**Then** the mismatch is detected at connect rather than at first divergent read

**Given** the versions match
**When** the client connects
**Then** the handshake costs no additional round trip on the common path

### Story 2.9: Tile Semantics and the Adjacency Grammar

**Leads:** quentin, tim, artie

As an agent,
I want to know what a tile means rather than only what it looks like,
So that I can place one correctly without a human telling me where it goes.

**Acceptance Criteria:**

**Given** a tile taxonomy describes semantic role rather than appearance
**When** a tile is classified
**Then** its role (ground, pavement, road, wall, floor, threshold, fixture) is data in `defs/`

**Given** adjacency rules state what may abut what
**When** two tiles are placed side by side in violation
**Then** the validation harness reports the violating pair and the rule that forbids it

**Given** a wall corner requires a specific arrangement, and a doorway is formed rather than drawn
**When** those constructions are expressed
**Then** they are grammar primitives in data, not special cases in code

**Given** room and building grammar primitives exist
**When** an agent composes a room from them
**Then** the result either satisfies the grammar or is rejected with a named reason

### Story 2.10: The Rule Engine

**Leads:** quentin, tim

As an agent,
I want new placement rules to be rows rather than code,
So that extending the city's grammar does not mean editing the generator.

**Acceptance Criteria:**

**Given** rules are data evaluated by a generic engine
**When** a new constraint such as "no cafe above floor 2" is added
**Then** it is a row in `defs/` and no engine code changes

**Given** the engine supports five constraint kinds
**When** rules are authored
**Then** placement (a cafe may not appear above floor 2), distribution (municipal services at roughly one per N dwellings, evenly spread), coherence (no skyscraper in a villa district), adjacency (what may abut what, how a doorway is formed) and requirement (every dwelling has a door, every room has a light, every business has stock space) are each expressible

**Given** a rule per special case is the known failure mode
**When** a new requirement arrives
**Then** it is satisfied by a row against an existing kind, or by a deliberate decision to add a sixth kind - never by a bespoke branch

**Given** rule sets are versioned
**When** a rule changes
**Then** the rule-set version changes with it

### Story 2.11: The Validation Harness

**Leads:** quentin, tim

As a developer,
I want the checker and the generator to read one source,
So that content cannot be silently bad.

**Acceptance Criteria:**

**Given** the generator applies the rules and the harness checks output against them
**When** both run
**Then** they read the same rule source
**And** any change that would let them read different sources fails the build

**Given** a correct block
**When** the harness runs over it
**Then** it passes with no violations reported

**Given** a deliberately broken block - a doorway too narrow, a room with no door, a skyscraper among villas, a cafe on the tenth floor
**When** the harness runs over it
**Then** each violation is reported individually, naming the rule and the location
**And** the harness does not stop at the first failure

**Given** this is A5's risk in its most dangerous form
**When** the harness is built
**Then** a test exists that deliberately points the two consumers at different sources and asserts the build fails

### Story 2.12: Agent Self-Verification

**Leads:** quentin, tim

As an agent,
I want to extend the rule set and confirm my own work,
So that content authoring scales past what one person can review.

**Acceptance Criteria:**

**Given** the scope assumes systems testable enough that agents can extend and validate them
**When** an agent adds a new tile semantic, adjacency rule or placement constraint
**Then** it can run the harness and read a pass or a named failure without human interpretation

**Given** documentation and test coverage are part of this epic's deliverable rather than a follow-up
**When** an agent reads `defs/`
**Then** each rule kind carries at least one worked example and one deliberately failing case

**Given** an agent's change breaks an existing rule
**When** the harness runs
**Then** the regression is reported against the specific rule that broke
**And** the failing case is added to the test set rather than only fixed

---
