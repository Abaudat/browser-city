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
