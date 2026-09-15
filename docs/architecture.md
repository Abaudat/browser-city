# Architecture

The technologies and the rules for using them. Requirements live in `docs/requirements.md` and are
cited here by identifier.

## Stack


| Part                          | Technology                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server module                 | Rust, edition 2024, `crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`                           |
| Server, database, replication | SpacetimeDB 2.9.x — the `spacetimedb` crate                                                              |
| Server workspace              | `server/` is a Cargo workspace: `sim` (pure logic), `bounds` (the table-bounds registry), and the `browser_city` module crate, which depends on both |
| Property testing (server)     | `proptest`, dev-dependency of `sim` only; case count from `PROPTEST_CASES`                              |
| Property testing (client)     | `fast-check` 4.10.0, pinned, `devDependency` of `client` only; never a runtime import, never in the built bundle |
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
  sub-cells relative to the footprint's anchor cell;
  `COLLIDER_SUBCELLS_PER_CELL` is generated into both artefacts and is
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
  sub-cells relative to the anchor cell, in the same unit as `collider`,
  reaching outside the footprint by at most `INTERACT_AT_MAX_REACH_CELLS`
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
prompt (story 4.6), the options menu and the connection notice. `client/
src/ui/` is their only home -- `mountOptionsMenu`/`mountConnectionNotice`
each take plain data and callbacks through a `mountX(options)` function
and return a handle with `destroy()`, no framework, no dependency. Every
top-level element a surface mounts carries `data-bc-surface` with one of
`options-menu`, `connection-notice` or `name-prompt`, checked exhaustively
against `document.body`'s own children by
`client/tests/e2e/connection-notice.spec.ts`. `ui/style.ts`'s
`ensureStyle(doc, id, css)` and `ui/theme.ts`'s `ensureUiTheme(doc)`
(shared font/colour/accent custom properties) are the one styling
mechanism both surfaces use, so a third surface never invents its own.

- `client/src/net/connection.ts`'s `ConnectionStatus` (`"connecting" |
  "connected" | "disconnected"`) is `net/`'s only connection-state export
  -- a plain string union, never an SDK type. `ui/connection-notice.ts`
  duplicates the same three-member union locally rather than importing
  it: `src/ui/**` may not import `net/**` (or `pixi.js`, `render/**`,
  `world/**`, `test-street/**`) -- a DOM surface receives plain data
  through its mount options, never reaches into the game. The union is
  built so a later story can add a `"reconnecting"` member (reconnection
  itself is out of scope here) without reshaping either side.
- The connection notice shows, after a debounce, while the status is not
  `"connected"`, and on recovery shows "Reconnected" briefly before a
  fade -- the only animation in this layer. Nothing in the disconnect
  path touches the Pixi `Application`, the scene, its ticker or any pool:
  the notice is the disconnect's only consumer, which is what makes "the
  world keeps rendering its last known state" hold by construction.
- The options menu is one panel, three sections in this fixed order --
  Audio, Display, Controls -- as stacked headings, never tabs. Every
  control has a real consumer today or a persisted value a named later
  story reads.
- `client/src/settings/settings-storage.ts` is the one settings-storage
  idiom every group (`input/keybindings-storage.ts`, `settings/
  audio-settings.ts`, `settings/display-settings.ts`) shares: one
  versioned `localStorage` key per group, read once through an injected
  `Storage`. Reading never throws and never writes; a version or shape it
  does not recognise falls back to defaults in memory.
- Three mechanical guards keep this section true, all run by
  `client-check`: `scripts/ci/check-no-canvas-ui.sh` (no Pixi `Text`/
  `BitmapText`/`HTMLText`/`SplitText` construction or import, no native
  `alert`/`confirm`/`prompt`, anywhere under `client/src/`);
  `client/biome.json`'s `src/ui/**` override (nothing below `ui/` can be
  imported by `render/**`, `world/**` or `input/**`, and `ui/**` itself
  cannot reach `net/**`, `render/**`, `world/**`, `test-street/**` or
  `pixi.js`); and `noRestrictedGlobals` banning `document` in
  `render/**`, `net/**`, `defs/**` and `boot/**` (`window` stays allowed)
  -- DOM creation is only possible in `ui/`, `input/`, `test-street/` and
  `main.ts`.

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
`wall_decals` 40, `characters` 50. `ground` keeps rank 0 and is the flat
ground pass's layer -- never a pool member, so its rank is never compared
against a pool rank. `overhead` (code 1, rank 1) is deprecated: its row
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
sub-rect -- a placeholder sub-rect until an atlas exists, but the field is
never optional. Extent comes from the placed object's `object_def`
(`defs/`), never a hardcoded number, and is capped at approximately 8x8
(FR127). A per-cell sub-rect is only ever legal on whole-tile boundaries:
either the source art is already exactly one tile long on the decomposed
axis (every cell repeats it whole) or exactly `cells * tile_size_px` long
(sliced into equal whole-pixel cells) -- anything else, including any
horizontal overhang, is refused at mount rather than drawn stretched or
fractional.

`render.tile_size_px` and `render.storey_height_px` are balance keys
(`defs/balance/render.toml`), not TypeScript literals, so they fold into
`defs_version` and stay reviewable alongside the art. `storey_height_px`
is the floor screen offset FR124 describes: a drawable's screen position
subtracts `floor * storey_height_px`, and a drawable on a storey above the
viewer's own must never sort as though it were on that floor because of
it.

The test street reads its sprites straight out of the repo-root
`ModernTileset/` at runtime (`new URL(..., import.meta.url)` asset
imports), not out of `client/public/`. `deploy.yml`'s `deploy-client` job
therefore checks out the whole repository -- never a sparse or
`client/`-only checkout -- for as long as any client code reads assets
from outside `client/`.

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
  once per family (`adult`/`kid`) in `[[appearance_layout]]`, and
  enforced against every part sheet's real dimensions: `tools/defs-build`
  reads each PNG's `IHDR` (width/height only, no `png` crate) and rejects
  a sheet whose size is not one of the layout's own declared
  `accepted_sizes`.
- Part sheets are fetched lazily, once per sheet, as CPU-side
  `ImageBitmap`s (`fetch` + `createImageBitmap`) -- never through Pixi's
  `Assets`/`Texture`. A bitmap is only needed while a composite is being
  built: `part-sheets.ts` ref-counts each in-flight load and closes the
  bitmap once every caller drawing from it has finished.
- Exactly one composite `Texture` exists per unique tuple+override: the
  five (or six, with a uniform accessory) layers are drawn in order via
  `OffscreenCanvas.drawImage` onto one compact strip, nearest-neighbour
  sampled, then wrapped in one Pixi `Texture.from` -- `RenderTexture`
  stays banned anywhere under `client/src/` ("Visibility" above). This
  texture is shared, reference-counted, and held in a bounded LRU
  (`render/appearance/appearance-cache.ts`) that evicts only entries with
  no outstanding reference. A character on screen is one `Sprite` in the
  `characters`-rank pool.
- Every `(animation, direction, frame)` cell of that compact strip is
  cropped once into its own frame `Texture` when the composite is built,
  never on a per-tick basis: callers look a frame up by index, they never
  construct one. Disposing a composite destroys every frame texture
  together with the base strip texture.

## Definitions (`defs/`)

`defs/` is the single source of truth for game content data (NFR31),
subdivided into `objects/`, `items/`, `recipes/`, `professions/`,
`chains/`, `appearance/` and `balance/`, each a directory of TOML files
(the naming table's `city-props.toml`). Neither build target writes here
and neither runs the generator: `tools/defs-build/` is a standalone Rust binary crate
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

Two optional sub-cell rects on an `[[object]]` carry its physical facts,
both validated identically on both sides: `collider` (FR128, fits inside
the footprint) and `interact_at` (FR148, reaches at most
`INTERACT_AT_MAX_REACH_CELLS` beyond it, has positive area, and never
lies entirely inside the object's own collider).

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
