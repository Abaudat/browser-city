# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Server workspace              | `server/` is a Cargo workspace: `sim` (pure logic), `bounds` (the table-bounds registry), and the `browser_city` module crate, which depends on both |
| Property testing              | `proptest`, dev-dependency of `sim` only; case count from `PROPTEST_CASES`                              |
| `serde`/`serde_json`          | Native-only tooling (`bounds`'s schema-snapshot serialization, the spike-report binaries under `server/spikes/*_report`, `server/tools/*` e.g. `world_backup`) — never a dependency of a published module crate |
| Hosting                       | SpacetimeDB Maincloud                                                                                    |
| CI / deploy                   | GitHub Actions is the only path to Maincloud; never a local `spacetime publish` |
| Client                        | TypeScript + PixiJS v8, bundled by Vite                                                                  |
| Client SDK                    | the `spacetimedb` npm package                                                                            |
| Client bindings               | `spacetime generate --lang typescript --out-dir client/src/net/bindings` — generated, never hand-written |
| Client lint/format            | Biome                                                                                                    |
| Client hosting                | GitHub Pages, deployed by CI on push to master                                                          |
| Rendering                     | PixiJS WebGPU with WebGL fallback; `@pixi/tilemap` for tile layers                                       |
| Audio                         | Web Audio directly, or a thin wrapper                                                                    |
| Art source                    | `ModernTileset/` — whole-object PNGs, nothing pre-split                                                  |
| Backup encryption             | `gpg --symmetric`                                                                                        |
| Backup tooling                | `scripts/ops/*.sh` shell `spacetime sql`/`spacetime call`/`describe --json`; `server/tools/world_backup` (native, `serde_json` `arbitrary_precision`) parses and canonicalises, never `jq` |
| Defs tooling                  | `tools/defs-build` — standalone native Rust binary crate (own `Cargo.toml`/`Cargo.lock`/`rust-toolchain.toml`, outside both `server/`'s workspace and the client), depends only on `toml` and `serde`; never a dependency of `browser_city` or the client bundle |


## Authority

Authority follows consequence: what cannot change the ledger runs client-side.


| Concern                                        | Side                               |
| ---------------------------------------------- | ---------------------------------- |
| The ledger, all records                        | Server                             |
| L1 boundary, L2 citizen brain, citizen routing | Server                             |
| Player movement and player collision           | Client, authoritative, unvalidated |
| L3 micro brain, rendering, animation, audio    | Client                             |

## Purity and determinism

`sim` never depends on `spacetimedb` (or anything that touches a network,
the filesystem, or the wall clock) and never will (NFR28) — `reducers/`
reads tables, calls `sim`, writes tables. `sim` is integer/fixed-point only,
uses ordered collections (`BTreeMap`/`BTreeSet`, never `HashMap`/`HashSet`),
and seeds its own PRNG (`sim::rng`, xoshiro256++ via splitmix64 — never
`rand`) from stable ids, never from a local source (NFR25, NFR26). Its
determinism is pinned by a committed golden vector, keyed by
`sim::rng::RNG_VERSION`; the golden and the version move together.

`browser_city` cannot be linked natively, so anything requiring a native
test lives in `sim` or `bounds`.

Every table declares a bound in the `bounds` crate's `TABLE_BOUNDS`
registry, mechanical or engineering (NFR37).

The published module runs with `overflow-checks` and `debug-assertions` on
(`server/Cargo.toml`'s `[profile.release]`, the profile `spacetime build`
uses): a `debug_assert!` is a production abort, not a test-only aid, and a
wrapping-arithmetic bug aborts the reducer rather than writing inconsistent
state (NFR41).

## Scheduled reducers

A single scheduled-reducer fire's dispatch drift may be assumed within
2.5 real seconds (one in-city minute at FR1's 24x compression); no
gameplay system may assume finer real-time precision than that.

A repeating schedule's absolute phase is not guaranteed to survive more
than a few ticks unless it is explicitly re-anchored to its own original
target on every reschedule, never to the time it actually fired -- a
repeat built the second way compounds its own lateness indefinitely
regardless of which SpacetimeDB API produced it. A system whose
correctness depends on phase over a session-length run (the day-night
cycle, a transit timetable, an L2 tick) must be built the first way, and
must additionally bound its own catch-up: re-anchoring to the original
target with no further care dispatches every missed tick back-to-back
after any pause (a deploy, a host stall) until it is caught up, which is
its own unbounded-burst hazard. A phase-preserving repeat must skip ticks
it cannot deliver on time, or clamp the elapsed-time delta it simulates,
rather than replaying them all.

Schedules are derived state: rebuilt from durable tables, never trusted
to outlive a deploy purely by surviving as pending rows. See
docs/spikes/1.3-scheduled-reducer-timing.md.

## Backup

See docs/spikes/1.4-backup-restore.md for the platform investigation and
the measured limitations behind these rules.

- Export via `scripts/ops/export-world.sh`, before every migration and
  daily once the deploy story wires it in; gpg-encrypted before it ever
  reaches an Actions artifact, retained 90 days.
- Restore only through the `restore_*` reducers
  (`server/src/tables/restore.rs`), into a fresh database, by the owner
  identity, at the exported schema.
- auto_inc tables are restored through their own sequence (id `0`),
  never with an explicit id, and advanced past the exported sequence
  position (`manifest.json`'s `sequence_floors`); a restore never
  re-issues an id.
- Scheduled tables are never restored.
- Consistency is per table, not across tables.
- Every non-scheduled table has a `restore_<table>` reducer, checked
  mechanically (`bounds/tests/restore_coverage.rs`); the round trip is
  proven by `scripts/ci/check-backup-restore.sh`.

## Schema

Fix the permanent decisions first. In SpacetimeDB a primary key and a
unique constraint are permanent, and a normal table can never become a
scheduled one (NFR33, NFR34) — everything else in the schema is additive
and just-in-time. So:

- Every entity table has a surrogate `u64` primary key, `#[primary_key]
  #[auto_inc]` — never composite, never a `String`, never an `Identity`,
  never a natural key. The one exception is a table sharing another
  table's id on purpose (NFR35's narrowness split, e.g. hot state keyed to
  its static row's id).
- A unique constraint is declared only where a real invariant demands it,
  documented in the column's own doc comment. FR142/D5's
  `character`/`character_identity` mapping is the canonical example:
  `identity` is `#[unique]` (an identity reaches at most one character);
  `character_id` is a plain index, not unique (one character, N
  identities).
- Tables are private by default; `public` is added only once the client
  demonstrably reads a table, and the generated bindings are regenerated
  in the same PR (`check-bindings-current.sh`).
- An extensible set (NFR36) is a `u32` code plus a companion data table,
  never a Rust enum, so a new variant is a row insert rather than a
  migration. Seeding is idempotent and lives in an explicit `reseed_codes`
  reducer (called from `init`, and re-callable by hand) rather than on a
  hot lifecycle path — publishing a module that adds a code is followed by
  calling `reseed_codes`, which is the deploy work's job to automate.
- An operator-facing reducer (`reseed_codes` is the first) is never left
  open to any caller: `init` records the publishing identity in the
  one-row `module_owner` table, and the reducer rejects any other caller
  via `tables::ops::require_owner`. The next operator reducer (a balance
  reload, a world fixup) copies this, not a fresh ad hoc check.
- One scheduled table per system that owns a cadence (NFR34), declared
  even before it is used, each with a scheduler-only reducer stub (rejects
  any `ctx.sender() != ctx.database_identity()`) — never one shared tick
  table.
- Static description and hot state never share a table (NFR35): what
  rewrites at a different frequency, or would need wholesale replacement
  independently, lives in its own table from the first commit.
- `server/schema.snapshot.json` (generated by `bounds`'s
  `regen-schema-snapshot` binary, kept current by
  `bounds/tests/schema_snapshot_current.rs`) pins every table's shape,
  column order included. `scripts/ci/check-schema-additive.sh` diffs it
  against the PR's merge base and fails on a moved primary key, a moved
  unique constraint, a changed scheduled status, a removed/retyped/reordered
  column, or a column appended without `#[default(...)]` or `#[auto_inc]`.
  `scripts/ci/check-live-migration.sh` proves the positive and negative
  halves of that last rule against a real local SpacetimeDB instance.
  A code's number in `sim::codes` is as permanent as a primary key;
  `scripts/ci/check-codes-append-only.sh` diffs
  `sim/tests/goldens/codes_*.golden` the same way.

## World addressing

A cell address is `(x: i32, y: i32, floor: i8, layer: u32)` (FR117). `x`/`y`
are absolute world tile coordinates, always signed, never chunk-relative in
a stored column. `floor` is signed (the subway is floor -1, FR122) and is
`i8`. `layer` is a `u32` code plus its companion `layer_code` data table
(NFR36, never a Rust enum, minted in `sim::codes::layer` with its FR123
depth-sort `rank` carried inline on the same code entry) and is purely a
rendering-order dimension (read by story 1.6) -- it is never a second
collision dimension; a collision test always consults one floor's whole
merged blocking set. A layer's `rank` is as permanent as its `code`
number and pinned by the same codes golden -- story 1.6 must get a
layer's depth order right the first time.

There is no dense per-cell table, and there never will be: cell facts are
always derived from placed content, never stored per cell.

- Walkability is the absence of a collider (FR128): computed by
  rasterising the colliders the placed objects on an entity's floor
  contribute, never a stored walkable/collision column.
- Building and room ownership (FR119) is areas, not per-cell: `building`
  and `room` rows carry a surrogate id; `building_area`/`room_area` rows
  hold the axis-aligned rectangles that belong to one such id. A
  non-rectangular footprint is several rects. Two same-kind rects on the
  same floor never overlap; `sim::world::WorldSpec::build` rejects a world
  that violates this. Areas are bucketed by `chunk_key` (`sim::world::
  World`'s internal `BTreeMap<u64, Vec<_>>`), so an ownership query costs
  one map lookup plus a scan of one chunk's rects, never every area in the
  world.
- Floor transitions (FR117) are rows in `floor_transition`, anchor cell to
  target cell, never a boolean on an object and never a special layer. A
  door is never one of these rows (FR118): it is an ordinary walkable
  cell. Both the anchor and the target cell must be standable on their own
  declared floor; `WorldSpec::build` rejects a world with a transition
  that violates this.

Chunking is the unit of subscription and of cost (FR145). `CHUNK_SIZE`
(32 tiles, one floor) is declared once, in `sim::world`; a literal 32
anywhere else is a defect. `sim::world::chunk_key(x, y, floor)` packs a
chunk's key as `[63:56] reserved=0 | [55:32] chunk_x (24-bit two's
complement) | [31:8] chunk_y (24-bit two's complement) | [7:0] floor
(8-bit two's complement)`; every spatially addressed table carries the
result as a plain indexed `chunk_key` column. Two containment rules: an
ownership rect is clipped so it lies entirely inside the chunk its key
names -- `sim::world::clip_rect_to_chunks` is the one function a
generator uses to produce such rects, and `WorldSpec::build` rejects any
area whose rect and declared `chunk_key` do not agree with that rule, so
a per-chunk subscription of the table is never partial; an object
instance is addressed by its anchor chunk and may overhang it, which the
client absorbs with a one-chunk subscription halo.

The collision grid's per-cell budget is 1 bit: a floor's collision set is
dense storage sized to its extent, indexed by arithmetic (never a map
lookup per cell, never a scan), so a query costs one bounded access
regardless of world size. `FloorCollision::build` rejects an invalid
extent or one over `sim::world::MAX_CELLS_PER_FLOOR`, rather than
allocating unboundedly.

`sim::world::fixture` (the hand-authored conformance world) is compiled
only behind `sim`'s `fixture` Cargo feature, which `bounds` enables for
its own dependency and `sim`'s own test builds enable for themselves;
`browser_city` never enables it, so the published module never contains
it.

The client's mirror of these addressing, collision, transition and
ownership rules is a separate TypeScript implementation (NFR30 forbids
sharing the code). The story that adds it must consume the committed
`fixtures/world-conformance.v1.json` in its own test suite, the same file
`sim/tests/world_conformance.rs` reads, regenerated from `sim::world::
fixture` by `bounds`'s `regen-world-fixture` binary.
`docs/trace-matrix.md`'s "World addressing" section carries a `deferred`
row for that obligation until it is met.

## Definitions (`defs/`)

`defs/` is the single source of truth for game content data (NFR31),
subdivided into `objects/`, `items/`, `recipes/`, `professions/`,
`chains/` and `balance/`, each a directory of TOML files (the naming
table's `city-props.toml`). Neither build target writes here and neither
runs the generator: `tools/defs-build/` is a standalone Rust binary crate
outside both the server and client dependency graphs (its own
`Cargo.toml` with an empty `[workspace]` table, its own committed
`Cargo.lock` and `rust-toolchain.toml`), and its two outputs are committed
and kept current by `scripts/ci/check-defs-current.sh` -- the same idiom
as `client/src/net/bindings`. `server/sim/src/generated/defs.rs` is a
plain Rust module of `static`/`const` tables over `&'static str` and
integers, no deserialisation or allocation at runtime; `client/public/
defs/defs.json` is a canonical, static JSON asset fetched at runtime,
cache-busted and compared against the FR147 handshake's own
`defs_version`. Both begin with a generated-file marker and are never
hand-edited.

An object, item, recipe, profession or chain declares an explicit,
permanent integer id in its own file -- never one derived from file
order, position or a hash. An id or a key, once merged, is never
renumbered, reused or retired: `tools/defs-build/goldens/defs-manifest.
golden` pins the append-only `kind id key` list, guarded by
`scripts/ci/check-defs-ids-append-only.sh`. `defs/balance/` entries seed
data (NFR45), keyed by a dotted `snake_case` balance key, not an id.

A single `defs_version` -- a SHA-256 over every git-tracked file under
`defs/`, sorted by path, LF-normalised -- covers every input, including
the prop atlases, character-part atlases and the audio manifest once
those land; their own manifests belong under `defs/`, not beside their
producing pipeline, so that they fold into this one version rather than
versioning independently. `defs_version` is computed, never hand-bumped,
identical in both generated artefacts, and guarded by
`scripts/ci/check-defs-version-bump.sh`.

The server and client each parse the generated source with their own
independent implementation (NFR30) -- deliberate duplication, not an
oversight, pinned against drift by a shared canonical dump golden and a
shared table of malformed-input cases both sides must reject.

## Naming


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

## Toolchain


| Prerequisite    | Notes                                                          |
| --------------- | -------------------------------------------------------------- |
| Rust via rustup | with `rustup target add wasm32-unknown-unknown`                |
| SpacetimeDB CLI | `spacetime dev` for hot reload, `spacetime publish` to release |
| SpacetimeDB CLI default server | `spacetime server set-default local`, so a flagless `spacetime mcp` also resolves to `local` |
| Node.js         | 22.x, pinned in `client/.nvmrc`; client build                  |

Agent tooling — declared in `.mcp.json` and `.claude/settings.json`, first-party only:

<!-- bc:agent-tooling:start -->
| Tool | Provided as | Pinned version | Notes |
| --- | --- | --- | --- |
| `spacetimedb` | `spacetime mcp` CLI subcommand, `.mcp.json` | 2.9.* | `--server local` explicit; database name from the local spacetime config, never hard-coded; approved via `enabledMcpjsonServers`, not an interactive prompt |
| `context7` | hosted HTTP MCP, `.mcp.json` | hosted, unpinnable | needs `${CONTEXT7_API_KEY}`, degrades to unauthenticated if unset; a lookup tool, never a source of truth over this file or `docs/requirements.md`; approved via `enabledMcpjsonServers` |
| `spacetimedb@spacetimedb-plugins` | Claude plugin marketplace `clockworklabs/SpacetimeDB`, `.claude/settings.json` | v2.9.0 | its bundled `spacetime mcp` (no `--server` flag) is blocked by `deniedMcpServers`' `serverCommand: ["spacetime", "mcp"]`, an exact match read from that tag's `.claude-plugin/marketplace.json` on 2026-09-07; only its skills load; re-read that file and update this row and the deny entry together whenever `ref` bumps |
| `pixijs-skills@pixijs-skills` | Claude plugin marketplace `pixijs/pixijs-skills`, `.claude/settings.json` | floating on `main` | official PixiJS v8 rendering skills |
<!-- bc:agent-tooling:end -->
