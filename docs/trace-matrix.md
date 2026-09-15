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
| `inv_collider_within_footprint` | `collider` is contained within `footprint` (FR128) | covered | `inv_collider_within_footprint` | — |
| `inv_collision_only_within_floor` | No cell on any other floor ever contributes to an entity's collision result (FR117) | covered | `inv_collision_only_within_floor` | — |
| `inv_floor_transition_lands_standable` | No transition cell ever targets a floor or cell where the entity would be inside geometry or out of bounds (FR117) | covered | `inv_floor_transition_lands_standable` | — |
| `inv_world_query_total` | A world query never panics and never wraps, for any i32 coordinate and any floor or layer (FR117) | covered | `inv_world_query_total` | — |
| `inv_cell_ownership_defined` | Every in-bounds cell answers the ownership query, and ids are stable across queries (FR119) | covered | `inv_cell_ownership_defined` | — |
| `inv_depth_order_total_and_stable` | The FR123 sort key is a strict total order (antisymmetric, strict for distinct keys, transitive), so no canopy footprint can ever fail to resolve an order | covered | `inv_depth_order_total_and_stable` | — |
| `inv_drawable_pool_is_a_permutation` | Sorting a drawable pool drops or duplicates nothing -- the output is exactly the input multiset (FR123) | covered | `inv_drawable_pool_is_a_permutation` | — |
| `inv_floor_never_affects_depth_order` | For any two drawables differing only in floor, the comparator's result against a third drawable is identical either way (FR124) | covered | `inv_floor_never_affects_depth_order` | — |
| `inv_multicell_prop_covers_footprint_once` | A multi-cell prop's decomposition yields exactly width*height drawables, anchors covering the footprint exactly once (FR125) | covered | `inv_multicell_prop_covers_footprint_once` | — |
| `inv_move_never_ends_inside_collider` | Starting from any non-penetrating position, any input sequence and any deltaMs (including huge frame spikes) never ends with the player box overlapping a collider (FR137) | covered | `inv_move_never_ends_inside_collider` | — |
| `inv_move_never_tunnels` | A single step with a delta much longer than a thin collider's width never ends on the far side of it | covered | `inv_move_never_tunnels` | — |
| `inv_slide_keeps_tangential_motion` | Moving diagonally into a flat, axis-aligned surface keeps the full tangential component of the motion and zeroes only the normal component; a flush two-cell corner never stops the player on its internal seam | covered | `inv_slide_keeps_tangential_motion` | — |
| `inv_collision_grid_matches_rebuild` | A model-based sequence of random insert/delete/update calls always leaves the grid identical to a from-scratch build of the surviving rows | covered | `inv_collision_grid_matches_rebuild` | — |
| `inv_absent_collider_is_walkable` | An object with no collider contributes nothing: the grid is unchanged by its insert and its delete, and a step in open space is never clamped (FR128) | covered | `inv_absent_collider_is_walkable` | — |
| `inv_step_is_frame_rate_independent` | In open space, one step of N ms equals k steps summing to N ms (within epsilon), and diagonal speed never exceeds axis speed | covered | `inv_step_is_frame_rate_independent` | — |
| `inv_retraction_keyed_on_ownership` | Over a generated terrace of adjacent buildings, any two cells inside the same building's own area give identical visibility for every drawable, and crossing a shared party wall flips retraction between exactly those two buildings' own near-side walls, never a third (FR120) | covered | `inv_retraction_keyed_on_ownership` | — |
| `inv_only_occupied_enclosure_opens` | In a generated terrace of N shops, standing in shop k retracts walls owned by k only (FR120) | covered | `inv_only_occupied_enclosure_opens` | — |
| `inv_floor_culling_exclusive` | Player floor >= 0 means no floor -1-or-below drawable is ever visible, and player floor < 0 means no floor >= 0 drawable is ever visible (FR122) | covered | `inv_floor_culling_exclusive` | — |
| `inv_visibility_never_reorders_pool` | Applying FR120/FR121/FR122 visibility never adds, removes or reorders pool members -- only `sprite.visible`/`sprite.alpha` change | covered | `inv_visibility_never_reorders_pool` | — |
| `inv_footprint_index_matches_rebuild` | A model-based sequence of random insert/delete/update calls always leaves the footprint index identical to a from-scratch build of the surviving rows, allocated chunks included (FR148) | covered | `inv_footprint_index_matches_rebuild` | — |
| `inv_pick_inverts_screen_position` | For any cell, any floor and any pixel of the screen rect that cell is actually drawn over, picking resolves back to that same cell, through `screen-position.ts`'s own projection constants (FR148) | covered | `inv_pick_inverts_screen_position` | — |
| `inv_reach_is_the_declared_rect` | For any anchor, any declared `interact_at` (negative offsets and rects reaching past the footprint included), any sub-cell count and any two floors, reachability equals the half-open reach rect in continuous world coordinates -- an independent model, so a swapped comparison or a dropped anchor translation fails (FR148) | covered | `inv_reach_is_the_declared_rect` | — |
| `inv_pick_hits_only_what_is_drawn_at_the_point` | For any candidates on one cell -- drawn over the point, drawn elsewhere, or drawing nothing at all, each independently visible -- the pick returns only one actually drawn at that point, chosen by the renderer own sort, and nothing when none is. The broad phase over-registers on purpose, so this is what makes a pick correct (FR148) | covered | `inv_pick_hits_only_what_is_drawn_at_the_point` | — |
| `inv_pick_resolves_topmost_drawn` | For any number of objects covering the clicked point, drawn from any layers in the rank ladder and independently visible or hidden, the pick returns whichever the renderer own sort draws last, and nothing when all are hidden (FR148) | covered | `inv_pick_resolves_topmost_drawn` | — |
| `inv_unreachable_never_emits` | For any player position, a click on an interactable object emits exactly one intent when the player's feet are inside its `interact_at`, and exactly one ignore when they are not -- never both and never neither (FR148) | covered | `inv_unreachable_never_emits` | — |
| `inv_keybindings_injective` | After any sequence of rebinds, no key code is ever bound to two actions, no action is missing, and no reserved code is ever bound (FR149) | covered | `inv_keybindings_injective` | — |
| `inv_keybindings_parse_is_total` | Parsing any value at all as stored bindings never throws and always yields a complete, valid, injective map (FR149) | covered | `inv_keybindings_parse_is_total` | — |
| `inv_keybindings_read_is_total` | Reading any string at all out of the bindings storage key never throws, always yields a complete map, and never writes -- so a parse bug can never destroy saved bindings (FR149) | covered | `inv_keybindings_read_is_total` | — |
| `inv_rebind_survives_reload` | Whatever any sequence of rebinds produces, loading it back yields exactly that map -- `rebind` and `normaliseBindings` cannot disagree about what is bindable, so no binding the player sets can vanish on the next boot (FR149) | covered | `inv_rebind_survives_reload` | — |
| `inv_appearance_deterministic_from_id` | The same citizen id always derives the same five-integer appearance tuple (FR61) | covered | `inv_appearance_deterministic_from_id` | 1.10 |
| `inv_appearance_indices_in_range` | For any u64 citizen id and family, `sim::appearance::generate` never panics and every non-zero index it returns names a real manifest entry of the matching family (FR61) | covered | `inv_appearance_indices_in_range` | 1.10 |
| `inv_kids_parts_only_on_kids_bodies` | A kid family tuple only ever contains kid-family body/eyes/hairstyle/outfit parts, and its accessory is always 0 -- never an adult part (FR61) | covered | `inv_kids_parts_only_on_kids_bodies` | 1.10 |
| `inv_outfit_follows_occupation` | Resolving a profession's uniform override (`resolveUniform`) always yields that profession's declared role_only, adult outfit/accessory by id, for any profession in `defs/professions` that has one (FR62) | covered | `inv_outfit_follows_occupation` | 1.10 |
| `inv_composite_cache_one_texture_per_tuple` | The appearance composite cache returns the same texture instance for the same tuple+override, calls the factory exactly once per unique key, and releases a texture once every reference is gone (FR61) | covered | `inv_composite_cache_one_texture_per_tuple` | 1.10 |
| `inv_composite_cache_bounded` | The appearance composite cache never holds more than its declared engineering cap of entries, evicting least-recently-used ones first | covered | `inv_composite_cache_bounded` | 1.10 |

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
| The server and the client independent parsers agree on every field, and on a shared table of malformed input both must reject (NFR30) | covered | `server/sim/tests/defs_dump.rs`, `client/tests/unit/defs/dump-golden.test.ts`, `tools/defs-build/tests/shared_malformed_cases.rs`, `client/tests/unit/defs/malformed.test.ts` |
| The prop atlases, character-part atlases and audio manifest fold into `defs_version` | deferred | the story that adds each pipeline -- none of the three inputs exist yet |
| An object `collider` (sub-cells, FR128) rejects zero/negative area and a rect that does not fit inside `width*height*COLLIDER_SUBCELLS_PER_CELL`; `COLLIDER_SUBCELLS_PER_CELL` is generated once into both artefacts (story 1.8) | covered | `tools/defs-build/tests/failure_fixtures.rs` -- `a_zero_area_collider_is_named`, `a_collider_outside_its_footprint_is_named`; `tools/defs-build/tests/shared_malformed_cases.rs` |

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
| The client-side TypeScript port of chunk addressing and whole-cell collision reads the same fixtures/world-conformance.v1.json its Rust oracle reads, and agrees on every case (NFR30, story 1.8) | covered | `client/tests/unit/world/conformance.test.ts` |
| The client-side TypeScript port of floor transitions and building/room ownership reads the same fixtures/world-conformance.v1.json its Rust oracle reads, and agrees on every case (NFR30, story 1.7) | covered | `client/tests/unit/world/conformance.test.ts`, `client/tests/unit/world/ownership.test.ts`, `client/tests/unit/world/transitions.test.ts` |

## Rendering

Story 1.6: FR123-FR127's depth sort, rank ladder and decomposition. Story
1.7: FR120-FR122's enclosure visibility (near-side retraction, window
translucency, subway/street floor culling). Same Guard-path discipline as
the sections above.

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
| A real, mounted Pixi display list produces the same order the comparator produces over the identical, committed fixture scene, both at rest and after a real keyboard-driven move (Quentin direction) | covered | `client/tests/e2e/test-street.spec.ts` (which replaced `render-order.spec.ts`) against `client/tests/unit/test-street/drawables.test.ts` and its shared goldens (`golden.ts`, generated by `regen-golden.ts`, never hand-typed) |
| The demo player movement is resolved by `world/movement.ts` swept-AABB `step` against real fixture colliders, and the scene only re-sorts when the player own quantised sort-key position actually changes (replacing the old bounds-clamped `player-step.ts`) | covered | `client/tests/unit/world/movement.test.ts`, `client/tests/unit/test-street/drawables.test.ts` |
| A per-cell sub-rect is only legal on whole-tile boundaries; a prop whose declared footprint does not match the real pixel dimensions of its art throws at mount rather than drawing a stretched or fractional slice (Artie/Tim direction, cycle 2) | covered | `client/src/test-street/scene.ts` -- `sliceTexture`/`sliceAlongAxis` |
| Every sprite the street scene mounts is drawn within the canvas -- an off-canvas scene fails loudly instead of passing every id-based check silently (Artie direction, cycle 2) | covered | `client/src/test-street/scene.ts` -- `assertSpritesWithinCanvas`, called at mount |
| The client-only trace-matrix check (no cargo) and the full run agree, and `client-check` runs the former so a client-only PR is never gated on the slowest half of the graph (Tim direction, cycle 2) | covered | `.github/workflows/ci.yml` -- the `client-check` job's own step, `scripts/ci/check-trace-matrix.sh --client-only` |
| The render-order e2e hook never ships in the production bundle, same as every other `window.__bc` use | covered | `.github/workflows/ci.yml` -- the `client-build` job's own bundle grep |
| Walking speed is a named constant derived from `movement.walk_speed_millicells_per_s`, never a literal scattered through movement code; crossing a 40-cell viewport at the committed speed takes 18s within tolerance across jittered frame deltas (FR137) | covered | `client/tests/unit/world/no-speed-literal.test.ts`, `client/tests/unit/world/defs-movement.test.ts` |
| Client movement code under `world/**` never imports `pixi.js`, values from `net/` (only `net/bindings` types, type-only) or `demo/`, and never touches `window`/`document` | covered | `client/biome.json` -- the `src/world/**` override's `noRestrictedImports` and `noRestrictedGlobals`, run by the `client-check` job |
| A collision query is `O(1)`: the number of cells examined for the same move is identical whether the grid holds 10 or 100k objects placed elsewhere, and no row query happens in the movement path | covered | `client/tests/unit/world/movement.test.ts` -- the counting-wrapper test |
| Colliders declared in `defs/objects` reach the running client: the grid def map is built from the fetched document, and a def sub-tile collider both blocks and lets the player past the free part of its cell (FR128) | covered | `client/src/world/object-defs.ts`, `client/tests/unit/world/defs-movement.test.ts` |
| The grid frees a chunk when its last entry is deleted, and a floor when its last chunk goes, so a streaming session never accumulates chunks it no longer has an entry in | covered | `client/tests/unit/world/collision-grid.test.ts` -- `inv_collision_grid_matches_rebuild` compares `allocatedChunkCount` too |
| The player can never walk off the drawn world: for any input sequence, every step keeps the drawn body over the interior floor or the pavement | covered | `client/tests/unit/test-street/drawables.test.ts` -- the boundary-ring property |
| Holding a direction key moves the avatar within three animation frames with no round trip (FR137); it comes to rest against a real collider and never pauses at a collider-less prop | covered | `client/tests/e2e/test-street.spec.ts` (which replaced `movement.spec.ts`) |
| FR120: a near-side wall of the building the viewer occupies is retracted, keyed on the ownership id alone (never proximity); a viewer outside any building or a wall it does not own is never retracted. Near-side-ness itself is derived from ownership and cell coordinates alone (the cell directly south is not the same building), never a hand-authored per-prop flag | covered | `client/src/render/visibility.ts` -- `isRetracted`, `isNearSideWall`, `client/tests/unit/render/visibility.test.ts` |
| FR121: a window drawable that is not hidden is translucent, at `render.window_alpha` (a balance key, never a literal); retraction wins over the window rule for a retracted near-side window | covered | `client/src/render/visibility.ts` -- `computeVisibility`, `client/tests/unit/render/visibility.test.ts` |
| FR122: two floors of opposite sign are never co-visible, compared by sign alone (never against the literal -1); a floor transition changes floor and position together, from one call, never one without the other | covered | `client/src/render/visibility.ts` -- `isFloorCulled`, `client/src/world/floor-walk.ts` -- `stepAndTransition`, `client/tests/unit/world/floor-walk.test.ts` |
| A floor transition fires only when a step walks into its anchor cell, never on arrival by transition and never while a key stays held on the landing cell; two mutually-targeting transitions never bounce (FR117/FR122) | covered | `client/src/world/floor-walk.ts`, `client/tests/unit/world/floor-walk.test.ts` |
| The transition index refuses a duplicate anchor rather than silently keeping only the last one declared at it | covered | `client/src/world/transitions.ts`, `client/tests/unit/world/transitions.test.ts` |
| The player own drawable `floor` follows a floor transition, so the player is never floor-culled from its own new position the instant it lands | covered | `client/src/render/sort-key.ts` -- `setDrawableFloor`, `client/src/test-street/drawables.ts` -- `updatePlayerDrawable`, `client/tests/unit/test-street/drawables.test.ts` |
| While the viewer is inside an enclosure, that same building floors above the viewer own floor are culled too (Artie direction, the same ownership-keyed rule as retraction) | covered | `client/src/render/visibility.ts` -- `isStoreyAboveCulled`, `client/tests/unit/render/visibility.test.ts` |
| No masking, filter or render-texture construct exists anywhere under `client/src/` (FR121) | covered | `scripts/ci/check-no-masks.sh`, run by the `client-check` job; `scripts/ci/tests/test-check-no-masks.sh`, run by `scripts-tests`; `client/tests/e2e/enclosure.spec.ts` -- `masksAllNull`, checked against the real, mounted display list |
| The permanent `render/**` modules (`visibility.ts` included) cannot import `pixi.js`, same discipline as the `world/**` import ban | covered | `client/biome.json` -- the `src/render/**` override's `noRestrictedImports` |
| The real, mounted `VisibilityApplier` reaches the same FR120/FR121/FR122 states the pure `computeVisibility` function predicts, after a real keyboard-driven walk into and out of an enclosure and into and out of the subway | covered | `client/tests/e2e/enclosure.spec.ts` |
| The street own committed transitions never target another transition own anchor cell -- a fixture-data sanity check, not the guard against the underlying bounce bug (see the edge-triggered `floor-walk.ts` row above) | covered | `client/tests/unit/test-street/fixture.test.ts` |
| Two storeys whose screen rects overlap (a bridge deck over the street it spans) are separated by one four-pass stack per floor, drawn in ascending floor order -- never a z-offset, a container trick in scene code, or a floor term in the sort key (FR124) | covered | `client/src/render/floor-stacks.ts`, `client/tests/unit/render/floor-stacks.test.ts`, `client/tests/e2e/test-street.spec.ts` -- the mounted order at the underpass |

## The hand-laid test street

Story 1.13: the one scene every foundation in Epic 1 is proven on, by use
rather than by unit test (AC1-AC3). Same Guard-path discipline as the
sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| AC1: the street is hand-laid from a hardcoded object set, placed by real `defs/objects` ids, with no generator -- and is one directory plus one import in `main.ts` to delete when Epic 3 replaces it | covered | `client/src/test-street/fixture.ts`, `client/tests/unit/test-street/street-conformance.test.ts`; `client/biome.json` -- the `render/**`, `world/**` and `input/**` overrides that forbid importing it back |
| AC2: the street really contains every foundational case -- two floors at one (x, y), a transition cell on each floor walked, a building with retractable near-side walls, a window with furniture behind it, a multi-cell prop, and a prop whose collider is smaller than its footprint | covered | `client/tests/unit/test-street/street-conformance.test.ts` |
| The street is legal world data: no overlapping same-kind ownership rects, every rect inside the one chunk its anchor corner names, both ends of every transition standable -- the same refusals `sim::world::WorldSpec::build` makes (NFR30) | covered | `client/src/world/world-spec.ts`, `client/tests/unit/world/world-spec.test.ts`, `client/tests/unit/test-street/street-conformance.test.ts` |
| The scripted walk is collision-feasible against the real resolver and the real grid before any browser runs it, and a whole lap ends back where it started | covered | `client/tests/unit/test-street/street-conformance.test.ts` |
| AC3: pressing a movement key drives a character down that street, with collision, depth sorting, wall retraction, floor culling and appearance all behaving correctly together rather than only in isolation -- real key presses only, no teleport hook, every wait a condition and never a fixed timeout | covered | `client/tests/e2e/test-street.spec.ts` |
| A pixel-level regression at the interior checkpoint and the underpass is caught even when every id-based assertion above still passes -- a fixed 1920x1080 viewport, animations disabled, a frozen street crowd for a deterministic frame, baselines generated on the CI image (Quentin's direction) | covered | `client/tests/e2e/test-street.spec.ts` -- the two `toHaveScreenshot` checks, `.github/workflows/update-visual-baselines.yml` |
| NFR2: a walked session at 1080p, including interior transitions, keeps p95 frame *work* under 8 ms and max under 16.7 ms, and does not leak over ten minutes. Partial: the harness and the regression gate ship here; "a busy street at rush hour" needs NPC crowds and is deferred to story 5.4 (L3 frame budget). The sustained-60-FPS half is deliberately not gated in CI -- a GPU-less headless runner cannot measure it without being flaky -- and belongs to spike 1.14 | partial | `client/tests/e2e/street-perf.spec.ts` (the `perf` Playwright project), `.github/workflows/ci.yml` -- the `e2e` job's own perf step, `.github/workflows/perf-soak.yml` -- the ten-minute soak, intentionally outside the `ci` gate |

## Input and intents

Story 1.9: FR148's intents and FR149's keybindings. Same Guard-path
discipline as the sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| Nothing in the input layer encodes what an intent means (AC3): an `Intent` is an object instance and its definition, with no verb, action or kind field, and `src/input/**` cannot import a procedure, an interaction module, `net/` (bindings included), `demo/` or `pixi.js` | covered | `client/src/input/intent.ts`; `client/biome.json` -- the `src/input/**` override; `scripts/ci/check-input-boundary.sh`, run by `client-check`; `scripts/ci/tests/test-check-input-boundary.sh`, run by `scripts-tests`; `client/tests/unit/input/pick.test.ts` -- the exact-shape and two-consumers tests |
| An object declares an interaction by carrying an `interact_at` rect and no other way; the rect has positive area, reaches no further than `INTERACT_AT_MAX_REACH_CELLS` beyond its own footprint, and never lies entirely inside the object own collider -- rejected identically by the build tool and by the client own parser (FR148) | covered | `tools/defs-build/src/validate.rs` -- `check_object_interact_at`, `client/src/defs/parse.ts` -- `checkInteractAtReach`, `tools/defs-build/tests/shared_malformed_cases.rs`, `client/tests/unit/defs/malformed.test.ts` |
| Picking never uses PixiJS hit-testing: exactly one `pointerdown`/`pointermove` listener on the canvas element, and no `eventMode`, `interactive` or per-sprite pointer handler anywhere under `client/src/` | covered | `client/src/input/pointer.ts`, `client/tests/unit/test-street/no-federated-events.test.ts` |
| A click or hover resolves to the object *drawn* under the pointer, including the part of a bottom-anchored sprite drawn above its own footprint: the index covers the cells a prop art overhangs into, and the point must fall inside the rect that object own sprites occupy. Known limitation, accepted for this story: the test is the whole sprite rectangle, transparent corners included -- per-pixel alpha is not consulted, so a click in a transparent corner of a sprite still resolves to it (FR148) | covered | `client/src/input/pick.ts` -- `topmostAt`'s narrow phase, `client/tests/unit/input/pick.test.ts` -- the drawn-extent cases, `client/tests/e2e/intents.spec.ts` -- the bin-lid click |
| The affordance follows the player, not only the mouse: with the pointer held still, walking into an object own `interact_at` marks it and walking out clears it, as does a visibility change under a still cursor (FR173) | covered | `client/src/input/pointer.ts` -- `refresh`, `client/tests/unit/input/pointer.test.ts`, `client/tests/e2e/intents.spec.ts` |
| A click is visibly ignored without anything being drawn for it: the highlight stays withheld and the cursor blips to `not-allowed` once, never pulsing, and an in-reach click adds no confirmation effect of its own (AC2, D17) | covered | `client/src/input/pointer.ts` -- `IGNORED_CURSOR_MS`, `client/tests/unit/input/pointer.test.ts`, `client/tests/e2e/intents.spec.ts` -- the real canvas element's own cursor |
| The affordance mark is confined to the hovered object own drawables and leaves nothing behind: one additive overlay sprite per drawable, built on hover and destroyed on un-hover, never a tile tint, an outline or a filter (FR173, FR121) | covered | `client/src/test-street/scene.ts` -- `HIGHLIGHT_ALPHA`/`buildHighlightOverlays`, `scripts/ci/check-no-masks.sh` |
| A real click on the real canvas records exactly one intent for the object clicked, records an ignore and no intent once out of range, and a rebind survives a reload while cleared storage boots on defaults with no console error (AC1/AC2/AC4) | covered | `client/tests/e2e/intents.spec.ts` |
| Movement keys resolve `KeyboardEvent.code`, never `.key`, so Shift, CapsLock and a non-QWERTY layout never stop a walk; the old key stops working the moment it is rebound | covered | `client/src/input/keyboard.ts`, `client/tests/unit/input/keyboard.test.ts` |
| Keybindings live in exactly one versioned `localStorage` key, written only on a real rebind; reading never throws and never writes, and never touches another key in the same origin (FR149) | covered | `client/src/input/keybindings-storage.ts`, `client/tests/unit/input/keybindings-storage.test.ts` |
| The DOM UI surface gains exactly one thing: the FR151 options menu, opened with `Escape`, which takes the keyboard while open, never pauses the world, and never blocks with `alert()`/`confirm()` | covered | `client/src/ui/options-menu.ts`, `client/tests/unit/ui/options-menu.test.ts` |
| The options menu is usable without a mouse: focus starts inside the panel on open and returns to the page on close, Tab cycles within the panel rather than leaking behind the backdrop, Tab cancels a capture instead of binding itself, and every keycap prints a readable key name rather than a `KeyboardEvent.code` | covered | `client/src/ui/options-menu.ts` -- `trapTab`/`keycapLabel`, `client/tests/unit/ui/options-menu.test.ts` |
| NFR6: mouse and keyboard only -- no touch, pointer-gesture or controller handling is written anywhere in the input layer | covered | `client/src/input/pointer.ts` -- `pointerdown`/`pointermove` only, no touch or gesture listener; `client/src/input/keyboard.ts` |

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
| The spike report measured SpacetimeDB version never goes stale against the same three pins story 1.3 does | covered | `scripts/ci/check-spike-pin.sh` |
