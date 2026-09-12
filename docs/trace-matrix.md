# Trace matrix

The invariants named across `requirements.md` and the architecture, and
whether an automated test protects each one today. `covered` rows name the
test function that protects them -- a Rust `#[test]` function, or (story
1.6 on) an `it`/`test` name in `client/tests/unit/**` prefixed `inv_`;
`deferred` rows name the story that will add the subsystem they protect.
`scripts/ci/check-trace-matrix.sh` fails CI if a `covered` row's test does
not exist in either suite, or if an `inv_*` test exists in either suite
with no row here.

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| `inv_identical_seeds_derive_identically` | Two derivations from identical seeded inputs match (NFR25) | covered | `inv_identical_seeds_derive_identically` | — |
| `inv_no_matter_starves` | No matter starves indefinitely | deferred | | matter/needs system |
| `inv_inventory_superset_after_absence` | Inventory is a superset after any absence | deferred | | inventory system |
| `inv_no_owned_item_degrades_during_absence` | No owned item degrades during absence | deferred | | inventory/decay system |
| `inv_budget_never_negative` | Budget never goes negative | deferred | | economy system |
| `inv_collider_within_footprint` | `collider` is contained within `footprint` | deferred | | placement/collision system |
| `inv_collision_only_within_floor` | No cell on any other floor ever contributes to an entity's collision result (FR117) | covered | `inv_collision_only_within_floor` | — |
| `inv_floor_transition_lands_standable` | No transition cell ever targets a floor or cell where the entity would be inside geometry or out of bounds (FR117) | covered | `inv_floor_transition_lands_standable` | — |
| `inv_world_query_total` | A world query never panics and never wraps, for any i32 coordinate and any floor or layer (FR117) | covered | `inv_world_query_total` | — |
| `inv_cell_ownership_defined` | Every in-bounds cell answers the ownership query, and ids are stable across queries (FR119) | covered | `inv_cell_ownership_defined` | — |
| `inv_depth_order_total_and_stable` | The FR123 sort key is a strict total order (antisymmetric, strict for distinct keys, transitive), so no canopy footprint can ever fail to resolve an order | covered | `inv_depth_order_total_and_stable` | — |
| `inv_drawable_pool_is_a_permutation` | Sorting a drawable pool drops or duplicates nothing -- the output is exactly the input multiset (FR123) | covered | `inv_drawable_pool_is_a_permutation` | — |
| `inv_floor_never_affects_depth_order` | For any two drawables differing only in floor, the comparator's result against a third drawable is identical either way (FR124) | covered | `inv_floor_never_affects_depth_order` | — |
| `inv_multicell_prop_covers_footprint_once` | A multi-cell prop's decomposition yields exactly width*height drawables, anchors covering the footprint exactly once (FR125) | covered | `inv_multicell_prop_covers_footprint_once` | — |

## Coverage scale (NFR29)

Rows above track whether an invariant is exercised at all; this tracks
whether it is exercised at the scale NFR29 asks for. Not part of the
id/constant/test symmetry `check-trace-matrix.sh` enforces above (there is
no `INV_` constant for a case count) -- checked by eye until there is a
citizen simulation to run it against.

| Requirement | Status | Blocked on |
| --- | --- | --- |
| Property suite runs thousands of simulated citizen-weeks (NFR29) | deferred | citizen simulation |

## Round trip and client/server boundary

Not part of the `inv_*`/`INV_*` id symmetry above (these guard requirements
that span the client/server boundary or the CI graph itself, not a `sim`
invariant), but not just checked by eye either: `check-trace-matrix.sh`
asserts that the path named in every `covered` row's Guard column exists.
A guard renamed or deleted without updating this table fails CI.

| Requirement | Status | Guard |
| --- | --- | --- |
| Browser-exclusive, no install/plugin/download gate (NFR5) | covered | `client/tests/e2e/round-trip.spec.ts` -- runs the client in stock headless Chromium with no flag, plugin or install step |
| No code shared between `server/` and `client/` (NFR30) | covered | `scripts/ci/check-no-shared-code.sh` |
| Sim purity, reducers as the only table-touching layer (NFR28) | covered | `scripts/ci/check-sim-purity.sh` (unchanged by this story) |
| TeV per reducer class instrumented from day one (NFR17) | deferred | first real reducer class -- nothing to measure yet (story 1.1) |

## Schema permanence

Story 1.2: the permanent decisions NFR33-NFR37 forbid ever getting wrong
in a second commit. Same Guard-path discipline as the section above --
`check-trace-matrix.sh` asserts every `covered` row's path exists.

| Requirement | Status | Guard |
| --- | --- | --- |
| Every table has exactly one primary key; no Rust enum in module source; tables stay under the column ceiling or carry a waiver (NFR33, NFR35, NFR36) | covered | `server/bounds/tests/schema_shape.rs` |
| Every scheduled table carries `scheduled_id`/`scheduled_at` and names a real, scheduler-only reducer (NFR34) | covered | `server/bounds/tests/schema_shape.rs` -- `every_scheduled_table_has_the_required_columns_and_names_a_real_reducer` |
| The schema snapshot is never stale against source | covered | `server/bounds/tests/schema_snapshot_current.rs` |
| A moved primary key, a moved unique constraint, a changed scheduled status, a removed/retyped/reordered column, or a column inserted ahead of an existing one fails the build (NFR33) | covered | `scripts/ci/check-schema-additive.sh` |
| Appending a column with a default publishes against a live world; appending one without a default is rejected, not silently accepted, and the rejection is the automigration one -- not a build or connection failure passing for it (NFR33) | covered | `scripts/ci/check-live-migration.sh` |
| The character&lt;-&gt;identity mapping is one-character-to-N-identities, `identity` unique and `character_id` a plain index (FR142, D5) | covered | `server/schema.snapshot.json` (`character_identity`'s row: `identity`'s `unique` and `character_id`'s `indexed` fields, pinned and diffed by the two guards above) |
| A committed `sim::codes` line (a code number or a name) never changes or disappears once merged; only new lines may be appended (NFR36) | covered | `scripts/ci/check-codes-append-only.sh` |
| Re-seeding the extensible-set companion tables is idempotent (`reseed_codes`) (NFR36, NFR38) | covered | `scripts/ci/check-live-migration.sh` |
| An operator-only reducer rejects any caller that is not the module owner (`reseed_codes`, `tables::ops::require_owner`) | covered | `scripts/ci/check-live-migration.sh` |

## Definitions

Story 2.1: `defs/` is the only source of truth; both targets consume
generated output, never each other, under one `defs_version` (NFR31).
Same Guard-path discipline as the sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| The generator emits a Rust include and a client JSON asset from `defs/`, and neither is ever hand-edited | covered | `scripts/ci/check-defs-current.sh` |
| A malformed definition fails the build naming the offending file and line, and no partial output is emitted | covered | `tools/defs-build/tests/failure_fixtures.rs` |
| An id or a key, once merged, is never renumbered, reused or retired | covered | `scripts/ci/check-defs-ids-append-only.sh` |
| The single `defs_version` changes whenever anything under `defs/` changes, and never independently | covered | `scripts/ci/check-defs-version-bump.sh` |
| Both generated artefacts carry the exact same `defs_version`, asserted directly rather than inferred, and the built client asset ships it too | covered | `scripts/ci/check-defs-version-agrees.sh`, the `client-build` job's own build-asset assertion |
| The server's and the client's independent parsers agree on every field, and on a shared table of malformed input both must reject (NFR30) | covered | `server/sim/tests/defs_dump.rs`, `client/tests/unit/defs/dump-golden.test.ts`, `tools/defs-build/tests/shared_malformed_cases.rs`, `client/tests/unit/defs/malformed.test.ts` |
| The prop atlases, character-part atlases and audio manifest fold into `defs_version` | deferred | the story that adds each pipeline -- none of the three inputs exist yet |

## World addressing

Story 1.5: `(x, y, floor, layer)` addressing, collision, floor transitions
and cell ownership (FR117-FR119). Same Guard-path discipline as the
sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| Two cells at the same (x, y) on different floors both exist without conflict; an entity on floor 0 tests collision only against floor 0 (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `two_cells_at_the_same_xy_on_different_floors_never_conflict` |
| A player under a bridge deck passes under it the whole span; the same walk one floor up interacts with the deck geometry above (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `walking_under_the_bridge_is_unobstructed_the_whole_span` and `walking_on_the_bridge_deck_interacts_with_its_railings` |
| Entering a transition cell changes the entity floor and its collision set together, from one function application (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `entering_a_transition_yields_the_target_floor_and_its_collision_set_together` |
| A door is an ordinary walkable cell; walking through one is a continuous position sequence with no space transition (FR118) | covered | `server/sim/tests/world_acceptance.rs` -- `walking_through_a_doorway_is_a_continuous_walk_with_no_space_transition` |
| A building ownership id is queryable for the player position, inside and outside it (FR119) | covered | `server/sim/tests/world_acceptance.rs` -- `the_buildings_id_is_queryable_inside_and_not_outside` |
| The canonical fixture world and its hand-typed query answers are checked against the real `sim::world` query functions (Quentin direction) | covered | `server/sim/tests/world_conformance.rs` |
| The shared conformance fixture (`fixtures/world-conformance.v1.json`) is never stale against the `sim::world::fixture` source | covered | `server/bounds/tests/world_fixture_current.rs` |
| The `chunk_key` packing round-trips and never panics, including at the extremes (FR145) | covered | `server/sim/tests/world_chunk.rs` |
| A collision query costs a bounded, small number of dense-storage accesses regardless of world size, and the collision grid stays within its documented 1-bit-per-cell budget | covered | `server/sim/tests/world_perf.rs` |
| An ownership query scans only the areas sharing the queried chunk, never every area in the world (FR119, FR120, FR122) | covered | `server/sim/tests/world_perf.rs` -- `ownership_lookup_scans_only_the_queried_chunk_not_every_area_in_the_world` |
| The client-side TypeScript port of addressing, collision, transition and ownership reads the same fixtures/world-conformance.v1.json its Rust oracle reads (NFR30) | deferred | client-side collision/addressing story |

## Rendering

Story 1.6: FR123-FR127's depth sort, rank ladder and decomposition. Same
Guard-path discipline as the sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| The rank ladder tens are unique among live codes, and every pool rank is a multiple of ten (FR123) | covered | `server/sim/tests/codes.rs` -- `layer_ranks_are_unique_and_pool_ranks_are_multiples_of_ten` |
| A deprecated layer code (`overhead`) stays seeded but refuses a live rank lookup, on both sides (Tim direction) | covered | `server/sim/tests/codes.rs` -- `deprecated_layer_codes_stay_seeded_but_refuse_live_rank`, `client/tests/unit/render/layer-ranks.test.ts` |
| A committed `sim::codes` layer line never changes or disappears once merged; only new lines may be appended (NFR36) | covered | `scripts/ci/check-codes-append-only.sh` |
| The one client-side rank-ladder mirror (`layer-table.ts`) never drifts from the golden-pinned server mapping on any code, name, rank or deprecated flag (Quentin/Tim direction, cycle 2) | covered | `scripts/ci/check-layer-table-current.sh` |
| The comparator is the sole ordering authority: a pool container keeps `sortableChildren` at `false`, and the children of a real Pixi `Container` end up in the comparator order regardless of the order they were attached in, including across repeated re-sorts with no duplication | covered | `client/tests/unit/render/pixi-order.test.ts` |
| The FR123 sort-key unit (tile * `SORT_SUBDIVISIONS`) is declared exactly once, round-trips exactly, is strictly monotonic, and resolves sub-tile movement to a different unit before a whole tile is crossed (Tim direction, cycle 2) | covered | `client/tests/unit/render/sort-units.test.ts` |
| The FR124 floor offset is zero at floor 0, proportional and strictly monotonic in floor (higher floor draws further up the screen), and sourced from the `render.storey_height_px` balance key rather than a literal (Quentin direction, cycle 2) | covered | `client/tests/unit/render/screen-position.test.ts` |
| The tile size and storey height are `defs/balance/render.toml` keys, not TypeScript literals, and fold into `defs_version` | covered | `scripts/ci/check-defs-current.sh`, `scripts/ci/check-defs-version-bump.sh` |
| A real, mounted Pixi display list produces the same order the comparator produces over the identical, committed fixture scene, both at rest and after a real keyboard-driven move (Quentin direction) | covered | `client/tests/e2e/render-order.spec.ts` against `client/tests/unit/demo/drawables.test.ts` and its shared goldens (`golden.ts`) |
| The demo player movement never leaves its bounds, is a true no-op with no input, and reports a sort-key change exactly when the quantised position changes (Quentin direction, cycle 2) | covered | `client/tests/unit/demo/player-step.test.ts` |
| A per-cell sub-rect is only legal on whole-tile boundaries; a prop whose declared footprint does not match the real pixel dimensions of its art throws at mount rather than drawing a stretched or fractional slice (Artie/Tim direction, cycle 2) | covered | `client/src/demo/scene.ts` -- `sliceTexture`/`sliceAlongAxis` |
| Every sprite the demo scene mounts is drawn within the canvas -- an off-canvas scene fails loudly instead of passing every id-based check silently (Artie direction, cycle 2) | covered | `client/src/demo/scene.ts` -- `assertSpritesWithinCanvas`, called at mount |
| The client-only trace-matrix check (no cargo) and the full run agree, and `client-check` runs the former so a client-only PR is never gated on the slowest half of the graph (Tim direction, cycle 2) | covered | `.github/workflows/ci.yml` -- the `client-check` job's own step, `scripts/ci/check-trace-matrix.sh --client-only` |
| The render-order e2e hook never ships in the production bundle, same as every other `window.__bc` use | covered | `.github/workflows/ci.yml` -- the `client-build` job's own bundle grep |

## Scheduled-reducer timing

Story 1.3: `docs/spikes/1.3-scheduled-reducer-timing.md`'s measured drift
budget and post-publish schedule rule (R10, D7). Same Guard-path
discipline as the sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| The spike report measured SpacetimeDB version never goes stale against the `server/Cargo.toml` pin, the `docs/architecture.md` stack line, or the pinned CLI installer exact patch | covered | `scripts/ci/check-spike-pin.sh` |
| The drift claims in `docs/spikes/1.3-scheduled-reducer-timing.md` are re-runnable with one command | covered | `scripts/dev/run-sched-timing-spike.sh` |
| Whether a pending scheduled row survives a schema-changing publish, or a publish to Maincloud, is unmeasured (only a same-wasm, same-schema local republish was measured) | deferred | the deploy story |

## Backup and restore

Story 1.4: `docs/spikes/1.4-backup-restore.md`'s logical export/restore and
the platform limitations it found. NFR39 splits into two rows: this story
proves the restore has been tested; it does not wire a backup into a
migration, because no Maincloud deploy workflow exists yet to wire it into
(same Guard-path discipline as the sections above).

| Requirement | Status | Guard |
| --- | --- | --- |
| The restore has been tested: export -> restore -> verify against a real SpacetimeDB instance, including adversarial values (every non-scheduled table, Timestamp-bearing ones included), a real `auto_inc` id gap (the restored sequence advancing past the recorded floor in the exported manifest, never merely to the maximum id present in the restored data, so no id the source ever issued is re-issued; an overshoot correctly aborting the whole call), byte-budgeted multi-batch restore, and the refusal paths (NFR39) | covered | `scripts/ci/check-backup-restore.sh` |
| Every non-scheduled table has a `restore_<table>` reducer -- a table nobody adds one for can never actually be restored | covered | `server/bounds/tests/restore_coverage.rs` |
| The world is backed up before every migration (NFR39) | deferred | the deploy story -- no Maincloud deploy workflow exists yet to run `scripts/ops/export-world.sh` before a publish |
| An unattended scheduled export runs daily and alerts on its own failure, including a schedule GitHub silently disabled | deferred | the deploy story -- `backup.yml` is `workflow_dispatch`-only until `SPACETIME_MAINCLOUD_TOKEN` exists; a daily schedule that fails on every run until then trains people to ignore the alarm |
| A full restore has been performed and verified against Maincloud (AC4), including a real, >=100,000-id auto_inc gap-fill under the reducer execution limits Maincloud itself imposes, with its wall time measured, not merely local timings extrapolated | deferred | no Maincloud credential (`SPACETIME_MAINCLOUD_TOKEN`/`BACKUP_PASSPHRASE`/`vars.BACKUP_DATABASE`) exists in this repo yet -- `.github/workflows/backup.yml`'s `rehearsal` job (which already carves that gap with `scripts/ops/seed-id-gaps.sh` and logs the restore's own wall time) is correct by inspection and unexercised |
| Cross-table consistency during export (each table is its own transaction) | deferred | the first reducer that writes two tables in one transaction (e.g. `citizen` + `citizen_state`) -- nothing reminds anyone today because none does yet |
| No reducer other than `restore_<table>` writes an auto_inc table while a restore is open -- a client-facing write racing the gap-fill loop could observe or create an id the exported data still needs | deferred | the first story whose reducer accepts a live client connection *and* writes an auto_inc table; today a restore always targets a database name no client connects to, by procedure (`scripts/ops/restore-world.sh`'s own doc comment), not by a lock the module enforces |
| The spike report's measured SpacetimeDB version never goes stale against the same three pins story 1.3's does | covered | `scripts/ci/check-spike-pin.sh` |
