# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Server workspace              | `server/` is a Cargo workspace: `sim` (pure logic), `bounds` (the table-bounds registry), and the `browser_city` module crate, which depends on both |
| Property testing (server)     | `proptest`, dev-dependency of `sim` and `tools/defs-build` only; case count from `PROPTEST_CASES`       |
| Property testing (client)     | `fast-check` 4.10.0, pinned, `devDependency` of `client` only; never a runtime import, never in the built bundle |
| E2E pixel compare             | `pixelmatch` 7.2.0 + `pngjs` 7.0.0 (`@types/pngjs` 6.0.5), pinned, `devDependency` of `client` only; never a runtime import, never in the built bundle |
| Boot-budget HTTPS preview     | `@vitejs/plugin-basic-ssl` 2.3.0, pinned, `devDependency` of `client` only; enabled only when `BC_BOOT_HTTPS=1` (the boot-budget harness), never for `npm run dev`/`preview` defaults, never in the built bundle |
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
| Defs tooling                  | `tools/defs-build` — standalone native Rust binary crate (own `Cargo.toml`/`Cargo.lock`/`rust-toolchain.toml`, outside both `server/`'s workspace and the client), depends on `toml`, `serde` and `png` (pinned exact); never a dependency of `browser_city` or the client bundle |


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

## Time

- In-city time is a pure function of one durable row and the server's `now`: `sim::time::city_time(epoch_at, now)` returns `CityTime { day, hour, minute, weekday, real_ms_into_minute }`, integer arithmetic only, `weekday` being `day` mod 7. The smallest unit of city time is the minute; `real_ms_into_minute` exists for rendering interpolation only, and no reducer, rule or gameplay decision may read it.
- `REAL_MS_PER_CITY_MINUTE` (FR1, 2500) is a fixed constant in `tools/defs-build/src/model.rs`, emitted into `sim/src/generated/defs.rs` and `client/public/defs/defs.json` (`real_ms_per_city_minute`, refused by `client/src/defs/parse.ts` when missing or below 1). `sim::time` derives its constants as expressions over it and refuses a value above `u16::MAX` at compile time.
- `world_clock` is a public one-row table (`id` 0, `epoch_at`): the real instant of day 0, 00:00, written from `init` only and never rewritten by a republish. It is restored by `restore_world_clock`.
- The server holds the epoch; clients derive time arithmetically and are never told it. Nothing ticks the clock: `world_clock_schedule` carries no row and no per-minute broadcast exists.
- The client subscribes to `world_clock` and estimates the server's clock from the `sync_clock` procedure (returns `ctx.timestamp`, reads and writes nothing): on connect, every 5 real minutes and when the tab becomes visible. The estimate advances on `performance.now()`; nothing under `client/src/time/` reads `Date.now()`, and it imports no `net/`, `pixi.js` or DOM global.
- `fixtures/city-clock-conformance.v1.json` pins `sim::time` and `client/src/time/city-time.ts` to each other.
- A later dev-build clock jump rewrites `epoch_at`; a multiplier is additive when FR163 comes.

## Backup

See docs/spikes/1.4-backup-restore.md for the platform investigation and
the measured limitations behind these rules.

- Export via `scripts/ops/export-world.sh`, before every migration
  (`.github/workflows/deploy.yml`'s `backup` job, always run ahead of
  `publish-module`) and daily once a `backup.yml` schedule and dead-man's-
  switch exist (`docs/trace-matrix.md`); gpg-encrypted before it ever
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

## Deploy

`.github/workflows/deploy.yml` is the one path from a merge on master to a
running game (`CI / deploy`, above) -- triggered by `workflow_run` of `ci`
on `master`, only on success, deploying that run's own `head_sha`, never
whatever master happens to be at; `workflow_dispatch` retries a deploy or
smoke-tests it. `resolve` refuses anything unsafe before any other job
runs: the resolved ref must be `refs/heads/master` itself, a dispatch's
own commit must be an ancestor of master (the compare API), and it must
carry a green `ci` check run. `vars.DEPLOY_ENABLED` gates everything past
that: until it is `true`, `resolve` emits a notice and every other job is
skipped, cleanly, so this workflow can be merged and live on master well
before Maincloud/Pages provisioning is finished (`server/README.md`),
with zero effect until then; a `workflow_dispatch` while disabled is a
loud failure instead, never a silent no-op.

- One credential, one owner identity: the same `SPACETIME_MAINCLOUD_TOKEN`/
  `BACKUP_PASSPHRASE` secrets and `BACKUP_DATABASE` variable `backup.yml`
  uses, never a second copy of any. Both secrets live in the `maincloud`
  environment (shared with `backup.yml`, restricted to master) rather than
  at repository scope, so a workflow dispatched from an arbitrary branch
  can never read them. Every job that logs in compares `spacetime login
  show` against the `MAINCLOUD_OWNER_IDENTITY` variable and refuses to
  continue if they differ.
- `changes` decides whether the client needs to change by comparing the
  resolved commit against what is *actually live* (a `<meta
  name="bc-build">` stamp read off the deployed page), never against the
  previous commit -- a client whose own deploy never ran must not be read
  as "already up to date" by a later, module-only commit. Unreachable, no
  stamp, or an unresolvable diff all default to "deploy the client".
  `scripts/ci/lib/deploy-client-paths.txt` is the one path list this and
  the `client` changes-filter above both read; `scripts/ci/
  check-deploy-client-paths-current.sh` keeps the latter a superset of it.
- `backup` (NFR39) always runs before `publish-module` (`needs:`, and a
  condition that can never let it run after a failed `backup` either --
  `scripts/ci/check-deploy-workflow.sh` asserts both). The one exception
  is the very first deploy, detected by `scripts/ops/
  check-database-exists.sh`'s own positive not-found check (the CLI's
  specific wording, pinned to the version `scripts/ci/
  install-spacetimedb-cli.sh` installs) rather than `|| true` on the
  export -- any other failure is a hard failure of the job.
- `publish-module` calls `reseed_codes` after publishing (NFR36/NFR38,
  above). NFR33 (an additive-only schema, enforced at PR time) is what
  makes this publish forward-only: there is no schema rollback, only fix
  and republish -- `server/README.md`'s own recovery section.
- `deploy-client` builds the client with `vite build --base=/browser-city/`
  (this repo is `Abaudat/browser-city`, no custom domain) and the real
  `VITE_SPACETIME_URI`/`VITE_SPACETIME_DB`, then deploys to GitHub Pages.
  `scripts/ci/check-pages-bundle.sh` asserts the built output never
  references any top-level dist entry root-absolute (quoted, backtick or
  `url(...)`) and that the real production URI is actually present -- run
  against a real build here, and against a second, production-style build
  `ci.yml`'s `client-build` job makes with dummy `VITE_` values, so a
  misconfigured base or a missing production URI is a red PR, not a
  broken deploy. Skips when a commit's own changes do not touch the
  client -- `smoke` still runs, since a module can break a client that is
  already deployed.
- `smoke` is a real Playwright spec (`client/tests/e2e/deploy-smoke.spec.ts`,
  the `deploy-smoke` project), not an HTTP 200 check: it asserts no failed
  request or console/page error, that the WebSocket dials the configured
  Maincloud URI and database, that the initial subscription applies, and
  that the player-controllable mark fires. It polls the live URL for a
  `<meta name="bc-build">` tag stamped with the deployed commit before
  running, so Pages propagation lag can never pass it against a stale
  deploy. `ci.yml`'s `e2e` job runs the identical spec against a
  production-base build under `/browser-city/`, backed by a disposable
  local SpacetimeDB, so a broken spec is caught before merge. Every run
  connects as a fresh, anonymous identity, like a real player -- there is
  no fixed smoke identity today, because `identity_connected` writes
  nothing yet; a fixed identity threaded through a URL query parameter
  would otherwise let any visitor forge another session, and would leak
  into an uploaded Playwright report on a public repo.
- No automatic rollback: a published schema cannot be rolled back, only
  rolled forward. A failure on master runs `scripts/ci/
  report-scheduled-failure.sh`, so it becomes a tracking issue rather than
  sitting unnoticed in the Actions tab; `server/README.md` names the
  manual recovery path.

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
  calling `reseed_codes`, automated by `deploy.yml`'s `publish-module` job.
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
rendering-order dimension -- it is never a second collision dimension; a
collision test always consults one floor's whole merged blocking set. A
layer's `rank` is as permanent as its `code` number and pinned by the same
codes golden. See "Rendering" below for the ladder itself.

There is no dense per-cell table, and there never will be: cell facts are
always derived from placed content, never stored per cell.

- Walkability is the absence of a collider (FR128): computed by
  rasterising the colliders the placed objects on an entity's floor
  contribute, never a stored walkable/collision column. The server's
  `FloorCollision` (below) is tile-granular, for citizen routing; sub-tile
  collider precision is client-only (FR137), and the server never
  consumes a `collider`. The two are not required to agree cell for cell.
- Building and room ownership (FR119) is areas, not per-cell: `building`
  and `room` rows carry a surrogate id; `building_area`/`room_area` rows
  hold the axis-aligned rectangles that belong to one such id. A
  non-rectangular footprint is several rects. Two same-kind rects on the
  same floor never overlap; `sim::world::WorldSpec::build` rejects a world
  that violates this. Areas are bucketed by `chunk_key` (`sim::world::
  World`'s internal `BTreeMap<u64, Vec<_>>`), so an ownership query costs
  one map lookup plus a scan of one chunk's rects, never every area in the
  world. A `room_area` never covers a `wall` cell, and a `threshold` cell
  lies in exactly one `room_area`.
- Floor transitions (FR117) are rows in `floor_transition`, anchor cell to
  target cell, never a boolean on an object and never a special layer. A
  door is never one of these rows (FR118): it is an ordinary walkable
  cell. Both the anchor and the target cell must be standable on their own
  declared floor; `WorldSpec::build` rejects a world with a transition
  that violates this.
- A two-way transition is a pair, and a pair must be an honest mirror of
  itself (story 15.2): for some axis-aligned unit step `d`, the reverse
  transition's own anchor is the forward one's landing cell offset by
  `-d`, and the reverse transition's own landing is the forward one's
  anchor cell offset by the same `-d` -- so walking the forward direction
  through one, then its exact opposite through the other, returns an
  entity to the cell it started from, never a detour through an unrelated
  direction. A stairwell has one top and one bottom: the *other* three
  neighbours of each anchor (every axis-aligned direction but the one `d`
  names) must each refuse a step into it -- real colliders on the drawn
  railings, never a rule that only checks the pairing shape and stops
  there.
  The client's `world/transitions.ts` mirrors the pairing half as
  `checkTransitionPairSymmetry`, pairing transitions one to one
  (`pairTransitions`, never a plain `find` that lets two forwards claim
  one reverse) and exposing each pairing's own `d` so a caller
  (`street-conformance.test.ts`'s own "one entrance" geometry check) never
  re-derives which neighbour is the entry side. This half is pure (no
  grid) and runs on every `TransitionIndex` construction by default --
  never an opt-in, so a subscription that hands this class real
  transitions is checked the same way the committed street's own fixture
  is. The standability half (both cells a pairing's own reverse
  introduces must be standable for the real body) runs additionally when
  `isStandable` is supplied. `skipPairSymmetry` is the named, visible
  escape hatch a test double uses to construct an intentionally invalid
  pair (`world/floor-walk.test.ts`'s own same-cell mutually-targeting
  fixture, proving `stepAndTransition`'s edge-triggered gating alone never
  bounces on it) -- the lenient path is a visible choice in that one test
  file, never a silent default in `world/`.

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
only behind `sim`'s `test-fixtures` Cargo feature, which `bounds` enables
for its own dependency and `sim`'s own test builds enable for themselves;
`browser_city` never enables it, so the published module never contains
it.

`sim::world::walkability`'s `WalkabilityGrid` is `FloorCollision`'s same
dense-bitset idiom, at sub-cell resolution. `rasterise` stamps a slice of
sim-local placements (object def id, anchor cell, floor) into that grid
using the real generated `ObjectDef`s. `erode` shrinks the grid by
`movement.player_body_width_subcells`/`_height_subcells` (never a
literal); a sub-cell is body-passable in the result iff the whole body
fits there. `enclosed_regions`/`narrow_passages` each take a grid, a seed
and the grid's own bounds, and flood-fill iteratively (never recursive)
and deterministically: every enclosed region, or every passage too
narrow for the body, is reported as a sorted rect with its own cell
count, never a single boolean verdict. A component touching any side of
the grid's own bounds is never reported -- the grid is only ever a
window onto a larger world -- so a generator rasterises a district into
the same grid and calls the same two functions, unmodified, as a
post-condition on what it placed.

The client's mirror of these addressing, collision, transition and
ownership rules is a separate TypeScript implementation (NFR30 forbids
sharing the code): `client/src/world/chunk.ts` (addressing),
`client/src/world/collision-grid.ts` (collision), `client/src/world/
transitions.ts` (floor transitions), `client/src/world/ownership.ts`
(building/room ownership) and `client/src/world/world-spec.ts`, which
mirrors `WorldSpec::build`'s own refusals (overlapping same-kind rects, a
rect that does not fit the chunk its anchor corner names, a transition
end that is not standable) so world data is refused before anything
consumes it, hand-laid or streamed. Its own test suite consumes the committed
`fixtures/world-conformance.v1.json`, the same file
`sim/tests/world_conformance.rs` reads, regenerated from `sim::world::
fixture` by `bounds`'s `regen-world-fixture` binary; every case in that
fixture is checked from the client side too
(`client/tests/unit/world/conformance.test.ts`).

## Movement and collision (client)

Player movement and collision are client-authoritative (FR137), permanent
code under `client/src/world/`, driven by collider data in `defs/`.

- A `collider` on an `[[object]]` is a half-open integer rect in
  sub-cells relative to the footprint's own north-west cell (`world/
  footprint.ts`'s `footprintOrigin`), not the placed row's own anchor
  cell; `COLLIDER_SUBCELLS_PER_CELL` is generated into both artefacts and is
  never derived from `render.tile_size_px`. No `collider` means walkable
  (FR128); there is no `walkable` flag. Containment inside
  `width*height` sub-cells is enforced by `tools/defs-build` and again by
  `client/src/defs/parse.ts`.
- Walking speed and the player body are balance keys
  (`defs/balance/movement.toml`), read once into a `MovementConfig` by
  `client/src/world/movement-config.ts`. The body is a small rect at the
  feet, centred on the player's position with its bottom edge there --
  never the sprite rect.
- The collision grid is derived, sparse by chunk and dense within one
  (`CHUNK_SIZE*CHUNK_SIZE`, indexed arithmetically), keyed by the
  client's own mirror of `chunk_key`. It is mutated only by
  `insert`/`delete`/`update` over `PlacedObject`-shaped rows, rasterises
  a collider into every cell it overlaps including across chunk edges,
  frees a chunk when its last entry goes, and throws on a non-zero
  `orientation`.
- The footprint index (`world/footprint-index.ts`) is a second derived
  index in the same storage shape, keyed by every cell an object's
  `width x height` covers rather than by its collider -- an object with
  no collider must still be clickable. `world/world-index.ts` is the one
  `insert`/`delete`/`update` that feeds both, so the two can never drift
  apart; nothing holds either index directly.
- A step resolves per axis by swept AABB, sweeping the union of the
  body's start and end boxes. `deltaMs` is clamped to 100 ms. Collider
  faces are exactly representable, so resolution snaps to a face with
  strict half-open comparisons and no epsilon. Candidates come only from
  the cells the swept body spans, never a row query.
- `world/**` may not import `pixi.js`, values from `net/` (only
  `net/bindings` types, type-only) or `test-street/`, and may not touch `window`
  or `document`; DOM input lives in `client/src/input/`.
- The server's `FloorCollision` stays tile-granular and never consumes a
  `collider`.

## Input (client)

`client/src/input/` is the only place DOM input is read, and it produces
*intents*, never actions (FR148).

- An `Intent` is `{ objectId, defId }` and nothing else: no verb, no
  action, no kind. Emission is one injected sink plus one `onIgnored`
  callback; there is no event bus.
- `src/input/**` may not import `pixi.js`, `net/` (bindings included),
  `test-street/`, or any procedure or interaction module -- enforced by
  `client/biome.json`'s override and by
  `scripts/ci/check-input-boundary.sh`.
- Picking never uses PixiJS hit-testing: one `pointerdown`/`pointermove`
  listener on the canvas *element*, and no `eventMode`, `interactive` or
  per-sprite pointer handler anywhere under `client/src/`.
- A pick is two phases. Broad: the cell under the pointer on the viewer's
  own floor (`render/screen-position.ts`'s `worldCellFromScreenPx`), in
  one chunk lookup, against a footprint index that registers every cell an
  object's *drawn* sprite covers -- its footprint plus its art overhang.
  Narrow: the point must fall inside the rect that object's sprites
  occupy, supplied by whoever built them. An object that draws nothing
  resolves through its own footprint cells.
- Where drawn objects overlap, `render/sort-key.ts`'s comparator decides
  which is in front. An object story 1.7 has hidden is never picked and
  never blocks a click on what is visible behind it.
- Hit-testing is the whole sprite rectangle, transparent corners
  included; per-pixel alpha is not consulted.
- The hover is re-resolved from the last pointer position whenever the
  player moves or visibility changes, not only on `pointermove`.
- `interact_at` on an `[[object]]` is a half-open integer rect in
  sub-cells relative to the same north-west sub-cell origin `collider`
  uses, reaching outside the footprint by at most `INTERACT_AT_MAX_REACH_CELLS`
  (generated into both artefacts). Its presence *is* the declaration that
  an object is interactable; there is no `interactable` flag. Reach is the
  player's feet in sub-cell integers, half-open comparisons, same floor --
  no distance, no radius, no epsilon.
- Movement keys resolve `KeyboardEvent.code`, never `.key`. Bindings are
  data (`input/keybindings.ts`): one code drives at most one action,
  `isBindableCode` is the single rule for what may be bound, and `Escape`
  is reserved for the options menu.
- Keybindings persist in exactly one versioned `localStorage` key,
  `bc.keybindings.v1`, through `input/keybindings-storage.ts`, itself a
  thin shape-and-defaults layer over `settings/settings-storage.ts`'s
  shared read-safely/write-safely idiom (below). Reading never throws and
  never writes; stored actions merge per action over the defaults.
  `clear()` is never called.

## DOM UI

The whole game has exactly three DOM UI surfaces (FR151): the boot name
prompt, the options menu, the connection notice. `client/src/ui/` is
their only home. Each is a `mountX(options)` function taking plain data
and callbacks, returning a handle with `destroy()` -- no framework, no
dependency. Every top-level element a surface mounts carries
`data-bc-surface` with one of `options-menu`, `connection-notice` or
`name-prompt`, checked against `document.body`'s own children by
`client/tests/e2e/connection-notice.spec.ts`. `index.html`'s own
`<style>` block holds the shared font/colour/accent custom properties
every surface uses; `ui/style.ts`'s `ensureStyle(doc, id, css)` is each
surface's own per-surface rule injector.

- `net/connection-status.ts` exports `ConnectionStatus` (`"connecting" |
  "connected" | "disconnected"`), a plain string union -- `net/`'s only
  export `src/ui/**` may import. `ui/connection-notice.ts` shows
  "Connecting…" while `"connecting"`, "Connection lost" while
  `"disconnected"`, and "Reconnected" briefly on a later `"connected"`
  before fading (the fade is the only animation here, its duration set
  from the `fadeMs` option). Nothing in the disconnect path touches the
  Pixi `Application`, the scene, its ticker or any pool. The
  "Reconnected" path is currently unreachable (nothing calls
  `setStatus("connected")` after a drop); kept in place for the
  reconnection story to wire.
- The options menu is one panel, three sections in this fixed order --
  Audio, Display, Controls -- as stacked headings, never tabs. Every
  control has a real consumer or a persisted value a named later story
  reads. Display's highlight-strength slider is `[20, 100]`, default 60,
  and drives `render/highlight.ts`'s `highlightOverlayAlpha` live through
  `StreetSceneHandle.setHighlightStrength` -- applied on every drag tick
  ('input'), not only on release, through the menu's own
  `onDisplayPreview`. The fullscreen row is hidden when
  `document.documentElement.requestFullscreen` does not exist; its label
  reflects `document.fullscreenElement`, kept live via `fullscreenchange`.
- `settings/settings-storage.ts` is the one settings-storage idiom every
  group (`input/keybindings-storage.ts`, `settings/audio-settings.ts`,
  `settings/display-settings.ts`) shares, including its `isRecord`/
  `clampPercent` helpers: one versioned `localStorage` key per group,
  read once through an injected `Storage`. Reading never throws and
  never writes; an unrecognised version or shape falls back to defaults
  in memory.
- Three mechanical guards, all run by `client-check`:
  `scripts/ci/check-no-canvas-ui.sh` (no Pixi `Text`/`BitmapText`/
  `HTMLText`/`SplitText`/`TextStyle`/`TextStyleOptions` construction or
  import, single- or multi-line, no native `alert`/`confirm`/`prompt`,
  anywhere under `client/src/`); `client/biome.json`'s `src/ui/**`
  override (nothing below `ui/` can import it; `ui/**` itself cannot
  reach `net/**` except `net/connection-status`, nor `render/**`,
  `world/**`, `test-street/**`, `pixi.js`); `noRestrictedGlobals` banning
  `document` in `render/**`, `net/**`, `defs/**` and `boot/**` (`window`
  stays allowed) -- DOM creation is only possible in `ui/`, `input/`,
  `test-street/` and `main.ts`.

## Rendering

`client/src/render/` holds the permanent rendering modules -- the ones
the next story that builds a real, subscribed drawable pool reaches for.
`client/src/test-street/` holds the one hand-laid scene the client is
proven against: a committed, deterministic fixture, throwaway harness
code by design, replaced wholesale by Epic 3's generator. There is never
more than one such directory. Imports flow test-street -> render/world/
input, never the reverse (`client/biome.json` enforces it on `render/**`,
`world/**` and `input/**`), so deleting the street is one directory and
one import in `main.ts`. `sort-key.ts`, `decompose.ts`, `layer-ranks.ts`,
`layer-table.ts`, `sort-units.ts`, `screen-position.ts`,
`floor-stacks.ts` and `pixi-order.ts` all live under `render/`; nothing
under `test-street/` is held to the coverage bar the permanent modules
are, though it is still exercised by real tests
(`client/vitest.config.ts`'s coverage `include`/`exclude`).

The street contributes no collider that is not drawn on the same floor
(story 15.2): every `STREET_PROPS` row that carries a `solid` flag or a
`defId` also carries a real sprite at that same footprint, and its
collider lies inside that footprint. An asset-placed solid prop may
declare several collider rects shaped to its art (`colliders`): the
first is fed under the prop's own id, each further one as a collider part
(`streetColliderPartId`) with the prop's own anchor and footprint.
`STREET_BOUNDARY` is exactly one thing: the undrawn ring that closes the
edge of the drawn world, in whole cells, every one outside every drawn
ground pass on its floor. The one exemption is the footbridge's south rail
(id 110), a sub-cell strip that keeps a walker leaning on it inside the
deck's own row. `client/tests/unit/test-street/street-conformance.test.ts`
holds this over the whole fixture: every collider cell traces back to a
drawn prop's own footprint or the ring; no ring rect but id 110 carries a
collider, and none overlaps a drawn ground pass; every `walls`-layer,
`furniture`-layer or `solid` row collides in its own footprint (all of
it, unless it declares its own shape), bar an explicit, reasoned
allow-list; and each subway stairwell's footprint is non-standable
everywhere but its tread path.

A frame draws four passes per floor, in this fixed order, declared even
when a pass is empty: three flat passes -- ground, ground decals, ground
objects -- followed by one y-sorted pool. A flat pass is never
depth-sorted and never occludes anything; anything with visible vertical
extent, however small, belongs in the pool instead (FR123).

Each floor gets its own such stack (`render/floor-stacks.ts`), and the
stacks draw in ascending floor order: every drawable on a higher floor is
drawn after every drawable on a lower one. That, and nothing else, is how
two storeys whose screen rects overlap -- a bridge deck over the street it
spans -- are resolved; floor never enters the sort key (FR124), and no
z-offset or container trick is used in scene code. The comparator orders
within one floor's pool only. Content above the player's own floor is
hidden only where the player is covered by it, through the ownership-keyed
rule under "Visibility" below, never a floor-specific check in scene
code.

The pool's sort key is `(y, rank, x, stableId)`, most significant first,
implemented once in `render/sort-key.ts` and nowhere else -- that
comparator is the sole ordering authority, reached through
`render/pixi-order.ts`'s `applyDepthOrder` (the one Pixi-touching
adapter for it), and a pool container's `sortableChildren` is `false`
everywhere one exists. Every component is an integer: `y`/`x` are world
*position*, in FR123 sort units (`render/sort-units.ts`'s
`SORT_SUBDIVISIONS` per tile), never a raw tile index and never a
screen-space or floor-adjusted value -- a continuous, moving character
needs sub-tile resolution to sort correctly against a static prop it is
passing, and every caller that builds a drawable must convert a tile
coordinate through `toSortUnits` or it silently mixes units. `rank`
comes from `sim::codes::layer` (below), never a literal; `stableId` is a
`bigint` end to end (`object_id` for a placed drawable, a character's id
for a character) and is never narrowed through `Number`. Floor is never a
term in the key (FR124): it is applied only once, as a vertical screen
offset (`render/screen-position.ts`'s `floorOffsetPx`), when a drawable
is positioned on screen. Occlusion between floors is entirely
"Visibility" below's job, not the sort key's.

`sim::codes::layer`'s rank ladder (FR123) is minted in tens, leaving every
in-between number free for a future layer to slot into without
renumbering anything: `furniture` 10, `objects` 20, `walls` 30,
`wall_decals` 40, `characters` 50. Every rank below 10 is a flat-pass
layer and every rank at or above 10 is a pool layer: `ground` (rank 0)
is the ground pass's layer and `ground_objects` (code 7, rank 5) is the
ground-objects pass's -- for anything lying flat, like a manhole cover or
a doormat. A drawable's pass is its layer and nothing else
(`layer-table.ts`'s `passOfLayer`); a flat-pass drawable is never
y-sorted, and `applyDepthOrder` throws if handed one. An upright object
standing on or overhanging a flat object's cell hides it -- the flat thing
is underneath, and that is the intended reading -- so content never places
a flat object where an upright prop stands if the flat object needs to be
seen. `overhead` (code 1, rank 1) is deprecated: its row
stays seeded forever (deprecation is a usage ban, not a deletion), but
nothing may place new content on it, and a rank lookup that resolves an
unknown or deprecated code throws rather than sorting it silently. A
rank's number is as permanent as its code and pinned by the same codes
golden. `client/src/render/layer-table.ts` is the client's one mirror of
that ladder -- every other client module that needs a code, a name, a
rank or the deprecated set reads it from there, never a second
hand-typed copy, and `scripts/ci/check-layer-table-current.sh` fails the
build the moment it disagrees with the golden.

A multi-cell prop (FR125/FR126) decomposes into one per-cell drawable per
cell of its footprint, each with its own anchor and its own source
sub-rect, never optional. Extent comes from the placed object's
`object_def` (`defs/`), never a hardcoded number, and is capped at
approximately 8x8 (FR127). A per-cell sub-rect is only ever legal on
whole-tile boundaries: either the source art is already exactly one tile
long on the decomposed axis (every cell repeats it whole) or exactly
`cells * tile_size_px` long (sliced into equal whole-pixel cells) --
anything else, including any horizontal overhang, is refused at mount
rather than drawn stretched or fractional. A def-placed prop's per-cell
sub-rect is cut from its own packed `atlas` rect
(`render/atlas-pages.ts`'s `AtlasPageLoader.objectCellTexture`), never
from a raw `ModernTileset/` import.

`render.tile_size_px` and `render.storey_height_px` are balance keys
(`defs/balance/render.toml`), not TypeScript literals, so they fold into
`defs_version` and stay reviewable alongside the art. `storey_height_px`
is the floor screen offset FR124 describes: a drawable's screen position
subtracts `floor * storey_height_px`, and a drawable on a storey above the
viewer's own must never sort as though it were on that floor because of
it.

Only a test-street row with no `object_def` reads its art straight out of
the repo-root `ModernTileset/` at runtime (`new URL(..., import.meta.url)`
asset imports), not out of `client/public/`. A row placed by a real
`object_def` draws only through its packed `atlas` rect (`AtlasPageLoader`),
never a `ModernTileset/` import of its own. Character part sheets are never
read the raw-import way either: they are packed, at build time, into
`client/public/atlas/`, like every other atlas page. `deploy.yml`'s
`deploy-client` job therefore checks out the whole repository -- never a
sparse or `client/`-only checkout -- for as long as any client code reads
assets from outside `client/`.

### Visibility

FR120-FR122's enclosure visibility is decided by one pure function,
applied strictly after the FR123 sort, and never itself adds, removes or
reorders a pool member.

- `client/src/render/visibility.ts`'s `computeVisibility` is the only
  visibility rule and imports no `pixi.js` (Biome enforces this);
  `client/src/render/pixi-visibility.ts`'s `VisibilityApplier` is the only
  code that writes `sprite.visible`/`sprite.alpha`, and never adds,
  removes or reorders pool members.
- Visibility is recomputed only on a change of the viewer's own cell
  ownership or floor, and applies to every pass -- the flat ground passes
  as well as the sorted pool.
- Retraction: a `walls` drawable that is near-side (the cell directly
  south of it, on the same floor, is not owned by the same building) and
  owned by the viewer's own building is hidden; a building's floors above
  the viewer's own current floor are hidden the same way while the viewer
  is inside it.
- Windows: an `[[object]]` with `window = true` in `defs/` draws at
  `render.window_alpha` percent (`defs/balance/render.toml`, never a
  TypeScript literal) once it is not hidden; masks, filters, render
  textures and stencils are banned anywhere under `client/src/`
  (`scripts/ci/check-no-masks.sh`).
- Floors of opposite sign are never co-visible, compared by sign alone
  against the viewer's own floor, never against the literal `-1`.

Retraction is keyed on `buildingId` alone, never `roomId`: a terrace shop
is its own building, not a room of a shared one.

### Affordance

FR173's affordance mark: one additive overlay copy of each visible
drawable of the hovered, in-reach object, inserted as a sibling directly
above its own source sprite in the pool container -- never a pool member,
never a separate top layer. Re-attached by the one wrapper that calls
`applyDepthOrder` (`test-street/scene.ts`'s `reorderFloor`); no other call
site touches it after a re-sort. Its overlay tracks its source every frame
it is alive -- position, scale, anchor, texture, visibility and alpha all
mirrored -- never a snapshot taken at hover start.

- `client/src/render/highlight.ts` is the pure half: `highlightOverlayAlpha`
  and `highlightOverlaySpec`, zero PixiJS. Alpha is `render.highlight_alpha`
  (a percent-integer balance key, `defs/balance/render.toml`, never a
  TypeScript literal) times the U1 display-strength dial (`[20, 100]`,
  default 60) times the source sprite's own alpha.
- `client/src/render/pixi-highlight.ts`'s `HighlightApplier` is the only
  code that constructs, inserts or destroys an overlay sprite, and owns
  its own per-frame `refresh` ticker subscription, live only while
  something is marked. Built on the first hover transition, torn down on
  the transition back to `undefined`; a scene at rest carries none (D17
  -- the hovered id lives in `input/pointer.ts`'s closure and in the
  applier alone, never on a drawable, in settings, or in any per-object
  cache).
- Only the four Pixi v8 basic blend modes (`normal`/`add`/`multiply`/
  `screen`) are ever assigned anywhere under `client/src/`, and no import
  from `pixi.js/advanced-blend-modes` exists; `scripts/ci/check-no-masks.sh`
  checks both mechanically.
- `input/pick.ts`'s `isWithinReach` is the same predicate the server will
  resolve a reducer click against -- never a second, more generous copy.

### Appearance

- A citizen's appearance is five stored `u16` part ids (FR61): `body`,
  `eyes`, `outfit`, `hairstyle`, `accessory`. `0` means "no layer",
  legal only on `hairstyle`/`accessory`; `body`/`eyes`/`outfit` are
  never absent.
- Generated exactly once, server-side, by `sim::appearance::generate` at
  citizen creation, seeded from the citizen id alone (`sim::rng`), and
  stored. Nothing ever re-derives an existing citizen's tuple.
- A profession's uniform (FR62: `[[uniform]]` in `defs/appearance/`) is a
  render-time override of the outfit and/or accessory layer, resolved by
  the client from `defs.json`, and never written back into the stored
  tuple. A uniform accessory is an additional layer, not a replacement:
  it removes the citizen's own civilian accessory only when both declare
  the same `slot` (a helmet removes a beanie; a jacket over a beard keeps
  the beard).
- `body` and `eyes` each carry a `pool` (`civilian`/`role_only`/
  `costume`), the same enum `outfit`/`accessory` already declare:
  `generate` draws `body` and `eyes` from the `civilian` pool only.
- Layout (cell size, direction order, one row per animation) is declared
  once per family (`adult`/`kid`) in `[[appearance_layout]]`, along with
  an `accepted_sizes` list of whole vendor-sheet dimensions the family
  allows; a part's own sheet must decode to real `IHDR` pixel dimensions
  in that list, and every declared row must fit inside every accepted
  size. Layout is also enforced against every part sheet's real
  *decoded* pixels, not merely its header: every family shares one cell
  size, a declared cell must fit inside the decoded sheet, a packed
  strip is never fully transparent, and a `body` strip's every cell
  holds at least one opaque pixel -- each failure names the part's own
  kind, key and sheet.
- Every part is packed into its own family's compact strip by
  `tools/defs-build`'s packer, one CPU-only page group per kind
  (`character_body`, `character_eyes`, ...), never bound to the GPU. A
  part's own JSON-only `atlas` rect names its page and placement,
  exactly like an object's. The client fetches a packed page lazily,
  once per page, as a CPU-side `ImageBitmap`
  (`render/appearance/character-part-pages.ts`) -- never through Pixi's
  `Assets`/`Texture`, and never a raw vendor sheet
  (`scripts/ci/check-no-raw-part-sheets.sh`).
- A look is drawn into one **slot** of `CHARACTER_COMPOSITE_PAGES`
  (`defs.json`) shared, canvas-backed 2048x2048 pages -- never a
  `Texture` per look. A slot is a grid of frame cells at `cell + 1px`
  transparent-gutter pitch (never extruded: a character sits on
  transparent pixels); capacity is derived from that arithmetic
  (`render/appearance/composite-slots.ts`). A slot's own frame `Texture`s
  are built once, on first occupancy, and reused by every later
  occupant; a page re-uploads at most once per tick. Slots are
  ref-counted and LRU-bounded (`render/appearance/appearance-cache.ts`)
  -- `dispose` frees a slot instead of destroying a texture;
  exhaustion rejects the acquire, never a third page. A character on
  screen is one `Sprite` in the `characters`-rank pool -- distinct
  citizens sharing a page cost nothing extra over identical ones.

## Debug tooling (client)

`client/src/debug/` holds every debug overlay (FR165) and is compiled in
behind a flag not exposed in production (FR168).

- The gate is structural, not a runtime check: `main.ts` reaches this
  directory through exactly one `if (import.meta.env.DEV) { const { … } =
  await import("./debug/overlays"); }`. A dynamic import inside a
  statically-false branch is a chunk Rollup never emits, so a production
  build contains no overlay code for any input to activate. `ci.yml`'s
  `client-build` greps the built assets for the `bc-debug`/`__bcDebug`
  sentinels; `client/tests/e2e/deploy-smoke.spec.ts` drives every
  registered overlay's activation against a real production build and
  asserts nothing appears.
- `main.ts` is the only importer. `client/biome.json` bans `../debug/**`
  everywhere else, and `scripts/ci/check-debug-boundary.sh` (run by
  `client-check`, tested by `scripts/ci/tests/`) re-checks that, that the
  one import is dynamic and DEV-gated, and that `createElementNS` appears
  nowhere under `client/src/` but `debug/`.
- Overlays draw as one `<svg data-bc-debug="overlays">` mounted inside the
  canvas mount (never `document.body`, so FR151's DOM-surface allowlist is
  unaffected), `pointer-events: none`, its `viewBox` the renderer's own
  logical size -- re-read on every redraw, never captured at mount, so a
  resize cannot leave the overlay projecting into a box the scene no
  longer draws in. One root `<g>` carries the scene's camera as
  `matrix(zoom 0 0 zoom offsetX offsetY)`; inside it, one
  `<g data-bc-debug="<overlay id>">` per enabled overlay. Nothing enters a
  floor stack or the y-sorted pool, so the tool that inspects the sort can
  never perturb it.
- `debug/overlay-registry.ts` is the only way an overlay exists: a
  `DebugOverlay` is `{ id, label, draw(group, view) }`, ids are unique and
  URL-safe, and everything starts disabled.
  `debug/overlay-conformance.ts` is the shared contract every registered
  descriptor is run through (off by default, idempotent enable/disable, no
  element left behind across a toggle, every colour from `DEBUG_STYLE`);
  adding an overlay is one file plus one line in `debug/overlays.ts`'s
  list, with no new test file.
- `DebugWorldView` (`debug/world-view.ts`) is the only thing an overlay
  may read. It extends `CollisionGridQuery`, so a real collider is read
  from the live grid `world/movement.ts` resolves against, never a second
  expansion of `defs/`; `world/world-index.ts`'s `objects(bounds)` is the
  one read-only enumeration of placed objects, bounded by a cell window,
  and is the source for the two states the grid cannot represent -- no
  collider (FR128's walkability) and a collider declared with no area,
  which `CollisionGrid` rasterises into no cell at all when it is
  cell-aligned. All geometry goes through `render/screen-position.ts`,
  including `visibleCellBounds`, the viewport window every overlay's cost
  is bounded by; a camera that describes no rectangle yields an empty
  window rather than an unbounded loop.
- Activation is the URL query `?debug=<id>,<id>` (unknown ids ignored with
  one console warning naming the known ones) plus `window.__bcDebug`, the
  registry's `list`/`enable`/`disable`/`toggle`/`redraw`. There is no
  keyboard binding: `input/` is the only DOM input reader.
- Redraws happen on the scene's own events (camera, order change, the
  player's cell or floor changing), never on a per-frame ticker; with
  every overlay disabled the redraw path returns before reading the world
  at all, so NFR2's budget is untouched.
- Style is data, in `debug/debug-style.ts`: one saturated palette, one
  monospace face, hairlines with `vector-effect: non-scaling-stroke`. The
  three collider states are decided in the pure builder and carried on
  `data-bc-collider` as `collider`, `empty` (declared with no area) and
  `none` (FR128's walkability), so they are assertable rather than only
  visible.
- `src/debug/**` is held to the same coverage bar as `src/render/**`, with
  nothing excluded.

## Definitions (`defs/`)

`defs/` is the single source of truth for game content data (NFR31),
subdivided into `objects/`, `items/`, `recipes/`, `professions/`,
`chains/`, `appearance/`, `balance/`, `tags/`, `rules/` and
`archetypes/`, each a directory of TOML files
(the naming table's `city-props.toml`). Neither build target writes here
and neither runs the generator: `tools/defs-build/` is a standalone Rust binary crate
outside both the server and client dependency graphs (its own
`Cargo.toml` with an empty `[workspace]` table, its own committed
`Cargo.lock` and `rust-toolchain.toml`), and its two outputs are committed
and kept current by `scripts/ci/check-defs-current.sh` -- the same idiom
as `client/src/net/bindings` and `protocol-version` (below). `server/sim/
src/generated/defs.rs` is a plain Rust module of `static`/`const` tables
over `&'static str` and integers, no deserialisation or allocation at
runtime; `client/public/defs/defs.json` is a canonical, static JSON asset
fetched at runtime, cache-busted and compared against the FR147
handshake's own `defs_version` (below). Both begin with a generated-file
marker and are never hand-edited.

An `[[item]]` (FR86) is `id`, `key`, `unit`, `shelf_life_minutes` and
`bulk`, all required. `unit` is a name resolved at build time against
`sim::codes::unit`'s golden, the way an object's `layer` is: it is a
`u32` code with a companion `unit` table, never an enum, and only the code
reaches either artefact. `shelf_life_minutes` is a `u32`, `0` meaning it
never spoils, capped at `MAX_SHELF_LIFE_MINUTES`. `bulk = { width, height
}` is the item's world footprint in whole cells (FR94), 1 to
`MAX_FOOTPRINT_CELLS` per axis. The item id's companion data is the
generated `ITEMS` / `defs.json` pair; there is no item database table
until a server reader needs one.

### The FR147 handshake

`module_version` (`server/src/version.rs`) is a public anonymous view of
one row: `defs_version` and `protocol_version` -- a SHA-256 over every
git-tracked file under `client/src/net/bindings/`, by the `defs_version`
recipe. `scripts/gen-protocol-version.sh` generates `server/src/
generated/protocol_version.rs` and `client/src/net/protocol-version.ts`,
guarded by `scripts/ci/check-bindings-current.sh` and `check-protocol-
version-agrees.sh`. `check-view-live-refresh.sh` pins that a republish
reaches held and fresh subscriptions alike.

`module_version` rides the initial `subscribe([...])` call -- never a
second subscription, a reducer or a fetch. `boot/handshake.ts` compares
by strict equality:

- Both equal: `proceed`.
- Only `defs_version` differs, or the first `fetchDefs` failed: one
  `fetchDefs` cache-busted with the server's version. Still stale is
  `updating`; any other failure is `reload`.
- `protocol_version` differs: `reload`.
- `reload` happens once per server version, recorded under
  `sessionStorage` key `bc.handshake.reloaded-for.v1` before reloading.
  Already recorded, a failed write or a throwing reload is `updating`:
  not drawing, the `updating` notice, no retry.

`mountStreetScene` takes a `VerifiedDefs`, produced only by `boot/
boot-gate.ts`; an unreachable or timed-out connection mounts the fetched
defs. After mount, `boot/post-mount-guard.ts` compares every later row
against what mounted: a mismatch stops the ticker, then `reload` or
`updating` -- never a live defs swap.

An object, item, recipe, profession, chain, or appearance part/layout/
uniform declares an explicit, permanent integer id in its own file --
never one derived from file order, position or a hash. An id or a key,
once merged, is never
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
`scripts/ci/check-defs-version-bump.sh`. It does not hash the
`ModernTileset/` PNGs themselves: vendor art is treated as immutable, and
replacing a sheet in place (rather than adding a new one under a new
part id) is not a change `defs_version` detects.

The server and client each parse the generated source with their own
independent implementation (NFR30) -- deliberate duplication, not an
oversight, pinned against drift by a shared canonical dump golden and a
shared table of malformed-input cases both sides must reject.

An `[[object]]` carries `id`, `key`, `name` (a free-text display string,
never a lookup key), `layer` (the layer's own name, resolved at build
time against `sim::codes::layer`'s golden into the numeric code the
runtime artefacts actually carry -- the string never reaches either
runtime), `sprite` (one whole-object rectangle: `sheet` a path under
`ModernTileset/`, `x`/`y`/`w`/`h` whole source pixels -- the tileset ships
whole objects as single PNGs, so this never composites), `width`/`height`
(the footprint, in cells, each independently capped at
`MAX_FOOTPRINT_CELLS` -- FR127, generated once and consumed by
`sim::world`'s compile-time assert that it never exceeds `CHUNK_SIZE`,
since the region-subscription halo depends on it), and two optional
sub-cell rects: `collider` (FR128, fits inside the footprint; its absence
is what makes an object walkable -- there is no separate `walkable`
field anywhere) and `interact_at` (FR148, reaches at most
`INTERACT_AT_MAX_REACH_CELLS` beyond it, has positive area, and never
lies entirely inside the object's own collider). A placed row's own
anchor cell is the footprint's smallest x, largest y cell. `collider`/
`interact_at` are declared relative to a different point, the
footprint's own north-west cell (matching the sprite's own pixel space).
`client/src/world/footprint.ts`'s `footprintOrigin` is the one place that
converts an anchor cell to its footprint's north-west cell; every client
module that needs to place a footprint-relative rect or cell calls it,
never re-deriving the offset itself. Three build-time checks apply only
to `layer` and `sprite`: `layer` resolves against the codes golden (an
unknown or deprecated name is refused, naming the accepted set); `sprite`
fits entirely inside its own sheet's real `IHDR` bounds; and `sprite`
agrees with the footprint exactly (`w == width * tile_size_px`, `h` a
whole multiple of `tile_size_px` and `h >= height * tile_size_px` -- a
tall prop may overhang upward, never sideways or downward). `sprite` never
repeats: a surface wider than its own art is a one-cell object placed
once per cell. Every field is validated identically on both sides.

FR128's walkability rule is two-sided: an object with no `collider` must
carry the `underfoot` tag (`defs/tags/city.toml`, permanent, append-only
like every other tag), and an object that carries `underfoot` must not
declare a `collider` -- both directions are wrong metadata, rejected by
object key, never a hard-coded allow-list of object keys in either
parser. The tag key is a single named constant (`UNDERFOOT_TAG_KEY`) on
each side, never a repeated string literal. An object on a flat-pass layer
must also carry `underfoot` and its sprite must not overhang upward
(`h` equals `height * tile_size_px` exactly); the reverse is free --
`underfoot` alone never selects a pass.

An `[[object]]` may name an `archetype` instead of declaring its own
`height` and/or `collider` directly -- `defs/archetypes/*.toml`, key
only, no id, supplying `height` and/or `collider_inset`. Each of
`height` and `collider` has exactly one source (the object itself or the
named archetype); both or neither is a build error. `tools/defs-build`
lowers every archetype reference to a plain `height`/`collider` between
parse and validation. `archetype` is authoring-time only: it is never
emitted into either generated artefact and never reaches a runtime. A
companion offline binary, `defs-propose`, prints `[[object]]` stanzas to
stdout only, and is never an input to `tools/defs-build`'s own `build`
path.

### Atlases

`tools/defs-build`'s own packer packs the *used* subset of
`ModernTileset/` -- every object's own `sprite` rect, nothing an
`[[object]]` does not name -- into 2048-wide pages (height the smallest
power of two, at least 16px, that holds the page's own content, capped at
2048), written wholly by that same `defs-build` run into
`client/public/atlas/`, which it owns: anything under that directory a run
did not write this time is deleted, so a stale page never outlives the
group or object that produced it. There is no separate atlas manifest
under `defs/` -- every packer input already lives in `defs/objects/`, and
`defs/atlas/page-groups.toml` (below) is the one other input, so both fold
into `defs_version` the same way every other file under `defs/` does.
Replacing a vendor PNG in place (rather than adding a new one under a new
id) changes the page hash and `defs.json`, caught by `check-defs-current`
and refetched by the browser under its new name, even though it does not
change `defs_version` -- consistent with vendor art's own immutability
rule above.

- A page's group comes from two steps: the sheet's own theme-sorter
  directory segment (e.g. `ME_Theme_Sorter_16x16/3_City_Props_Singles_
  16x16` -> `city_props`), then `defs/atlas/page-groups.toml`'s own
  `theme -> group` table, which every street-kit theme (terrain, city
  props, generic/floor-modular buildings, and whichever themed folders
  the street kit borrows single props from) maps to one shared
  `ATLAS_SHARED_GROUP` (`"street"`) group; a themed district keeps its
  own group. A sheet under `Room_Builder_subfiles/`, with no theme-sorter
  subfolder of its own, has theme `room_builder`. A theme absent from the
  table fails the build naming it, and
  so does a table that maps nothing at all to `ATLAS_SHARED_GROUP`, or
  one that maps a theme onto a `character_*` group -- those are reserved
  for the packer's own character-part groups, one per declared part kind
  (body/eyes/hairstyle/outfit/accessory; see "Appearance" above for the
  CPU-only, per-look-compositing use they serve). A group never spans
  more than `ATLAS_MAX_PAGES_PER_GROUP` (2) pages. A scene is the shared
  group plus at most one themed group -- a player is never on the street
  and inside a themed interior at once -- plus the fixed
  `CHARACTER_COMPOSITE_PAGES` every scene with a crowd on it binds: the
  shared group's own page count, plus the *worst* other group's own page
  count (`character_*` groups excluded -- they are CPU-only, never
  bound), plus `CHARACTER_COMPOSITE_PAGES`, never spans more than
  `ATLAS_MAX_BOUND_PAGES` (8); a failure names all three terms and the
  total. `atlas_max_pages_per_group`/`character_composite_pages` are
  emitted into `defs.json`; the scene rule itself is the packer's own,
  the client has no use for it.
- Every packed rect carries a permanent 1px border of extruded
  (edge-repeated, never transparent) pixels on every side -- nearest-
  neighbour sampling plus this stops bleed at a fractional camera
  position or a DPR-scaled canvas.
- A page's filename is content-hashed -- SHA-256 over the page's own
  canonical RGBA pixel buffer (never its encoded PNG bytes), truncated to
  `defs_version`'s own 16 hex characters -- so an unrelated group's page
  never renames when another group's pixels change.
- `defs.json`'s `atlas_pages` array (`file`, `group`, `width`, `height`)
  and every object's/character part's own required `atlas` field
  (`{ page, x, y, w, h }`, `page` an index into `atlas_pages`, the rect
  in page pixels, gutter excluded) are JSON-only, like a rule row is
  Rust-only: never in `server/sim/src/generated/defs.rs` or the
  cross-parser dump. `sprite`/`sheet` stay in both artefacts as the
  authoring input.
- The client loads a page only on first demand (`client/src/render/
  atlas-pages.ts`'s `AtlasPageLoader`, Pixi `Assets.load`,
  `scaleMode: "nearest"`, one shared `Texture` per page, one shared
  cropped `Texture` per object id) -- never every page at boot, only ones
  a placed object actually resolves to. A rejected page load is evicted
  from the loader's own cache so a later demand retries rather than
  replaying the same rejection for the rest of the session.

### Contact sheet

`tools/defs-build/contact-sheet.html`: a committed output of the same
`defs-build` run, guarded by `check-defs-current.sh`. Never under
`client/public/` or `defs/`. Static HTML, no JS; references the atlas
pages under `client/public/atlas/` by relative path, one CSS rule per
referenced page, classed by group and in-group ordinal. Draws only the
lowered geometry (footprint/collider/`interact_at`),
grouped by declared archetype -- `check-no-runtime-footprint-inference.sh`
holds that it reads no pixel.

### Rules (`defs/rules/`, `defs/tags/`)

`sim::rules` (FR111/FR112) is the one generic rule engine: `evaluate(rules:
&[RuleDef], site: &impl RuleSite) -> Vec<Violation>`, pure, over integer
geometry only. Tags (`defs/tags/*.toml`, permanent id/key, append-only
manifest like every other kind) are the engine's only vocabulary -- an
object's `tags` field and a rule row's own subject/container/per/within/
a/requires fields all resolve a tag name to its id at build time; the
engine never sees a content key. `scripts/ci/check-rule-engine-no-
content-keys.sh` fails the build if any manifest key ever appears as a
quoted-string literal under `server/sim/src/rules/`. `RuleSite` answers
three questions over integer geometry -- tags at a cell, real areas
containing it, subjects within an area or the whole site.

A tag's own `[[tag]]` row may carry `role = { layers = [...] }`; its
presence is what makes that tag a role. The closed taxonomy is ground,
pavement, road, wall, floor, threshold, fixture. `layers` is the closed
set of `sim::codes::layer` names an object of that role may sit on,
resolved to codes at build time. Every `[[object]]` carries exactly one
role tag in its ordinary `tags` list -- zero, two, or a layer outside the
role's own `layers` all fail the build by object key.

Five closed kinds, one TOML array table each under `defs/rules/*.toml`,
any file: `[[placement]]`, `[[distribution]]`, `[[coherence]]`,
`[[adjacency]]`, `[[requirement]]`. `RuleKind` is a closed Rust enum
matched exhaustively (no `_ =>` arm) -- a sixth kind is a compile error
until the match is updated on purpose. Every rule kind shares one id/key
namespace ("rule") in the manifest. Distribution's "evenly spread" is a
ratio, a minimum spacing and a maximum coverage distance (`max_distance`,
always positive) together. `evaluate` returns every violation, sorted
and deduplicated.

Adjacency's engine shape is `Adjacency { a, relation, alternatives:
&'static [&'static [NeighbourTerm]] }`, where `NeighbourTerm { direction,
tag, present }` names one same-floor neighbour condition; an alternative
matches when every one of its terms holds, and the row matches when any
alternative does. `Require` violates when no alternative matches;
`Forbid` violates once per matching alternative, and every `Forbid`
alternative is exactly one `present: true` term. `[[adjacency]]` authors
either the terse `b` (+ optional `direction`) form or a hand-authored
`alternatives` pattern (an optional `rotate = true` lowers one authored
alternative to its four 90-degree rotations); `tools/defs-build` lowers
both into the same `alternatives` shape at build time. `Violation` carries
`other: Option<Cell>`, the matched neighbour cell for a `Forbid`
violation, `None` otherwise -- ordering is `(rule_id, subject, other)`.
Two `Forbid` rows whose lowered constraint sets agree up to swapping
which tag is the subject are refused at build time -- `road`/`floor` and
`floor`/`road` are the same seam under two names. Room and building
grammar primitives are ordinary rows in `defs/rules/*.toml`.

Rule rows and the tag table are emitted into `server/sim/src/generated/
defs.rs` only, as `static` tables (`TAGS`, `RULES`); tags (role included)
also reach `client/public/defs/defs.json` as a required field (an
object's `tags` field, validated against the tag table on both sides
identically), rule rows never do -- the client never evaluates a rule.

There is no separate rule-set version: `defs_version` already hashes
every tracked file under `defs/`, including `defs/rules/` and
`defs/tags/`, and is the rule-set version FR108/FR109 refer to.

`sim::rules::RuleSet` is the only thing `evaluate` accepts, and
`RuleSet::committed` (wrapping `generated::defs::RULES`) is its only
non-test constructor -- `RuleSet::for_test` and `rules::testing` are
gated behind the `test-fixtures` feature. `sim::validation::validate` is
the one validation harness: it takes no rules, object or balance
argument, reads the committed defs itself, and composes `evaluate`
against `RuleSet::committed` with the enclosed-region/narrow-passage
walkability checks over a real placed-object block, never stopping at
the first defect. A candidate carries its own producing `defs_version`;
`validate` refuses (`RuleSourceMismatch`) rather than validating one
stamped with any other version. `sim::validation::PlacedSite` (a
`RuleSite` over placed objects) stamps every cell of a placed object's
footprint with every one of its tags, unioned where objects stack, and
its own indexing cost is bounded by placed cells and areas, never by
cells times areas. `scripts/ci/check-rule-source.sh` fails the build if
`server/sim/Cargo.toml` names `test-fixtures` on any line but its own
`[features]` declaration and self dev-dependency, if any other manifest
but that one and `server/bounds/Cargo.toml` enables it, if the resolved
feature graph for `browser_city` ever turns it on or cannot be resolved
at all, or if `for_test`, `RuleKind` or `RULES` (the bare words) appear
outside `server/sim/src/rules/`.

Every committed rule key is named by at least one passing and one
deliberately failing example under `server/sim/tests/rule-examples/
*.grid` -- flat, no per-rule directory: a case's own `rules:` header
lists every key it is a worked example for. A small line-oriented format
(`server/sim/tests/support/grid.rs`) declares a tag legend, an optional
set of opaque areas over a rect, a character grid (`.` empty, top row
`y=0`, left column `x=0`) and, for a `fail` case, the exact rendered
`sim::validation::Defect` lines it must produce. `server/sim/tests/
rule_examples.rs` evaluates every case against the *whole* committed
`RuleSet` (never only the rule(s) it names) with exact-set assertion,
enforces that every committed key has a case both ways, and that a
`fail` case is a small change over a `pass` case sharing one of its
rules, never an unrelated toy world. `scripts/dev/verify-defs.sh` is the
one command an agent runs: it regenerates `defs/`, builds the corpus's
own test binary, then runs it, exit `0` only when every case passed,
`1` for a named failure, `2` when the harness itself could not build.
`defs/README.md` is the agent-facing copy of this same grammar --
excluded from `defs-build`'s own parse, though still folded into
`defs_version` like every other tracked path here.

`docs/generation.md` (FR111) is the home of rule and generation-parameter
*intent*, keyed by rule key / balance key, never under `defs/`. Its
machine-read sections are the five kinds plus `## parameters`, exact
heading text, one table each; a rule row's `pass` column must name a
`### ` heading under its own `## Passes` section, and its `reads`
column must name a row in the `## Neighbourhood parameters` table.
`server/sim/tests/rule_examples.rs` fails when a committed rule key has
no row under its own kind's section there, or when a committed key's
row is still marked `planned`, or when `## Must never be seen`'s own
`Status` disagrees with what its `Claimed by` column derives.

## Generation

`sim::generation` (FR110): the generator's seven coarse-to-fine passes,
pure functions and data only (NFR28) -- no table, no reducer, no client
code. A pass's signature is: the city seed, `&` the outputs of *earlier*
passes it actually reads (never a later pass, never by mutation) and
`GenerationConfig` -- nothing else. Pass ids (`PASS_LAND_USE`..
`PASS_PROP_PLACEMENT`) are append-only constants in FR110's own order; a
pass not yet implemented still reserves its id. Each pass seeds its own
`sim::rng::Rng` stream from `seed_from_ids(city_seed, PASS_ID)`, so
adding a draw to one pass never reshuffles another; within pass 2, each
superblock further seeds its own stream from `seed_from_ids(pass_seed,
superblock_index)`, and within passes 3-4 each block and each plot from
its own bounds (`generation::rect_seed_key`), never its position in a
list -- so one block's (or plot's) own draw count never reshuffles
another's, and adding a plot to one block never moves any other block's
or plot's draws.

`generation::plan(city_seed, &cfg, &content) -> Result<District,
GenerationError>` chains every implemented pass in order with no verdict
on the result (only pass 1's own site check can fail). `content` is
`GenerationContent { rules: RuleSet<'_>, building_types: &[BuildingTypeDef]
}` -- every content table a pass reads, loaded once
(`GenerationContent::committed()` wraps `RuleSet::committed()` and
`defs::BUILDING_TYPES`) and passed down as a struct, never a literal read
from `defs::` inside a pass; one signature, no `plan_with` twin.
`District::check_building_count(&cfg)` holds AC4's building-count
verdict; `District::check_rules(&content)` holds FR112's verdict over the
finished district's own `DistrictSite` (`sim::rules::evaluate` must find
no violation); `District::check_workplace_count(&cfg, &content)` holds
AC4's workplace-count verdict, the same two-band shape as building count.
`generation::generate` is `plan` plus all three, in that order, and is
what production calls. `scripts/ci/check-generation-entry-point.sh` fails
the build on any `plots::run(`/`envelopes::run(`/`building_types::run(`
call under `server/sim/tests/` or `server/bounds/` not marked `//
generation-entry-point: allow` -- the marker is reserved for the
independence properties and the golden's pass-2-run-twice test, which
deliberately feed one pass a perturbed or repeated predecessor;
single-pass unit tests live in the pass's own module. `GenerationError`
is the one error type across every implemented pass (`InvalidConfig` from
`GenerationConfig::from_balance`, `InvalidSite { site,
coarse_cell_size_cells }` from pass 1, `BuildingCountOutOfTolerance {
got, min, max }` from the district's own count check, `RuleViolations {
count, first }` from `check_rules`, `WorkplaceCountOutOfTolerance { got,
min, max }` from `check_workplace_count`) -- never a `Result<_, String>`
per pass.

Coordinates are world-absolute `i32` cells throughout; `SiteBounds` is
`sim::world::Rect` reused, never a second rect type. `GenerationConfig::
from_balance` reads every balance key the implemented passes need once,
returning `Err` on a cross-key inconsistency a single key's own range
cannot express (e.g. the site extent not a multiple of the coarse cell
size) -- a missing balance key itself is not an `Err` case: `sim::
balance::value` panics on that, the same as every other balance read in
`sim`, since a missing key is a `defs/`-authoring bug, not a runtime
config error. Pass 1 (`land_use::run`) itself also returns `Result`,
refusing (never silently truncating) a site whose extent is not a whole
multiple of the coarse cell size.

A measured generation ceiling (`generation.streets.max_detour_
excess_cells`) is set from `cargo run -p bounds --release --bin
measure-generation`'s own output by the margin rule stated in that key's
own `defs/` comment; a `from_balance` refusal alongside one is a
config-consistency (loosening) guard, never a generator worst-case
claim.

Pass 2's own junction registry enforces one specific case: where two
*different* streets each cross the same third street (a staggered
crossing), their own crossing points are either coincident (a true
4-way) or at least `generation.streets.junction_min_separation_cells`
apart, centreline to centreline (`resolve_junction_position`'s own doc
comment argues why this holds for every split this pass ever creates).
This is narrower than "every pair of junctions on one street": two
junctions from an ordinary sequential block split are governed by
`min_block_depth_cells` instead (`try_split` never places a split
closer than that to either end of its own parent rect), a different,
already-enforced margin, not this registry.
`StreetNetwork::close_same_street_junction_pairs` checks the net gap
(carriageway edge to carriageway edge) between every same-line pair, of
either kind, against `min_block_depth_cells` -- asserted empty over
arbitrary seeds.

Land use and the street network are independently generated fields (no
land-use-boundary snapping) -- a block's own land use is decided once,
after subdivision, by majority coarse-cell area (`generation::
block_land_use`), so a change of use only ever reads at a real block
edge. `subdivide` still forces a split whenever the current rect spans
more than one land-use region, which is what keeps every region
touching a street (AC2) without that snapping.

Which of a block's own four sides abut a real street is
`generation::block_sides(bounds, site)`: a side abuts a street iff it
does not coincide with the site's own boundary -- a pure O(1) function
of the block's own bounds against the site's, never a stored field and
never a scan of `StreetNetwork::edges` per block, guarded by the
invariant `inv_generation_block_sides_matches_a_real_street_edge`
against the real street edges. Pass 3 (plot subdivision) reads this to
cut only street-abutting faces into plots, never landlocking one; every
cell of a block belongs to a plot, and land no row claims is one
explicit `open` plot, never silent remainder. Pass 4 (the building
envelope) sizes a footprint from each plot's own geometry, land use and
density, always inside its own plot, at or above that land use's minimum
usable interior (checked against the interior net, footprint minus the
wall ring, never the outer rectangle) -- a plot that cannot hold that
minimum yields a typed `EnvelopeOutcome::Rejected`, counted, never a
footprint shrunk below it, and pass 3 never hands it one.
Building count itself fails generation: `District::check_building_count`
returns `Err(GenerationError::BuildingCountOutOfTolerance)` when the
realised placed-envelope count for a seed sits outside `[min, max]`,
derived from `generation.envelopes.target_count_per_million_cells` (the
Scale Baseline figure, never a measurement of the generator itself)
scaled by the real site area and `count_tolerance_percent`; the pooled
mean over a fixed seed range is held to that same target within
`mean_count_tolerance_percent`.

Pass 5 (building type, FR116) hands down what each placed envelope *is*:
a `defs::BuildingTypeDef` id, from the `building-types` def kind
(`defs/building-types/*.toml` -> `tools/defs-build` ->
`sim::generated::defs::BUILDING_TYPES`, a permanent append-only
id/key). A row carries `tags`, `land_uses` (a `[bool; 4]` mask, one per
`LandUse` variant), `density_min`/`_max`, `min_interior_width_cells`/
`_depth_cells`, `weight`, `requires_site`/`prefers_site` (each a
`[bool; 4]` mask over the same closed structural vocabulary --
`corner`, and the street tier an envelope's own front faces:
`arterial`/`street`/`lane`, `tools/defs-build`'s own `RawSiteContext`
order), `density_affinity` and `professions` (a plain profession key
list, into `defs/professions/`) -- never a `count`/`unique`/`required`
field: how many of something exist is a rule (a `[[distribution]]`
row), never a field on the type. "Institution", "workplace" and
"dwelling" are all *derived*, never a stored category: a workplace is
any type whose own `professions` is non-empty, a municipal service
carries the `municipal_service` tag, a dwelling carries `dwelling`.

`building_types::run` places constructively, in two steps: a weighted
draw among every *hard*-eligible type for an envelope's own plot (land
use, density band, minimum interior, every `requires_site` context it
demands) first, seeded from the envelope's own footprint
(`rect_seed_key`, never list position); then, for every committed
`[[distribution]]` row, read generically through `sim::rules::RuleDef::
as_distribution` (never by matching the rule engine's own closed kind
enum) in ascending rule id order, an override onto a named institution
among the still-eligible envelopes. A row's own whole-site target
(`per`-tag count / `ratio`, the same figure `sim::rules::evaluate`'s
own Distribution check computes) splits into a *floor* per catchment --
a fixed-extent square tiling the site (`GenerationConfig::building_
type_catchment_extent_cells`) -- and a site-wide *remainder*: each
catchment owes exactly `floor(per-tag count in that catchment /
ratio)`, never a share inflated by how much of the `per` tag it happens
to hold (a proportional remainder drags a civic building toward
whichever catchment holds the most dwellings, not toward its own
preferred site); the units the floors do not account for are placed
site-wide instead. Both the per-catchment floor and the site-wide
remainder place through the one `place_row`, sharing one running
`min_spacing` state (`chosen_cells`) so nothing before or after a
catchment boundary clusters. Within either pool, candidates are ranked
-- never chosen by a distance search -- first by how many of the
subject type's own `prefers_site` contexts they match, then by
`density_affinity`, then by a seeded draw key (total in practice, so a
distance tie-break is never reached). `place_row` first runs plain
first-fit over that rank order (the floor: a target's placed count is
never below what first-fit alone would give), then a depth-first search
bounded by `PLACEMENT_SEARCH_NODE_BUDGET` (a fixed node count, never
wall-clock, since maximum independent set on a spacing graph is NP-hard
and this runs inside world creation) for a fuller selection: a top-
ranked candidate that conflicts (by `min_spacing`) with every other
real candidate, none of which conflict with each other, must never
strand an achievable target (found by `proptest`, PR #317 cycle 3) --
the search only ever decides whether a candidate already offered in
rank order is kept, never reorders the pool itself. On a `target`
genuinely unreachable from the pool, `place_row` returns the largest
real selection the search found within its own budget, never an empty
one (PR #317 cycle 4: an earlier version popped every tentative choice
back out on failure, silently placing zero where `target - 1` was
real).

The per-catchment floor is a real, unconditional guarantee, never
discounted by the row's own site-wide `tolerance_percent` (that
tolerance belongs only to the site-wide ratio check `sim::rules::
evaluate`'s own Distribution kind runs, where the unplaced remainder
lives): a catchment is owed exactly `floor(per-tag count in that
catchment / ratio)`, bounded down only by what the catchment's own real
geometry can hold -- the largest `k` for which some subset of its own
hard-eligible, unclaimed candidates is pairwise-`min_spacing`-clear (of
each other and of this same row's own subjects already placed in a
neighbouring catchment, since `min_spacing` is a site-wide constraint,
never scoped to one catchment). `inv_generation_no_quadrant_lacks_its_
required_services` (`server/sim/tests/invariants.rs`) asserts `placed
>= k` per seed, per catchment, over arbitrary `u64` seeds, computing
that same `k` independently -- never skipping the assertion outright,
even where `k` is `0`.

`DistrictSite` (`generation::site`) is the one `RuleSite` a *finished*
district presents to `sim::rules::evaluate` -- one subject cell per
typed building (its front-edge midpoint, floor 0, tagged with its own
type's `tags`), one area per block (`AreaId = rect_seed_key(block
bounds)`) -- built once, from the same fields, by `District::
check_rules`. Pass 5's own constructive placement shares only
`front_cell`, the same one-subject-cell rule, since `evaluate` needs a
finished district's full tag/area index, never a partial one; it never
calls `evaluate` per candidate, and is whole-site. `scripts/ci/
check-generator-no-content-keys.sh` holds the generator to the same
content-blindness `check-rule-engine-no-content-keys.sh` holds the rule
engine to: no building-type/tag/profession/rule key as a quoted literal
under `server/sim/src/generation/`.

Evidence: `bounds/src/generation_evidence.rs` renders every implemented
pass's own output, for three committed seeds, to `docs/generation/*.svg`
-- pass 5's own file additionally tints each envelope by a derived,
structural `TypeClass` (never a tag name or a hash: is the `per` basis
of a committed distribution row, housing; is named by a committed
coherence row's own `subject`/`within`, the two form extremes; has
posts, workplace; both housing and posts, mixed use; none of these,
vacant/yard -- six fixed classes, a fixed palette, so two unrelated
types can never collide onto one swatch), marks every envelope whose
own type is the subject of a committed distribution row this pass
actually feeds with a marker shape read from that one row list's own
position (map and legend share the identical list and index -- a
second, `placed`-filtered list with its own index was PR #317 cycle 3's
own map/legend mismatch), overlays a dashed catchment grid with a pink
wash over a physically-short catchment (no text on the map -- PR #317
cycle 4: five-line label plates on the map itself covered half a
catchment; the per/owed/placed figures now live in a panel below the
map, one line per catchment). `cargo run -p bounds --bin dump-generation`
regenerates them; `bounds/tests/generation_evidence_current.rs` fails
the build if the committed files and a fresh render ever disagree.

`GENERATION_VERSION` is bumped whenever any implemented pass's algorithm
or seeding (never a `defs/balance/generation.toml` or
`defs/building-types/`/`defs/rules/` retune) moves a fixed seed's
output; `server/sim/tests/generation_golden.rs` runs against a config
and a small `GenerationContent` both frozen in the test itself, under
deliberately unrelated ids/keys, not live `defs::BALANCE`/
`defs::BUILDING_TYPES`, so a balance or content retune alone never
forces a version bump, and the same shape of output against a wholly
different content table is itself proof the generator never branches on
a content key. `server/sim/tests/goldens/generation_v5.golden` is keyed
to it, guarded by `check-golden-version-bump.sh`'s `generation_*` arm the
same way `RNG_VERSION`/`APPEARANCE_VERSION` are.

## Routing

- `server/sim/src/routing/` owns the estimate, the graph and the search.
- `Milliminutes` is the sole cost unit under `routing/`.
- The estimate is Manhattan distance x the derived walking rate x the mode percent, plus a per-floor penalty: pure, cache-free and table-free, enforced by `scripts/ci/check-routing-estimate-purity.sh`.
- `sim::time::REAL_MS_PER_CITY_MINUTE` is the one server-side FR1 constant.
- Transport modes are `routing.speed_percent.*` multipliers on `movement.walk_speed_millicells_per_s`, never absolute speeds.

## Boot budget

Boot milestones are marked only through `client/src/boot/boot-marks.ts`; NFR1
is measured by `scripts/dev/run-boot-budget-spike.sh` against a production
build.

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

`docs/trace-matrix.md`'s `| Requirement | Status | Guard |` tables are
recognised by that exact header; `check-trace-matrix.sh` checks every
`covered`/`partial` cell's paths and declared names (NFR47).

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
