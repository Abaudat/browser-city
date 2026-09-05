# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Hosting                       | SpacetimeDB Maincloud                                                                                    |
| Client                        | TypeScript + PixiJS v8, bundled by Vite                                                                  |
| Client SDK                    | the `spacetimedb` npm package                                                                            |
| Client bindings               | `spacetime generate --lang typescript --out-dir client/src/net/bindings` — generated, never hand-written |
| Rendering                     | PixiJS WebGPU with WebGL fallback; `@pixi/tilemap` for tile layers                                       |
| Audio                         | Web Audio directly, or a thin wrapper                                                                    |
| Art source                    | `ModernTileset/` — whole-object PNGs, nothing pre-split                                                  |


## Authority

Authority follows consequence: what cannot change the ledger runs client-side.


| Concern                                        | Side                               |
| ---------------------------------------------- | ---------------------------------- |
| The ledger, all records                        | Server                             |
| L1 boundary, L2 citizen brain, citizen routing | Server                             |
| Player movement and player collision           | Client, authoritative, unvalidated |
| L3 micro brain, rendering, animation, audio    | Client                             |


The server does no per-frame work and no sub-tile collision for any entity. Player position is not
policed: there is no PvP, no death and no competition.

## World model

One tilemap. Every cell is addressed `(x, y, floor, layer)`.

- **Floor** is the vertical axis and the collision domain — bridges, storeys, subway, roofs.
Collision tests only within an entity's own floor. Floors join at transition cells: stairs,
ramps, ladders, station steps, manholes.
- **Layer** is a composition slot within a floor: Ground, Ground decals, Ground objects,
Furniture, Objects, Walls, Wall decals. Collision, generation and interaction read it. It is not
draw order.
- **Interiors live in the same tilemap**, at their building's footprint. Doors are ordinary
walkable cells; there are no portals, and the navmesh is one connected graph per floor.
- Cells carry a **building/room ownership id**, which keys wall retraction and culling.
- **One row per placed object instance**, keyed on an instance id, `#[index(btree)]` on
`(floor, x, y)`, anchored at its bottom-left cell — smallest x, largest y. Extent comes from
`object_def`; covered cells hold no row of their own. Several objects may share an anchor.
- **Footprints are capped at 8x8 cells.** Larger structures are composed of several objects.
- Building footprints are sized by interior usability, not by street frontage.

### Depth sorting

- Three flat passes — Ground, Ground decals, Ground objects — then one y-sorted pool. No top pass.
- Pool key `(y, layer_rank, x, object_id)` ascending, `layer_rank` in tens:
Furniture 0 · Objects 10 · Walls 20 · Wall decals 30 · Characters 40.
- `layer_rank` resolves same-cell ties only.
- Objects are never sliced. Sprite height and width never affect depth.
- Floor is a vertical screen offset, never a sort key.

### Visibility

- A roof is the floor above, drawn at its offset.
- Windows are semi-transparent wall tiles. No masking, no apertures.
- Near-side walls retract for the building the player occupies.
- Culling is per enclosure, keyed on the ownership id.

## Collision

- **Walkability** is tile-level per floor, server-side, emitted by generation and patched on
structural change.
- **Sub-tile collision is derived client-side**: rows expand into a grid on insert, update and
delete — `O(footprint)` per write, `O(1)` per lookup. Neither side queries rows to answer
"what is at `(x, y)`".
- Citizens route on the navmesh and never collide.

```rust
object_def {
    id, name,
    layer,                    // layer_rank
    atlas_page, rect,         // whole-object sprite, one rect
    footprint: (w, d),        // cells, from the anchor
    collider: Option<Rect>,   // pixels, anchor-relative; None means walkable
    interact_at: Option<(i8, i8)>,
    container_grid: Option<(w, h)>,
}
```

There is no walkable flag — absence of a collider is walkability. The collider is one AABB, and
`collider` lies inside `footprint`. `object_def` is compiled into the module and shipped to the
client as a cached static asset: two parsers, one source file.

**Footprints are inferred once, offline** — propose from alpha coverage of the sprite's lower band,
classify against archetypes, validate, review as a contact sheet. Never at spawn time. Validation
invariants: every prop has a nonzero footprint or sits on an explicit walkable allow-list; rects
lie within sprite bounds; doorway cells leave a gap at least one character wide; every walkable
region of a generated district is reachable.

## Navigation

Two structures: the walkability grid above, and the macro routing graph, which is **tables, never
module globals** — a rollback must revert it and a restart must not lose it.

```rust
nav_node       { id, kind: Transit | Source | Portal, floor, x, y, business_id: Option<u32> }
                 // index(btree) on (floor, x, y)
node_provision { node_id, provision, quality }
                 // index(btree) on (provision)
nav_edge       { from, to, cost_minutes, kind: Street | Interior | Transit | Portal }
```

- **Edge cost is denominated in minutes**, the game's only currency, so the transport ladder is an
edge-cost modifier rather than a special case.
- `Portal` edges are the only edges where `from.floor != to.floor`.
- Interiors collapse to an entrance node, plus an internal node for a large building.
- Source nodes advertise provisions, so the routing graph is also the index of what the city
offers; `business_id` joins them to `citizen_memory`.
- The client never receives the macro graph.
- **Utility scoring uses a fresh Manhattan estimate**, never a stored distance:
`manhattan_cells × minutes_per_cell(mode) + floor_change_penalty`.
- One A* runs after the choice, not during scoring. Commute routes are cached on the citizen and
recomputed on disturbance.
- **There is no route invalidation.** A citizen whose cached route crosses a new obstruction hits
it, re-routes and overwrites the cache; a citizen planning fresh uses the patched graph.

## Simulation


| Layer              | Scope                                  | Cadence             | Runs                             |
| ------------------ | -------------------------------------- | ------------------- | -------------------------------- |
| L1 — boundary      | External prices, in-migration, weather | Slow                | Server, always                   |
| L2 — citizen brain | Goals, schedule, employment, needs     | At transitions only | Server, every citizen, always    |
| L3 — micro brain   | Steering, avoidance, gait, flavour     | Per frame           | Client, instantiated bodies only |


- **L1 is only what has no author inside the simulation.** It has no access to player state and
hands no number to anything inside the city. Wages and prices are set by employers and
businesses, one posting and one shop at a time.
- **L2 is advanced by a scheduled table** — one row per pending transition, one reducer invocation
per due row, the row deleted on firing, and scheduling transactional with the state change that
decided it. Nobody ticks. There are no plans and no committed chains, so there is nothing to
invalidate.
- **L3 (D-L3) is simulated by every client for the NPCs in its own bubble.** No ownership, no
assignment, no handoff. Divergence is bounded to sub-tile steering.
- **Obligations are a calendar; own-time is utility.** Scoring runs over a small bar set — money,
rest, hunger, social, pursuit drive — plus habit, with a one-step horizon. Traits (caution,
ambition, diligence, sociability, frugality) are per citizen and weight the same evaluator that
scores an evening and an inbox.
- **Citizens act on stale belief.** Externally visible state is observed on passing. Nothing is
broadcast; knowledge travels on physical carriers.

### Bodies

There is no simulation zone; only bodies have one. Citizens carry no coordinates.

```rust
actor_location   { actor_id, kind: Player | Citizen, chunk, floor }  // index(btree) on (chunk)
citizen_state    { citizen_id, activity, location }
                   // location = At(node_id) | InTransit(route_id, t_depart, t_arrive)
player_transform { player_id, x, y, facing }                         // overwritten in place
citizen_memory   { citizen_id, business_id, habit_strength, last_contact,
                   known_state, known_state_at }
```

- A citizen's position is derived from `(location, now)`. A player's is authored, so only it is
transmitted — one row overwritten in place at about 10 Hz, which is both the rendering channel
and the durable state.
- `chunk` exists **only** because subscriptions filter on stored columns. It is updated on
crossing.
- Populating a region is a query over indexed route segments and located activities, never a
promotion. Subscribe ahead of intent; the body zone carries margin and despawns with hysteresis.
- `citizen_memory` is keyed on the business, written on surprise only, deleted when reality returns
to the public default, capped per citizen by LRU, and fan-out deleted when a business dies.
`known_state` NULL means the public default. It holds no distance field, and a row may be written
only by an observation or an interaction at a defined location and time.

### Drivers

A body has exactly one driver, and it is swappable: `SelfL2`, `Understudy` or `Player`.

- The procedure state machine is the shared substrate. The driver decides how a step is performed,
never what the state is; L2 state is never suspended.
- Handover snaps to the current step boundary. Taking over cancels the pending scheduled
transition; handing back re-creates it.
- **The understudy only adds** — money, payslips, a receipt. It never subtracts, replaces,
consumes, degrades or rearranges.
- A player may perform a procedure badly, but never outside its state space.

## Institutions and economy

- A **matter** is an item of institutional business scoped to a jurisdiction and a place. Four
inbound fluxes, each with an author and a carrier: citizen-filed, worker escalation,
inter-institutional request, calendar. Nothing arrives by detection (NFR18).
- Matters are scored on severity, age, cost against budget, jurisdiction fit, disposition, and who
raised it — that last term read from the decider's own `citizen_memory`.
- **Approve, Deny, Defer and Escalate are all first-class.** A decision record carries the action, a
reason code and the severity at the time, so re-raising requires material change rather than a
timer.
- Matters expire after N in-city weeks, which is that table's bound.
- **Chains are declared step sequences** — durable, multi-step, surviving restart and deploy. An
order is a chain instance, so logistics is the chain engine pointed at goods.
- **Stock is `(holder, item, quantity)`**, held by a business instance rather than a room or a
brand. It moves only inside a work-procedure step or a consumption event.
- **Cash is ordinary stock** — denominations are items, and a till can run out. Bank money is a
balance per holder.
- Discrete items are instances with a position; bulk is a quantity inside a discrete container.
Containers hold a Tetris grid whose cells are the object's world footprint, with the grid size on
the object definition. NPCs pack by first fit on that same grid.
- **Routine jobs** are a fixed sequence of steps over local state, with branches. **Decider jobs**
are agenda selection over matters. Both run the same evaluator.

## Data and configuration

Three tiers, split by who changes a thing and how often.


| Tier        | Contents                                                   | Where                                           |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Constants   | tile size 16, day = 60 real minutes, layer ranks           | Compiled, one source with a generated TS mirror |
| Balance     | parameters of decision functions                           | Tables, seeded at init, runtime-tunable         |
| Definitions | `object_def`, items, recipes, professions, chain templates | Baked with the build under `defs_version`       |


- Balance holds the parameters of decision functions, never the values they produce. Its shape is a
flat key-to-value table with dotted `snake_case` keys and a documented registry.
- **Live parameters and seed values are marked distinctly.** Tuning a seed value on a running world
does nothing; the city already exists.
- `**defs_version` covers atlases, definitions, the audio manifest and the schema version
together.** It is compared at connect, and the client refreshes on mismatch.
- **Sprites never go through the database.** Atlas pages are 2048x2048, packed by neighbourhood and
theme, content-hashed, served over HTTP and cached by the service worker. One build command emits
the pages and `object_def` together.
- **A citizen's appearance is five indices** — body, eyes, outfit, hairstyle, accessory — generated
coherently and deterministically from the citizen id. All five sheets share one frame layout, so
one `(animation, direction, frame)` index selects from each. The runtime caches each unique
composite to a single texture.

### Generation

- Multi-pass, coarse to fine: land use, street network, plot subdivision, building envelope,
building type, interior layout, prop placement.
- **Rules are data in `defs/`, evaluated by a generic engine.** Five kinds: placement,
distribution, coherence, adjacency, requirement.
- **The generator and the validation harness read the same rule source.**
- `seed + rule-set version` reproduces the city. The city records the version it was generated
under; rule changes never regenerate it, and new areas are generated under current rules.

## Client

- **Input produces intents, not actions (D16).** A click resolves to an object instance through the
derived grid, checks reachability against `interact_at`, and emits an intent; what it means is the
procedure's business. Movement is local and immediate. Keybindings live in `localStorage`.
- **All UI is DOM (D17)** — the boot name prompt, the options menu, connection notices. **The canvas
may draw transient, object-bound views, and nothing persistent, global or abstract.** Container
views are the only such case, and `client/src/ui/canvas/` holds them and nothing else.
- Items on a surface are in the world, sub-tile positioned, with no view. Items in a container are
seen through that container's transient view.
- **Boot:** the name prompt is DOM in the HTML shell, interactive at first paint while the payload
streams. First-ever spawn is the flat interior, not a street. A return visit reads the token from
`localStorage`. Levers: progressive first frame, a small initial subscription widened after it, a
service worker over bundle and atlases, atlases split by neighbourhood, prefetch along intent.
- **Identity is anonymous-first.** SpacetimeDB issues it during the handshake; the client stores the
token and re-presents it with `.withToken()`. OIDC linking is optional and mints a *second*
identity, so a `character ↔ identity` table — one character, N identities — exists from the first
schema.
- Object animation is client-side and non-authoritative, looping or state-driven, with phase seeded
from the object id. Characters are directional walk cycles applied per appearance layer.
- Audio reads the same derived state as the renderer: ambient beds crossfaded by environment,
neighbourhood and time of day, interior transitions by low-pass filter, positional one-shots.
Earshot is deliberately wider than the viewport. Diegetic music is an emitter, not a system.

## Repository

```
defs/                 source of truth — data, not code
  objects/ items/ recipes/ professions/ chains/ balance/

server/               Rust SpacetimeDB module
  src/tables/           table declarations by domain
  src/sim/              PURE — no table access, property-tested
    utility/ matters/ nav/ appearance/
  src/reducers/         read -> call sim -> write
    citizen/ institution/ economy/ boundary/ world/ player/
  src/clock/            in-city time
  src/config/           balance access, constants
  src/debug/            time control, inspectors
  tests/                property tests over sim/

client/               TypeScript + PixiJS
  src/boot/ net/ world/ render/ entities/ l3/ input/ audio/ debug/
  src/ui/dom/           out of fiction
  src/ui/canvas/        container views only

tools/                offline pipeline
  atlas-packer/ footprint/ defs-build/ character-parts/
```


| System                          | Location                                            |
| ------------------------------- | --------------------------------------------------- |
| L1 — the boundary               | `server/src/reducers/boundary/`                     |
| L2 — citizen brain              | `server/src/reducers/citizen/` + `sim/utility/`     |
| L3 — micro brain                | `client/src/l3/`                                    |
| Matters, chains, deciders       | `server/src/reducers/institution/` + `sim/matters/` |
| Stock, orders, money            | `server/src/reducers/economy/`                      |
| Nav graph, walkability          | `server/src/reducers/world/` + `sim/nav/`           |
| Player collision, depth sorting | `client/src/world/`, `client/src/render/`           |
| Character composition           | `client/src/entities/` + `sim/appearance/`          |
| Observability                   | `server/src/debug/` + an external watcher           |


Beyond NFR28 and NFR30 to NFR32: `server/` never names a rendering concept, and `client/` never
names a simulation one.

### Naming


| Element                            | Convention             | Example                               |
| ---------------------------------- | ---------------------- | ------------------------------------- |
| Rust modules, functions, fields    | `snake_case`           | `score_matter`                        |
| Rust types                         | `PascalCase`           | `MatterKind`                          |
| TypeScript files                   | `kebab-case.ts`        | `sort-key.ts`                         |
| TypeScript types and classes       | `PascalCase`           | `CollisionGrid`                       |
| TypeScript functions and variables | `camelCase`            | `deriveCitizenPosition`               |
| Files in `defs/`                   | `kebab-case`           | `city-props.toml`                     |
| Data keys                          | `snake_case`           | matches Rust, so no translation layer |
| Balance keys                       | dotted `snake_case`    | `citizen.bar_decay.rest`              |
| Table names                        | `snake_case`, singular | `citizen_state`                       |


## Observability and debug

- A scheduled reducer samples per-table row counts and bytes into `table_metrics` on a slow
cadence. An external watcher subscribes to it and alerts on a table's declared threshold or on
the storage review trigger. Alerting lives outside the module, off the critical path.
- One pipeline serves table growth, cost per reducer class, and the gameplay metrics.
- Debug tools are compiled in behind a flag not exposed in production, and presented in a
deliberately non-diegetic style: clock multiplier and jump; a causality inspector answering why a
citizen is where they are; overlays for footprints, navmesh, chunks, sort order and routes; a
matter and chain inspector; a determinism harness that regenerates from seed and diffs.

## Toolchain


| Prerequisite    | Notes                                                          |
| --------------- | -------------------------------------------------------------- |
| Rust via rustup | with `rustup target add wasm32-unknown-unknown`                |
| SpacetimeDB CLI | `spacetime dev` for hot reload, `spacetime publish` to release |
| Node.js         | client build                                                   |


Back up the world before every migration, and restore from a backup at least once before trusting
it.