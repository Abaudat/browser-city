# Generation Design

This is the home for placement constraints, adjacency tables, density
curves and neighbourhood parameter ranges -- the document
`docs/architecture.md`'s Rules section names as the home for rule
content. `docs/gdd.md`'s Level Design Framework states *intent* ("the
periphery is deliberately quiet"); this document turns intent into
rules; `defs/rules/*.toml` holds the executable rows. A claim is stated
in exactly one of those three, never two -- in particular, this document
never repeats a number or a tag `defs/` already carries: a rule entry
here is its `key`, its `status` (`committed`/`planned`), the pass that
consumes it, its scope, the parameters it reads and a one-sentence
intent, never the subject/ratio/spacing/direction that make it fire.
Those live only in the `defs/rules/*.toml` row the key names.

A rule arrives here before or with the code that consumes it, never
after: a `planned` row with no matching `defs/rules/` key is the
normal, expected state of most of this document today; the reverse --
a committed key with no row, or a row still marked `planned` once its
key is committed -- is a red build (`server/sim/tests/rule_examples.rs`).

The lowercase headings below (`## parameters` and the five `## <kind>`
sections) are machine-read, fixed shape -- exact heading text, one
table each, checked at every build. So is "## Must never be seen"'s own
`Claimed by`/`Status` pair, even though its heading is Title Case.
Every other section is free prose.

## Design laws

These apply to every rule recorded below, not just the ones already
written.

- **Friction is content.** A distribution rule must not sand the city
  into uniform convenience. Service coverage thinning with affluence or
  toward the periphery is intended; a rule guaranteeing everything is
  near everyone is a design defect, not a safety net.
- **The city grows** (Epic 14). New neighbourhoods generate adjacent to
  a city that already exists and is lived in. A whole-site rule is the
  expensive exception, and its own row must say how it behaves when the
  site is extended rather than generated fresh.
- **Every state change has an author.** Initial generation is the one
  sanctioned authorless act, because no citizen exists yet to have
  authored anything. Any later invocation of the generator is the
  outcome of the development chain (Epic 14), never spontaneous.

## Neighbourhood parameters

A neighbourhood is a point in a four-parameter space and nothing more
(FR113). No rule may name a neighbourhood; any "character" archetype
named in prose is an example vector through this space, not an identity
a rule can branch on. These are the same quantities the gentrification
loop (physical state -> desirability -> rent -> demographics) later
mutates -- they are the sim's own quantities, whose *initial* values the
generator sets, not generator-private knobs.

**Density has one definition: how tightly plots are packed along a
block** (the GDD's own wording). "Props visible per screen of street"
(below) and the citizen density a busy screen can support (a
consequence the gentrification loop reads later) are *consequences* a
rule derives from that packing, not second meanings of the word -- a
rule that wants either of those reads the packing value and derives
them, it never states them as if they were the parameter itself.

**Land-use mix is not a scalar.** The GDD names four uses --
residential, commercial, industrial, institutional -- so the parameter
is a share per use, four non-negative components summing to a whole,
never a single axis running between two of them. "Four parameters"
stays true; one of them is composite.

No range or curve value is invented here to fill the table below --
none exists in `defs/` yet (this document does not create
`defs/balance/generation.toml`). Two neighbourhoods at opposite ends of
a parameter must be tellable apart from a single screenshot with no
text; that is this section's own acceptance test, applied when the
first values land.

| Parameter | Unit | Range | Visible carrier |
| --- | --- | --- | --- |
| Density | plots per unit street length, integer | not yet ranged in `defs/` | plot packing along `2_City_Terrains`/`1_Terrains_and_Fences` ground coverage, and street-prop cadence (bins, benches, lamps, trees) from `3_City_Props` -- more plots and more props per screen at the high end, wide gaps and few props at the low end |
| Building age | integer, newer to older | not yet ranged in `defs/` | facade variant *within* `4_Generic_Buildings`, never family choice (family is Land-use mix's and Affluence's own carrier, see below). Older end: `Condo_9` (exposed pipes, posters and flyers, a stained base course), the `Condo_8` fire-escape/balcony/flyer dressing on a tenement body as assembled in `Condo_Example`, `Condo_4` (red brick, arched entrances, bay fronts, white cornices) and `Condo_6` (grey stone, round-arched windows). Newer end: `Condo_5` (flat teal panel block, ribbon windows, canopy entrance) and `Condo_1`/`Condo_2` (flat rendered facades, plain rectangular windows, no ornament). `Condo_3` and `Condo_7` sit mid-range. No set has an aged variant of itself, so age reads through architectural style and applied dressing alone, never a building visibly ageing in place. `5_Floor_Modular_Buildings` varies by ground-floor shop type, not by age; `7_Villas` and `9_Shopping_Center_and_Markets` ship one building style each -- neither carries an age range |
| Affluence | integer, poorer to richer | not yet ranged in `defs/` | which exterior family appears (`7_Villas`' detached houses at the high end vs `4_Generic_Buildings`' condo blocks at the low/mid end) and which `moderninteriors` theme dresses the interior (e.g. `26_Condominium_Singles` vs the plain `1_Generic` theme); prop density (a furnished vs. sparse room) is a generator output the rules produce, never a sprite variant -- no "sparse" or "furnished" sheet exists to carry it directly |
| Land-use mix | four shares (residential / commercial / industrial / institutional), integer, summing to a whole | not yet ranged in `defs/` | which family appears at all along a street: `4_Generic_Buildings`/`5_Floor_Modular_Buildings`/`7_Villas` (residential), `9_Shopping_Center_and_Markets`/`16_Office` (commercial), `8_Worksite` (industrial -- the only dedicated industrial family the tileset ships; the industrial end of this range is thin by construction, not by design choice), institutional families per FR116 once a later story adds them |

Three carriers, three parameters, never shared: building *family*
carries Land-use mix and, within a family, which family, Affluence;
facade *variant within* `4_Generic_Buildings` carries Building age;
plot packing and street-prop cadence carry Density. A row that reuses
a carrier already claimed above is wrong on sight.

## Rule scope and reads

Two columns on every rule row below read from closed vocabularies.

**`scope`** is the largest extent the engine must see to judge the
rule: `cell` (the subject and its immediate same-floor neighbours),
`room`, `building`, `neighbourhood`, `site`. The test for choosing: if
generating more city next door (Epic 14) could change whether an
existing placement still passes, the rule is `neighbourhood` or
`site`; if it could not, the rule is smaller than that. `site` is the
exception the city-grows design law above is about -- a row scoped
`site` owes its own row an answer to how it behaves when the site is
extended, stated in its intent or found in "Does not fit" below.

**`reads`** lists the neighbourhood parameters (by name, from the
table above, `+`-joined) whose value changes what the rule demands, or
`-` when none. Until "Does not fit"'s first gap below (a rule's
numbers cannot vary with a neighbourhood parameter) is closed, every
committed row is necessarily `-` -- a `reads` value naming an actual
parameter is itself evidence that gap has been closed.

## Passes

The spine is FR110's seven passes, coarse to fine. A pass not yet
implemented gets its heading and contract lines only, never speculative
rules invented to fill it. Rules are never grouped by building or
institution -- Institutions (FR116) are rows in the building-type pass,
expressed over tags exactly like everything else; a heading here named
after one institution would be the accreted-special-case shape this
document exists to prevent. Which rules a pass consumes is never
restated here: filter the `pass` column in the tables below -- a second,
prose copy of that mapping is exactly the kind of duplicate this
document's own opening paragraph forbids.

### Land use

- **Receives:** the city seed and the site bounds.
- **Hands down:** a coarse residential/commercial/industrial/
  institutional split across the site, and the spatial parameter field
  the whole city reads from then on. Story 3.2 (`sim::generation::land_
  use`) authors two of the four neighbourhood parameters at every point
  on the field -- land-use mix (which of the four uses) and density,
  including the centre-to-periphery falloff as a property of the field
  itself, not of any later pass; building age and affluence are added to
  this same field by the first pass that reads either (3.7), never a
  second field. A grown neighbourhood (Epic 14) is a new region of the
  same field, adjacent to the one already there.
- **Reads:** nothing -- it is the first pass, and the pass that
  authors the field every later pass reads.
- **Evidence:** [`docs/generation/land-use-seed-1.svg`](generation/land-use-seed-1.svg),
  [`-seed-2`](generation/land-use-seed-2.svg), [`-seed-3`](generation/land-use-seed-3.svg)
  -- flat colour per coarse cell (land use), density carried as opacity,
  a legend for the four uses; three seeds so the rules read as rules and
  not one lucky roll. Regenerated and diffed by `bounds/tests/generation_
  evidence_current.rs` (`cargo run -p bounds --bin dump-generation`
  regenerates it).

### Street network

- **Receives:** the land-use split and the parameter field.
- **Hands down:** the street graph (carriageway, pavement, kerb) blocks
  are subdivided from.
- **Reads:** density, land use.
- **Evidence:** [`docs/generation/street-network-seed-1.svg`](generation/street-network-seed-1.svg),
  [`-seed-2`](generation/street-network-seed-2.svg), [`-seed-3`](generation/street-network-seed-3.svg)
  -- one land-use tint per finished block (majority coarse-cell area,
  never per coarse cell -- a change of tint only ever falls at a real
  block edge), the street graph on top by tier (arterial/street/lane), a
  combined legend, and two 40x22-cell viewport outlines (one at the
  density peak, one at the farthest periphery) so the per-screen reading
  is judgeable directly from the image; same regen-and-diff guard as the
  row above.

### Plot subdivision

- **Receives:** a street-network block and the land-use field (each
  block's own land use and density) -- a pass reads every earlier pass's
  output it actually needs, never only its immediate predecessor's.
- **Hands down:** individual plots within the block, each recording its
  own front-facing side, land use and density. Faces are cut in a fixed
  order -- south, north, east, west, regardless of street tier -- and
  the face cut first takes the corner, so a south-facing corner plot
  (facade to the camera) is the wider one, and a corner plot is cut
  wider by exactly the inset its corner edge carries. Opposite rows run
  through to the block's mid-line and meet; a core at or under the
  density-interpolated ceiling (`max_core_depth_cells` at the peak,
  `max_core_depth_periphery_cells` at the edge -- deep gardens there) is
  absorbed into the rows as rear yard, and only a core past it stays
  open, as one explicit, recorded `open` plot (a future yard, park or
  car park) whose short side always clears `open_min_side_cells`. A face
  remainder too short for one module is never a plot of its own: it is
  absorbed into the rows beside it. A block with no street frontage at
  all, or too small on some axis for one module, yields one whole-block
  `open` plot rather than a landlocked or unbuildable one.
- **Reads:** density, land-use mix.
- **Evidence:** [`docs/generation/envelopes-seed-1.svg`](generation/envelopes-seed-1.svg),
  [`-seed-2`](generation/envelopes-seed-2.svg), [`-seed-3`](generation/envelopes-seed-3.svg)
  -- shared with the building-envelope pass below: the street-network
  SVG's own block tint and streets as the backdrop, every plot's outline
  on top (`open` ones hatched, front edge a heavier stroke), a legend;
  same regen-and-diff guard as the rows above.

### Building envelope

- **Receives:** a plot.
- **Hands down:** a building footprint -- at this story, an abstract
  outer rectangle only (no wall cells, no entrance cell yet; the sealed
  exterior shell lands with the story that first rasterises one, which is
  what `front` is recorded for), or a typed rejection when the plot
  cannot hold its own land use's minimum usable interior -- never a
  footprint shrunk below that minimum. The footprint fills its plot's
  full available width exactly (variety comes from the plot rhythm, never
  from shaving the frontage) and its available depth minus a small keyed
  trim; every envelope on a block sits the same setback behind its own
  street edge, and a corner envelope sits flush to both streets' build
  lines. At or above the density threshold the gap between neighbours
  is 0 (party walls); below it, the committed side gap exactly -- never
  1 cell.
- **Reads:** density, land-use mix (not building age: pass 5, building
  type, has not run yet, so the "intended type" this pass sizes against
  is the plot's own land use).
- **Evidence:** the same three files as the plot-subdivision pass above
  -- every plot's own yard (a lighter tint, `open` ones hatched, rejected
  ones hatched distinctly) and every placed envelope (a darker, opaque
  fill, a door tick on its own front edge), plus two residential insets
  at viewport scale (the block nearest the density peak and the farthest
  one, so plot packing alone is what differs) since a 12x11 envelope is
  unreadable at 512-cell scale; same regen-and-diff guard.

### Building type

- **Receives:** a sealed envelope.
- **Hands down:** what the building *is* (residential, a named
  institution, a shop family, a workplace).
- **Reads:** affluence, land-use mix.
- **Evidence:** (added when the pass lands.)

### Interior layout

- **Receives:** a building's own type and envelope.
- **Hands down:** the room grammar's own composition (walls, floor,
  doors) and enterable status.
- **Reads:** affluence.
- **Evidence:** (added when the pass lands.)

### Prop placement

- **Receives:** a finished interior or exterior cell set.
- **Hands down:** the placed props a player actually walks past.
- **Reads:** density, affluence, building age.
- **Evidence:** (added when the pass lands.)

## Density is per screen

The unit of a density curve is the viewport, not the city (`docs/gdd.md`'s
"density is local"; the tile size the viewport is measured in is
`render.tile_size_px`, `defs/balance/render.toml` -- not restated here
as a number, so the two can never drift). Density curves are recorded
as *props visible per screen of street* along the centre-to-periphery
axis, a consequence of the Density parameter above, never a city-wide
ratio and never a second meaning of "density". The numbers themselves
arrive with the pass that consumes them, settled against full-viewport
screenshots -- not invented here. Two constraints on the curve are about
look, not tuning, and hold from this document on:

- The periphery gets *fewer* props, never missing ground or broken
  joins -- sparse reads as quiet, a gap reads as a bug.
- Density is clustered with purpose (bins by benches, clutter by
  shopfronts, lamps and trees on a regular cadence), never uniform
  scatter -- noise reads as generated, rhythm reads as real.

## Targets

The Scale Baseline (`docs/gdd.md`, NFR14) is the acceptance target for
the rule set as a whole. The numbers themselves are cited there, not
restated here -- `docs/gdd.md` wins if the two are ever found to
disagree.

| Target | Owning pass |
| --- | --- |
| Site extent | Land use / Street network |
| Building count | Building envelope |
| Workplace count | Building type |
| Enterable interior count | Interior layout |
| Profession count and employer depth | Building type (job definition) |
| Citizen count | Outside generation -- the sim's own population, seeded onto generated workplaces/dwellings |

## parameters
| balance key | status | pass | intent |
| --- | --- | --- | --- |
| generation.site_extent_cells | committed | Land use | the site's own square extent, in world cells |
| generation.land_use.coarse_cell_size_cells | committed | Land use | world cells per coarse land-use cell; the site extent must be a whole multiple of it |
| generation.land_use.min_leaf_cells | committed | Land use | the minimum size, on both axes, of a recursively-subdivided land-use district -- the guaranteed lower bound on a region's own area |
| generation.land_use.max_leaf_cells | committed | Land use | a district larger than this on either axis is split again |
| generation.land_use.split_jitter_pct | committed | Land use | how far a district split position may jitter from the rect's own midpoint |
| generation.land_use.max_recursion_depth | committed | Land use | a safety cap on recursive district-subdivision depth |
| generation.land_use.density_min | committed | Land use | density at the site's own edge |
| generation.land_use.density_max | committed | Land use | density at the field's own peak |
| generation.land_use.density_peak_offset_min_pct | committed | Land use | the density peak's own minimum offset from the site's geometric centre, as a percent of half the site extent (NFR8: never a perfectly concentric field) |
| generation.land_use.density_peak_offset_max_pct | committed | Land use | the density peak's own maximum offset from the site's geometric centre, same unit |
| generation.land_use.share_residential_pct | committed | Land use | the residential share of the land-use mix |
| generation.land_use.share_commercial_pct | committed | Land use | the commercial share of the land-use mix |
| generation.land_use.share_industrial_pct | committed | Land use | the industrial share of the land-use mix |
| generation.land_use.share_institutional_pct | committed | Land use | the institutional share of the land-use mix; the four shares sum to a whole |
| generation.land_use.institutional_min_pockets | committed | Land use | the minimum number of mutually non-adjacent institutional components a site must show -- "a school, a clinic and a town hall do not share a campus" |
| generation.land_use.institutional_max_pocket_share_percent | committed | Land use | no single institutional component may exceed this percent of the site's own coarse-cell count |
| generation.streets.arterial_count_ns_min | committed | Street network | the minimum north-south arterial count -- seeded uniformly in `[..._min, ..._max]`, never a fixed count |
| generation.streets.arterial_count_ns_max | committed | Street network | the maximum north-south arterial count |
| generation.streets.arterial_count_ew_min | committed | Street network | the minimum east-west arterial count |
| generation.streets.arterial_count_ew_max | committed | Street network | the maximum east-west arterial count |
| generation.streets.arterial_width_cells | committed | Street network | an arterial's own carriageway-plus-pavement width |
| generation.streets.street_width_cells | committed | Street network | a street-tier segment's own carriageway-plus-pavement width |
| generation.streets.lane_width_cells | committed | Street network | a lane-tier segment's own carriageway-plus-pavement width |
| generation.streets.arterial_jitter_pct | committed | Street network | how far an arterial may jitter from its own even band position |
| generation.streets.block_size_min_cells | committed | Street network | target block side length at the field's own maximum density |
| generation.streets.block_size_max_cells | committed | Street network | target block side length at the field's own minimum density |
| generation.streets.min_block_depth_cells | committed | Street network | the minimum margin a recursive split must leave on each side |
| generation.streets.max_block_depth_min_cells | committed | Street network | a harder ceiling than the density target, applied to a block's own *shorter* side, at the field's own maximum density: a block whose short side still exceeds this gets a further lane-tier split |
| generation.streets.max_block_depth_max_cells | committed | Street network | the same ceiling's own value at the field's own minimum density -- interpolated like `block_size_min/max_cells`, so the periphery's own larger blocks are not cancelled by a flat ceiling |
| generation.streets.max_street_splits_per_superblock | committed | Street network | how many street-tier (not lane-tier) cuts one superblock may take before an over-target block is split with a lane instead -- keeps the core from reading as half asphalt; commercial blocks are exempt (always street tier) |
| generation.streets.junction_min_separation_cells | committed | Street network | the minimum net gap, carriageway edge to carriageway edge, between two junctions on the same street line -- a split that cannot land clean against this is refused outright, never merely snapped clear |
| generation.streets.split_jitter_pct | committed | Street network | how far a block split position may jitter from the rect's own midpoint |
| generation.streets.max_recursion_depth | committed | Street network | a safety cap on recursive block-subdivision depth |
| generation.streets.max_lane_splits | committed | Street network | a safety cap on the extra lane-tier splits one over-deep block may take (bypassed when the block still spans more than one land-use region -- AC2's "never stranded" is a hard bound) |
| generation.streets.min_distinct_block_sizes | committed | Street network | the minimum number of distinct block widths, and separately heights, a city must show ("not a perfect grid") |
| generation.streets.detour_long_pair_cells | committed | Street network | `max_detour_percent`'s own ratio applies only to pairs at least this far apart (Manhattan); closer pairs are bounded by `max_detour_excess_cells` instead |
| generation.streets.max_detour_percent | committed | Street network | the Manhattan-fitness ratio ceiling 3.11's pathfinding estimator relies on, for long pairs |
| generation.streets.max_detour_excess_cells | committed | Street network | the additive Manhattan-fitness ceiling (world cells), applied to every sampled pair regardless of distance |
| generation.streets.p99_detour_percent | committed | Street network | the 99th-percentile detour ratio, over one city's own sampled pairs, must not exceed this -- `max_detour_percent` alone only bounds the single worst pair |
| generation.streets.peripheral_low_band_floor_percent | committed | Street network | per-city anti-inversion floor: the low-density (periphery) mean block area must be at least this percent of the high-density (core) mean |
| generation.streets.peripheral_pooled_min_ratio_percent | committed | Street network | pooled over a fixed seed range, summed low-band mean area over summed high-band mean area must be at least this percent -- the guard that actually fails a density-blind generator |
| generation.plots.frontage_min_cells | committed | Plot subdivision | AC1: a plot fronts a street iff it shares at least this many world cells of edge length with a street-abutting side of its own block; corner-point contact is landlocked |
| generation.plots.high_density_threshold | committed | Plot subdivision | the density at or above which a block's own build line sits flush on the pavement (setback 0, party walls); shared with the building-envelope pass's own side-gap step |
| generation.plots.setback_periphery_cells | committed | Plot subdivision | the one shared build-line setback every plot on a below-threshold block sits behind |
| generation.plots.residential_width_min_cells | committed | Plot subdivision | the rhythm-module width band a residential block face draws its plot widths from, minimum end |
| generation.plots.commercial_width_min_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_width_min_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_width_min_cells | committed | Plot subdivision | same, institutional |
| generation.plots.residential_width_max_cells | committed | Plot subdivision | the same residential band's maximum end |
| generation.plots.commercial_width_max_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_width_max_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_width_max_cells | committed | Plot subdivision | same, institutional |
| generation.plots.residential_row_depth_cells | committed | Plot subdivision | a residential plot's own depth from its block face inward |
| generation.plots.commercial_row_depth_cells | committed | Plot subdivision | same, commercial |
| generation.plots.industrial_row_depth_cells | committed | Plot subdivision | same, industrial |
| generation.plots.institutional_row_depth_cells | committed | Plot subdivision | same, institutional |
| generation.plots.max_core_depth_cells | committed | Plot subdivision | the most a block's own leftover core may reach on either axis before it becomes an explicit `open` plot rather than being absorbed into the rows as rear yard -- at the density peak |
| generation.plots.max_core_depth_periphery_cells | committed | Plot subdivision | the same ceiling at the periphery, interpolated by density between the two: deep rear gardens there, a small yard at the core |
| generation.plots.open_min_side_cells | committed | Plot subdivision | the minimum short side of any `open` plot this pass creates of its own accord -- a residue narrower than this is never a plot of its own |
| generation.plots.max_open_percent_by_count | committed | Plot subdivision | the maximum percent of a district's plots that may be `open`, by count -- asserted per city |
| generation.plots.max_open_percent_by_area | committed | Plot subdivision | the same ceiling by plotted area |
| generation.plots.max_unplotted_percent | committed | Plot subdivision | the maximum percent of every block's summed area that may belong to no plot at all, citywide |
| generation.envelopes.wall_thickness_cells | committed | Building envelope | the wall ring's own thickness, both axes -- interior usable floor is the footprint minus two of these per axis |
| generation.envelopes.residential_min_interior_width_cells | committed | Building envelope | the minimum usable interior width a residential footprint must clear, checked against the interior net |
| generation.envelopes.commercial_min_interior_width_cells | committed | Building envelope | same, commercial |
| generation.envelopes.industrial_min_interior_width_cells | committed | Building envelope | same, industrial |
| generation.envelopes.institutional_min_interior_width_cells | committed | Building envelope | same, institutional |
| generation.envelopes.residential_min_interior_depth_cells | committed | Building envelope | the same residential minimum's depth |
| generation.envelopes.commercial_min_interior_depth_cells | committed | Building envelope | same, commercial |
| generation.envelopes.industrial_min_interior_depth_cells | committed | Building envelope | same, industrial |
| generation.envelopes.institutional_min_interior_depth_cells | committed | Building envelope | same, institutional |
| generation.envelopes.max_width_cells | committed | Building envelope | the outer envelope ceiling, both axes, shared across every land use |
| generation.envelopes.max_depth_cells | committed | Building envelope | the outer envelope ceiling's own depth |
| generation.envelopes.side_gap_periphery_cells | committed | Building envelope | the total gap between two neighbouring envelopes on a below-threshold block -- half inset from each side; 0 at or above the threshold (party walls) |
| generation.envelopes.size_trim_max_cells | committed | Building envelope | the most a footprint's depth may trim back from filling its plot's available depth, for variety -- width is never trimmed |
| generation.envelopes.mean_width_cells | committed | Building envelope | AC3's own mean footprint width (12): the pooled mean over the fixed seed range 0..256 must sit within the tolerance below, every single city's own mean within a weak band four times as wide |
| generation.envelopes.mean_width_tolerance_cells | committed | Building envelope | the tolerance around the mean width |
| generation.envelopes.mean_depth_cells | committed | Building envelope | AC3's own mean footprint depth (11), same two bands |
| generation.envelopes.mean_depth_tolerance_cells | committed | Building envelope | the tolerance around the mean depth |
| generation.envelopes.min_distinct_sizes | committed | Building envelope | NFR8/AC3's anti-cheat floor: the minimum number of distinct (width, depth) footprint pairs a district must show |
| generation.envelopes.target_count_per_million_cells | committed | Building envelope | AC4's own building-count target -- the Scale Baseline's ~894 at 512x512, stated per one million site cells and scaled by real site area, never a measurement |
| generation.envelopes.count_tolerance_percent | committed | Building envelope | AC4's per-seed tolerance band around the scaled target, as a percent -- the wild-deviation guard |
| generation.envelopes.mean_count_tolerance_percent | committed | Building envelope | AC4's pooled band: the mean placed count over the fixed seed range 0..256 must sit within this percent of the scaled target |
| generation.envelopes.max_rejected_plot_percent | committed | Building envelope | the maximum percent of attempted plots the envelope pass may reject, asserted per city |

## placement
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| lighting_ground_floor_only | committed | Prop placement | cell | - | **placeholder** -- a street lamp standing on an upper-storey ledge instead of at street level |

## distribution
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| waste_per_three_seating | committed | Prop placement | site | - | **placeholder** -- seating with no bin anywhere nearby, or every bin clumped in one corner while the rest of the street collects litter; scoped `site` because distribution's own coverage math already is -- "Does not fit"'s distribution gap below is this row's own answer to how it behaves when the site grows |
| depot_present | committed | Building type | site | - | a depot per roughly `ratio` dwellings, never clustered with another depot -- "the district has a depot" (AC2); `max_distance` set past the site's own diagonal on purpose (no coverage ceiling on a municipal row, Derek's direction) |
| council_present | committed | Building type | site | - | same shape, the council |
| hospital_present | committed | Building type | site | - | same shape, the hospital |
| welfare_office_present | committed | Building type | site | - | welfare offices at a real ratio (never a singleton), spaced apart -- they sit where land is cheap, and the walk to them is content (Derek's direction), never guaranteed near |
| shelter_present | committed | Building type | site | - | same shape, shelters |

## coherence
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| no_counter_in_a_stairwell | committed | Interior layout | room | - | **placeholder** -- a shop till standing on a stairwell landing |
| no_high_rise_within_a_low_rise_block | committed | Building type | building | - | AC1, "no skyscraper among villas": a `form_high` building never shares a block with a `form_low` one -- the form-class scale is `defs/tags/generation.toml`'s own vocabulary, never a type key |

## adjacency
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| counter_faces_a_shopfront | committed | Interior layout | cell | - | **placeholder** -- a till with its back to a blank wall, no shopfront anywhere on its own perimeter |
| road_never_touches_wall | committed | Building envelope | cell | - | the carriageway running straight into a building wall with no pavement between them |
| road_never_touches_ground | committed | Building envelope | cell | - | asphalt bleeding directly into bare ground with no pavement edge |
| floor_never_touches_bare_ground | committed | Building envelope | cell | - | an interior floor tile exposed straight to bare ground, as if the wall around it were missing |
| floor_never_touches_pavement_directly | committed | Building envelope | cell | - | an interior floor tile touching street pavement with no wall or threshold sealing the room |
| floor_never_touches_road_directly | committed | Building envelope | cell | - | an interior floor tile opening straight onto the road |
| doorway_formed_between_walls | committed | Building envelope | cell | - | a gap in a wall run that reads as a hole, never a door -- no threshold, or the wrong tiles either side of it |
| wall_is_part_of_a_straight_run_or_a_corner | committed | Building envelope | cell | - | a lone wall stub standing in the open, joining nothing |
| entrance_opens_onto_pavement | committed | Building envelope | cell | - | a building's own front door opening onto another building's wall or into an interior room instead of the street |

## requirement
| key | status | pass | scope | reads | intent |
| --- | --- | --- | --- | --- | --- |
| walled_room_has_waste_bin | committed | Interior layout | room | - | **placeholder** -- stands in for a future room-completeness rule; describes nothing a real room looks like yet |
| room_has_a_door | committed | Interior layout | room | - | a sealed room a player can see into but never enter |
| building_has_an_entrance | committed | Building envelope | building | - | a building with no door anywhere on its own perimeter |
| footprint_sized_for_interior_usability | planned | Building envelope | building | - | a building whose frontage looks generous but whose interior is too cramped to hold the room grammar it needs |

## Must never be seen

Seeded now as intents, not rules. `Status` is `claimed` exactly when
`Claimed by` names at least one key and every key it names is
`committed` in a kind table above under the section `Expected kind`
names; `unclaimed` otherwise -- checked mechanically, not by eye.

| Visual failure | Expected kind | Claimed by | Status |
| --- | --- | --- | --- |
| Two premises of the same chain adjacent to or facing each other on one street | distribution | | unclaimed |
| A cell with no ground drawable at all | adjacency | | unclaimed |
| A kerb that stops mid-run, leaving a bare seam | adjacency | | unclaimed |
| Pavement that ends mid-block with no terminating piece | adjacency | | unclaimed |
| A road that dead-ends into a wall with no terminating piece | adjacency | | unclaimed |
| A door that opens directly onto the road | adjacency | | unclaimed |
| A door that opens onto another wall | adjacency | | unclaimed |
| A door blocked by a prop sitting on its own threshold cell | requirement | | unclaimed |
| Street furniture placed on the carriageway | placement | | unclaimed |
| Pavement furniture leaving less than one walkable cell of pavement | adjacency | | unclaimed |
| The same facade repeated side by side with no variation, beyond what a real terrace would do | distribution | | unclaimed |
| The same prop sprite repeated side by side with no variation | distribution | | unclaimed |
| A shopfront with no counter behind it | requirement | | unclaimed |
| A building with no entrance anywhere on its own perimeter | requirement | building_has_an_entrance | claimed |
| Interior-sheet props placed on the street | coherence | | unclaimed |
| Exterior-sheet props placed indoors | coherence | | unclaimed |
| A street with no lighting at all | distribution | | unclaimed |
| Lamps at irregular spacing along a street | distribution | | unclaimed |
| A land-use boundary cutting through the middle of a block, rather than running along a street | adjacency | | unclaimed |
| Two parallel streets close enough to leave a sliver block no plot can use | adjacency | | unclaimed |
| A street that jogs sideways within less than a minimum block length | coherence | | unclaimed |
| A road that stops a few tiles short of the site edge instead of exiting cleanly through it | adjacency | | unclaimed |
| A uniform, symmetric empty ring around the site's own periphery | distribution | | unclaimed |
| A plot with no street frontage | adjacency | | unclaimed |
| A building standing off its block face's shared build line | coherence | | unclaimed |
| A 1-cell slit between two buildings | adjacency | | unclaimed |
| Land inside a block that belongs to no plot | requirement | | unclaimed |
| A building whose entrance faces the block interior or a side passage | adjacency | | unclaimed |
| A vacant gap in an otherwise continuous high-density street wall | coherence | | unclaimed |

The five `defs/rules/city.toml` rows and the `defs/rules/grammar.toml`
rows above are placeholders and grammar primitives, not a claim on this
catalogue: `entrance_opens_onto_pavement` and `doorway_formed_between_walls`
guard individual room/building composition, not a whole generated
street, so the rows they overlap stay `unclaimed` until a real
generation-pass rule claims them -- `building_has_an_entrance` is the
one exception, because "a building has no entrance" is the same claim
at either scale.

Until a rule claims them, five of the pass 3-4 rows are guarded by a
proptest invariant each (`server/sim/tests/invariants.rs`) rather than
by nothing: "A plot with no street frontage" by
`inv_generation_every_plot_fronts_a_street`; "A 1-cell slit between two
buildings" by `inv_generation_envelope_gaps_are_zero_or_at_least_two`
(every pair of envelopes in a block, both axes, whichever face each
belongs to); "Land inside a block that belongs to no plot" by
`inv_generation_unplotted_percent_bounded` (an explicit `open` core is a
plot) and `inv_generation_open_plots_are_never_slivers`; "A vacant gap in
an otherwise continuous high-density street wall" by
`inv_generation_no_open_plot_on_a_built_face_at_high_density`; and a
building under its own class's floor (8x8 outer for residential, the
smallest) by `inv_generation_envelope_size_within_its_class_band`.

## Does not fit

Two gaps the five kinds cannot express today, found by checking the
design laws above against `server/sim/src/rules/mod.rs` rather than
assumed:

- **A rule's numbers cannot vary with a neighbourhood parameter.**
  Every `RuleKind` field is a constant (a ratio, a spacing, a floor
  range); none reads a parameter's value at generation time. "Service
  coverage thinning with affluence or toward the periphery" (the
  friction-is-content law above) cannot be written as a rule until this
  exists. Owned by the neighbourhood-character story, unless an earlier
  pass needs it first.
- **Distribution cannot be scoped below the whole site.** A
  distribution row's ratio, spacing and coverage are "measured over the
  whole site... never a per-container one" (`sim::rules::mod.rs`), so
  every distribution row is whole-site by construction -- itself "the
  expensive exception" the city-grows law above asks each such row to
  explain, and a whole-site constant with a coverage ceiling is what
  the friction-is-content law calls a design defect if service
  coverage should instead thin toward the periphery. The periphery as a
  density falloff cannot be judged by the harness (FR112: generator and
  harness read one source) until this exists. Owned by the first story
  that adds a real distribution row.

A rule that cannot be expressed as one of the five kinds over tags for
any other reason is written here too, with why -- a signal that a
system is missing, never licence for a bespoke branch in the generator
or a sixth kind added quietly.
